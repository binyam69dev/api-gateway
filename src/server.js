require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
});

// Redis connection
const redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.on('connect', () => console.log('✅ Redis connected'));
redisClient.connect();

// ============ REQUEST LOGGING MIDDLEWARE ============
async function logRequest(req, res, statusCode, responseTimeMs) {
    try {
        const userId = req.user?.id || null;
        const ipAddress = req.ip || req.socket.remoteAddress;
        await pool.query(
            `INSERT INTO request_logs (user_id, ip_address, method, path, status_code, response_time_ms, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, ipAddress, req.method, req.path, statusCode, responseTimeMs, req.headers['user-agent']]
        );
    } catch (err) { console.error('Logging error:', err.message); }
}

app.use(async (req, res, next) => {
    const startTime = Date.now();
    const originalSend = res.send;
    res.send = function(body) {
        logRequest(req, res, res.statusCode, Date.now() - startTime).catch(console.error);
        originalSend.call(this, body);
    };
    next();
});

// Cache middleware
function cache(ttlSeconds = 60) {
    return async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const cacheKey = `cache:${req.originalUrl || req.url}`;
        try {
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                res.setHeader('X-Cache', 'HIT');
                return res.json(JSON.parse(cachedData));
            }
            const originalJson = res.json;
            res.json = function(data) {
                redisClient.set(cacheKey, JSON.stringify(data), { EX: ttlSeconds });
                res.setHeader('X-Cache', 'MISS');
                originalJson.call(this, data);
            };
            next();
        } catch (err) { next(); }
    };
}

// Rate limiting middleware
const rateLimit = (windowMs = 60000, maxRequests = 100) => {
    return async (req, res, next) => {
        const identifier = req.user?.id || req.ip;
        const key = `ratelimit:${identifier}`;
        try {
            const current = await redisClient.get(key);
            const count = current ? parseInt(current) : 0;
            if (count >= maxRequests) {
                return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil(windowMs / 1000) });
            }
            await redisClient.set(key, count + 1, { EX: Math.ceil(windowMs / 1000) });
            next();
        } catch (err) { next(); }
    };
};

// ============ ADMIN AUTH MIDDLEWARE ============
async function adminMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Admin token required' });
    }
    
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const user = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
        
        if (user.rows.length === 0 || user.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// ============ DYNAMIC ROUTING ============
async function getRouteFromDatabase(path, method) {
    try {
        let result = await pool.query(
            'SELECT target_url, required_role, rate_limit_per_minute, cache_ttl_seconds FROM routes WHERE path_pattern = $1 AND method = $2 AND is_active = true',
            [path, method]
        );
        if (result.rows.length === 0) {
            result = await pool.query(
                `SELECT target_url, required_role, rate_limit_per_minute, cache_ttl_seconds 
                 FROM routes 
                 WHERE $1 LIKE REPLACE(path_pattern, ':id', '%') 
                 AND method = $2 AND is_active = true LIMIT 1`,
                [path, method]
            );
        }
        return result.rows[0] || null;
    } catch (err) { return null; }
}

async function proxyRequest(targetUrl, req, res) {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + (req.url.split('?')[1] ? '?' + req.url.split('?')[1] : ''),
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'x-forwarded-for': req.ip,
                'x-user-id': req.user?.id || ''
            }
        };
        
        const proxyReq = http.request(options, (proxyRes) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                res.status(proxyRes.statusCode).set(proxyRes.headers).send(body);
                resolve();
            });
        });
        
        proxyReq.on('error', (err) => {
            res.status(504).json({ error: 'Gateway timeout', message: err.message });
            reject(err);
        });
        
        if (req.body && Object.keys(req.body).length > 0) {
            proxyReq.write(JSON.stringify(req.body));
        }
        proxyReq.end();
    });
}

pool.connect((err) => {
    if (err) console.error('❌ PostgreSQL failed:', err.message);
    else console.log('✅ PostgreSQL connected');
});

// ============ PUBLIC ENDPOINTS ============
app.get('/health', async (req, res) => {
    let dbStatus = 'disconnected', redisStatus = 'disconnected';
    try { await pool.query('SELECT 1'); dbStatus = 'connected'; } catch (err) {}
    try { await redisClient.ping(); redisStatus = 'connected'; } catch (err) {}
    res.json({ status: 'ok', postgres: dbStatus, redis: redisStatus });
});

app.get('/routes', async (req, res) => {
    const result = await pool.query('SELECT path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active FROM routes ORDER BY path_pattern');
    res.json({ total: result.rows.length, routes: result.rows });
});

app.get('/logs', async (req, res) => {
    const result = await pool.query(`SELECT id, user_id, ip_address, method, path, status_code, response_time_ms, created_at FROM request_logs ORDER BY created_at DESC LIMIT 50`);
    res.json({ total: result.rows.length, logs: result.rows });
});

app.get('/logs/stats', async (req, res) => {
    const result = await pool.query(`SELECT COUNT(*) as total_requests, COUNT(DISTINCT ip_address) as unique_ips, AVG(response_time_ms) as avg_response_time_ms, COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count FROM request_logs WHERE created_at > NOW() - INTERVAL '1 hour'`);
    res.json(result.rows[0]);
});

// ============ ADMIN API (Protected) ============

// Get all users (admin only)
app.get('/admin/users', adminMiddleware, async (req, res) => {
    const result = await pool.query('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ total: result.rows.length, users: result.rows });
});

// Create/update route (admin only)
app.post('/admin/routes', adminMiddleware, async (req, res) => {
    const { path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds } = req.body;
    
    if (!path_pattern || !method || !target_url) {
        return res.status(400).json({ error: 'path_pattern, method, and target_url required' });
    }
    
    const result = await pool.query(
        `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (path_pattern, method) 
         DO UPDATE SET target_url = $3, required_role = $4, rate_limit_per_minute = $5, cache_ttl_seconds = $6, is_active = true
         RETURNING *`,
        [path_pattern, method, target_url, required_role || 'guest', rate_limit_per_minute || 100, cache_ttl_seconds || 0]
    );
    
    res.json({ message: 'Route saved successfully', route: result.rows[0] });
});

// Delete route (admin only)
app.delete('/admin/routes/:path/:method', adminMiddleware, async (req, res) => {
    const { path, method } = req.params;
    const result = await pool.query('DELETE FROM routes WHERE path_pattern = $1 AND method = $2 RETURNING *', [path, method]);
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Route not found' });
    }
    
    res.json({ message: 'Route deleted successfully', route: result.rows[0] });
});

// Clear Redis cache (admin only)
app.post('/admin/cache/clear', adminMiddleware, async (req, res) => {
    await redisClient.flushAll();
    res.json({ message: 'Cache cleared successfully' });
});

// Get system stats (admin only)
app.get('/admin/stats', adminMiddleware, async (req, res) => {
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const routeCount = await pool.query('SELECT COUNT(*) FROM routes');
    const logCount = await pool.query('SELECT COUNT(*) FROM request_logs WHERE created_at > NOW() - INTERVAL \'24 hours\'');
    
    res.json({
        users: parseInt(userCount.rows[0].count),
        routes: parseInt(routeCount.rows[0].count),
        requests_last_24h: parseInt(logCount.rows[0].count),
        redis_connected: redisClient.isOpen
    });
});

// Update user role (admin only)
app.put('/admin/users/:id/role', adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!role || !['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Role must be "user" or "admin"' });
    }
    
    const result = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role', [role, id]);
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User role updated', user: result.rows[0] });
});

// ============ AUTH ENDPOINTS ============
app.post('/auth/register', rateLimit(60000, 5), async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
    
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'User exists' });
    
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role', [email, hashed, 'user']);
    res.status(201).json({ message: 'User created', user: result.rows[0] });
});

app.post('/auth/login', rateLimit(60000, 10), async (req, res) => {
    const { email, password } = req.body;
    const result = await pool.query('SELECT id, email, password_hash, role FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
    res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, role: user.role } });
});

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

app.get('/protected', authMiddleware, rateLimit(60000, 100), (req, res) => {
    res.json({ message: 'Access granted', user: req.user });
});

// ============ CACHING DEMO ============
app.get('/api/time', cache(30), (req, res) => {
    res.json({ message: 'CACHED for 30 seconds!', timestamp: new Date().toISOString() });
});

app.get('/api/slow', cache(60), async (req, res) => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    res.json({ message: 'Took 2 seconds first time, now cached!', generatedAt: new Date().toISOString() });
});

// ============ DYNAMIC ROUTING HANDLER ============
app.all('*', async (req, res) => {
    const route = await getRouteFromDatabase(req.path, req.method);
    if (!route) return res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
    if (route.required_role && route.required_role !== 'guest' && !req.user) return res.status(401).json({ error: 'Authentication required' });
    
    try { await proxyRequest(route.target_url, req, res); }
    catch (err) { res.status(502).json({ error: 'Bad gateway', message: err.message }); }
});

// Home
app.get('/', (req, res) => {
    res.json({
        message: 'API Gateway with Admin API',
        endpoints: {
            public: { health: 'GET /health', routes: 'GET /routes', logs: 'GET /logs', stats: 'GET /logs/stats' },
            admin: { users: 'GET /admin/users', createRoute: 'POST /admin/routes', deleteRoute: 'DELETE /admin/routes/:path/:method', clearCache: 'POST /admin/cache/clear', stats: 'GET /admin/stats' },
            auth: { register: 'POST /auth/register', login: 'POST /auth/login', protected: 'GET /protected' }
        },
        admin_credentials: { email: 'admin@gateway.com', password: 'admin123' }
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Gateway on http://localhost:${PORT}`);
    console.log(`\n🔐 Admin Login: admin@gateway.com / admin123`);
    console.log(`📋 Admin APIs: GET /admin/users, POST /admin/routes, DELETE /admin/routes/:path/:method`);
    console.log(`🗑️  Clear cache: POST /admin/cache/clear`);
    console.log(`📊 System stats: GET /admin/stats\n`);
});
