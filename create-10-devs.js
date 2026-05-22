const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'api_gateway',
    user: 'gateway_admin',
    password: 'SecurePass123!',
});

async function createDevelopers() {
    console.log('\n👥 CREATING 10 DEVELOPERS\n');
    
    const developers = [
        { name: 'Alice Chen', email: 'alice@techcorp.com', company: 'TechCorp' },
        { name: 'Bob Wilson', email: 'bob@startupx.com', company: 'StartupX' },
        { name: 'Carol Davis', email: 'carol@devstudio.com', company: 'DevStudio' },
        { name: 'David Kim', email: 'david@cloudnine.com', company: 'CloudNine' },
        { name: 'Emma Brown', email: 'emma@datasys.com', company: 'DataSys' },
        { name: 'Frank Miller', email: 'frank@webflow.com', company: 'WebFlow' },
        { name: 'Grace Lee', email: 'grace@appmasters.com', company: 'AppMasters' },
        { name: 'Henry Zhang', email: 'henry@codelab.com', company: 'CodeLab' },
        { name: 'Iris Patel', email: 'iris@innovate.com', company: 'Innovate' },
        { name: 'Jack Ryan', email: 'jack@futuresoft.com', company: 'FutureSoft' }
    ];
    
    let created = 0;
    
    for (const dev of developers) {
        const hashedPassword = await bcrypt.hash('password123', 10);
        
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, name, company, role, is_verified)
             VALUES ($1, $2, $3, $4, 'user', true)
             ON CONFLICT (email) DO NOTHING
             RETURNING email`,
            [dev.email, hashedPassword, dev.name, dev.company]
        );
        
        if (result.rows.length > 0) {
            created++;
            console.log(`   ✅ ${dev.email} (${dev.company})`);
        }
    }
    
    const total = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'user'");
    console.log(`\n📊 TOTAL DEVELOPERS: ${total.rows[0].count}`);
    console.log('✅ Password for all developers: password123\n');
    
    process.exit();
}

createDevelopers();
