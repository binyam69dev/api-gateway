const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { pool } = require('../../config/database');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiters
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { error: 'Too many registration attempts. Please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again later.' }
});

// ============ HELPER FUNCTIONS ============
function validatePassword(password) {
    const errors = [];
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain at least 1 uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain at least 1 lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain at least 1 number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain at least 1 special character');
    return errors;
}

function logActivity(type, email, status, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${type} | ${email} | ${status} | IP: ${details.ip || 'unknown'} | UA: ${details.ua?.substring(0, 50) || 'unknown'}`;
    console.log(logEntry);
    
    // Also save to database (optional)
    if (process.env.NODE_ENV === 'production') {
        pool.query(
            `INSERT INTO activity_logs (type, email, status, ip_address, user_agent, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [type, email, status, details.ip, details.ua, JSON.stringify(details)]
        ).catch(err => console.error('Failed to log activity:', err.message));
    }
}

// ============ REGISTER ============
router.post('/register', registerLimiter, [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').optional().trim().escape()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;
    
    // Log attempt
    logActivity('REGISTER_ATTEMPT', email, 'PENDING', { ip: req.ip, ua: req.headers['user-agent'] });
    
    // Validate password strength
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
        logActivity('REGISTER_FAILED', email, 'WEAK_PASSWORD', { ip: req.ip, errors: passwordErrors });
        return res.status(400).json({ errors: passwordErrors });
    }
    
    try {
        // Check if user exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            logActivity('REGISTER_FAILED', email, 'ALREADY_EXISTS', { ip: req.ip });
            return res.status(400).json({ error: 'User already exists' });
        }
        
        // Hash password with higher salt rounds for production
        const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // Create verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Create user
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, name, role, is_verified, verification_token, created_at, ip_address)
             VALUES ($1, $2, $3, 'user', false, $4, NOW(), $5)
             RETURNING id, email, name`,
            [email, hashedPassword, name || email.split('@')[0], verificationToken, req.ip]
        );
        
        logActivity('REGISTER_SUCCESS', email, 'SUCCESS', { 
            ip: req.ip, 
            ua: req.headers['user-agent'],
            userId: result.rows[0].id 
        });
        
        // In production, send verification email here
        // await sendVerificationEmail(email, verificationToken);
        
        res.status(201).json({ 
            message: 'Registration successful! Please verify your email.',
            user: { id: result.rows[0].id, email: result.rows[0].email, name: result.rows[0].name }
        });
        
    } catch (error) {
        logActivity('REGISTER_ERROR', email, 'ERROR', { ip: req.ip, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============ LOGIN ============
router.post('/login', loginLimiter, [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    
    // Log attempt
    logActivity('LOGIN_ATTEMPT', email, 'PENDING', { ip: req.ip, ua: req.headers['user-agent'] });
    
    try {
        const result = await pool.query(
            'SELECT id, email, password_hash, role, name, is_verified, login_count FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            logActivity('LOGIN_FAILED', email, 'USER_NOT_FOUND', { ip: req.ip });
            // Use same message to prevent user enumeration
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        // Check if email is verified
        if (!user.is_verified && process.env.NODE_ENV === 'production') {
            logActivity('LOGIN_FAILED', email, 'NOT_VERIFIED', { ip: req.ip });
            return res.status(401).json({ error: 'Please verify your email before logging in' });
        }
        
        // Verify password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            logActivity('LOGIN_FAILED', email, 'INVALID_PASSWORD', { ip: req.ip });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Update user stats
        await pool.query(
            `UPDATE users SET last_login = NOW(), last_ip = $1, login_count = login_count + 1 WHERE id = $2`,
            [req.ip, user.id]
        );
        
        // Generate JWT with refresh token support
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                name: user.name,
                iat: Math.floor(Date.now() / 1000)
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // Generate refresh token
        const refreshToken = jwt.sign(
            { id: user.id },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        logActivity('LOGIN_SUCCESS', email, 'SUCCESS', { 
            ip: req.ip, 
            ua: req.headers['user-agent'],
            userId: user.id,
            loginCount: user.login_count + 1
        });
        
        res.json({ 
            message: 'Login successful',
            token,
            refresh_token: refreshToken,
            user: { 
                id: user.id, 
                email: user.email, 
                role: user.role, 
                name: user.name 
            }
        });
        
    } catch (error) {
        logActivity('LOGIN_ERROR', email, 'ERROR', { ip: req.ip, error: error.message });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============ REFRESH TOKEN ============
router.post('/refresh-token', async (req, res) => {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh token required' });
    }
    
    try {
        const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
        const user = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [decoded.id]);
        
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        
        const newToken = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        logActivity('TOKEN_REFRESH', user.rows[0].email, 'SUCCESS', { ip: req.ip });
        
        res.json({ token: newToken });
        
    } catch (error) {
        logActivity('TOKEN_REFRESH', 'unknown', 'FAILED', { ip: req.ip, error: error.message });
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});

// ============ LOGOUT ============
router.post('/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    let email = 'unknown';
    
    if (authHeader) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.decode(token);
            email = decoded?.email || 'unknown';
        } catch(e) {}
    }
    
    logActivity('LOGOUT', email, 'SUCCESS', { ip: req.ip });
    res.json({ message: 'Logged out successfully' });
});

// ============ GET PROFILE ============
router.get('/profile', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await pool.query(
            'SELECT id, email, name, role, is_verified, created_at, last_login, login_count FROM users WHERE id = $1',
            [decoded.id]
        );
        
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        res.json({ user: user.rows[0] });
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ============ CHANGE PASSWORD ============
router.post('/change-password', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Current and new password required' });
    }
    
    const passwordErrors = validatePassword(new_password);
    if (passwordErrors.length > 0) {
        return res.status(400).json({ errors: passwordErrors });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [decoded.id]);
        
        const valid = await bcrypt.compare(current_password, user.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, decoded.id]);
        
        logActivity('PASSWORD_CHANGE', decoded.email, 'SUCCESS', { ip: req.ip });
        
        res.json({ message: 'Password changed successfully' });
        
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

module.exports = router;
