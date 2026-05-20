const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

async function adminMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    
    const { pool } = require('../config/database');
    const user = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    
    if (user.rows[0]?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

module.exports = { authMiddleware, adminMiddleware };
