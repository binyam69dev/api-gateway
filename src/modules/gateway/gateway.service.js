const http = require('http');
const https = require('https');
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
        // First try exact match
        let result = await pool.query(
            `SELECT target_url, required_role, rate_limit_per_minute, cache_ttl_seconds 
             FROM routes 
             WHERE path_pattern = $1 AND method = $2 AND is_active = true`,
            [path, method]
        );
        
        // If no exact match, try pattern match
        if (result.rows.length === 0) {
            result = await pool.query(
                `SELECT target_url, required_role, rate_limit_per_minute, cache_ttl_seconds 
                 FROM routes 
                 WHERE $1 LIKE REPLACE(path_pattern, ':id', '%') 
                 AND method = $2 AND is_active = true 
                 LIMIT 1`,
                [path, method]
            );
        }
        
        return result.rows[0] || null;
    } catch (err) {
        console.error('Route lookup error:', err);
        return null;
    }
}

async function proxyRequest(targetUrl, req, res) {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: req.method,
            timeout: 30000,
            headers: {
                'User-Agent': req.headers['user-agent'] || 'API-Gateway',
                'Accept': req.headers['accept'] || 'application/json',
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Authorization': req.headers['authorization'],
                'x-forwarded-for': req.ip,
                'x-user-id': req.user?.id || ''
            }
        };
        
        // Remove undefined headers
        Object.keys(options.headers).forEach(key => {
            if (options.headers[key] === undefined) {
                delete options.headers[key];
            }
        });
        
        const protocol = url.protocol === 'https:' ? https : http;
        
        const proxyReq = protocol.request(options, (proxyRes) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                if (!res.headersSent) {
                    // Remove problematic headers
                    const headers = { ...proxyRes.headers };
                    delete headers['content-length'];
                    delete headers['transfer-encoding'];
                    delete headers['connection'];
                    
                    res.writeHead(proxyRes.statusCode, headers);
                    res.end(body);
                }
                resolve();
            });
        });
        
        proxyReq.on('error', (err) => {
            console.error(`Proxy error for ${targetUrl}:`, err.message);
            if (!res.headersSent) {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Gateway timeout', message: err.message }));
            }
            reject(err);
        });
        
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Gateway timeout', message: 'Request timed out' }));
            }
            reject(new Error('Timeout'));
        });
        
        if (req.body && Object.keys(req.body).length > 0) {
            proxyReq.write(JSON.stringify(req.body));
        }
        proxyReq.end();
    });
}

async function handleRequest(req, res) {
    console.log(`📡 [REQUEST] ${req.method} ${req.path} - ${new Date().toLocaleTimeString()}`);
    
    try {
        const route = await getRouteFromDatabase(req.path, req.method);
        
        if (!route) {
            console.log(`❌ [NOT FOUND] ${req.method} ${req.path}`);
            if (!res.headersSent) {
                res.status(404).json({ 
                    error: 'Route not found', 
                    path: req.path, 
                    method: req.method,
                    hint: 'Add this route to the routes table'
                });
            }
            return;
        }
        
        console.log(`✅ [ROUTE FOUND] ${req.method} ${req.path} → ${route.target_url}`);
        
        if (route.required_role && route.required_role !== 'guest' && !req.user) {
            console.log(`🔒 [AUTH REQUIRED] ${req.method} ${req.path} - Role: ${route.required_role}`);
            if (!res.headersSent) {
                res.status(401).json({ error: 'Authentication required' });
            }
            return;
        }
        
        const serviceName = route.target_url.split('/')[2] || 'unknown';
        const cb = getCircuitBreaker(serviceName);
        
        console.log(`🔄 [PROXY] Forwarding to ${route.target_url}`);
        
        await cb.call(() => proxyRequest(route.target_url, req, res));
        
    } catch (err) {
        console.error(`❌ [ERROR] ${req.method} ${req.path}:`, err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error', message: err.message });
        }
    }
}

function getCircuitStates() {
    const states = {};
    circuitBreakers.forEach((cb, name) => {
        states[name] = cb.getState();
    });
    return states;
}

module.exports = { handleRequest, getCircuitStates, proxyRequest };
