const pool = require('../config/db');
const redis = require('../config/redis');
const generateShortCode = require('../utils/generateShortCode');
const Joi = require('joi');

// Validation schema for creating URLs
const urlSchema = Joi.object({
    original_url: Joi.string().uri().required(),
    expiration_days: Joi.number().integer().min(1).max(365).default(30),
    is_public: Joi.boolean().default(false)
});

// Create a new shortened URL
exports.createUrl = async (req, res) => {
    try {
        const { error, value } = urlSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { original_url, expiration_days, is_public } = value;
        const shortCode = generateShortCode();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiration_days);

        // Get user_id if user is logged in (optional)
        const userId = req.user ? req.user.id : null;

        const result = await pool.query(
            'INSERT INTO urls (short_code, original_url, expires_at, user_id, is_public) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [shortCode, original_url, expiresAt, userId, is_public]
        );

        res.status(201).json({
            message: 'URL shortened successfully',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Create URL error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all URLs (filtered by user if logged in)
exports.getAllUrls = async (req, res) => {
    try {
        // If user is logged in, only return their URLs
        // If not logged in, return empty array
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required. Login to view your URLs.' });
        }

        const result = await pool.query(
            'SELECT * FROM urls WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );

        res.json({
            message: 'URLs retrieved successfully',
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error('Get all URLs error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get a single URL by short code
exports.getUrlByCode = async (req, res) => {
    try {
        const { shortCode } = req.params;

        // First check Redis cache
        const cachedUrl = await redis.get(`url:${shortCode}`);
        if (cachedUrl) {
            const urlData = JSON.parse(cachedUrl);

            // If URL is private and user doesn't own it, deny access
            if (!urlData.is_public && (!req.user || req.user.id !== urlData.user_id)) {
                return res.status(403).json({ error: 'This URL is private' });
            }

            return res.json({
                message: 'URL metadata retrieved (from cache)',
                data: urlData
            });
        }

        // If not in cache, query database
        const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        const urlData = result.rows[0];

        // Check if URL is private and user doesn't own it
        if (!urlData.is_public && (!req.user || req.user.id !== urlData.user_id)) {
            return res.status(403).json({ error: 'This URL is private' });
        }

        // Check if URL has expired
        if (urlData.expires_at && new Date(urlData.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This shortened URL has expired' });
        }

        // Cache for 1 hour
        await redis.set(`url:${shortCode}`, JSON.stringify(urlData), { EX: 3600 });

        res.json({
            message: 'URL metadata retrieved',
            data: urlData
        });
    } catch (err) {
        console.error('Get URL error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Update a URL (only owner can update)
exports.updateUrl = async (req, res) => {
    try {
        const { shortCode } = req.params;
        const { original_url, is_public } = req.body;

        // Must be logged in to update
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Find the URL
        const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        const url = result.rows[0];

        // Check ownership - only owner can update
        if (url.user_id !== req.user.id) {
            return res.status(403).json({ error: 'You do not have permission to update this URL' });
        }

        // Validate new URL if provided
        if (original_url) {
            const urlRegex = /^https?:\/\/.+/;
            if (!urlRegex.test(original_url)) {
                return res.status(400).json({ error: 'Invalid URL format' });
            }
        }

        // Update URL
        const updateResult = await pool.query(
            'UPDATE urls SET original_url = $1, is_public = $2, updated_at = NOW() WHERE short_code = $3 RETURNING *',
            [original_url || url.original_url, is_public !== undefined ? is_public : url.is_public, shortCode]
        );

        // Invalidate cache
        await redis.del(`url:${shortCode}`);

        res.json({
            message: 'URL updated successfully',
            data: updateResult.rows[0]
        });
    } catch (err) {
        console.error('Update URL error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete a URL (only owner can delete)
exports.deleteUrl = async (req, res) => {
    try {
        const { shortCode } = req.params;

        // Must be logged in to delete
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Find the URL
        const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        const url = result.rows[0];

        // Check ownership - only owner can delete
        if (url.user_id !== req.user.id) {
            return res.status(403).json({ error: 'You do not have permission to delete this URL' });
        }

        // Delete URL
        await pool.query('DELETE FROM urls WHERE short_code = $1', [shortCode]);

        // Invalidate cache
        await redis.del(`url:${shortCode}`);

        res.json({ message: 'URL deleted successfully' });
    } catch (err) {
        console.error('Delete URL error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Redirect to original URL (public endpoint - no auth required)
exports.redirect = async (req, res) => {
    try {
        const { shortCode } = req.params;

        // Check cache first
        const cachedUrl = await redis.get(`url:${shortCode}`);
        if (cachedUrl) {
            const urlData = JSON.parse(cachedUrl);

            // If private URL, user must be the owner
            if (!urlData.is_public && (!req.user || req.user.id !== urlData.user_id)) {
                return res.status(403).json({ error: 'This URL is private' });
            }

            // Check expiration
            if (urlData.expires_at && new Date(urlData.expires_at) < new Date()) {
                return res.status(410).json({ error: 'This shortened URL has expired' });
            }

            // Increment clicks (async, don't wait)
            pool.query('UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1', [shortCode]);

            return res.redirect(urlData.original_url);
        }

        // Query database
        const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        const urlData = result.rows[0];

        // If private URL, user must be the owner
        if (!urlData.is_public && (!req.user || req.user.id !== urlData.user_id)) {
            return res.status(403).json({ error: 'This URL is private' });
        }

        // Check expiration
        if (urlData.expires_at && new Date(urlData.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This shortened URL has expired' });
        }

        // Cache for 1 hour
        await redis.set(`url:${shortCode}`, JSON.stringify(urlData), { EX: 3600 });

        // Increment clicks (async, don't wait)
        pool.query('UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1', [shortCode]);

        res.redirect(urlData.original_url);
    } catch (err) {
        console.error('Redirect error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Health check
exports.health = async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'healthy', database: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'unhealthy', error: 'Database connection failed' });
    }
};