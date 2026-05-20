const { redisClient } = require('../config/redis');

function rateLimit(maxRequests = 100, windowMs = 60000) {
    return async (req, res, next) => {
        const identifier = req.user?.id || req.ip;
        const key = `ratelimit:${identifier}`;
        
        try {
            const current = await redisClient.get(key);
            const count = current ? parseInt(current) : 0;
            
            if (count >= maxRequests) {
                return res.status(429).json({ error: 'Too many requests' });
            }
            
            await redisClient.set(key, count + 1, { EX: Math.ceil(windowMs / 1000) });
            next();
        } catch (err) {
            next();
        }
    };
}

module.exports = rateLimit;
