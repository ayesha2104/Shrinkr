require('dotenv').config();
const { Pool } = require('pg');
const queryStats = require('../utils/queryStats');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // Default is unchanged (SSL on, certificate not verified). DB_SSL=false is only
    // meant for a throwaway local Postgres that has no SSL configured (tests/benchmarks).
    ssl: process.env.DB_SSL === 'false' ? false : {
        rejectUnauthorized: false
    }
});

// Count every query issued through pool.query() (see utils/queryStats.js). The wrapper
// forwards all arguments untouched, so callbacks and query-config objects still work.
const originalQuery = pool.query.bind(pool);
pool.query = (...args) => {
    queryStats.record(args[0]);
    return originalQuery(...args);
};

pool.connect((err, client, release) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('Database connected successfully');
        release();
    }
});

module.exports = pool;