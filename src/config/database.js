const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST ,
    port: process.env.POSTGRES_PORT ,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER ,
    password: process.env.POSTGRES_PASSWORD 
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
