const express = require('express');
const { pool } = require('../../config/database');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const crypto = require('crypto');

const router = express.Router();

// Developer: Request new route
router.post('/request-route', authMiddleware, async (req, res) => {
    const { path_pattern, method, target_url, reason, urgency } = req.body;
    
    if (!path_pattern || !target_url) {
        return res.status(400).json({ error: 'Path and target URL required' });
    }
    
    const result = await pool.query(
        `INSERT INTO route_requests (requested_by, requested_by_email, path_pattern, method, target_url, reason, urgency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.user.id, req.user.email, path_pattern, method || 'GET', target_url, reason, urgency || 'normal']
    );
    
    res.json({ 
        message: 'Route request submitted', 
        request_id: result.rows[0].id,
        status: 'pending',
        estimated_time: 'Will be reviewed within 24 hours'
    });
});

// Developer: Check request status
router.get('/request-status/:id', authMiddleware, async (req, res) => {
    const result = await pool.query(
        `SELECT id, path_pattern, method, target_url, status, reviewed_by, reviewed_at, created_at
         FROM route_requests 
         WHERE id = $1 AND requested_by = $2`,
        [req.params.id, req.user.id]
    );
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Request not found' });
    }
    
    res.json(result.rows[0]);
});

// Developer: View all available routes
router.get('/available-routes', async (req, res) => {
    const result = await pool.query(
        `SELECT path_pattern, method, required_role, rate_limit_per_minute, cache_ttl_seconds
         FROM routes 
         WHERE is_active = true 
         ORDER BY path_pattern`
    );
    
    res.json({ 
        total: result.rows.length,
        routes: result.rows,
        note: 'To request a new route, POST to /portal/request-route'
    });
});

// Developer: Get their API keys
router.get('/api-keys', authMiddleware, async (req, res) => {
    const result = await pool.query(
        `SELECT id, api_key, name, permissions, rate_limit, expires_at, last_used, created_at
         FROM api_keys 
         WHERE user_id = $1`,
        [req.user.id]
    );
    
    res.json({ api_keys: result.rows });
});

// Developer: Create new API key
router.post('/api-keys', authMiddleware, async (req, res) => {
    const { name, rate_limit } = req.body;
    const apiKey = crypto.randomBytes(32).toString('hex');
    
    const result = await pool.query(
        `INSERT INTO api_keys (user_id, api_key, name, rate_limit)
         VALUES ($1, $2, $3, $4)
         RETURNING id, api_key, name, rate_limit`,
        [req.user.id, apiKey, name, rate_limit || 100]
    );
    
    res.json({ 
        message: 'API Key created', 
        api_key: result.rows[0],
        warning: 'Save this key now. You won\'t see it again!'
    });
});

// Developer: Revoke API key
router.delete('/api-keys/:id', authMiddleware, async (req, res) => {
    await pool.query(
        `DELETE FROM api_keys WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
    );
    
    res.json({ message: 'API key revoked' });
});

// Developer: View their usage stats
router.get('/usage', authMiddleware, async (req, res) => {
    const result = await pool.query(
        `SELECT 
            COUNT(*) as total_requests,
            COUNT(DISTINCT path) as unique_endpoints,
            AVG(response_time_ms) as avg_response_time,
            COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count
         FROM api_usage 
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY user_id`,
        [req.user.id]
    );
    
    const daily = await pool.query(
        `SELECT 
            DATE(created_at) as date,
            COUNT(*) as requests
         FROM api_usage 
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
         GROUP BY DATE(created_at)
         ORDER BY date DESC`,
        [req.user.id]
    );
    
    res.json({ 
        summary: result.rows[0] || { total_requests: 0 },
        daily_usage: daily.rows
    });
});

// Developer: Register webhook
router.post('/webhooks', authMiddleware, async (req, res) => {
    const { url, events } = req.body;
    
    const result = await pool.query(
        `INSERT INTO webhooks (user_id, url, events)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [req.user.id, url, events || ['route.approved']]
    );
    
    res.json({ message: 'Webhook registered', webhook: result.rows[0] });
});

module.exports = router;
