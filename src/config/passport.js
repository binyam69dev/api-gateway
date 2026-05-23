// config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const jwt = require('jsonwebtoken');

// ============ HELPER FUNCTION ============
async function findOrCreateUser(profile, provider, done) {
    try {
        const { pool } = require('./database');
        
        // Get email from profile
        let email = profile.emails?.[0]?.value;
        if (!email && provider === 'facebook') {
            email = `${profile.id}@facebook.com`;
        }
        if (!email && provider === 'github') {
            email = `${profile.id}@github.com`;
        }
        
        const name = profile.displayName || profile.username || email.split('@')[0];
        const providerId = profile.id;
        const avatar = profile.photos?.[0]?.value || null;
        
        // Check if user exists by email or social_id
        let userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 OR (social_provider = $2 AND social_id = $3)',
            [email, provider, providerId]
        );
        
        let user;
        
        if (userResult.rows.length === 0) {
            // Create new user
            const insertResult = await pool.query(
                `INSERT INTO users (email, name, is_verified, role, created_at, social_provider, social_id, avatar, last_login_at) 
                 VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, NOW()) 
                 RETURNING id, email, name, role`,
                [email, name, true, 'user', provider, providerId, avatar]
            );
            user = insertResult.rows[0];
            console.log(`✅ Created new ${provider} user:`, user.email);
        } else {
            user = userResult.rows[0];
            // Update existing user
            await pool.query(
                `UPDATE users 
                 SET social_provider = $1, 
                     social_id = $2, 
                     avatar = COALESCE($3, avatar),
                     last_login_at = NOW(),
                     login_count = login_count + 1
                 WHERE id = $4`,
                [provider, providerId, avatar, user.id]
            );
            console.log(`✅ Updated existing ${provider} user:`, user.email);
        }
        
        // Generate JWT token (will be set as cookie by route handler)
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role || 'user', name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // Generate refresh token
        const refreshToken = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        return done(null, { ...user, token, refreshToken });
        
    } catch (error) {
        console.error(`❌ ${provider} auth error:`, error.message);
        return done(error, null);
    }
}

// ============ COOKIE OPTIONS (for route handlers) ============
const getCookieOptions = () => ({
    httpOnly: process.env.NODE_ENV === 'production',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
});

// ============ GOOGLE STRATEGY (ADMIN) ============
passport.use('admin-google', new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/admin/google/callback`,
    scope: ['profile', 'email']
}, (accessToken, refreshToken, profile, done) => {
    findOrCreateUser(profile, 'google', done);
}));

// ============ GOOGLE STRATEGY (DEVELOPER) ============
passport.use('developer-google', new GoogleStrategy({
    clientID: process.env.DEV_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.DEV_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/developer/google/callback`,
    scope: ['profile', 'email']
}, (accessToken, refreshToken, profile, done) => {
    findOrCreateUser(profile, 'google', done);
}));

// ============ GITHUB STRATEGY ============
passport.use('github', new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/github/callback`,
    scope: ['user:email']
}, (accessToken, refreshToken, profile, done) => {
    findOrCreateUser(profile, 'github', done);
}));

// ============ DEVELOPER GITHUB STRATEGY ============
passport.use('developer-github', new GitHubStrategy({
    clientID: process.env.DEV_GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.DEV_GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/developer/github/callback`,
    scope: ['user:email']
}, (accessToken, refreshToken, profile, done) => {
    findOrCreateUser(profile, 'github', done);
}));

// ============ FACEBOOK STRATEGY ============
passport.use('facebook', new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/facebook/callback`,
    profileFields: ['id', 'emails', 'name', 'picture.type(large)']
}, (accessToken, refreshToken, profile, done) => {
    findOrCreateUser(profile, 'facebook', done);
}));

// ============ DEVELOPER FACEBOOK STRATEGY ============
passport.use('developer-facebook', new FacebookStrategy({
    clientID: process.env.DEV_FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.DEV_FACEBOOK_APP_SECRET || process.env.FACEBOOK_APP_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/developer/facebook/callback`,
    profileFields: ['id', 'emails', 'name', 'picture.type(large)']
}, (accessToken, refreshToken, profile, done) => {
    findOrCreateUser(profile, 'facebook', done);
}));

// ============ SERIALIZATION ============
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const { pool } = require('./database');
        const result = await pool.query(
            'SELECT id, email, name, role FROM users WHERE id = $1',
            [id]
        );
        done(null, result.rows[0]);
    } catch (err) {
        console.error('Deserialize error:', err.message);
        done(err, null);
    }
});

// ============ HELPER: Get redirect URL based on user role ============
function getRedirectUrl(userRole) {
    return userRole === 'admin' ? '/admin.html' : '/developer-dashboard.html';
}

// ============ HELPER: Set auth cookies ============
function setAuthCookies(res, token, refreshToken) {
    const cookieOptions = getCookieOptions();
    res.cookie('adminToken', token, cookieOptions);
    res.cookie('devToken', token, cookieOptions);
    if (refreshToken) {
        res.cookie('refreshToken', refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
    }
}

module.exports = { 
    passport, 
    getCookieOptions, 
    setAuthCookies, 
    getRedirectUrl 
};