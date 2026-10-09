const pool = require('../config/db');
const generateShortCode = require('../utils/generateShortCode');
const { getCachedUrl, setCachedUrl, invalidateCachedUrl } = require('../utils/urlCache');
const Joi = require('joi');

const MAX_SHORT_CODE_ATTEMPTS = 5;
const PG_UNIQUE_VIOLATION = '23505';

// Only http(s) targets are accepted: Joi's bare .uri() would also allow javascript:, file:, ftp: ...
// URL schemes are case-insensitive (RFC 3986) but Joi's scheme match is not, so the check runs on a copy
// with just the scheme lowercased. The value itself is returned untouched, so what the user typed is stored.
const httpOnlyUri = Joi.string().uri({ scheme: ['http', 'https'] });
const httpUrl = () => Joi.string().custom((value, helpers) => {
    const lowerScheme = value.replace(/^[a-z][a-z0-9+.-]*(?=:)/i, (scheme) => scheme.toLowerCase());
    return httpOnlyUri.validate(lowerScheme).error
        ? helpers.error('string.uriCustomScheme', { scheme: 'http|https' })
        : value;
});

// Validation schema for creating URLs
const urlSchema = Joi.object({
    original_url: httpUrl().required(),
    expiration_days: Joi.number().integer().min(1).max(365).default(30),
    is_public: Joi.boolean().default(false)
});

// Validation schema for updating URLs (both fields optional; expiry cannot be changed here)
const updateSchema = Joi.object({
    original_url: httpUrl(),
    is_public: Joi.boolean()
});

const isExpired = (urlData) => Boolean(urlData.expires_at) && new Date(urlData.expires_at) < new Date();
const canView = (urlData, user) => urlData.is_public || (user && user.id === urlData.user_id);

// Create a new shortened URL
exports.createUrl = async (req, res) => {
    try {
        const { error, value } = urlSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { original_url, expiration_days, is_public } = value;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiration_days);

        // Get user_id if user is logged in (optional)
        const userId = req.user ? req.user.id : null;

        // Random 6-char codes can collide; the UNIQUE constraint decides, and we retry with a new code.
        let row;
        for (let attempt = 1; !row; attempt++) {
            try {
                const result = await pool.query(
                    'INSERT INTO urls (short_code, original_url, expires_at, user_id, is_public) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                    [generateShortCode(), original_url, expiresAt, userId, is_public]
                );
                row = result.rows[0];
            } catch (err) {
                if (err.code !== PG_UNIQUE_VIOLATION || attempt >= MAX_SHORT_CODE_ATTEMPTS) throw err;
            }
        }

        res.status(201).json({
            message: 'URL shortened successfully',
            data: row
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

        // Cache-aside read. getCachedUrl never throws: null means miss OR Redis unavailable.
        let urlData = await getCachedUrl(shortCode);
        const servedFromCache = urlData !== null;

        if (!servedFromCache) {
            const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Short code not found' });
            }
            urlData = result.rows[0];
        }

        // Authorisation is evaluated on every request, cached or not: the cache stores the row, not a verdict.
        if (!canView(urlData, req.user)) {
            return res.status(403).json({ error: 'This URL is private' });
        }

        // Also applied to cached rows, so the 1h TTL can't extend a link's life
        if (isExpired(urlData)) {
            return res.status(410).json({ error: 'This shortened URL has expired' });
        }

        if (!servedFromCache) {
            await setCachedUrl(shortCode, urlData); // 1 hour TTL, best-effort
        }

        res.json({
            message: servedFromCache ? 'URL metadata retrieved (from cache)' : 'URL metadata retrieved',
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

        // Validate the body only after the ownership check, as before
        const { error, value } = updateSchema.validate(req.body || {});
        if (error) {
            const field = error.details[0].path[0];
            return res.status(400).json({ error: field === 'original_url' ? 'Invalid URL format' : error.details[0].message });
        }
        const { original_url, is_public } = value;

        // user_id in the WHERE clause keeps the write owner-scoped even if ownership changed since the SELECT
        const updateResult = await pool.query(
            'UPDATE urls SET original_url = $1, is_public = $2 WHERE short_code = $3 AND user_id = $4 RETURNING *',
            [original_url || url.original_url, is_public !== undefined ? is_public : url.is_public, shortCode, req.user.id]
        );
        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        // Invalidate cache (delete, not rewrite). Best-effort: the update already committed.
        await invalidateCachedUrl(shortCode);

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
        await pool.query('DELETE FROM urls WHERE short_code = $1 AND user_id = $2', [shortCode, req.user.id]);

        // Invalidate cache. Best-effort: the delete already committed.
        await invalidateCachedUrl(shortCode);

        res.json({ message: 'URL deleted successfully' });
    } catch (err) {
        console.error('Delete URL error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Fire-and-forget click counter: the redirect does not wait for this write.
// The .catch() is required - a rejected promise nobody handles would crash the Node process.
// Trade-off: analytics are eventually consistent, and a click can be lost if the process
// dies right after responding. An analytics failure must never fail a redirect.
function recordClick(shortCode) {
    pool.query('UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1', [shortCode])
        .catch((err) => console.error('Click count update failed', { shortCode, error: err.message }));
}

// Redirect to original URL (public endpoint - no auth required)
//
//   Redis hit                           -> redirect
//   Redis miss / Redis unavailable      -> PostgreSQL -> populate Redis -> redirect
//
// Behaviour is intentionally the same as the inline handler this replaced: any short
// code redirects regardless of is_public (is_public only guards the metadata endpoint).
exports.redirect = async (req, res) => {
    try {
        const { shortCode } = req.params;

        // 1. Redis. getCachedUrl never throws: null means "miss" or "Redis can't answer".
        let urlData = await getCachedUrl(shortCode);
        const servedFromCache = urlData !== null;

        // 2. PostgreSQL fallback
        if (!servedFromCache) {
            const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Short code not found' });
            }
            urlData = result.rows[0];
        }

        // Check expiration (also applied to cached rows, so the 1h TTL can't extend a link's life)
        if (isExpired(urlData)) {
            return res.status(410).json({ error: 'This shortened URL has expired' });
        }

        // 3. Populate the cache after a database lookup. Awaited, but bounded by a timeout
        //    and never throws, so a slow/dead Redis can't fail or hang the redirect.
        if (!servedFromCache) {
            await setCachedUrl(shortCode, urlData);
        }

        recordClick(shortCode);
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