const redis = require('redis');

const redisClient = redis.createClient({
    url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
    socket: {
        reconnectStrategy: (retries) => {
            console.log(`Redis reconnect attempt ${retries}`);
            if (retries > 10) {
                console.error('Redis max reconnection attempts reached');
                return new Error('Redis connection failed after 10 attempts');
            }
            return Math.min(retries * 100, 3000);
        },
        timeout: 10000
    }
});

redisClient.on('error', (err) => {
    console.error('❌ Redis error:', err.message);
});

redisClient.on('connect', () => {
    console.log('✅ Redis connected');
});

redisClient.on('ready', () => {
    console.log('✅ Redis ready for operations');
});

redisClient.on('end', () => {
    console.log('⚠️ Redis connection closed');
});

async function connectRedis() {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
        console.log('✅ Redis connection established');
        return redisClient;
    } catch (err) {
        console.error('❌ Redis connection failed:', err.message);
        console.log('⚠️ Continuing without Redis - rate limiting and caching will be disabled');
        return null;
    }
}

async function disconnectRedis() {
    try {
        if (redisClient.isOpen) {
            await redisClient.quit();
            console.log('✅ Redis disconnected');
        }
    } catch (err) {
        console.error('Redis disconnect error:', err.message);
    }
}

// Helper functions for rate limiting
async function incrementRateLimit(key, windowSeconds, maxRequests) {
    try {
        const current = await redisClient.incr(key);
        if (current === 1) {
            await redisClient.expire(key, windowSeconds);
        }
        return current > maxRequests;
    } catch (err) {
        console.error('Rate limit error:', err.message);
        return false;
    }
}

// Helper functions for caching
async function getCached(key) {
    try {
        const data = await redisClient.get(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error('Cache get error:', err.message);
        return null;
    }
}

async function setCached(key, data, ttlSeconds = 60) {
    try {
        await redisClient.setEx(key, ttlSeconds, JSON.stringify(data));
        return true;
    } catch (err) {
        console.error('Cache set error:', err.message);
        return false;
    }
}

async function clearCache(pattern = '*') {
    try {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`Cleared ${keys.length} cache keys`);
        }
        return keys.length;
    } catch (err) {
        console.error('Cache clear error:', err.message);
        return 0;
    }
}

module.exports = { 
    redisClient, 
    connectRedis, 
    disconnectRedis,
    incrementRateLimit,
    getCached,
    setCached,
    clearCache
};