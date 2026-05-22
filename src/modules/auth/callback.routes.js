const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');

const router = express.Router();

// OAuth Callback handler
router.get('/:provider', async (req, res) => {
    const { provider } = req.params;
    const { code } = req.query;
    
    if (!code) {
        return res.send(`
            <script>
                if (window.opener) {
                    window.opener.postMessage({ type: 'auth_error', error: 'No code received' }, '*');
                }
                window.close();
            </script>
        `);
    }
    
    try {
        let accessToken;
        let userData;
        
        if (provider === 'github') {
            // Exchange code for token
            const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
                code,
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/github`
            }, {
                headers: { Accept: 'application/json' }
            });
            accessToken = tokenRes.data.access_token;
            
            const userRes = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `token ${accessToken}` }
            });
            
            let email = userRes.data.email;
            if (!email) {
                const emailsRes = await axios.get('https://api.github.com/user/emails', {
                    headers: { Authorization: `token ${accessToken}` }
                });
                const primaryEmail = emailsRes.data.find(e => e.primary);
                email = primaryEmail?.email || `${userRes.data.login}@github.com`;
            }
            
            userData = {
                email: email,
                name: userRes.data.name || userRes.data.login,
                picture: userRes.data.avatar_url,
                sub: userRes.data.id.toString()
            };
        } else {
            // For other providers, basic handling
            userData = {
                email: `user@${provider}.com`,
                name: `${provider} User`,
                picture: null,
                sub: `temp_${provider}_${Date.now()}`
            };
        }
        
        // Find or create user
        let user = await pool.query('SELECT * FROM users WHERE email = $1', [userData.email]);
        
        if (user.rows.length === 0) {
            const result = await pool.query(
                `INSERT INTO users (email, name, avatar, social_provider, social_id, is_verified, role)
                 VALUES ($1, $2, $3, $4, $5, true, 'user')
                 RETURNING id, email, name, role`,
                [userData.email, userData.name, userData.picture, provider, userData.sub]
            );
            user = result;
        }
        
        const token = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Success</title></head>
            <body>
                <script>
                    if (window.opener) {
                        window.opener.postMessage({ type: 'auth_success', token: '${token}' }, '*');
                    }
                    window.close();
                </script>
                <p>Login successful! You can close this window.</p>
            </body>
            </html>
        `);
    } catch (error) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Error</title></head>
            <body>
                <script>
                    if (window.opener) {
                        window.opener.postMessage({ type: 'auth_error', error: '${error.message}' }, '*');
                    }
                    window.close();
                </script>
                <p>Login failed: ${error.message}</p>
            </body>
            </html>
        `);
    }
});

module.exports = router;
