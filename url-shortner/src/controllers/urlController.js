const pool = require('../config/db');
const redisClient = require('../config/redis');
const generateShortCode = require('../utils/generateShortCode');
const Joi = require('joi');

const urlSchema = Joi.object({
    original_url: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .required()
        .messages({
            'string.uri': 'original_url must be a valid URL starting with http or https',
            'any.required': 'original_url is required'
        })
});

const createUrl = async (req, res) => {
    const { error, value } = urlSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { original_url } = value;

    try {
        let short_code;
        let isUnique = false;

        while (!isUnique) {
            short_code = generateShortCode();
            const existing = await pool.query(
                'SELECT id FROM urls WHERE short_code = $1', [short_code]
            );
            if (existing.rows.length === 0) isUnique = true;
        }

        const result = await pool.query(
            'INSERT INTO urls (original_url, short_code) VALUES ($1, $2) RETURNING *',
            [original_url, short_code]
        );

        res.status(201).json({
            message: 'Short URL created',
            short_code: result.rows[0].short_code,
            short_url: `http://localhost:3000/${result.rows[0].short_code}`,
            original_url: result.rows[0].original_url
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
};

const getAllUrls = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM urls ORDER BY created_at DESC');
        res.status(200).json({ count: result.rows.length, data: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
};

const getUrl = async (req, res) => {
    const { shortCode } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM urls WHERE short_code = $1', [shortCode]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }
        res.status(200).json({ data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
};

const updateUrl = async (req, res) => {
    const { shortCode } = req.params;
    const { original_url } = req.body;

    if (!original_url) {
        return res.status(400).json({ error: 'original_url is required' });
    }

    try {
        const result = await pool.query(
            'UPDATE urls SET original_url = $1 WHERE short_code = $2 RETURNING *',
            [original_url, shortCode]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        await redisClient.del(shortCode);

        res.status(200).json({ message: 'URL updated successfully', data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
};

const deleteUrl = async (req, res) => {
    const { shortCode } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM urls WHERE short_code = $1 RETURNING *', [shortCode]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }
        res.status(200).json({ message: 'Deleted successfully', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
};

const redirectUrl = async (req, res) => {
    const { shortCode } = req.params;
    try {
        const cached = await redisClient.get(shortCode);
        if (cached) {
            console.log('Cache HIT →', shortCode);
            pool.query(
                'UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1', [shortCode]
            );
            return res.redirect(302, cached);
        }

        console.log('Cache MISS →', shortCode);
        const result = await pool.query(
            'SELECT * FROM urls WHERE short_code = $1', [shortCode]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short URL not found' });
        }

        const url = result.rows[0];
        await redisClient.set(shortCode, url.original_url, { EX: 3600 });
        await pool.query(
            'UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1', [shortCode]
        );

        res.redirect(302, url.original_url);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = { createUrl, getAllUrls, getUrl, updateUrl, deleteUrl, redirectUrl };