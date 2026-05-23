const { redis } = require('../config/redis');

/**
 * Rate Limiting Middleware
 * Limits number of requests from a single user/IP within a time window
 * 
 * @param {number} maxRequests - Maximum requests allowed (default: 100)
 * @param {number} windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns {Function} Express middleware
 */
function rateLimit(maxRequests = 100, windowMs = 60000) {
    return async (req, res, next) => {
        // Use user ID if logged in (from cookie), otherwise use IP
        const identifier = req.user?.id || req.ip;
        const key = `ratelimit:${identifier}:${req.path}`;
        
        try {
            // Get current request count
            const current = await redis.get(key);
            const count = current ? parseInt(current) : 0;
            
            // Calculate remaining requests
            const remaining = Math.max(0, maxRequests - count);
            
            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', maxRequests);
            res.setHeader('X-RateLimit-Remaining', remaining);
            res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + Math.ceil(windowMs / 1000));
            
            // Check if limit exceeded
            if (count >= maxRequests) {
                const resetTime = Math.ceil(windowMs / 1000);
                res.setHeader('Retry-After', resetTime);
                
                return res.status(429).json({ 
                    error: 'Too many requests',
                    message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
                    retryAfter: resetTime
                });
            }
            
            // Increment counter and set expiration
            await redis.set(key, count + 1, 'EX', Math.ceil(windowMs / 1000));
            next();
            
        } catch (error) {
            // If Redis fails, skip rate limiting (fail open)
            console.error('Rate limit error:', error.message);
            res.setHeader('X-RateLimit-Status', 'DISABLED');
            next();
        }
    };
}

// ============ SPECIFIC RATE LIMITERS ============

/**
 * Strict rate limiter for authentication endpoints
 * 5 attempts per 15 minutes
 */
function authRateLimit() {
    return rateLimit(5, 15 * 60 * 1000);
}

/**
 * API rate limiter for general endpoints
 * 100 requests per minute
 */
function apiRateLimit() {
    return rateLimit(100, 60 * 1000);
}

/**
 * Strict rate limiter for sensitive operations
 * 10 requests per hour
 */
function strictRateLimit() {
    return rateLimit(10, 60 * 60 * 1000);
}

// ============ RATE LIMIT CLEANUP ============

/**
 * Clear rate limit for a specific user/IP
 * @param {string} identifier - User ID or IP address
 */
async function clearRateLimit(identifier) {
    try {
        const keys = await redis.keys(`ratelimit:${identifier}:*`);
        if (keys.length > 0) {
            await redis.del(keys);
            console.log(`Cleared rate limit for: ${identifier}`);
        }
        return keys.length;
    } catch (error) {
        console.error('Clear rate limit error:', error);
        return 0;
    }
}

/**
 * Clear all rate limits
 */
async function clearAllRateLimits() {
    try {
        const keys = await redis.keys('ratelimit:*');
        if (keys.length > 0) {
            await redis.del(keys);
            console.log(`Cleared ${keys.length} rate limit entries`);
        }
        return keys.length;
    } catch (error) {
        console.error('Clear all rate limits error:', error);
        return 0;
    }
}

module.exports = { 
    rateLimit, 
    authRateLimit, 
    apiRateLimit, 
    strictRateLimit,
    clearRateLimit,
    clearAllRateLimits
};