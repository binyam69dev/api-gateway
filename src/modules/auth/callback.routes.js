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

// ============ OAUTH CALLBACK HANDLER ============
router.get('/:provider', async (req, res) => {
    const { provider } = req.params;
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Error</title></head>
            <body>
                <h2>Authentication Failed</h2>
                <p>No authorization code received. Please try again.</p>
                <a href="/login.html">Back to Login</a>
            </body>
            </html>
        `);
    }
    
    try {
        let accessToken;
        let userData;
        
        // ============ GITHUB OAUTH ============
        if (provider === 'github') {
            // Exchange code for access token
            const tokenRes = await axios.post('https://github.com/login/oauth/access_token', {
                code,
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/callback/github`
            }, {
                headers: { Accept: 'application/json' }
            });
            
            accessToken = tokenRes.data.access_token;
            
            if (!accessToken) {
                throw new Error('Failed to get access token');
            }
            
            // Get user info
            const userRes = await axios.get('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            
            // Get email (GitHub may not provide email in primary request)
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
        
        // ============ GOOGLE OAUTH ============
        else if (provider === 'google') {
            const { OAuth2Client } = require('google-auth-library');
            const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
            
            const ticket = await client.verifyIdToken({
                idToken: code,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            
            const payload = ticket.getPayload();
            
            userData = {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                sub: payload.sub,
                provider: 'google'
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
            
            // Get user info
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
        
        // ============ DEFAULT / UNKNOWN PROVIDER ============
        else {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Login Error</title></head>
                <body>
                    <h2>Unsupported Provider</h2>
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
        
        // ============ GENERATE JWT TOKEN ============
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
        
        // Generate refresh token
        const refreshToken = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        // ============ SET COOKIES ============
        res.cookie('adminToken', token, getCookieOptions());
        res.cookie('devToken', token, getCookieOptions());
        res.cookie('refreshToken', refreshToken, getCookieOptions());
        
        // ============ REDIRECT TO DASHBOARD ============
        // Redirect to admin or developer dashboard based on role
        const redirectUrl = user.role === 'admin' ? '/admin.html' : '/developer-dashboard.html';
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Login Successful</title>
                <meta http-equiv="refresh" content="2;url=${redirectUrl}">
                <style>
                    body {
                        font-family: Arial, sans-serif;
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
                        border-radius: 20px;
                        backdrop-filter: blur(10px);
                    }
                    .spinner {
                        width: 40px;
                        height: 40px;
                        border: 4px solid rgba(255,255,255,0.3);
                        border-top-color: white;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>✅ Login Successful!</h2>
                    <p>Welcome back, ${user.name || user.email}!</p>
                    <div class="spinner"></div>
                    <p>Redirecting to dashboard...</p>
                </div>
                <script>
                    // Fallback redirect after 2 seconds
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
            <head><title>Login Error</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h2>❌ Authentication Failed</h2>
                <p>Error: ${error.message}</p>
                <p>Please try again or use email login.</p>
                <a href="/login.html" style="color: #4f46e5;">Back to Login</a>
            </body>
            </html>
        `);
    }
});

module.exports = router;