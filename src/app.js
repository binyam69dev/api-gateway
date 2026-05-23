require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const cookieParser = require("cookie-parser");
const expressRateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

// ============ IMPORT CUSTOM MIDDLEWARES ============
const { authMiddleware, adminMiddleware } = require("./middlewares/auth.middleware");
const { cache, clearCache, clearAllCache } = require("./middlewares/cache.middleware");
const { 
    rateLimit: customRateLimit, 
    authRateLimit, 
    apiRateLimit,
    clearRateLimit 
} = require("./middlewares/rateLimit.middleware");

const app = express();

// ============ HTTPS ENFORCEMENT ============
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https"
  ) {
    return res.redirect(301, "https://" + req.headers.host + req.url);
  }
  next();
});

// ============ CORS ============
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
    exposedHeaders: ["Set-Cookie", "Cookie"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  }),
);

// ============ HELMET CSP ============
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com",
          "https://accounts.google.com",
          "https://connect.facebook.net",
          "https://www.facebook.com",
          "https://github.com",
          "https://api.github.com",
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com",
          "https://accounts.google.com",
          "https://www.facebook.com",
        ],
        styleSrcElem: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdnjs.cloudflare.com",
          "https://accounts.google.com",
          "https://www.facebook.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com",
          "data:",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "https:",
          "https://platform-lookaside.fbsbx.com",
          "https://avatars.githubusercontent.com",
          "https://lh3.googleusercontent.com",
        ],
        connectSrc: [
          "'self'",
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:3002",
          "https://cdn.jsdelivr.net",
          "https://*.jsdelivr.net",
          "https://accounts.google.com",
          "https://oauth2.googleapis.com",
          "https://graph.facebook.com",
          "https://www.facebook.com",
          "https://api.github.com",
          "https://github.com",
        ],
        frameSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://www.facebook.com",
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  }),
);

app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ============ DEBUG ENDPOINT - Remove in production ============
app.get("/debug/cookies", (req, res) => {
  res.json({
    cookies: req.cookies,
    cookieNames: Object.keys(req.cookies || {}),
    hasCookies: !!req.headers.cookie,
    cookieHeader: req.headers.cookie || 'none'
  });
});

// ============ EXPRESS RATE LIMITING ============
const authLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  skipSuccessfulRequests: true,
});

const apiLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Too many requests. Please slow down." },
});

app.use("/auth/login", authLimiter);
app.use("/auth/register", authLimiter);
app.use("/api/", apiLimiter);

// ============ SESSION & PASSPORT ============
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const FacebookStrategy = require("passport-facebook").Strategy;
const jwt = require("jsonwebtoken");

app.use(
  session({
    secret: process.env.SESSION_SECRET || "session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

// ============ HELPER FUNCTION ============
async function findOrCreateUser(profile, provider, done) {
  try {
    const { pool } = require("./config/database");

    let email = profile.emails?.[0]?.value;
    if (!email && provider === "facebook") email = `${profile.id}@facebook.com`;
    if (!email && provider === "github") email = `${profile.id}@github.com`;

    const name = profile.displayName || profile.username || email.split("@")[0];
    const providerId = profile.id;
    const avatar = profile.photos?.[0]?.value || null;

    let userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR (social_provider = $2 AND social_id = $3)",
      [email, provider, providerId],
    );

    let user;

    if (userResult.rows.length === 0) {
      const insertResult = await pool.query(
        `INSERT INTO users (email, name, is_verified, role, created_at, social_provider, social_id, avatar, last_login_at) 
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, NOW()) 
         RETURNING id, email, name, role`,
        [email, name, true, "user", provider, providerId, avatar],
      );
      user = insertResult.rows[0];
      console.log(`Created new ${provider} user:`, user.email);
    } else {
      user = userResult.rows[0];
      await pool.query(
        `UPDATE users SET social_provider = $1, social_id = $2, avatar = COALESCE($3, avatar),
         last_login_at = NOW(), login_count = login_count + 1 WHERE id = $4`,
        [provider, providerId, avatar, user.id],
      );
      console.log(`Updated existing ${provider} user:`, user.email);
    }

    const authToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role || "user" },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "24h" },
    );

    return done(null, { ...user, token: authToken });
  } catch (error) {
    console.error(`${provider} auth error:`, error);
    return done(error, null);
  }
}

// ============ PASSPORT STRATEGIES ============
passport.use(
  "admin-google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.APP_URL || "http://localhost:3000"}/auth/admin/google/callback`,
      scope: ["profile", "email"],
    },
    (accessToken, refreshToken, profile, done) => {
      findOrCreateUser(profile, "google", done);
    },
  ),
);

passport.use(
  "developer-google",
  new GoogleStrategy(
    {
      clientID: process.env.DEV_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.DEV_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.APP_URL || "http://localhost:3000"}/auth/developer/google/callback`,
      scope: ["profile", "email"],
    },
    (accessToken, refreshToken, profile, done) => {
      findOrCreateUser(profile, "google", done);
    },
  ),
);

passport.use(
  "github",
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${process.env.APP_URL || "http://localhost:3000"}/auth/github/callback`,
      scope: ["user:email"],
    },
    (accessToken, refreshToken, profile, done) => {
      findOrCreateUser(profile, "github", done);
    },
  ),
);

passport.use(
  "developer-github",
  new GitHubStrategy(
    {
      clientID: process.env.DEV_GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.DEV_GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${process.env.APP_URL || "http://localhost:3000"}/auth/developer/github/callback`,
      scope: ["user:email"],
    },
    (accessToken, refreshToken, profile, done) => {
      findOrCreateUser(profile, "github", done);
    },
  ),
);

passport.use(
  "facebook",
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: `${process.env.APP_URL || "http://localhost:3000"}/auth/facebook/callback`,
      profileFields: ["id", "emails", "name", "picture.type(large)"],
    },
    (accessToken, refreshToken, profile, done) => {
      findOrCreateUser(profile, "facebook", done);
    },
  ),
);

passport.use(
  "developer-facebook",
  new FacebookStrategy(
    {
      clientID: process.env.DEV_FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.DEV_FACEBOOK_APP_SECRET || process.env.FACEBOOK_APP_SECRET,
      callbackURL: `${process.env.APP_URL || "http://localhost:3000"}/auth/developer/facebook/callback`,
      profileFields: ["id", "emails", "name", "picture.type(large)"],
    },
    (accessToken, refreshToken, profile, done) => {
      findOrCreateUser(profile, "facebook", done);
    },
  ),
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query("SELECT id, email, name, role FROM users WHERE id = $1", [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err, null);
  }
});

// ============ REFRESH TOKEN FUNCTIONS ============
function generateTokens(userId, email, role) {
  const accessToken = jwt.sign(
    { id: userId, email, role },
    process.env.JWT_SECRET || "secret",
    { expiresIn: process.env.JWT_EXPIRES_IN || "1h" },
  );
  const refreshToken = jwt.sign(
    { id: userId, email },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "secret",
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" },
  );
  return { accessToken, refreshToken };
}

async function storeRefreshToken(userId, refreshToken) {
  const { pool } = require("./config/database");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, refreshToken, expiresAt],
  );
}

// ============ REFRESH TOKEN ENDPOINT ============
app.post("/auth/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(401).json({ error: "Refresh token required" });
  }
  try {
    const { pool } = require("./config/database");
    const tokenResult = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()",
      [refreshToken],
    );
    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "secret");
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      decoded.id,
      decoded.email,
      decoded.role,
    );
    await pool.query("UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1", [refreshToken]);
    await storeRefreshToken(decoded.id, newRefreshToken);
    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

// ============ LOGIN ENDPOINT ============
app.post("/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  try {
    const { pool } = require("./config/database");
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: "Please login using Google, GitHub, or Facebook" });
    }
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      await pool.query("UPDATE users SET login_attempts = COALESCE(login_attempts, 0) + 1 WHERE id = $1", [user.id]);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    await pool.query("UPDATE users SET login_attempts = 0, last_login_at = NOW() WHERE id = $1", [user.id]);

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role || "user" },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1h" },
    );
    const refreshToken = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    try {
      await pool.query(`INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`, [user.id, refreshToken, expiresAt]);
    } catch (tableError) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          token TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          revoked BOOLEAN DEFAULT FALSE
        )
      `);
      await pool.query(`INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`, [user.id, refreshToken, expiresAt]);
    }

    const cookieOptions = {
      httpOnly: false,
      secure: false,
      sameSite: "lax",
      path: "/",
    };

    res.cookie("adminToken", accessToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 });
    res.cookie("devToken", accessToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 });
    res.cookie("refreshToken", refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    console.log("Cookies set successfully for user:", user.email);
    
    res.json({
      message: "Login successful",
      user: { id: user.id, email: user.email, name: user.name, role: user.role || "user" },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});
// ============ REGISTER ENDPOINT ============
app.post("/auth/register", authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }
  
  try {
    const { pool } = require("./config/database");
    
    // Check if user already exists
    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "User already exists" });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, created_at, is_verified) 
       VALUES ($1, $2, $3, $4, NOW(), $5) 
       RETURNING id, email, name, role`,
      [email, hashedPassword, name || email.split('@')[0], "user", true]
    );
    
    const newUser = result.rows[0];
    console.log("New user registered:", newUser.email);
    
    res.status(201).json({ 
      message: "Registration successful! Please login.",
      user: { id: newUser.id, email: newUser.email, name: newUser.name }
    });
    
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Server error during registration" });
  }
});

// ============ CHECK EMAIL EXISTS ============
app.post("/auth/check-email", async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }
  
  try {
    const { pool } = require("./config/database");
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    
    res.json({ exists: result.rows.length > 0 });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});
// ============ CONFIG ENDPOINTS ============
app.get("/api/config/google", (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID });
});


// ============ HEALTH & METRICS ============
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/metrics", authMiddleware, adminMiddleware, (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// ============ ROUTES API (CACHED) ============
app.get("/routes", cache(60), async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query(
      "SELECT path_pattern, method, required_role, rate_limit_per_minute, cache_ttl_seconds FROM routes WHERE is_active = true LIMIT 100",
    );
    res.json({ routes: result.rows });
  } catch (err) {
    res.json({ routes: [] });
  }
});

// ============ PORTAL API ============
app.get("/portal/my-requests", authMiddleware, async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query(
      "SELECT * FROM route_requests WHERE requested_by = $1 ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json({ requests: result.rows });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.post("/portal/request-route", authMiddleware, async (req, res) => {
  try {
    const decoded = req.user;
    const { path_pattern, method, target_url, reason } = req.body;
    const { pool } = require("./config/database");
    await pool.query(
      `INSERT INTO route_requests (requested_by, requested_by_email, path_pattern, method, target_url, reason, urgency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'normal', 'pending')`,
      [decoded.id, decoded.email, path_pattern, method, target_url, reason || ""],
    );
    res.json({ message: "Request submitted successfully" });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// ============ GOOGLE ONE-TAP LOGIN ============
app.post("/auth/google", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "No token provided" });
  try {
    const { OAuth2Client } = require("google-auth-library");
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { email, name, sub: googleId, picture } = payload;
    const { pool } = require("./config/database");

    let userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    let user;

    if (userResult.rows.length === 0) {
      const insertResult = await pool.query(
        `INSERT INTO users (email, name, is_verified, role, created_at, social_provider, social_id, avatar, last_login_at) 
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, NOW()) 
         RETURNING id, email, name, role`,
        [email, name || email.split("@")[0], true, "user", "google", googleId, picture],
      );
      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];
      await pool.query(
        `UPDATE users SET social_provider = $1, social_id = $2, avatar = COALESCE($3, avatar),
         last_login_at = NOW(), login_count = login_count + 1 WHERE id = $4`,
        ["google", googleId, picture, user.id],
      );
    }

    const authToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role || "user" },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "24h" },
    );

    const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
    res.cookie("adminToken", authToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 });
    res.cookie("devToken", authToken, { ...cookieOptions, maxAge: 60 * 60 * 1000 });

    res.json({ message: "Login successful", user: { id: user.id, email: user.email, name: user.name, role: user.role || "user" } });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(401).json({ error: "Invalid Google token: " + error.message });
  }
});

// ============ ADMIN OAUTH ROUTES ============
app.get("/auth/admin/google", passport.authenticate("admin-google", { scope: ["profile", "email"] }));
app.get("/auth/admin/google/callback", passport.authenticate("admin-google", { failureRedirect: "/login.html" }), (req, res) => {
  const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
  res.cookie("adminToken", req.user.token, cookieOptions);
  res.cookie("devToken", req.user.token, cookieOptions);
  res.redirect("/admin.html");
});

app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));
app.get("/auth/github/callback", passport.authenticate("github", { failureRedirect: "/login.html" }), (req, res) => {
  const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
  res.cookie("adminToken", req.user.token, cookieOptions);
  res.cookie("devToken", req.user.token, cookieOptions);
  res.redirect("/admin.html");
});

app.get("/auth/facebook", passport.authenticate("facebook", { scope: ["email"] }));
app.get("/auth/facebook/callback", passport.authenticate("facebook", { failureRedirect: "/login.html" }), (req, res) => {
  const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
  res.cookie("adminToken", req.user.token, cookieOptions);
  res.cookie("devToken", req.user.token, cookieOptions);
  res.redirect("/admin.html");
});

// ============ DEVELOPER OAUTH ROUTES ============
app.get("/auth/developer/google", passport.authenticate("developer-google", { scope: ["profile", "email"] }));
app.get("/auth/developer/google/callback", passport.authenticate("developer-google", { failureRedirect: "/developer-auth.html" }), (req, res) => {
  const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
  res.cookie("devToken", req.user.token, cookieOptions);
  res.cookie("adminToken", req.user.token, cookieOptions);
  res.redirect("/developer-dashboard.html");
});

app.get("/auth/developer/github", passport.authenticate("developer-github", { scope: ["user:email"] }));
app.get("/auth/developer/github/callback", passport.authenticate("developer-github", { failureRedirect: "/developer-auth.html" }), (req, res) => {
  const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
  res.cookie("devToken", req.user.token, cookieOptions);
  res.cookie("adminToken", req.user.token, cookieOptions);
  res.redirect("/developer-dashboard.html");
});

app.get("/auth/developer/facebook", passport.authenticate("developer-facebook", { scope: ["email"] }));
app.get("/auth/developer/facebook/callback", passport.authenticate("developer-facebook", { failureRedirect: "/developer-auth.html" }), (req, res) => {
  const cookieOptions = { httpOnly: false, secure: false, sameSite: "lax", path: "/" };
  res.cookie("devToken", req.user.token, cookieOptions);
  res.cookie("adminToken", req.user.token, cookieOptions);
  res.redirect("/developer-dashboard.html");
});

// ============ SOCIAL AUTH URL ENDPOINT ============
app.get("/auth/social/url/:provider", (req, res) => {
  const { provider } = req.params;
  const redirectUri = `${process.env.APP_URL || "http://localhost:3000"}/auth/${provider}/callback`;
  const urls = {
    google: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=email%20profile`,
    github: `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=user:email`,
    facebook: `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${redirectUri}&scope=email,public_profile`,
  };
  if (urls[provider]) {
    res.json({ url: urls[provider] });
  } else {
    res.status(404).json({ error: "Provider not supported" });
  }
});

// ============ USER PROFILE ENDPOINTS ============
app.get("/auth/profile", authMiddleware, async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query(
      `SELECT id, email, name, role, company, website, location, bio, avatar, created_at, monthly_requests, is_verified 
       FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/auth/update-profile", authMiddleware, async (req, res) => {
  const { name, company, website, location, bio } = req.body;
  try {
    const { pool } = require("./config/database");
    const updates = [];
    const values = [];
    let paramCount = 1;
    if (name !== undefined) { updates.push(`name = $${paramCount++}`); values.push(name); }
    if (company !== undefined) { updates.push(`company = $${paramCount++}`); values.push(company); }
    if (website !== undefined) { updates.push(`website = $${paramCount++}`); values.push(website); }
    if (location !== undefined) { updates.push(`location = $${paramCount++}`); values.push(location); }
    if (bio !== undefined) { updates.push(`bio = $${paramCount++}`); values.push(bio); }
    updates.push(`updated_at = NOW()`);
    values.push(req.user.id);
    if (updates.length === 1) return res.status(400).json({ error: "No fields to update" });
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramCount} RETURNING id, email, name, role, company, website, location, bio`;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, message: "Profile updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/update-avatar", authMiddleware, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: "Avatar data required" });
  try {
    const { pool } = require("./config/database");
    await pool.query(`UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`, [avatar, req.user.id]);
    res.json({ success: true, message: "Avatar updated successfully" });
  } catch (err) {
    console.error("Error updating avatar:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie("adminToken");
  res.clearCookie("devToken");
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out successfully" });
});

// ============ ADMIN ENDPOINTS ============
app.get("/admin/me", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query("SELECT id, email, name, role, company, created_at FROM users WHERE id = $1", [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/analytics", authMiddleware, adminMiddleware, cache(300), async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const routesResult = await pool.query("SELECT COUNT(*) FROM routes WHERE is_active = true");
    const developersResult = await pool.query("SELECT COUNT(*) FROM users");
    const pendingResult = await pool.query("SELECT COUNT(*) FROM route_requests WHERE status = $1", ["pending"]);
    let totalCalls = 0;
    try {
      const callsResult = await pool.query("SELECT COUNT(*) FROM api_usage");
      totalCalls = parseInt(callsResult.rows[0].count);
    } catch (err) { totalCalls = 0; }
    res.json({
      summary: {
        total_routes: parseInt(routesResult.rows[0].count),
        total_developers: parseInt(developersResult.rows[0].count),
        pending_requests: parseInt(pendingResult.rows[0].count),
        total_api_calls: totalCalls,
      },
    });
  } catch (err) {
    console.error("Error fetching analytics:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/developers", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query("SELECT id, email, name, role, company, created_at, monthly_requests, is_verified, avatar FROM users ORDER BY created_at DESC");
    res.json({ developers: result.rows });
  } catch (err) {
    console.error("Error fetching developers:", err);
    res.status(500).json({ error: err.message });
  }
});
// ============ GET CURRENT USER INFO WITH ROLE ============
app.get("/auth/me", authMiddleware, async (req, res) => {
    try {
        const { pool } = require("./config/database");
        const result = await pool.query(
            "SELECT id, email, name, role, created_at FROM users WHERE id = $1",
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        res.json({
            user: result.rows[0],
            role: result.rows[0].role,
            isAdmin: result.rows[0].role === 'admin'
        });
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});

app.get("/admin/requests/pending", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { pool } = require("./config/database");
    const result = await pool.query("SELECT * FROM route_requests WHERE status = $1 ORDER BY created_at ASC", ["pending"]);
    res.json({ requests: result.rows });
  } catch (err) {
    console.error("Error fetching pending requests:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/requests/:id/approve", authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const { pool } = require("./config/database");
    const requestResult = await pool.query("SELECT * FROM route_requests WHERE id = $1", [id]);
    if (requestResult.rows.length === 0) return res.status(404).json({ error: "Request not found" });
    const request = requestResult.rows[0];
    await pool.query(
      `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [request.path_pattern, request.method, request.target_url, "user", 100, 60, true, request.requested_by],
    );
    await pool.query("UPDATE route_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3", ["approved", req.user.id, id]);
    res.json({ success: true, message: "Request approved and route created" });
  } catch (err) {
    console.error("Error approving request:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/requests/:id/reject", authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const { pool } = require("./config/database");
    await pool.query("UPDATE route_requests SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $4", ["rejected", reason || "No reason provided", req.user.id, id]);
    res.json({ success: true, message: "Request rejected" });
  } catch (err) {
    console.error("Error rejecting request:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/requests/bulk-approve", authMiddleware, adminMiddleware, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: "No request IDs provided" });
  try {
    const { pool } = require("./config/database");
    for (const id of ids) {
      const requestResult = await pool.query("SELECT * FROM route_requests WHERE id = $1", [id]);
      if (requestResult.rows.length === 0) continue;
      const request = requestResult.rows[0];
      await pool.query(
        `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [request.path_pattern, request.method, request.target_url, "user", 100, 60, true, request.requested_by],
      );
      await pool.query("UPDATE route_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3", ["approved", req.user.id, id]);
    }
    res.json({ success: true, message: `${ids.length} requests approved` });
  } catch (err) {
    console.error("Error bulk approving:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/users/:userId/role", authMiddleware, adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!["user", "admin"].includes(role)) return res.status(400).json({ error: 'Invalid role. Must be "user" or "admin"' });
  try {
    const { pool } = require("./config/database");
    const currentUser = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
    if (currentUser.rows.length === 0) return res.status(404).json({ error: "User not found" });
    if (userId === req.user.id) return res.status(400).json({ error: "You cannot change your own role" });
    if (role === "user" && currentUser.rows[0].role === "admin") {
      const adminCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = $1", ["admin"]);
      if (parseInt(adminCount.rows[0].count) <= 1) return res.status(400).json({ error: "Cannot demote the last admin" });
    }
    await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2", [role, userId]);
    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (err) {
    console.error("Error updating role:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/routes/:path/:method", authMiddleware, adminMiddleware, async (req, res) => {
  const { path, method } = req.params;
  try {
    const { pool } = require("./config/database");
    await pool.query("DELETE FROM routes WHERE path_pattern = $1 AND method = $2", [decodeURIComponent(path), method]);
    res.json({ success: true, message: "Route deleted" });
    await clearCache(`cache:/routes*`);
  } catch (err) {
    console.error("Error deleting route:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/routes", authMiddleware, adminMiddleware, async (req, res) => {
  const { path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds } = req.body;
  if (!path_pattern || !target_url) return res.status(400).json({ error: "Path and target URL are required" });
  try {
    const { pool } = require("./config/database");
    await pool.query(
      `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [path_pattern, method || "GET", target_url, required_role || "user", rate_limit_per_minute || 100, cache_ttl_seconds || 60, true, req.user.id],
    );
    await clearCache(`cache:/routes*`);
    res.json({ success: true, message: "Route added" });
  } catch (err) {
    console.error("Error adding route:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/cache/clear", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await clearAllCache();
    res.json({ success: true, message: "Cache cleared" });
  } catch (err) {
    console.error("Error clearing cache:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/settings", authMiddleware, adminMiddleware, async (req, res) => {
  const { rate_limit, cache_ttl } = req.body;
  try {
    const { redis } = require("./config/redis");
    if (rate_limit) await redis.set("settings:rate_limit", rate_limit);
    if (cache_ttl) await redis.set("settings:cache_ttl", cache_ttl);
    res.json({ success: true, message: "Settings updated" });
  } catch (err) {
    console.error("Error updating settings:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============ STATIC FILES ============
app.use(express.static(path.join(__dirname, "../public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

// Change password endpoint
app.post("/auth/change-password", authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password required" });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    
    try {
        const { pool } = require("./config/database");
        const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        const user = result.rows[0];
        
        // If user has social login only (no password)
        if (!user.password_hash) {
            return res.status(400).json({ error: "This account uses social login. No password to change." });
        }
        
        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: "Current password is incorrect" });
        }
        
        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Update password
        await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [hashedPassword, req.user.id]);
        
        res.json({ message: "Password changed successfully" });
    } catch (error) {
        console.error("Password change error:", error);
        res.status(500).json({ error: "Server error" });
    }
});
module.exports = app;