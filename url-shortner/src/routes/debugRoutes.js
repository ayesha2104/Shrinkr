// Development/benchmark-only routes. index.js mounts this router only when
// ENABLE_DEBUG_METRICS=true AND NODE_ENV is not "production".
//
//   GET  /__debug/db-stats        -> { total, urlLookup, clickUpdate, other, since }
//   POST /__debug/db-stats/reset  -> zeroes the counters and returns the fresh snapshot

const express = require('express');
const queryStats = require('../utils/queryStats');

const router = express.Router();

router.get('/db-stats', (req, res) => {
    res.json(queryStats.snapshot());
});

router.post('/db-stats/reset', (req, res) => {
    queryStats.reset();
    res.json(queryStats.snapshot());
});

module.exports = router;
