const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'api_gateway',
    user: process.env.POSTGRES_USER || 'gateway_admin',
    password: process.env.POSTGRES_PASSWORD || 'SecurePass123!',
});

pool.on('error', (err) => console.error('Unexpected database error:', err));

async function testConnection() {
    try {
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL connected');
        return true;
    } catch (err) {
        console.error('❌ PostgreSQL connection failed:', err.message);
        return false;
    }
}

module.exports = { pool, testConnection };
