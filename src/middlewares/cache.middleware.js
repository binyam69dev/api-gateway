const { redis } = require('../config/redis');

/**
 * Redis Caching Middleware
 * Caches GET requests for specified TTL (Time To Live)
 * 
 * @param {number} ttlSeconds - Cache duration in seconds (default: 60)
 * @returns {Function} Express middleware
 */
function cache(ttlSeconds = 60) {
    return async (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }
        
        // Create unique cache key based on URL
        const cacheKey = `cache:${req.originalUrl || req.url}`;
        
        try {
            // Try to get cached data
            const cachedData = await redis.get(cacheKey);
            
            if (cachedData) {
                // Cache HIT - return cached response
                res.setHeader('X-Cache', 'HIT');
                res.setHeader('X-Cache-TTL', ttlSeconds);
                return res.json(JSON.parse(cachedData));
            }
            
            // Cache MISS - store original res.json function
            const originalJson = res.json.bind(res);
            
            // Override res.json to cache the response
            res.json = function(data) {
                // Store in Redis with expiration
                redis.set(cacheKey, JSON.stringify(data), 'EX', ttlSeconds)
                    .catch(err => console.error('Redis cache set error:', err));
                
                // Set cache headers
                res.setHeader('X-Cache', 'MISS');
                res.setHeader('X-Cache-TTL', ttlSeconds);
                
                // Call original json function
                originalJson(data);
            };
            
            next();
            
        } catch (error) {
            // If Redis fails, skip cache and continue
            console.error('Cache middleware error:', error.message);
            res.setHeader('X-Cache', 'DISABLED');
            next();
        }
    };
}

// ============ CACHE INVALIDATION HELPERS ============

/**
 * Clear cache for specific pattern
 * @param {string} pattern - Redis key pattern (e.g., 'cache:/routes*')
 */
async function clearCache(pattern = 'cache:*') {
    try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
            await redis.del(keys);
            console.log(`Cleared ${keys.length} cache entries matching: ${pattern}`);
        }
        return keys.length;
    } catch (error) {
        console.error('Cache clear error:', error);
        return 0;
    }
}

/**
 * Clear all cache
 */
async function clearAllCache() {
    return clearCache('cache:*');
}

module.exports = { cache, clearCache, clearAllCache };