const express = require('express');
const authService = require('./auth.service');
const rateLimit = require('../../middlewares/rateLimit.middleware');
const { authMiddleware } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.post('/register', rateLimit(5, 60000), async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
    
    try {
        const user = await authService.register(email, password);
        res.status(201).json({ message: 'User created', user });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/login', rateLimit(10, 60000), async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await authService.login(email, password);
        res.json(result);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

router.get('/protected', authMiddleware, rateLimit(100, 60000), (req, res) => {
    res.json({ message: 'Access granted', user: req.user });
});

module.exports = router;
