// Counts PostgreSQL queries issued through the shared pool (see src/config/db.js).
//
// Queries are split into categories so tests and benchmarks can tell "the URL
// lookup hit the database" apart from unrelated traffic such as the async
// click-count UPDATE:
//   urlLookup   - SELECT ... FROM urls WHERE short_code = ...
//   clickUpdate - UPDATE urls SET clicks = clicks + 1 ...
//   other       - everything else (health check, auth, listing, inserts, ...)
//
// Only calls made through pool.query() are counted. Redis operations are never
// counted, and neither is anything that checks out a client with pool.connect().

const CATEGORIES = ['urlLookup', 'clickUpdate', 'other'];

let counts;
let since;

function reset() {
    counts = { total: 0, urlLookup: 0, clickUpdate: 0, other: 0 };
    since = new Date().toISOString();
}

function classify(sqlText) {
    const sql = String(sqlText).replace(/\s+/g, ' ').trim();
    if (/^select\b.* from urls where short_code\s*=/i.test(sql)) return 'urlLookup';
    if (/^update urls set clicks\s*=\s*clicks\s*\+\s*1\b/i.test(sql)) return 'clickUpdate';
    return 'other';
}

// Called for every pool.query(). Must never throw: counting is diagnostics only.
function record(queryArg) {
    try {
        const sqlText = typeof queryArg === 'string' ? queryArg : queryArg && queryArg.text;
        counts.total += 1;
        counts[classify(sqlText)] += 1;
    } catch (err) {
        // ignore - never let the counter affect a real query
    }
}

function snapshot() {
    return { ...counts, since };
}

reset();

module.exports = { record, reset, snapshot, classify, CATEGORIES };
