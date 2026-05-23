const jwt = require('jsonwebtoken');

// ============ COOKIE-BASED AUTHENTICATION MIDDLEWARE ============
function authMiddleware(req, res, next) {
    // Read token from cookies (not Authorization header)
    const token = req.cookies.adminToken || req.cookies.devToken;
    
    // Debug logging (remove in production)
    console.log("Auth Middleware - Cookies:", Object.keys(req.cookies || {}));
    console.log("Auth Middleware - Token found:", !!token);
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided. Please login.' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        console.log("Auth Middleware - User authenticated:", decoded.email);
        next();
    } catch (error) {
        console.error("Token verification error:", error.message);
        // Clear invalid cookies
        res.clearCookie('adminToken');
        res.clearCookie('devToken');
        res.clearCookie('refreshToken');
        return res.status(401).json({ error: 'Invalid or expired token. Please login again.' });
    }
}

// ============ ADMIN MIDDLEWARE ============
async function adminMiddleware(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    try {
        const { pool } = require('../config/database');
        const result = await pool.query(
            'SELECT role FROM users WHERE id = $1', 
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        if (result.rows[0].role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        next();
    } catch (error) {
        console.error("Admin middleware error:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { authMiddleware, adminMiddleware };