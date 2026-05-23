const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../../config/database');

class AuthService {
    
    // ============ REGISTER ============
    async register(email, password, name = null, ip = null) {
        // Check if user exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            throw new Error('User already exists');
        }
        
        // Hash password (higher salt rounds for production)
        const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
        const hashed = await bcrypt.hash(password, saltRounds);
        
        // Create verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Insert user
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, name, role, is_verified, verification_token, created_at, ip_address)
             VALUES ($1, $2, $3, 'user', false, $4, NOW(), $5)
             RETURNING id, email, name, role, is_verified`,
            [email, hashed, name || email.split('@')[0], verificationToken, ip || null]
        );
        
        return {
            ...result.rows[0],
            verification_token: verificationToken
        };
    }

    // ============ LOGIN ============
    async login(email, password, ip = null) {
        const result = await pool.query(
            `SELECT id, email, password_hash, role, name, is_verified, login_count 
             FROM users WHERE email = $1`,
            [email]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Invalid credentials');
        }
        
        const user = result.rows[0];
        
        // Check if email is verified (for production)
        if (!user.is_verified && process.env.NODE_ENV === 'production') {
            throw new Error('Please verify your email before logging in');
        }
        
        // Verify password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            throw new Error('Invalid credentials');
        }
        
        // Update login stats
        await pool.query(
            `UPDATE users SET last_login = NOW(), last_ip = $1, login_count = login_count + 1 WHERE id = $2`,
            [ip || null, user.id]
        );
        
        // Generate tokens
        const accessToken = jwt.sign(
            { id: user.id, email: user.email, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        const refreshToken = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                name: user.name
            }
        };
    }

    // ============ REFRESH TOKEN ============
    async refreshToken(refreshToken) {
        if (!refreshToken) {
            throw new Error('Refresh token required');
        }
        
        try {
            const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
            
            const result = await pool.query(
                'SELECT id, email, role, name FROM users WHERE id = $1',
                [decoded.id]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Invalid refresh token');
            }
            
            const user = result.rows[0];
            
            const newAccessToken = jwt.sign(
                { id: user.id, email: user.email, role: user.role, name: user.name },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            
            return { accessToken: newAccessToken };
            
        } catch (error) {
            throw new Error('Invalid or expired refresh token');
        }
    }

    // ============ GET PROFILE ============
    async getProfile(userId) {
        const result = await pool.query(
            `SELECT id, email, name, role, is_verified, created_at, last_login, login_count, avatar, company
             FROM users WHERE id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        return result.rows[0];
    }

    // ============ UPDATE PROFILE ============
    async updateProfile(userId, updates) {
        const allowedFields = ['name', 'company', 'website', 'location', 'bio', 'avatar'];
        const fields = [];
        const values = [];
        let paramCount = 1;
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key) && value !== undefined) {
                fields.push(`${key} = $${paramCount++}`);
                values.push(value);
            }
        }
        
        if (fields.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        fields.push(`updated_at = NOW()`);
        values.push(userId);
        
        const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING id, email, name, role, company, website, location, bio, avatar`;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        return result.rows[0];
    }

    // ============ CHANGE PASSWORD ============
    async changePassword(userId, currentPassword, newPassword) {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!valid) {
            throw new Error('Current password is incorrect');
        }
        
        const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [hashedPassword, userId]
        );
        
        return { message: 'Password changed successfully' };
    }

    // ============ VERIFY EMAIL ============
    async verifyEmail(token) {
        const result = await pool.query(
            'SELECT id FROM users WHERE verification_token = $1 AND is_verified = false',
            [token]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Invalid or expired verification token');
        }
        
        await pool.query(
            `UPDATE users SET is_verified = true, verification_token = NULL, updated_at = NOW() WHERE id = $1`,
            [result.rows[0].id]
        );
        
        return { message: 'Email verified successfully' };
    }

    // ============ RESET PASSWORD REQUEST ============
    async requestPasswordReset(email) {
        const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            // Don't reveal that email doesn't exist for security
            return { message: 'If your email is registered, you will receive a reset link' };
        }
        
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);
        
        await pool.query(
            `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
            [resetToken, expiresAt, result.rows[0].id]
        );
        
        // In production, send email here
        // await sendResetEmail(email, resetToken);
        
        return { 
            message: 'If your email is registered, you will receive a reset link',
            reset_token: process.env.NODE_ENV === 'development' ? resetToken : undefined
        };
    }

    // ============ RESET PASSWORD ============
    async resetPassword(token, newPassword) {
        const result = await pool.query(
            `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
            [token]
        );
        
        if (result.rows.length === 0) {
            throw new Error('Invalid or expired reset token');
        }
        
        const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        
        await pool.query(
            `UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = $2`,
            [hashedPassword, result.rows[0].id]
        );
        
        return { message: 'Password reset successfully' };
    }
}

module.exports = new AuthService();