const rateLimit = require('express-rate-limit');

// BENCHMARK_MODE=true switches the GLOBAL limiter off so a 10,000-request local benchmark
// isn't throttled at 100 requests / 15 minutes. It must be exactly "true", and it is IGNORED
// when NODE_ENV=production, so it cannot weaken a real deployment by accident.
// Only the global limiter is affected; the per-route limiters below and in urlRoutes.js stay on.
const benchmarkModeRequested = process.env.BENCHMARK_MODE === 'true';
const benchmarkMode = benchmarkModeRequested && process.env.NODE_ENV !== 'production';
if (benchmarkMode) {
    console.warn('BENCHMARK_MODE=true: global rate limiter is DISABLED (local benchmarking only)');
} else if (benchmarkModeRequested) {
    console.error('BENCHMARK_MODE=true was ignored because NODE_ENV=production; global rate limiter stays ON');
}

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => benchmarkMode
});

const createUrlLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many URLs created, please try again after a minute' }
});

module.exports = { globalLimiter, createUrlLimiter };