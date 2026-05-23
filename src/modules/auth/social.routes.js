const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');

const router = express.Router();

// ============ COOKIE OPTIONS ============
const getCookieOptions = () => ({
    httpOnly: process.env.NODE_ENV === 'production',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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

// ============ GET OAUTH URL ============
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

// ============ OAUTH CALLBACK HANDLER ============
router.get('/callback/:provider', async (req, res) => {
    const { provider } = req.params;
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Error</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h2>❌ Authentication Failed</h2>
                <p>No authorization code received.</p>
                <a href="/login.html">Back to Login</a>
            </body>
            </html>
        `);
    }
    
    try {
        let accessToken;
        let userData;
        
        // ============ GOOGLE OAUTH ============
        if (provider === 'google') {
            const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/google`,
                grant_type: 'authorization_code'
            });
            
            accessToken = tokenRes.data.access_token;
            
            const userRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            
            userData = {
                email: userRes.data.email,
                name: userRes.data.name,
                picture: userRes.data.picture,
                sub: userRes.data.sub,
                provider: 'google'
            };
        }
        
        // ============ GITHUB OAUTH ============
        else if (provider === 'github') {
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
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            
            let email = userRes.data.email;
            if (!email) {
                const emailsRes = await axios.get('https://api.github.com/user/emails', {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                const primaryEmail = emailsRes.data.find(e => e.primary && e.verified);
                email = primaryEmail?.email || `${userRes.data.login}@github.com`;
            }
            
            userData = {
                email: email,
                name: userRes.data.name || userRes.data.login,
                picture: userRes.data.avatar_url,
                sub: userRes.data.id.toString(),
                provider: 'github'
            };
        }
        
        // ============ FACEBOOK OAUTH ============
        else if (provider === 'facebook') {
            // Exchange code for access token
            const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
                params: {
                    client_id: process.env.FACEBOOK_APP_ID,
                    client_secret: process.env.FACEBOOK_APP_SECRET,
                    redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/facebook`,
                    code: code
                }
            });
            
            accessToken = tokenRes.data.access_token;
            
            const userRes = await axios.get('https://graph.facebook.com/me', {
                params: {
                    fields: 'id,name,email,picture',
                    access_token: accessToken
                }
            });
            
            userData = {
                email: userRes.data.email || `${userRes.data.id}@facebook.com`,
                name: userRes.data.name,
                picture: userRes.data.picture?.data?.url,
                sub: userRes.data.id,
                provider: 'facebook'
            };
        }
        
        // ============ UNSUPPORTED PROVIDER ============
        else {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Login Error</title></head>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2>❌ Unsupported Provider</h2>
                    <p>Provider "${provider}" is not supported.</p>
                    <a href="/login.html">Back to Login</a>
                </body>
                </html>
            `);
        }
        
        // ============ FIND OR CREATE USER ============
        let result = await pool.query(
            'SELECT * FROM users WHERE email = $1 OR (social_provider = $2 AND social_id = $3)',
            [userData.email, provider, userData.sub]
        );
        
        let user;
        
        if (result.rows.length === 0) {
            // Create new user
            const insertResult = await pool.query(
                `INSERT INTO users (email, name, avatar, social_provider, social_id, is_verified, role, created_at, last_login_at)
                 VALUES ($1, $2, $3, $4, $5, true, 'user', NOW(), NOW())
                 RETURNING id, email, name, role, avatar`,
                [userData.email, userData.name, userData.picture, provider, userData.sub]
            );
            user = insertResult.rows[0];
            console.log(`Created new ${provider} user:`, user.email);
        } else {
            user = result.rows[0];
            // Update existing user
            await pool.query(
                `UPDATE users 
                 SET social_provider = $1, social_id = $2, avatar = COALESCE($3, avatar),
                     last_login_at = NOW(), login_count = login_count + 1
                 WHERE id = $4`,
                [provider, userData.sub, userData.picture, user.id]
            );
            console.log(`Updated existing ${provider} user:`, user.email);
        }
        
        // ============ GENERATE JWT TOKENS ============
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role || 'user',
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
        
        // ============ SET COOKIES ============
        res.cookie('adminToken', token, getCookieOptions());
        res.cookie('devToken', token, getCookieOptions());
        res.cookie('refreshToken', refreshToken, getRefreshCookieOptions());
        
        // ============ REDIRECT TO DASHBOARD ============
        const redirectUrl = user.role === 'admin' ? '/admin.html' : '/developer-dashboard.html';
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Login Successful</title>
                <meta http-equiv="refresh" content="2;url=${redirectUrl}">
                <style>
                    body {
                        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                    }
                    .container {
                        text-align: center;
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 24px;
                        backdrop-filter: blur(10px);
                        box-shadow: 0 8px 32px rgba(0,0,0,0.1);
                    }
                    .checkmark {
                        width: 60px;
                        height: 60px;
                        background: #10b981;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 32px;
                        margin: 0 auto 20px;
                    }
                    .spinner {
                        width: 40px;
                        height: 40px;
                        border: 3px solid rgba(255,255,255,0.3);
                        border-top-color: white;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                    h2 { margin-bottom: 8px; }
                    p { opacity: 0.9; margin-bottom: 20px; }
                    .redirect-link {
                        color: white;
                        text-decoration: none;
                        font-size: 14px;
                        opacity: 0.8;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="checkmark">✓</div>
                    <h2>Login Successful!</h2>
                    <p>Welcome back, ${user.name || user.email}</p>
                    <div class="spinner"></div>
                    <p>Redirecting to dashboard...</p>
                    <a href="${redirectUrl}" class="redirect-link">Click here if not redirected</a>
                </div>
                <script>
                    setTimeout(function() {
                        window.location.href = '${redirectUrl}';
                    }, 2000);
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error(`OAuth error for ${provider}:`, error.message);
        
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Login Error</title>
                <style>
                    body {
                        font-family: 'Inter', sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: #f8fafc;
                    }
                    .error-container {
                        max-width: 500px;
                        margin: 0 auto;
                        background: white;
                        padding: 40px;
                        border-radius: 24px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    }
                    h2 { color: #ef4444; margin-bottom: 16px; }
                    p { color: #64748b; margin-bottom: 24px; }
                    a {
                        background: #4f46e5;
                        color: white;
                        text-decoration: none;
                        padding: 12px 24px;
                        border-radius: 40px;
                        display: inline-block;
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h2>❌ Authentication Failed</h2>
                    <p>${error.message}</p>
                    <a href="/login.html">Back to Login</a>
                </div>
            </body>
            </html>
        `);
    }
});

module.exports = router;