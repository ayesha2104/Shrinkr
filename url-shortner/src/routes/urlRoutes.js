const express = require('express');
const urlController = require('../controllers/urlController');
const { authMiddleware, optionalAuth } = require('../middlewares/authMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiters
const createLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 5,
    message: 'Too many URLs created from this IP, please try again later.'
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to all routes
router.use(generalLimiter);

// Create new shortened URL (anonymous or logged in)
router.post('/', createLimiter, optionalAuth, urlController.createUrl);

// Get all URLs (must be logged in)
router.get('/', authMiddleware, urlController.getAllUrls);

// Get single URL metadata (by short code)
router.get('/:shortCode', optionalAuth, urlController.getUrlByCode);

// Update a URL (must be logged in + owner)
router.put('/:shortCode', authMiddleware, urlController.updateUrl);

// Delete a URL (must be logged in + owner)
router.delete('/:shortCode', authMiddleware, urlController.deleteUrl);

// Health check
router.get('/health', urlController.health);

module.exports = router;