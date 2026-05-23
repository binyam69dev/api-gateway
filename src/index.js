require('dotenv').config({ path: './.env' });
const app = require('./app');
const { testConnection } = require('./config/database');
const { connectRedis } = require('./config/redis');

const PORT = parseInt(process.env.PORT) || 3000;

async function start() {
    try {
        // Test database connection
        await testConnection();
        console.log('✅ Database connection verified');
        
        // Connect to Redis
        await connectRedis();
        console.log('✅ Redis connection verified');
        
    } catch (error) {
        console.error('❌ Failed to connect to services:', error.message);
        console.log('⚠️  Continuing without database/Redis... Some features may be limited');
    }
    
    const startServer = (port) => {
        const server = app.listen(port, () => {
            console.log(`\n🚀 Modern API Gateway on http://localhost:${port}`);
            console.log(`📊 Health: http://localhost:${port}/health`);
            console.log(`📈 Metrics: http://localhost:${port}/metrics`);
            console.log(`🔐 Admin: admin@gateway.com / admin123`);
            console.log(`\n✅ Modular structure loaded!\n`);
            console.log(`🍪 Cookie-based authentication enabled`);
            console.log(`🔒 HttpOnly cookies | SameSite=lax | Secure=${process.env.NODE_ENV === 'production'}\n`);
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`);
                startServer(port + 1);
            } else {
                console.error('❌ Server error:', err);
                process.exit(1);
            }
        });
    };
    
    startServer(PORT);
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

start();