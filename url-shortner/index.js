require('dotenv').config();
const express = require('express');
const { globalLimiter } = require('./src/middlewares/rateLimiter');
const urlRouter = require('./src/routes/urlRoutes');
const authRoutes = require('./src/routes/authRoutes');
const urlController = require('./src/controllers/urlController');
const pool = require('./src/config/db');
const redis = require('./src/config/redis');
const cors = require('cors');




const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.set('trust proxy', 1);

app.use(express.json());

// Development/benchmark-only DB query counter. Off unless explicitly enabled, and never in production.
if (process.env.ENABLE_DEBUG_METRICS === 'true' && process.env.NODE_ENV !== 'production') {
    app.use('/__debug', require('./src/routes/debugRoutes'));
    console.log('Debug metrics enabled: /__debug/db-stats');
}

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
// Redirect endpoint - root level (Redis first, PostgreSQL fallback; see urlController.redirect)
app.get('/:shortCode', urlController.redirect);

module.exports = app;

// Only start the server when run directly (`node index.js`), so tests can import the app.
if (require.main === module) {
    // Not awaited on purpose: if Redis is down, connect() keeps retrying in the background
    // and redirects are served from PostgreSQL in the meantime.
    redis.connect().catch((err) => console.error('Redis connect failed:', err.message));

    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}
