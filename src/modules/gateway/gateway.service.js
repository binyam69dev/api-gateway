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
        
        // If no exact match, try pattern match (supports :id parameters)
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

async function proxyRequest(targetUrl, req, res, userInfo = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        
        // Build headers with user info from cookie
        const headers = {
            'User-Agent': req.headers['user-agent'] || 'API-Gateway',
            'Accept': req.headers['accept'] || 'application/json',
            'Content-Type': req.headers['content-type'] || 'application/json',
            'x-forwarded-for': req.ip,
            'x-user-id': userInfo?.id || '',
            'x-user-email': userInfo?.email || '',
            'x-user-role': userInfo?.role || ''
        };
        
        // Pass through authorization if present (for downstream services)
        if (req.headers['authorization']) {
            headers['Authorization'] = req.headers['authorization'];
        }
        
        // Remove undefined headers
        Object.keys(headers).forEach(key => {
            if (headers[key] === undefined || headers[key] === '') {
                delete headers[key];
            }
        });
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: req.method,
            timeout: 30000,
            headers: headers
        };
        
        const protocol = url.protocol === 'https:' ? https : http;
        
        const proxyReq = protocol.request(options, (proxyRes) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                if (!res.headersSent) {
                    // Remove problematic headers
                    const responseHeaders = { ...proxyRes.headers };
                    delete responseHeaders['content-length'];
                    delete responseHeaders['transfer-encoding'];
                    delete responseHeaders['connection'];
                    
                    res.writeHead(proxyRes.statusCode, responseHeaders);
                    res.end(body);
                }
                resolve();
            });
        });
        
        proxyReq.on('error', (err) => {
            console.error(`Proxy error for ${targetUrl}:`, err.message);
            if (!res.headersSent) {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Gateway timeout', 
                    message: err.message,
                    target: targetUrl
                }));
            }
            reject(err);
        });
        
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            if (!res.headersSent) {
                res.writeHead(504, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Gateway timeout', 
                    message: 'Request timed out after 30 seconds' 
                }));
            }
            reject(new Error('Timeout'));
        });
        
        // Send body if present
        if (req.body && Object.keys(req.body).length > 0) {
            const bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            proxyReq.write(bodyString);
        }
        proxyReq.end();
    });
}

async function handleRequest(req, res) {
    const startTime = Date.now();
    console.log(`📡 [REQUEST] ${req.method} ${req.path} - ${new Date().toLocaleTimeString()}`);
    
    try {
        // Get route from database
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
        
        // Check if authentication is required
        if (route.required_role && route.required_role !== 'guest') {
            // Get user from cookie (adminToken or devToken)
            const token = req.cookies?.adminToken || req.cookies?.devToken;
            
            if (!token) {
                console.log(`🔒 [AUTH REQUIRED] ${req.method} ${req.path} - No token provided`);
                if (!res.headersSent) {
                    res.status(401).json({ 
                        error: 'Authentication required', 
                        required_role: route.required_role 
                    });
                }
                return;
            }
            
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                req.user = decoded;
                
                // Check role requirement
                if (route.required_role === 'admin' && req.user.role !== 'admin') {
                    console.log(`🔒 [AUTH FAILED] ${req.method} ${req.path} - Admin role required`);
                    if (!res.headersSent) {
                        res.status(403).json({ 
                            error: 'Forbidden', 
                            required_role: route.required_role,
                            user_role: req.user.role
                        });
                    }
                    return;
                }
                
                console.log(`✅ [AUTH SUCCESS] User: ${req.user.email} (${req.user.role})`);
                
            } catch (err) {
                console.log(`🔒 [AUTH ERROR] ${req.method} ${req.path} - Invalid token`);
                if (!res.headersSent) {
                    res.status(401).json({ error: 'Invalid or expired token' });
                }
                return;
            }
        }
        
        // Check rate limiting (optional - can be enhanced with Redis)
        // Rate limiting would go here
        
        // Apply circuit breaker
        const serviceName = route.target_url.split('/')[2] || 'unknown';
        const cb = getCircuitBreaker(serviceName);
        
        console.log(`🔄 [PROXY] Forwarding to ${route.target_url}`);
        
        // Execute proxy request with circuit breaker
        await cb.call(() => proxyRequest(route.target_url, req, res, req.user));
        
        const duration = Date.now() - startTime;
        console.log(`✅ [COMPLETE] ${req.method} ${req.path} - ${duration}ms`);
        
        // Log to database (async, don't await)
        if (process.env.NODE_ENV === 'production') {
            pool.query(
                `INSERT INTO request_logs (method, path, target_url, status_code, response_time_ms, user_id, ip_address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [req.method, req.path, route.target_url, res.statusCode, duration, req.user?.id, req.ip]
            ).catch(err => console.error('Failed to log request:', err.message));
        }
        
    } catch (err) {
        const duration = Date.now() - startTime;
        console.error(`❌ [ERROR] ${req.method} ${req.path}:`, err.message);
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Internal server error', 
                message: err.message,
                path: req.path,
                method: req.method
            });
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

// Get user from cookie (middleware helper)
function getUserFromCookie(req) {
    const token = req.cookies?.adminToken || req.cookies?.devToken;
    if (!token) return null;
    
    try {
        const jwt = require('jsonwebtoken');
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return null;
    }
}

module.exports = { 
    handleRequest, 
    getCircuitStates, 
    proxyRequest,
    getUserFromCookie,
    getRouteFromDatabase
};