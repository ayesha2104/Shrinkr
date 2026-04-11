require('dotenv').config();
const express = require('express');
const { globalLimiter } = require('./src/middlewares/rateLimiter');
const { urlRouter, redirectUrl } = require('./src/routes/urlRoutes');
const pool = require('./src/config/db');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use('/urls', urlRouter);
app.get('/:shortCode', redirectUrl);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});