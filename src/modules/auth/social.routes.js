const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');

const router = express.Router();

// Get OAuth URL for provider
router.get('/url/:provider', (req, res) => {
    const { provider } = req.params;
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/${provider}`;
    
    const urls = {
        google: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID || ''}&redirect_uri=${redirectUri}&response_type=code&scope=email%20profile`,
        github: `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID || ''}&redirect_uri=${redirectUri}&scope=user:email`,
        facebook: `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID || ''}&redirect_uri=${redirectUri}&scope=email,public_profile`,
    };
    
    if (urls[provider]) {
        res.json({ url: urls[provider] });
    } else {
        res.status(404).json({ error: 'Provider not supported' });
    }
});

// OAuth Callback handler
router.get('/callback/:provider', async (req, res) => {
    const { provider } = req.params;
    const { code } = req.query;
    
    if (!code) {
        return res.send('<script>window.opener?.postMessage({type:"auth_error",error:"No code"});window.close();</script>');
    }
    
    try {
        let accessToken, userData;
        
        if (provider === 'google') {
            const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
                code, client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/google`,
                grant_type: 'authorization_code'
            });
            accessToken = tokenRes.data.access_token;
            const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            userData = { email: userRes.data.email, name: userRes.data.name, picture: userRes.data.picture, sub: userRes.data.sub };
        } 
        else if (provider === 'github') {
            const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
                code, client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/github`
            }, { headers: { Accept: 'application/json' } });
            accessToken = tokenRes.data.access_token;
            const userRes = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `token ${accessToken}` }
            });
            let email = userRes.data.email;
            if (!email) {
                const emailsRes = await axios.get('https://api.github.com/user/emails', {
                    headers: { Authorization: `token ${accessToken}` }
                });
                const primary = emailsRes.data.find(e => e.primary);
                email = primary?.email || `${userRes.data.login}@github.com`;
            }
            userData = { email, name: userRes.data.name || userRes.data.login, picture: userRes.data.avatar_url, sub: userRes.data.id.toString() };
        }
        else if (provider === 'facebook') {
            const userRes = await axios.get('https://graph.facebook.com/me', {
                params: { access_token: code, fields: 'id,name,email,picture' }
            });
            userData = { email: userRes.data.email, name: userRes.data.name, picture: userRes.data.picture?.data?.url, sub: userRes.data.id };
        }
        
        // Find or create user
        let user = await pool.query('SELECT * FROM users WHERE email = $1', [userData.email]);
        if (user.rows.length === 0) {
            user = await pool.query(
                `INSERT INTO users (email, name, avatar, social_provider, social_id, is_verified, role)
                 VALUES ($1, $2, $3, $4, $5, true, 'user')
                 RETURNING id, email, name, role, avatar`,
                [userData.email, userData.name, userData.picture, provider, userData.sub]
            );
        }
        
        const token = jwt.sign(
            { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );
        
        res.send(`<!DOCTYPE html><html><head><title>Login Success</title></head><body>
            <script>if(window.opener) window.opener.postMessage({type:"auth_success", token:"${token}"},"*"); window.close();</script>
            <p>Login successful! You can close this window.</p>
        </body></html>`);
    } catch (error) {
        res.send(`<script>if(window.opener) window.opener.postMessage({type:"auth_error", error:"${error.message}"},"*"); window.close();</script>`);
    }
});

module.exports = router;
