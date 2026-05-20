const http = require('http');
const { pool } = require('../../config/database');
const CircuitBreaker = require('../../utils/circuitBreaker');

const circuitBreakers = new Map();

function getCircuitBreaker(serviceName) {
    if (!circuitBreakers.has(serviceName)) {
        circuitBreakers.set(serviceName, new CircuitBreaker(serviceName));
    }
    return circuitBreakers.get(serviceName);
}

async function getRouteFromDatabase(path, method) {
    try {
        const result = await pool.query(
            `SELECT target_url, required_role, rate_limit_per_minute, cache_ttl_seconds 
             FROM routes WHERE path_pattern = $1 AND method = $2 AND is_active = true`,
            [path, method]
        );
        return result.rows[0] || null;
    } catch (err) {
        return null;
    }
}

async function proxyRequest(targetUrl, req, res) {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        const options = {
            hostname: url.hostname,
            port: url.port || 80,
            path: url.pathname + (req.url.split('?')[1] ? '?' + req.url.split('?')[1] : ''),
            method: req.method,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'x-forwarded-for': req.ip,
                'x-user-id': req.user?.id || ''
            }
        };
        
        const proxyReq = http.request(options, (proxyRes) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                res.status(proxyRes.statusCode).set(proxyRes.headers).send(body);
                resolve();
            });
        });
        
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            reject(new Error('Request timeout'));
        });
        
        proxyReq.on('error', reject);
        
        if (req.body && Object.keys(req.body).length > 0) {
            proxyReq.write(JSON.stringify(req.body));
        }
        proxyReq.end();
    });
}

async function handleRequest(req, res) {
    const route = await getRouteFromDatabase(req.path, req.method);
    
    if (!route) {
        return res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
    }
    
    if (route.required_role && route.required_role !== 'guest' && !req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const serviceName = route.target_url.split('/')[2] || 'unknown';
    const cb = getCircuitBreaker(serviceName);
    
    try {
        await cb.call(() => proxyRequest(route.target_url, req, res));
    } catch (err) {
        res.status(502).json({ error: 'Service unavailable', message: err.message });
    }
}

function getCircuitStates() {
    const states = {};
    circuitBreakers.forEach((cb, name) => {
        states[name] = cb.getState();
    });
    return states;
}

module.exports = { handleRequest, getCircuitStates };
