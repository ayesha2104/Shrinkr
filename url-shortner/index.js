require('dotenv').config();
const express = require('express');
const { globalLimiter } = require('./src/middlewares/rateLimiter');
const urlRouter = require('./src/routes/urlRoutes');
const authRoutes = require('./src/routes/authRoutes');
const pool = require('./src/config/db');
const cors = require('cors');




const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.set('trust proxy', 1);

app.use(express.json());
app.use(globalLimiter);

// Health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ server: 'running', database: 'connected' });
    } catch (err) {
        res.status(500).json({ server: 'running', database: 'disconnected' });
    }
});

app.use('/auth', authRoutes);
app.use('/urls', urlRouter);
// Redirect endpoint - root level
app.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const result = await pool.query('SELECT * FROM urls WHERE short_code = $1', [shortCode]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short code not found' });
        }

        const urlData = result.rows[0];

        // Check if expired
        if (urlData.expires_at && new Date(urlData.expires_at) < new Date()) {
            return res.status(410).json({ error: 'This shortened URL has expired' });
        }

        // Increment clicks
        await pool.query('UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1', [shortCode]);

        // Redirect
        res.redirect(urlData.original_url);
    } catch (err) {
        console.error('Redirect error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});




app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});