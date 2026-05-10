const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const Joi = require('joi');

// Validation schema for user registration/login
const userSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required()
});

// Register a new user with email/password
exports.register = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        const { error, value } = userSchema.validate({ email, password });
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        // Check if user already exists
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        // Hash password (bcrypt salts and hashes automatically)
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user into database
        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
            [email, hashedPassword]
        );

        const user = result.rows[0];

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRY || '7d' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            user: { id: user.id, email: user.email },
            token
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Login with email/password
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        const { error } = userSchema.validate({ email, password });
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        // Find user by email
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRY }
        );

        res.json({
            message: 'Login successful',
            user: { id: user.id, email: user.email },
            token
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Handle Google OAuth callback
exports.googleCallback = async (req, res) => {
    try {
        const { email, sub: googleId } = req.oidc.user; // `sub` is Google's user ID

        // Check if user already exists with this Google ID
        let result = await pool.query('SELECT * FROM users WHERE oauth_id = $1', [googleId]);

        let user;
        if (result.rows.length === 0) {
            // New user - create them
            const insertResult = await pool.query(
                'INSERT INTO users (email, oauth_provider, oauth_id) VALUES ($1, $2, $3) RETURNING id, email',
                [email, 'google', googleId]
            );
            user = insertResult.rows[0];
        } else {
            user = result.rows[0];
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRY || '7d' }
        );

        // Redirect to frontend with token
        res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
    } catch (err) {
        console.error('Google callback error:', err);
        res.status(500).json({ error: 'Authentication failed' });
    }
};