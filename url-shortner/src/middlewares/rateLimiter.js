const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false
});

const createUrlLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many URLs created, please try again after a minute' }
});

module.exports = { globalLimiter, createUrlLimiter };