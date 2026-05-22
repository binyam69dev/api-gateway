require('dotenv').config({ path: './.env' });
const app = require('./app');
const { testConnection } = require('./config/database');
const { connectRedis } = require('./config/redis');

const PORT = parseInt(process.env.PORT) || 3000;

async function start() {
    await testConnection();
    await connectRedis();
    
    const startServer = (port) => {
        const server = app.listen(port, () => {
            console.log(`\n🚀 Modern API Gateway on http://localhost:${port}`);
            console.log(`📊 Health: http://localhost:${port}/health`);
            console.log(`📈 Metrics: http://localhost:${port}/metrics`);
            console.log(`🔐 Admin: admin@gateway.com / admin123`);
            console.log(`\n✅ Modular structure loaded!\n`);
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`);
                startServer(port + 1);
            } else {
                console.error('Server error:', err);
                process.exit(1);
            }
        });
    };
    
    startServer(PORT);
}

start();