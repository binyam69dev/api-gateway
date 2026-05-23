const axios = require('axios');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const crypto = require('crypto');

class SocialAuthService {
    constructor() {
        this.providers = {
            google: this.handleGoogle.bind(this),
            github: this.handleGithub.bind(this),
            facebook: this.handleFacebook.bind(this),
            apple: this.handleApple.bind(this)
        };
    }

    // ============ GOOGLE HANDLER ============
    async handleGoogle(accessToken) {
        try {
            const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            
            return {
                provider: 'google',
                providerId: response.data.sub,
                email: response.data.email,
                name: response.data.name,
                avatar: response.data.picture
            };
        } catch (error) {
            console.error('Google auth error:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Google');
        }
    }

    // ============ GITHUB HANDLER ============
    async handleGithub(accessToken) {
        try {
            const response = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            
            // Get primary email if not provided
            let email = response.data.email;
            if (!email) {
                const emailsRes = await axios.get('https://api.github.com/user/emails', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                const primaryEmail = emailsRes.data.find(e => e.primary && e.verified);
                email = primaryEmail?.email || `${response.data.login}@github.com`;
            }
            
            return {
                provider: 'github',
                providerId: response.data.id.toString(),
                email: email,
                name: response.data.name || response.data.login,
                avatar: response.data.avatar_url
            };
        } catch (error) {
            console.error('GitHub auth error:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with GitHub');
        }
    }

    // ============ FACEBOOK HANDLER ============
    async handleFacebook(accessToken) {
        try {
            const response = await axios.get('https://graph.facebook.com/me', {
                params: {
                    access_token: accessToken,
                    fields: 'id,name,email,picture'
                }
            });
            
            return {
                provider: 'facebook',
                providerId: response.data.id,
                email: response.data.email || `${response.data.id}@facebook.com`,
                name: response.data.name,
                avatar: response.data.picture?.data?.url || null
            };
        } catch (error) {
            console.error('Facebook auth error:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Facebook');
        }
    }

    // ============ APPLE HANDLER ============
    async handleApple(accessToken) {
        try {
            const decoded = jwt.decode(accessToken);
            if (!decoded) {
                throw new Error('Invalid Apple ID token');
            }
            
            return {
                provider: 'apple',
                providerId: decoded.sub,
                email: decoded.email,
                name: decoded.name || 'Apple User',
                avatar: null
            };
        } catch (error) {
            console.error('Apple auth error:', error.message);
            throw new Error('Failed to authenticate with Apple');
        }
    }

    // ============ AUTHENTICATE USER ============
    async authenticate(provider, accessToken) {
        if (!this.providers[provider]) {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        // Get user data from provider
        const userData = await this.providers[provider](accessToken);

        // Look for existing user
        let result = await pool.query(
            `SELECT * FROM users 
             WHERE email = $1 OR (social_provider = $2 AND social_id = $3)`,
            [userData.email, provider, userData.providerId]
        );

        let user;

        if (result.rows.length === 0) {
            // Create new user
            const insertResult = await pool.query(
                `INSERT INTO users (email, name, avatar, social_provider, social_id, is_verified, role, created_at, last_login_at)
                 VALUES ($1, $2, $3, $4, $5, true, 'user', NOW(), NOW())
                 RETURNING id, email, name, role, avatar, social_provider, social_id`,
                [userData.email, userData.name, userData.avatar, provider, userData.providerId]
            );
            user = insertResult.rows[0];
            console.log(`[SocialAuth] Created new ${provider} user:`, user.email);
            
            // Log activity
            await this.logActivity(user.id, 'SOCIAL_REGISTER', { provider });
        } else {
            user = result.rows[0];
            
            // Update avatar if changed
            if (userData.avatar && user.avatar !== userData.avatar) {
                await pool.query(
                    `UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`,
                    [userData.avatar, user.id]
                );
                user.avatar = userData.avatar;
            }
            
            // Update last login
            await pool.query(
                `UPDATE users SET last_login_at = NOW(), login_count = login_count + 1 WHERE id = $1`,
                [user.id]
            );
            
            console.log(`[SocialAuth] Updated existing ${provider} user:`, user.email);
            await this.logActivity(user.id, 'SOCIAL_LOGIN', { provider });
        }

        // Generate JWT tokens (will be set as cookies by route handler)
        const accessToken_jwt = jwt.sign(
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
            { id: user.id, email: user.email },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return {
            accessToken: accessToken_jwt,
            refreshToken: refreshToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatar: user.avatar,
                social_provider: user.social_provider
            }
        };
    }

    // ============ EXCHANGE CODE FOR TOKEN ============
    async exchangeCodeForToken(provider, code, redirectUri) {
        const tokenUrls = {
            google: 'https://oauth2.googleapis.com/token',
            github: 'https://github.com/login/oauth/access_token',
            facebook: 'https://graph.facebook.com/v18.0/oauth/access_token'
        };
        
        const clientConfigs = {
            google: {
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET
            },
            github: {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET
            },
            facebook: {
                client_id: process.env.FACEBOOK_APP_ID,
                client_secret: process.env.FACEBOOK_APP_SECRET
            }
        };
        
        const config = clientConfigs[provider];
        if (!config) {
            throw new Error(`Unsupported provider: ${provider}`);
        }
        
        let params = {
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            ...config
        };
        
        let response;
        
        if (provider === 'github') {
            response = await axios.post(tokenUrls[provider], params, {
                headers: { Accept: 'application/json' }
            });
            return response.data.access_token;
        } else if (provider === 'facebook') {
            response = await axios.get(tokenUrls[provider], { params });
            return response.data.access_token;
        } else {
            response = await axios.post(tokenUrls[provider], new URLSearchParams(params), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            return response.data.access_token;
        }
    }

    // ============ GET OAUTH URL ============
    getAuthUrl(provider, redirectUri) {
        const baseUrls = {
            google: 'https://accounts.google.com/o/oauth2/v2/auth',
            github: 'https://github.com/login/oauth/authorize',
            facebook: 'https://www.facebook.com/v18.0/dialog/oauth'
        };
        
        const clientIds = {
            google: process.env.GOOGLE_CLIENT_ID,
            github: process.env.GITHUB_CLIENT_ID,
            facebook: process.env.FACEBOOK_APP_ID
        };
        
        const scopes = {
            google: 'email profile',
            github: 'user:email',
            facebook: 'email,public_profile'
        };
        
        const url = new URL(baseUrls[provider]);
        url.searchParams.append('client_id', clientIds[provider]);
        url.searchParams.append('redirect_uri', redirectUri);
        url.searchParams.append('response_type', 'code');
        url.searchParams.append('scope', scopes[provider]);
        
        return url.toString();
    }

    // ============ LOG ACTIVITY ============
    async logActivity(userId, action, details = {}) {
        try {
            await pool.query(
                `INSERT INTO activity_logs (user_id, action, details, created_at)
                 VALUES ($1, $2, $3, NOW())`,
                [userId, action, JSON.stringify(details)]
            );
        } catch (err) {
            console.error('Failed to log activity:', err.message);
        }
    }

    // ============ GET SOCIAL ACCOUNTS ============
    async getUserSocialAccounts(userId) {
        const result = await pool.query(
            `SELECT social_provider, social_id, created_at 
             FROM users 
             WHERE id = $1 AND social_provider IS NOT NULL`,
            [userId]
        );
        return result.rows;
    }

    // ============ LINK SOCIAL ACCOUNT ============
    async linkSocialAccount(userId, provider, providerId, email, name, avatar) {
        await pool.query(
            `UPDATE users 
             SET social_provider = $1, social_id = $2, avatar = COALESCE($3, avatar),
                 updated_at = NOW()
             WHERE id = $4`,
            [provider, providerId, avatar, userId]
        );
        
        await this.logActivity(userId, 'SOCIAL_LINK', { provider });
        
        return { message: `Successfully linked ${provider} account` };
    }

    // ============ UNLINK SOCIAL ACCOUNT ============
    async unlinkSocialAccount(userId, provider) {
        await pool.query(
            `UPDATE users 
             SET social_provider = NULL, social_id = NULL, updated_at = NOW()
             WHERE id = $1 AND social_provider = $2`,
            [userId, provider]
        );
        
        await this.logActivity(userId, 'SOCIAL_UNLINK', { provider });
        
        return { message: `Successfully unlinked ${provider} account` };
    }
}

module.exports = new SocialAuthService();