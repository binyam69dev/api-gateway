const { pool } = require('../../config/database');
const { redisClient } = require('../../config/redis');

class AdminService {
    async getAllUsers() {
        const result = await pool.query('SELECT id, email, role, created_at FROM users ORDER BY created_at DESC');
        return result.rows;
    }

    async createRoute(data) {
        const { path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds } = data;
        const result = await pool.query(
            `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true)
             ON CONFLICT (path_pattern, method) 
             DO UPDATE SET target_url = $3, required_role = $4, rate_limit_per_minute = $5, cache_ttl_seconds = $6
             RETURNING *`,
            [path_pattern, method, target_url, required_role || 'guest', rate_limit_per_minute || 100, cache_ttl_seconds || 0]
        );
        return result.rows[0];
    }

    async deleteRoute(path, method) {
        const result = await pool.query('DELETE FROM routes WHERE path_pattern = $1 AND method = $2 RETURNING *', [path, method]);
        return result.rows[0];
    }

    async clearCache() {
        await redisClient.flushAll();
        return true;
    }

    async getStats() {
        const userCount = await pool.query('SELECT COUNT(*) FROM users');
        const routeCount = await pool.query('SELECT COUNT(*) FROM routes');
        const logCount = await pool.query('SELECT COUNT(*) FROM request_logs WHERE created_at > NOW() - INTERVAL \'24 hours\'');
        
        return {
            users: parseInt(userCount.rows[0].count),
            routes: parseInt(routeCount.rows[0].count),
            requestsLast24h: parseInt(logCount.rows[0].count)
        };
    }
}

module.exports = new AdminService();
