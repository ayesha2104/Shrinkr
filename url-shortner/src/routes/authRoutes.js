const express = require('express');
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { authLimiter } = require('../middlewares/rateLimiter');

const router = express.Router();

// Public routes (no authentication required)
router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);

// Protected routes
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        message: 'User info',
        user: req.user
    });
});

module.exports = router;