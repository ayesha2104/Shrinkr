// Seeds the benchmark dataset: 100 private, non-expired URLs (bench000 .. bench099).
//
//   npm run benchmark:seed
//
// Reproducible and idempotent: one INSERT ... SELECT generate_series(...) statement, and re-running it
// resets the same rows (including clicks = 0) instead of adding more. It only ever touches rows whose
// short_code starts with "bench". Connection settings come from scripts/bench/localEnv.js, which
// refuses non-loopback hosts and never reads your .env.

const { BENCH_URL_COUNT, BENCH_CODE_PREFIX } = require('./localEnv'); // must be first
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
        max: 1
    });

    try {
        console.log(`Seeding ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME} (local throwaway database)`);

        // Create tables if the throwaway database is empty.
        await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

        await pool.query(
            `INSERT INTO urls (short_code, original_url, is_public, clicks, expires_at)
             SELECT $1 || lpad(g::text, 3, '0'),
                    'https://example.com/bench/' || lpad(g::text, 3, '0'),
                    false,
                    0,
                    now() + interval '30 days'
             FROM generate_series(0, $2::int - 1) AS g
             ON CONFLICT (short_code) DO UPDATE
                SET original_url = EXCLUDED.original_url,
                    is_public    = EXCLUDED.is_public,
                    clicks       = 0,
                    expires_at   = EXCLUDED.expires_at`,
            [BENCH_CODE_PREFIX, BENCH_URL_COUNT]
        );

        const { rows } = await pool.query(
            `SELECT count(*)::int AS n, min(short_code) AS first, max(short_code) AS last,
                    bool_or(is_public) AS any_public, sum(clicks)::int AS clicks
             FROM urls WHERE short_code LIKE $1 || '%'`,
            [BENCH_CODE_PREFIX]
        );
        const r = rows[0];
        console.log(`Seeded ${r.n} URLs: ${r.first} .. ${r.last} (all private: ${!r.any_public}, total clicks: ${r.clicks})`);
        if (r.n !== BENCH_URL_COUNT) throw new Error(`expected ${BENCH_URL_COUNT} benchmark URLs, found ${r.n}`);
    } finally {
        await pool.end();
    }
})().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
