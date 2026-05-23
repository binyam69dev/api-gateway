const { pool } = require('../../config/database');
const { redis } = require('../../config/redis');

class AdminService {
    
    // ============ GET ALL USERS ============
    async getAllUsers() {
        const result = await pool.query(
            `SELECT id, email, name, role, company, is_verified, created_at, last_login_at 
             FROM users 
             ORDER BY created_at DESC`
        );
        return result.rows;
    }

    // ============ GET USER BY ID ============
    async getUserById(userId) {
        const result = await pool.query(
            `SELECT id, email, name, role, company, avatar, is_verified, created_at, last_login_at 
             FROM users 
             WHERE id = $1`,
            [userId]
        );
        return result.rows[0];
    }

    // ============ UPDATE USER ROLE ============
    async updateUserRole(userId, newRole, updatedBy) {
        const result = await pool.query(
            `UPDATE users 
             SET role = $1, updated_at = NOW() 
             WHERE id = $2 
             RETURNING id, email, name, role`,
            [newRole, userId]
        );
        
        if (result.rows.length > 0) {
            console.log(`User ${userId} role updated to ${newRole} by ${updatedBy}`);
        }
        
        return result.rows[0];
    }

    // ============ CREATE NEW ROUTE ============
    async createRoute(data) {
        const { 
            path_pattern, 
            method, 
            target_url, 
            required_role, 
            rate_limit_per_minute, 
            cache_ttl_seconds,
            created_by 
        } = data;
        
        const result = await pool.query(
            `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW())
             ON CONFLICT (path_pattern, method) 
             DO UPDATE SET 
                target_url = $3, 
                required_role = $4, 
                rate_limit_per_minute = $5, 
                cache_ttl_seconds = $6,
                updated_at = NOW()
             RETURNING *`,
            [path_pattern, method, target_url, required_role || 'guest', rate_limit_per_minute || 100, cache_ttl_seconds || 0, created_by || null]
        );
        
        return result.rows[0];
    }

    // ============ DELETE ROUTE ============
    async deleteRoute(path, method) {
        const result = await pool.query(
            'DELETE FROM routes WHERE path_pattern = $1 AND method = $2 RETURNING *', 
            [path, method]
        );
        return result.rows[0];
    }

    // ============ GET ROUTE BY PATH ============
    async getRoute(path, method) {
        const result = await pool.query(
            'SELECT * FROM routes WHERE path_pattern = $1 AND method = $2',
            [path, method]
        );
        return result.rows[0];
    }

    // ============ GET ALL ROUTES ============
    async getAllRoutes(activeOnly = false) {
        let query = 'SELECT * FROM routes ORDER BY path_pattern';
        const params = [];
        
        if (activeOnly) {
            query = 'SELECT * FROM routes WHERE is_active = true ORDER BY path_pattern';
        }
        
        const result = await pool.query(query, params);
        return result.rows;
    }

    // ============ CLEAR CACHE ============
    async clearCache() {
        try {
            await redis.flushall();
            console.log('Cache cleared successfully');
            return true;
        } catch (error) {
            console.error('Cache clear error:', error);
            return false;
        }
    }

    // ============ CLEAR SPECIFIC CACHE PATTERN ============
    async clearCachePattern(pattern) {
        try {
            const keys = await redis.keys(pattern);
            if (keys.length > 0) {
                await redis.del(keys);
                console.log(`Cleared ${keys.length} cache keys matching: ${pattern}`);
            }
            return keys.length;
        } catch (error) {
            console.error('Cache pattern clear error:', error);
            return 0;
        }
    }

    // ============ GET STATS ============
    async getStats() {
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const adminCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
        const developerCount = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
        const routeCount = await pool.query('SELECT COUNT(*) FROM routes WHERE is_active = true');
        const pendingRequests = await pool.query("SELECT COUNT(*) FROM route_requests WHERE status = 'pending'");
        const logCount = await pool.query(
            "SELECT COUNT(*) FROM request_logs WHERE created_at > NOW() - INTERVAL '24 hours'"
        );
        
        return {
            users: {
                total: parseInt(userCount.rows[0].count),
                admins: parseInt(adminCount.rows[0].count),
                developers: parseInt(developerCount.rows[0].count)
            },
            routes: parseInt(routeCount.rows[0].count),
            pendingRequests: parseInt(pendingRequests.rows[0].count),
            requestsLast24h: parseInt(logCount.rows[0].count)
        };
    }

    // ============ GET PENDING REQUESTS ============
    async getPendingRequests() {
        const result = await pool.query(
            `SELECT r.*, u.email, u.name as requester_name
             FROM route_requests r
             JOIN users u ON r.requested_by = u.id
             WHERE r.status = 'pending'
             ORDER BY r.created_at ASC`
        );
        return result.rows;
    }

    // ============ APPROVE REQUEST ============
    async approveRequest(requestId, approvedBy, approvedById) {
        const request = await pool.query('SELECT * FROM route_requests WHERE id = $1', [requestId]);
        
        if (request.rows.length === 0) {
            return null;
        }
        
        const reqData = request.rows[0];
        
        // Create route from request
        await pool.query(
            `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active, created_by, approved_by, approved_at)
             VALUES ($1, $2, $3, $4, 100, 60, true, $5, $6, NOW())
             ON CONFLICT (path_pattern, method) 
             DO UPDATE SET target_url = $3, approved_by = $6, approved_at = NOW()`,
            [reqData.path_pattern, reqData.method, reqData.target_url, 'guest', reqData.requested_by, approvedById]
        );
        
        // Update request status
        await pool.query(
            `UPDATE route_requests 
             SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() 
             WHERE id = $2`,
            [approvedById, requestId]
        );
        
        return { 
            id: requestId, 
            status: 'approved', 
            approvedBy,
            route: {
                path: reqData.path_pattern,
                method: reqData.method,
                target: reqData.target_url
            }
        };
    }

    // ============ REJECT REQUEST ============
    async rejectRequest(requestId, rejectedBy, rejectedById, reason) {
        await pool.query(
            `UPDATE route_requests 
             SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2 
             WHERE id = $3`,
            [rejectedById, reason || 'No reason provided', requestId]
        );
        
        return { 
            id: requestId, 
            status: 'rejected', 
            rejectedBy,
            reason: reason || 'No reason provided'
        };
    }
}

module.exports = new AdminService();