const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'api_gateway',
    user: 'gateway_admin',
    password: 'SecurePass123!',
});

const routes = [
    // 1. Weather API
    ['/weather/current', 'GET', 'https://wttr.in/NewYork?format=j1', 'guest', 50, 300, 'Current weather in New York'],
    
    // 2. Random Joke API
    ['/jokes/random', 'GET', 'https://official-joke-api.appspot.com/random_joke', 'guest', 100, 60, 'Random programming joke'],
    
    // 3. Random User Generator
    ['/users/random', 'GET', 'https://randomuser.me/api/', 'guest', 100, 300, 'Generate random user profile'],
    
    // 4. Bitcoin Price
    ['/crypto/bitcoin', 'GET', 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', 'guest', 50, 60, 'Current Bitcoin price in USD'],
    
    // 5. Cat Facts
    ['/facts/cat', 'GET', 'https://catfact.ninja/fact', 'guest', 100, 60, 'Random cat fact'],
    
    // 6. ISS Location
    ['/space/iss', 'GET', 'http://api.open-notify.org/iss-now.json', 'guest', 50, 30, 'Current International Space Station location'],
    
    // 7. Random Activity
    ['/activity', 'GET', 'https://www.boredapi.com/api/activity', 'guest', 100, 60, 'Something to do when bored'],
    
    // 8. Random Quote
    ['/quotes/random', 'GET', 'https://api.quotable.io/random', 'guest', 100, 60, 'Inspirational quote'],
    
    // 9. Dog Image
    ['/animals/dog', 'GET', 'https://dog.ceo/api/breeds/image/random', 'guest', 100, 60, 'Random dog image URL'],
    
    // 10. Public APIs List
    ['/public-apis', 'GET', 'https://api.publicapis.org/entries', 'guest', 30, 300, 'List of public APIs']
];

async function addRoutes() {
    console.log('\n🗺️ ADDING 10 PROFESSIONAL ROUTES\n');
    
    let added = 0;
    let exists = 0;
    
    for (const route of routes) {
        const [path, method, target, role, rateLimit, cacheTtl, description] = route;
        
        try {
            const result = await pool.query(
                `INSERT INTO routes (path_pattern, method, target_url, required_role, rate_limit_per_minute, cache_ttl_seconds, description, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                 ON CONFLICT (path_pattern, method) DO NOTHING
                 RETURNING path_pattern`,
                [path, method, target, role, rateLimit, cacheTtl, description]
            );
            
            if (result.rows.length > 0) {
                console.log(`   ✅ ${method} ${path} - ${description}`);
                added++;
            } else {
                console.log(`   ⏭️ ${method} ${path} - Already exists`);
                exists++;
            }
        } catch (err) {
            console.log(`   ❌ Error adding ${path}: ${err.message}`);
        }
    }
    
    const total = await pool.query('SELECT COUNT(*) FROM routes WHERE is_active = true');
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ New routes added: ${added}`);
    console.log(`   ⏭️ Already existed: ${exists}`);
    console.log(`   📊 TOTAL ACTIVE ROUTES: ${total.rows[0].count}`);
    console.log(`\n✅ Routes added successfully!\n`);
    
    process.exit();
}

addRoutes();
