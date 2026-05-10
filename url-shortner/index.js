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
app.get('/:shortCode', redirectUrl);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});