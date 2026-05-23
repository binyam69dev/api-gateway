const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    // Connection pool settings for production
    max: process.env.NODE_ENV === 'production' ? 20 : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected database error:', err.message);
    if (process.env.NODE_ENV === 'production') {
        // In production, you might want to alert monitoring system
        console.error('Database connection lost, attempting to reconnect...');
    }
});

pool.on('connect', () => {
    console.log('✅ PostgreSQL connection established');
});

async function testConnection() {
    try {
        const result = await pool.query('SELECT 1 as connected, NOW() as time, version() as pg_version');
        console.log('✅ PostgreSQL connected');
        console.log(`   📦 Version: ${result.rows[0].pg_version.split(',')[0]}`);
        console.log(`   🕐 Server time: ${result.rows[0].time}`);
        return true;
    } catch (err) {
        console.error('❌ PostgreSQL connection failed:', err.message);
        console.error('   Please check:');
        console.error('   - PostgreSQL is running: docker ps | grep postgres');
        console.error('   - Environment variables in .env file');
        console.error('   - Host and port are correct');
        return false;
    }
}

async function getPoolStats() {
    return {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: pool.options.max
    };
}

async function endPool() {
    try {
        await pool.end();
        console.log('✅ PostgreSQL pool closed');
    } catch (err) {
        console.error('Error closing pool:', err.message);
    }
}

module.exports = { pool, testConnection, getPoolStats, endPool };