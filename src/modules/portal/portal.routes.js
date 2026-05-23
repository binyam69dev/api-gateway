const express = require('express');
const { pool } = require('../../config/database');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const crypto = require('crypto');

const router = express.Router();

// ============ HELPER FUNCTION ============
function logActivity(userId, action, details = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] USER:${userId} | ${action} | ${JSON.stringify(details)}`);
    
    if (process.env.NODE_ENV === 'production') {
        pool.query(
            `INSERT INTO activity_logs (user_id, action, details, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [userId, action, JSON.stringify(details)]
        ).catch(err => console.error('Failed to log activity:', err.message));
    }
}

// ============ DEVELOPER: REQUEST NEW ROUTE ============
router.post('/request-route', authMiddleware, async (req, res) => {
    try {
        const { path_pattern, method, target_url, reason, urgency } = req.body;
        
        if (!path_pattern || !target_url) {
            return res.status(400).json({ error: 'Path and target URL are required' });
        }
        
        // Validate path format
        if (!path_pattern.startsWith('/')) {
            return res.status(400).json({ error: 'Path must start with /' });
        }
        
        // Check if route already exists
        const existingRoute = await pool.query(
            'SELECT id FROM routes WHERE path_pattern = $1 AND method = $2',
            [path_pattern, method || 'GET']
        );
        
        if (existingRoute.rows.length > 0) {
            return res.status(409).json({ 
                error: 'Route already exists',
                hint: 'This endpoint is already available'
            });
        }
        
        // Check for duplicate pending request
        const existingRequest = await pool.query(
            `SELECT id, status FROM route_requests 
             WHERE requested_by = $1 AND path_pattern = $2 AND method = $3 AND status = 'pending'`,
            [req.user.id, path_pattern, method || 'GET']
        );
        
        if (existingRequest.rows.length > 0) {
            return res.status(409).json({ 
                error: 'You already have a pending request for this route',
                request_id: existingRequest.rows[0].id
            });
        }
        
        const result = await pool.query(
            `INSERT INTO route_requests (requested_by, requested_by_email, path_pattern, method, target_url, reason, urgency, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
             RETURNING id, path_pattern, method, target_url, status, created_at`,
            [req.user.id, req.user.email, path_pattern, method || 'GET', target_url, reason || null, urgency || 'normal']
        );
        
        logActivity(req.user.id, 'ROUTE_REQUEST_CREATED', {
            request_id: result.rows[0].id,
            path: path_pattern,
            method: method || 'GET'
        });
        
        res.json({ 
            message: 'Route request submitted successfully',
            request_id: result.rows[0].id,
            status: 'pending',
            estimated_time: 'Will be reviewed within 24 hours',
            request: result.rows[0]
        });
        
    } catch (error) {
        console.error('Route request error:', error);
        res.status(500).json({ error: 'Failed to submit route request' });
    }
});

// ============ DEVELOPER: CHECK REQUEST STATUS ============
router.get('/request-status/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.id, r.path_pattern, r.method, r.target_url, r.status, r.reason, 
                    r.reviewed_by, r.reviewed_at, r.created_at,
                    u.name as reviewer_name
             FROM route_requests r
             LEFT JOIN users u ON r.reviewed_by = u.id
             WHERE r.id = $1 AND r.requested_by = $2`,
            [req.params.id, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Request status error:', error);
        res.status(500).json({ error: 'Failed to fetch request status' });
    }
});

// ============ DEVELOPER: VIEW ALL MY REQUESTS ============
router.get('/my-requests', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, path_pattern, method, target_url, status, urgency, reason, created_at, reviewed_at
             FROM route_requests 
             WHERE requested_by = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        
        const pending = result.rows.filter(r => r.status === 'pending').length;
        const approved = result.rows.filter(r => r.status === 'approved').length;
        const rejected = result.rows.filter(r => r.status === 'rejected').length;
        
        res.json({ 
            total: result.rows.length,
            summary: { pending, approved, rejected },
            requests: result.rows
        });
        
    } catch (error) {
        console.error('My requests error:', error);
        res.status(500).json({ error: 'Failed to fetch your requests' });
    }
});

// ============ DEVELOPER: VIEW ALL AVAILABLE ROUTES ============
router.get('/available-routes', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT path_pattern, method, required_role, rate_limit_per_minute, cache_ttl_seconds, description
             FROM routes 
             WHERE is_active = true 
             ORDER BY path_pattern`
        );
        
        res.json({ 
            total: result.rows.length,
            routes: result.rows,
            note: 'To request a new route, POST to /portal/request-route'
        });
        
    } catch (error) {
        console.error('Available routes error:', error);
        res.status(500).json({ error: 'Failed to fetch available routes' });
    }
});

// ============ DEVELOPER: GET API KEYS ============
router.get('/api-keys', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, api_key, name, permissions, rate_limit, expires_at, last_used, created_at
             FROM api_keys 
             WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        
        res.json({ 
            total: result.rows.length,
            api_keys: result.rows.map(key => ({
                ...key,
                // Mask API key for display (only show first and last 4 chars)
                api_key_display: key.api_key ? `${key.api_key.substring(0, 8)}...${key.api_key.substring(key.api_key.length - 4)}` : null
            }))
        });
        
    } catch (error) {
        console.error('API keys error:', error);
        res.status(500).json({ error: 'Failed to fetch API keys' });
    }
});

// ============ DEVELOPER: CREATE NEW API KEY ============
router.post('/api-keys', authMiddleware, async (req, res) => {
    try {
        const { name, rate_limit, permissions } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Name is required for API key' });
        }
        
        const apiKey = `ag_${crypto.randomBytes(32).toString('hex')}`;
        
        const result = await pool.query(
            `INSERT INTO api_keys (user_id, api_key, name, permissions, rate_limit, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING id, api_key, name, permissions, rate_limit, created_at`,
            [req.user.id, apiKey, name, permissions || ['read'], rate_limit || 100]
        );
        
        logActivity(req.user.id, 'API_KEY_CREATED', { key_id: result.rows[0].id, name });
        
        res.json({ 
            message: 'API Key created successfully',
            api_key: result.rows[0],
            warning: '⚠️ Save this key now! You will not be able to see it again.'
        });
        
    } catch (error) {
        console.error('Create API key error:', error);
        res.status(500).json({ error: 'Failed to create API key' });
    }
});

// ============ DEVELOPER: REVOKE API KEY ============
router.delete('/api-keys/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM api_keys WHERE id = $1 AND user_id = $2
             RETURNING id, name`,
            [req.params.id, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'API key not found' });
        }
        
        logActivity(req.user.id, 'API_KEY_REVOKED', { key_id: req.params.id, name: result.rows[0].name });
        
        res.json({ 
            message: 'API key revoked successfully',
            revoked_key: result.rows[0]
        });
        
    } catch (error) {
        console.error('Revoke API key error:', error);
        res.status(500).json({ error: 'Failed to revoke API key' });
    }
});

// ============ DEVELOPER: VIEW USAGE STATS ============
router.get('/usage', authMiddleware, async (req, res) => {
    try {
        // Summary for last 30 days
        const summary = await pool.query(
            `SELECT 
                COUNT(*) as total_requests,
                COUNT(DISTINCT endpoint) as unique_endpoints,
                COALESCE(AVG(response_time_ms), 0) as avg_response_time,
                COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count,
                COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success_count
             FROM api_usage 
             WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
            [req.user.id]
        );
        
        // Daily breakdown for last 7 days
        const daily = await pool.query(
            `SELECT 
                DATE(created_at) as date,
                COUNT(*) as requests,
                COALESCE(AVG(response_time_ms), 0) as avg_response_time
             FROM api_usage 
             WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'
             GROUP BY DATE(created_at)
             ORDER BY date DESC`,
            [req.user.id]
        );
        
        // Top endpoints
        const topEndpoints = await pool.query(
            `SELECT 
                endpoint,
                method,
                COUNT(*) as hit_count
             FROM api_usage 
             WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
             GROUP BY endpoint, method
             ORDER BY hit_count DESC
             LIMIT 10`,
            [req.user.id]
        );
        
        res.json({ 
            summary: summary.rows[0] || { total_requests: 0, unique_endpoints: 0, avg_response_time: 0, error_count: 0, success_count: 0 },
            daily_usage: daily.rows,
            top_endpoints: topEndpoints.rows
        });
        
    } catch (error) {
        console.error('Usage stats error:', error);
        res.status(500).json({ error: 'Failed to fetch usage statistics' });
    }
});

// ============ DEVELOPER: REGISTER WEBHOOK ============
router.post('/webhooks', authMiddleware, async (req, res) => {
    try {
        const { url, events, secret } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Webhook URL is required' });
        }
        
        // Validate URL format
        try {
            new URL(url);
        } catch {
            return res.status(400).json({ error: 'Invalid webhook URL' });
        }
        
        const webhookSecret = secret || crypto.randomBytes(24).toString('hex');
        
        const result = await pool.query(
            `INSERT INTO webhooks (user_id, url, events, secret, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             RETURNING id, url, events, created_at`,
            [req.user.id, url, events || ['route.approved', 'route.rejected'], webhookSecret]
        );
        
        logActivity(req.user.id, 'WEBHOOK_CREATED', { url, events: events || ['route.approved'] });
        
        res.json({ 
            message: 'Webhook registered successfully',
            webhook: result.rows[0],
            secret: webhookSecret,
            warning: '⚠️ Save this secret. It will not be shown again.'
        });
        
    } catch (error) {
        console.error('Webhook registration error:', error);
        res.status(500).json({ error: 'Failed to register webhook' });
    }
});

// ============ DEVELOPER: GET WEBHOOKS ============
router.get('/webhooks', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, url, events, last_triggered, created_at, is_active
             FROM webhooks 
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        
        res.json({ webhooks: result.rows });
        
    } catch (error) {
        console.error('Get webhooks error:', error);
        res.status(500).json({ error: 'Failed to fetch webhooks' });
    }
});

// ============ DEVELOPER: DELETE WEBHOOK ============
router.delete('/webhooks/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM webhooks WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Webhook not found' });
        }
        
        logActivity(req.user.id, 'WEBHOOK_DELETED', { webhook_id: req.params.id });
        
        res.json({ message: 'Webhook deleted successfully' });
        
    } catch (error) {
        console.error('Delete webhook error:', error);
        res.status(500).json({ error: 'Failed to delete webhook' });
    }
});

module.exports = router;