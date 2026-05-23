const express = require('express');
const adminService = require('./admin.service');
const { authMiddleware, adminMiddleware } = require('../../middlewares/auth.middleware');
const { clearCache } = require('../../middleware/cache');

const router = express.Router();

// ============ APPLY MIDDLEWARES TO ALL ROUTES ============
router.use(authMiddleware);
router.use(adminMiddleware);

// ============ GET ALL USERS ============
router.get('/users', async (req, res) => {
    try {
        const users = await adminService.getAllUsers();
        res.json({ 
            success: true,
            total: users.length, 
            users,
            requestedBy: req.user.email // From cookie
        });
    } catch (error) {
        console.error("Get users error:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// ============ CREATE NEW ROUTE ============
router.post('/routes', async (req, res) => {
    try {
        const routeData = {
            ...req.body,
            created_by: req.user.id, // From cookie
            created_by_email: req.user.email
        };
        const route = await adminService.createRoute(routeData);
        
        // Clear cache after route creation
        await clearCache('cache:/routes*');
        
        res.json({ 
            success: true,
            message: 'Route saved', 
            route,
            approvedBy: req.user.email
        });
    } catch (error) {
        console.error("Create route error:", error);
        res.status(500).json({ error: "Failed to create route" });
    }
});

// ============ DELETE ROUTE ============
router.delete('/routes/:path/:method', async (req, res) => {
    try {
        const { path, method } = req.params;
        const route = await adminService.deleteRoute(decodeURIComponent(path), method);
        
        if (!route) {
            return res.status(404).json({ error: 'Route not found' });
        }
        
        // Clear cache after route deletion
        await clearCache('cache:/routes*');
        
        res.json({ 
            success: true,
            message: 'Route deleted', 
            route,
            deletedBy: req.user.email
        });
    } catch (error) {
        console.error("Delete route error:", error);
        res.status(500).json({ error: "Failed to delete route" });
    }
});

// ============ CLEAR CACHE ============
router.post('/cache/clear', async (req, res) => {
    try {
        await adminService.clearCache();
        res.json({ 
            success: true,
            message: 'Cache cleared',
            clearedBy: req.user.email
        });
    } catch (error) {
        console.error("Clear cache error:", error);
        res.status(500).json({ error: "Failed to clear cache" });
    }
});

// ============ GET STATS ============
router.get('/stats', async (req, res) => {
    try {
        const stats = await adminService.getStats();
        res.json({ 
            success: true,
            stats,
            requestedBy: req.user.email
        });
    } catch (error) {
        console.error("Get stats error:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

module.exports = router;