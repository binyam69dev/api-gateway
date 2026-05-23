const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    user: 'gateway_admin',
    password: 'SecurePass123!',
    host: 'localhost',
    port: 5432,
    database: 'api_gateway'
});

async function fixPassword() {
    const hash = bcrypt.hashSync('admin123', 10);
    console.log('New hash:', hash);
    
    await pool.query('UPDATE users SET password_hash = \ WHERE email = \', [hash, 'admin@gateway.com']);
    console.log('Password updated for admin@gateway.com');
    
    const result = await pool.query('SELECT email, password_hash FROM users WHERE email = \', ['admin@gateway.com']);
    console.log('Verification:', result.rows[0]);
    
    await pool.end();
}

fixPassword();
