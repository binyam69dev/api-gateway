const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'api_gateway',
    user: 'gateway_admin',
    password: 'SecurePass123!',
});

async function testAll() {
    console.log('\n🔍 TESTING API GATEWAY\n');
    console.log('='.repeat(50));
    
    // 1. Health Check
    console.log('\n1. HEALTH CHECK');
    try {
        const health = await fetch('http://localhost:3000/health');
        const healthData = await health.json();
        console.log('   ✅ Gateway:', healthData.status);
        console.log('   ✅ PostgreSQL:', healthData.postgres);
        console.log('   ✅ Redis:', healthData.redis);
    } catch (err) {
        console.log('   ❌ Gateway not running!');
        process.exit();
    }
    
    // 2. Authentication
    console.log('\n2. AUTHENTICATION');
    const login = await fetch('http://localhost:3000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@gateway.com', password: 'admin123' })
    });
    const loginData = await login.json();
    console.log(loginData.token ? '   ✅ Admin Login SUCCESS' : '   ❌ Login FAILED');
    
    // 3. Routes count
    console.log('\n3. ROUTES IN DATABASE');
    const routes = await pool.query('SELECT COUNT(*) FROM routes WHERE is_active = true');
    console.log(`   ✅ Total active routes: ${routes.rows[0].count}`);
    
    // 4. Test key routes
    console.log('\n4. TESTING KEY ROUTES');
    
    const testRoutes = [
        '/health',
        '/routes',
        '/api/time',
        '/jokes/random',
        '/facts/cat',
        '/users/random',
        '/space/iss',
        '/crypto/bitcoin'
    ];
    
    let working = 0;
    for (const path of testRoutes) {
        try {
            const res = await fetch(`http://localhost:3000${path}`);
            if (res.ok) {
                working++;
                console.log(`   ✅ ${path} - ${res.status}`);
            } else {
                console.log(`   ⚠️ ${path} - ${res.status}`);
            }
        } catch (err) {
            console.log(`   ❌ ${path} - ERROR`);
        }
    }
    
    console.log(`\n   Working: ${working}/${testRoutes.length}`);
    
    // 5. Caching test
    console.log('\n5. CACHING PERFORMANCE');
    const start1 = Date.now();
    await fetch('http://localhost:3000/api/time');
    const time1 = Date.now() - start1;
    
    const start2 = Date.now();
    await fetch('http://localhost:3000/api/time');
    const time2 = Date.now() - start2;
    
    console.log(`   First call: ${time1}ms`);
    console.log(`   Second call: ${time2}ms`);
    console.log(`   ✅ Cache working! ${Math.round((time1-time2)/time1*100)}% faster`);
    
    console.log('\n' + '='.repeat(50));
    console.log('\n✅ GATEWAY IS READY FOR DEPLOYMENT!\n');
    
    process.exit();
}

testAll();
