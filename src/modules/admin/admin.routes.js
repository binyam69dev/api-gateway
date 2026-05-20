const express = require('express');
const adminService = require('./admin.service');
const { authMiddleware, adminMiddleware } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/users', async (req, res) => {
    const users = await adminService.getAllUsers();
    res.json({ total: users.length, users });
});

router.post('/routes', async (req, res) => {
    const route = await adminService.createRoute(req.body);
    res.json({ message: 'Route saved', route });
});

router.delete('/routes/:path/:method', async (req, res) => {
    const { path, method } = req.params;
    const route = await adminService.deleteRoute(path, method);
    if (!route) return res.status(404).json({ error: 'Route not found' });
    res.json({ message: 'Route deleted', route });
});

router.post('/cache/clear', async (req, res) => {
    await adminService.clearCache();
    res.json({ message: 'Cache cleared' });
});

router.get('/stats', async (req, res) => {
    const stats = await adminService.getStats();
    res.json(stats);
});

module.exports = router;
