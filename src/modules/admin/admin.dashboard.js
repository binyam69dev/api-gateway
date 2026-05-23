const express = require('express');
const { pool } = require('../../config/database');
const { authMiddleware, adminMiddleware } = require('../../middlewares/auth.middleware');
const { clearCache } = require('../../middleware/cache');

const router = express.Router();

// ============ DASHBOARD STATS ============
router.get('/analytics', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const totalRoutes = await pool.query("SELECT COUNT(*) FROM routes WHERE is_active = true");
        const totalDevelopers = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
        const pendingRequests = await pool.query("SELECT COUNT(*) FROM route_requests WHERE status = 'pending'");
        const apiCalls30d = await pool.query("SELECT COUNT(*) FROM api_usage WHERE created_at > NOW() - INTERVAL '30 days'");
        const approvedToday = await pool.query("SELECT COUNT(*) FROM routes WHERE approved_at::DATE = CURRENT_DATE");
        
        res.json({
            summary: {
                total_routes: parseInt(totalRoutes.rows[0].count),
                total_developers: parseInt(totalDevelopers.rows[0].count),
                pending_requests: parseInt(pendingRequests.rows[0].count),
                total_api_calls: parseInt(apiCalls30d.rows[0].count),
                approved_today: parseInt(approvedToday.rows[0].count)
            }
        });
    } catch (error) {
        console.error("Analytics error:", error);
        res.status(500).json({ error: "Failed to fetch analytics" });
    }
});

// ============ PENDING REQUESTS ============
router.get('/requests/pending', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.*, u.email, u.company, u.name as requester_name
             FROM route_requests r
             JOIN users u ON r.requested_by = u.id
             WHERE r.status = 'pending'
             ORDER BY 
                CASE r.urgency WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                r.created_at ASC`
        );
        res.json({ requests: result.rows });
    } catch (error) {
        console.error("Pending requests error:", error);
        res.status(500).json({ error: "Failed to fetch pending requests" });
    }
});

// ============ APPROVED REQUESTS ============
router.get('/requests/approved', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.id, r.requested_by_email as email, r.path_pattern, r.target_url, 
                    u.email as reviewed_by_email, r.reviewed_at, r.created_at
             FROM route_requests r
             LEFT JOIN users u ON r.reviewed_by = u.id
             WHERE r.status = 'approved'
             ORDER BY r.reviewed_at DESC
             LIMIT 50`
        );
        res.json({ requests: result.rows });
    } catch (error) {
        console.error("Approved requests error:", error);
        res.status(500).json({ error: "Failed to fetch approved requests" });
    }
});

// ============ ALL DEVELOPERS ============
router.get('/developers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, name, role, company, monthly_requests, request_limit, created_at, is_verified
             FROM users 
             ORDER BY created_at DESC`
        );
        res.json({ developers: result.rows });
    } catch (error) {
        console.error("Developers error:", error);
        res.status(500).json({ error: "Failed to fetch developers" });
    }
});

// ============ APPROVE REQUEST ============
router.post('/requests/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    
    try {
        const request = await pool.query(`SELECT * FROM route_requests WHERE id = $1`, [id]);
        if (request.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }
        
        const reqData = request.rows[0];
        
        await pool.query(
            `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, created_by, approved_by, approved_at, is_active)
             VALUES ($1, $2, $3, $4, 100, 60, $5, $6, NOW(), true)
             ON CONFLICT (path_pattern, method) DO UPDATE 
             SET target_url = $3, approved_at = NOW(), approved_by = $6, updated_at = NOW()`,
            [reqData.path_pattern, reqData.method, reqData.target_url, 'guest', reqData.requested_by, req.user.id]
        );
        
        await pool.query(
            `UPDATE route_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
            [req.user.id, id]
        );
        
        // Clear cache for routes
        await clearCache('cache:/routes*');
        
        res.json({ 
            message: 'Route approved', 
            route: { 
                path: reqData.path_pattern, 
                method: reqData.method, 
                target: reqData.target_url 
            } 
        });
    } catch (error) {
        console.error("Approve request error:", error);
        res.status(500).json({ error: "Failed to approve request" });
    }
});

// ============ REJECT REQUEST ============
router.post('/requests/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    
    try {
        await pool.query(
            `UPDATE route_requests SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2 WHERE id = $3`,
            [req.user.id, reason || 'No reason provided', id]
        );
        
        res.json({ message: 'Request rejected', reason: reason || 'No reason provided' });
    } catch (error) {
        console.error("Reject request error:", error);
        res.status(500).json({ error: "Failed to reject request" });
    }
});

// ============ BULK APPROVE ============
router.post('/requests/bulk-approve', authMiddleware, adminMiddleware, async (req, res) => {
    const { ids } = req.body;
    
    if (!ids || !ids.length) {
        return res.status(400).json({ error: 'No request IDs provided' });
    }
    
    try {
        for (const id of ids) {
            const request = await pool.query(`SELECT * FROM route_requests WHERE id = $1`, [id]);
            if (request.rows.length > 0) {
                const reqData = request.rows[0];
                await pool.query(
                    `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, created_by, approved_by, approved_at, is_active)
                     VALUES ($1, $2, $3, $4, 100, 60, $5, $6, NOW(), true)
                     ON CONFLICT (path_pattern, method) DO NOTHING`,
                    [reqData.path_pattern, reqData.method, reqData.target_url, 'guest', reqData.requested_by, req.user.id]
                );
                await pool.query(`UPDATE route_requests SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`, [req.user.id, id]);
            }
        }
        
        await clearCache('cache:/routes*');
        res.json({ message: `${ids.length} routes approved` });
    } catch (error) {
        console.error("Bulk approve error:", error);
        res.status(500).json({ error: "Failed to bulk approve" });
    }
});

// ============ ADD NEW ROUTE ============
router.post('/routes', authMiddleware, adminMiddleware, async (req, res) => {
    const { path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds } = req.body;
    
    if (!path_pattern || !target_url) {
        return res.status(400).json({ error: "Path pattern and target URL are required" });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW())
             ON CONFLICT (path_pattern, method) DO UPDATE 
             SET target_url = $3, updated_at = NOW(), required_role = $4, rate_limit_per_minute = $5, cache_ttl_seconds = $6
             RETURNING *`,
            [path_pattern, method || 'GET', target_url, required_role || 'guest', rate_limit_per_minute || 100, cache_ttl_seconds || 0, req.user.id]
        );
        
        await clearCache('cache:/routes*');
        res.json({ message: 'Route saved', route: result.rows[0] });
    } catch (error) {
        console.error("Add route error:", error);
        res.status(500).json({ error: "Failed to add route" });
    }
});

// ============ DELETE ROUTE ============
router.delete('/routes/:path/:method', authMiddleware, adminMiddleware, async (req, res) => {
    const { path, method } = req.params;
    
    try {
        const result = await pool.query(
            'DELETE FROM routes WHERE path_pattern = $1 AND method = $2 RETURNING *', 
            [decodeURIComponent(path), method]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Route not found' });
        }
        
        await clearCache('cache:/routes*');
        res.json({ message: 'Route deleted', route: result.rows[0] });
    } catch (error) {
        console.error("Delete route error:", error);
        res.status(500).json({ error: "Failed to delete route" });
    }
});

// ============ CLEAR CACHE ============
router.post('/cache/clear', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { redis } = require('../../config/redis');
        await redis.flushall();
        res.json({ message: 'Cache cleared successfully' });
    } catch (error) {
        console.error("Clear cache error:", error);
        res.status(500).json({ error: "Failed to clear cache" });
    }
});

module.exports = router;