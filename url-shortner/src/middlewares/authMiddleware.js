const jwt = require('jsonwebtoken');

// Middleware: Require authentication (user must be logged in)
exports.authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authorization token required' });
        }

        const token = authHeader.substring(7); // Remove "Bearer " prefix

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach user info to request
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Middleware: Optional authentication (verify token if present, but don't require it)
// Used for endpoints that work for both anonymous and logged-in users
exports.optionalAuth = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded; // User is authenticated
        }
        // If no token or invalid token, req.user stays undefined
        // But we don't fail - just continue
        next();
    } catch (err) {
        // Token was invalid but optional auth, so just continue without user
        next();
    }
};