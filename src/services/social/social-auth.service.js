const axios = require('axios');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');

class SocialAuthService {
    constructor() {
        this.providers = {
            google: this.handleGoogle.bind(this),
            github: this.handleGithub.bind(this),
            facebook: this.handleFacebook.bind(this),
            apple: this.handleApple.bind(this)
        };
    }

    async handleGoogle(accessToken) {
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
    }

    async handleGithub(accessToken) {
        const response = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `token ${accessToken}` }
        });
        return {
            provider: 'github',
            providerId: response.data.id.toString(),
            email: response.data.email || `${response.data.login}@github.com`,
            name: response.data.name || response.data.login,
            avatar: response.data.avatar_url
        };
    }

    async handleFacebook(accessToken) {
        const response = await axios.get('https://graph.facebook.com/me', {
            params: {
                access_token: accessToken,
                fields: 'id,name,email,picture'
            }
        });
        return {
            provider: 'facebook',
            providerId: response.data.id,
            email: response.data.email,
            name: response.data.name,
            avatar: response.data.picture?.data?.url
        };
    }

    async handleApple(accessToken) {
        const decoded = jwt.decode(accessToken);
        return {
            provider: 'apple',
            providerId: decoded.sub,
            email: decoded.email,
            name: decoded.name || 'Apple User',
            avatar: null
        };
    }

    async authenticate(provider, accessToken) {
        if (!this.providers[provider]) {
            throw new Error(`Unsupported provider: ${provider}`);
        }

        const userData = await this.providers[provider](accessToken);

        let user = await pool.query(
            `SELECT * FROM users WHERE email = $1 OR (social_provider = $2 AND social_id = $3)`,
            [userData.email, provider, userData.providerId]
        );

        if (user.rows.length === 0) {
            const result = await pool.query(
                `INSERT INTO users (email, name, avatar, social_provider, social_id, is_verified, role)
                 VALUES ($1, $2, $3, $4, $5, true, 'user')
                 RETURNING id, email, name, role, avatar`,
                [userData.email, userData.name, userData.avatar, provider, userData.providerId]
            );
            user = result;
        } else {
            if (userData.avatar && user.rows[0].avatar !== userData.avatar) {
                await pool.query(
                    `UPDATE users SET avatar = $1 WHERE id = $2`,
                    [userData.avatar, user.rows[0].id]
                );
                user.rows[0].avatar = userData.avatar;
            }
        }

        const token = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        return {
            token,
            user: {
                id: user.rows[0].id,
                email: user.rows[0].email,
                name: user.rows[0].name,
                role: user.rows[0].role,
                avatar: user.rows[0].avatar
            }
        };
    }
}

module.exports = new SocialAuthService();
