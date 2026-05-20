const { redisClient } = require('../config/redis');

function cache(ttlSeconds = 60) {
    return async (req, res, next) => {
        if (req.method !== 'GET') return next();
        
        const cacheKey = `cache:${req.originalUrl || req.url}`;
        
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                res.setHeader('X-Cache', 'HIT');
                return res.json(JSON.parse(cached));
            }
            
            const originalJson = res.json;
            res.json = function(data) {
                redisClient.set(cacheKey, JSON.stringify(data), { EX: ttlSeconds });
                res.setHeader('X-Cache', 'MISS');
                originalJson.call(this, data);
            };
            next();
        } catch (err) {
            next();
        }
    };
}

module.exports = cache;
