const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { testConnection } = require('./config/database');
const { connectRedis } = require('./config/redis');
const { getMetrics } = require('./utils/metrics');
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const { handleRequest, getCircuitStates } = require('./modules/gateway/gateway.service');
const cache = require('./middlewares/cache.middleware');
const rateLimit = require('./middlewares/rateLimit.middleware');

const app = express();

// Global middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
    let dbOk = false, redisOk = false;
    try {
        const { pool } = require('./config/database');
        await pool.query('SELECT 1');
        dbOk = true;
    } catch (err) {}
    
    try {
        const { redisClient } = require('./config/redis');
        await redisClient.ping();
        redisOk = true;
    } catch (err) {}
    
    res.json({ status: dbOk && redisOk ? 'ok' : 'degraded', postgres: dbOk, redis: redisOk });
});

// Metrics
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', require('./utils/metrics').register.contentType);
    res.send(await getMetrics());
});

// Routes list
app.get('/routes', async (req, res) => {
    const { pool } = require('./config/database');
    const result = await pool.query('SELECT path_pattern, method, target_url, required_role FROM routes WHERE is_active = true');
    res.json({ total: result.rows.length, routes: result.rows });
});

// Circuit status
app.get('/circuits', (req, res) => {
    res.json({ circuits: getCircuitStates() });
});

// Auth routes
app.use('/auth', authRoutes);

// Admin routes
app.use('/admin', adminRoutes);

// Caching demo
app.get('/api/time', cache(30), (req, res) => {
    res.json({ message: 'CACHED (30s)', timestamp: new Date().toISOString() });
});

app.get('/api/slow', cache(60), async (req, res) => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    res.json({ message: 'Slow response (cached 60s)', generatedAt: new Date().toISOString() });
});

// Main gateway handler
app.all('*', handleRequest);

module.exports = app;
