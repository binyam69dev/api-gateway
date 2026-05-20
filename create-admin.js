const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function createAdmin() {
    const hashed = await bcrypt.hash('admin123', 10);
    console.log('Hash:', hashed);
    
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'api_gateway',
        user: 'gateway_admin',
        password: 'SecurePass123!',
    });
    
    await pool.query("DELETE FROM users WHERE email = 'admin@gateway.com'");
    await pool.query(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
        ['admin@gateway.com', hashed]
    );
    
    console.log('✅ Admin created! Testing login...');
    
    const result = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['admin@gateway.com']);
    const isValid = await bcrypt.compare('admin123', result.rows[0].password_hash);
    console.log('Password test:', isValid ? '✅ WORKS' : '❌ FAILED');
    
    await pool.end();
    process.exit();
}

createAdmin();
