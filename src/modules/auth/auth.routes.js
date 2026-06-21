const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool } = require('../../config/database');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ============ RATE LIMITERS ============
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

const refreshLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { error: 'Too many refresh requests. Please try again later.' }
});

// ============ COOKIE OPTIONS ============
const getCookieOptions = () => ({
    httpOnly: process.env.COOKIE_HTTP_ONLY === 'true' || process.env.NODE_ENV === 'production',
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
});

const getRefreshCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
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
    
    // In production, log to database
    if (process.env.NODE_ENV === 'production') {
        pool.query(
            `INSERT INTO activity_logs (type, email, status, ip_address, user_agent, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [type, email, status, details.ip, details.ua, JSON.stringify(details)]
        ).catch(err => console.error('Failed to log activity:', err.message));
    }
}

// ============ AUTHENTICATION MIDDLEWARE (COOKIE-BASED) ============
const authenticateCookie = async (req, res, next) => {
    const token = req.cookies.adminToken || req.cookies.devToken;
    
    if (!token) {
        return res.status(401).json({ 
            error: 'No token provided. Please login.',
            code: 'NO_TOKEN'
        });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Token expired. Please login again.',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({ 
            error: 'Invalid token. Please login again.',
            code: 'INVALID_TOKEN'
        });
    }
};

// ============ REGISTER ============
/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     description: |
 *       Create a new user account with email and password.
 *       Password must be at least 8 characters with uppercase, lowercase, number, and special character.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePass123!
 *               name:
 *                 type: string
 *                 example: John Doe
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: User already exists
 *       429:
 *         description: Too many registration attempts
 */
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
    
    logActivity('REGISTER_ATTEMPT', email, 'PENDING', { ip: req.ip, ua: req.headers['user-agent'] });
    
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
        logActivity('REGISTER_FAILED', email, 'WEAK_PASSWORD', { ip: req.ip, errors: passwordErrors });
        return res.status(400).json({ errors: passwordErrors });
    }
    
    try {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            logActivity('REGISTER_FAILED', email, 'ALREADY_EXISTS', { ip: req.ip });
            return res.status(409).json({ error: 'User already exists' });
        }
        
        const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
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
        
        res.status(201).json({ 
            message: 'Registration successful! Please verify your email.',
            user: { id: result.rows[0].id, email: result.rows[0].email, name: result.rows[0].name }
        });
        
    } catch (error) {
        logActivity('REGISTER_ERROR', email, 'ERROR', { ip: req.ip, error: error.message });
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============ LOGIN (COOKIE-BASED) ============
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login to the API Gateway
 *     description: |
 *       Authenticate a user and receive secure HttpOnly cookies.
 *       After successful login, `adminToken` or `devToken` cookies are set.
 *       These cookies are automatically sent with subsequent requests.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@gateway.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Admin123!
 *     responses:
 *       200:
 *         description: Login successful
 *         headers:
 *           Set-Cookie:
 *             schema:
 *               type: string
 *             description: 'adminToken, devToken, refreshToken (HttpOnly)'
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */
router.post('/login', loginLimiter, [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    
    logActivity('LOGIN_ATTEMPT', email, 'PENDING', { ip: req.ip, ua: req.headers['user-agent'] });
    
    try {
        const result = await pool.query(
            'SELECT id, email, password_hash, role, name, is_verified, login_count FROM users WHERE email = $1',
            [email]
        );
        
        if (result.rows.length === 0) {
            logActivity('LOGIN_FAILED', email, 'USER_NOT_FOUND', { ip: req.ip });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = result.rows[0];
        
        if (!user.is_verified && process.env.NODE_ENV === 'production') {
            logActivity('LOGIN_FAILED', email, 'NOT_VERIFIED', { ip: req.ip });
            return res.status(401).json({ error: 'Please verify your email before logging in' });
        }
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            await pool.query(
                'UPDATE users SET login_attempts = COALESCE(login_attempts, 0) + 1 WHERE id = $1',
                [user.id]
            );
            logActivity('LOGIN_FAILED', email, 'INVALID_PASSWORD', { ip: req.ip });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Reset login attempts on success
        await pool.query(
            `UPDATE users SET login_attempts = 0, last_login = NOW(), last_ip = $1, login_count = login_count + 1 WHERE id = $2`,
            [req.ip, user.id]
        );
        
        // Generate JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                name: user.name
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        const refreshToken = jwt.sign(
            { id: user.id },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        // Set cookies
        res.cookie('adminToken', token, getCookieOptions());
        res.cookie('devToken', token, getCookieOptions());
        res.cookie('refreshToken', refreshToken, getRefreshCookieOptions());
        
        logActivity('LOGIN_SUCCESS', email, 'SUCCESS', { 
            ip: req.ip, 
            ua: req.headers['user-agent'],
            userId: user.id,
            loginCount: user.login_count + 1
        });
        
        res.json({ 
            message: 'Login successful',
            user: { 
                id: user.id, 
                email: user.email, 
                role: user.role, 
                name: user.name 
            }
        });
        
    } catch (error) {
        logActivity('LOGIN_ERROR', email, 'ERROR', { ip: req.ip, error: error.message });
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============ REFRESH TOKEN ============
/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh authentication token
 *     description: |
 *       Uses the refresh token cookie to get a new access token.
 *       The refresh token is automatically sent via cookie.
 *     tags:
 *       - Authentication
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh-token', refreshLimiter, async (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
    }
    
    try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
        const user = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [decoded.id]);
        
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        
        const newToken = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // Set new cookie
        res.cookie('adminToken', newToken, getCookieOptions());
        res.cookie('devToken', newToken, getCookieOptions());
        
        logActivity('TOKEN_REFRESH', user.rows[0].email, 'SUCCESS', { ip: req.ip });
        
        res.json({ message: 'Token refreshed successfully' });
        
    } catch (error) {
        logActivity('TOKEN_REFRESH', 'unknown', 'FAILED', { ip: req.ip, error: error.message });
        res.status(401).json({ error: 'Invalid refresh token' });
    }
});

// ============ LOGOUT ============
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout and clear cookies
 *     description: |
 *       Clears all authentication cookies (adminToken, devToken, refreshToken).
 *       After logout, the user must login again to access protected endpoints.
 *     tags:
 *       - Authentication
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 */
router.post('/logout', (req, res) => {
    const email = req.cookies.adminToken ? 'authenticated' : 'unknown';
    
    // Clear all cookies
    res.clearCookie('adminToken', { path: '/' });
    res.clearCookie('devToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/' });
    
    logActivity('LOGOUT', email, 'SUCCESS', { ip: req.ip });
    res.json({ message: 'Logged out successfully' });
});

// ============ GET PROFILE ============
/**
 * @swagger
 * /auth/profile:
 *   get:
 *     summary: Get current user profile
 *     description: |
 *       Returns the profile information of the currently authenticated user.
 *       Requires a valid authentication cookie.
 *     tags:
 *       - Profile
 *     security:
 *       - adminCookieAuth: []
 *       - devCookieAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/profile', authenticateCookie, async (req, res) => {
    try {
        const user = await pool.query(
            'SELECT id, email, name, role, is_verified, created_at, last_login, login_count FROM users WHERE id = $1',
            [req.user.id]
        );
        
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ user: user.rows[0] });
        
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============ CHANGE PASSWORD ============
/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change user password
 *     description: |
 *       Change the password for the authenticated user.
 *       Requires current password and new password (min 8 characters).
 *     tags:
 *       - Profile
 *     security:
 *       - adminCookieAuth: []
 *       - devCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - current_password
 *               - new_password
 *             properties:
 *               current_password:
 *                 type: string
 *                 format: password
 *                 example: OldPass123!
 *               new_password:
 *                 type: string
 *                 format: password
 *                 example: NewPass123!
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Current password incorrect
 */
router.post('/change-password', authenticateCookie, async (req, res) => {
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Current and new password required' });
    }
    
    const passwordErrors = validatePassword(new_password);
    if (passwordErrors.length > 0) {
        return res.status(400).json({ errors: passwordErrors });
    }
    
    try {
        const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        
        if (user.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }
        
        const valid = await bcrypt.compare(current_password, user.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        const hashedPassword = await bcrypt.hash(new_password, 12);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, req.user.id]);
        
        logActivity('PASSWORD_CHANGE', req.user.email, 'SUCCESS', { ip: req.ip });
        
        res.json({ message: 'Password changed successfully' });
        
    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;