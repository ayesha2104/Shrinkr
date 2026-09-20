// Integration tests for the cached redirect: real Express app, real PostgreSQL, real Redis.
//
//   docker compose -f docker-compose.bench.yml up -d     # throwaway Postgres + Redis (or any local ones)
//   npm test
//
// scripts/bench/localEnv.js pins the connection settings to LOCAL throwaway services, refuses
// non-loopback hosts and never reads your .env.
//
// "URL lookup" below means: SELECT ... FROM urls WHERE short_code = ...  (see src/utils/queryStats.js).
// The click-count UPDATE is a different category and is expected on every redirect.

require('../scripts/bench/localEnv'); // must be first

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes } = require('node:crypto');

const app = require('../index'); // exports the app; does not listen or connect Redis when required
const pool = require('../src/config/db');
const redis = require('../src/config/redis');
const queryStats = require('../src/utils/queryStats');

const ORIGINAL_URL = 'https://example.com/integration-test';
// short_code is varchar(10): "it" + 8 hex chars
const newCode = () => 'it' + randomBytes(4).toString('hex');
const cacheKey = (code) => `url:${code}`;
const createdCodes = [];

let server;
let port;

function get(path) {
    return new Promise((resolve, reject) => {
        // no redirect following: http.get returns the 302 itself
        http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
        }).on('error', reject);
    });
}

async function waitFor(predicate, description, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`timed out waiting for: ${description}`);
}

async function seedUrl() {
    const code = newCode();
    // private (is_public = false): redirects must work anyway, as they do today
    await pool.query(
        'INSERT INTO urls (short_code, original_url, is_public) VALUES ($1, $2, false)',
        [code, ORIGINAL_URL]
    );
    createdCodes.push(code);
    await redis.del(cacheKey(code)); // make sure the cache starts empty for this code
    assert.equal(await redis.exists(cacheKey(code)), 0, 'cache must start empty');
    return code;
}

test.before(async () => {
    try {
        await pool.query('SELECT 1');
    } catch (err) {
        throw new Error(
            `PostgreSQL is not reachable (${err.message}). Start the throwaway databases first: ` +
            '`docker compose -f docker-compose.bench.yml up -d` (see docs/benchmark.md).'
        );
    }
    await pool.query('SELECT 1 FROM urls LIMIT 1'); // fails clearly if the schema is missing

    redis.connect().catch(() => {}); // failures are surfaced by the readiness check below
    await waitFor(() => redis.isReady, 'Redis to become ready (is the throwaway Redis running?)', 5000);

    server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;
});

test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
        if (createdCodes.length) {
            await pool.query('DELETE FROM urls WHERE short_code = ANY($1)', [createdCodes]);
            if (redis.isReady) await redis.del(createdCodes.map(cacheKey));
        }
    } finally {
        if (redis.isOpen) redis.destroy();
        await pool.end();
    }
});

test('second request for the same short code performs 0 URL lookup queries', async () => {
    const code = await seedUrl();

    // --- request 1: cache miss -> PostgreSQL lookup -> cache populated
    queryStats.reset();
    const first = await get(`/${code}`);
    assert.equal(first.status, 302);
    assert.equal(first.location, ORIGINAL_URL);
    assert.equal(queryStats.snapshot().urlLookup, 1, 'first request must look the URL up in PostgreSQL');
    assert.equal(await redis.exists(cacheKey(code)), 1, 'first request must populate the cache');
    await waitFor(() => queryStats.snapshot().clickUpdate === 1, 'click update from request 1');

    // --- request 2: cache hit -> no URL lookup query at all
    queryStats.reset();
    const second = await get(`/${code}`);
    assert.equal(second.status, 302);
    assert.equal(second.location, ORIGINAL_URL);
    // The click UPDATE is fire-and-forget: wait until it is issued so we know the request is fully
    // accounted for, then assert on the lookup category specifically.
    await waitFor(() => queryStats.snapshot().clickUpdate === 1, 'click update from request 2');
    const stats = queryStats.snapshot();
    assert.equal(stats.urlLookup, 0, `second request must not query PostgreSQL for the URL (got ${JSON.stringify(stats)})`);
    assert.equal(stats.clickUpdate, 1, 'the click counter is still written to PostgreSQL');
    assert.equal(stats.total, 1, 'the click UPDATE is the only PostgreSQL query');

    // the analytics write really landed in PostgreSQL (2 redirects -> clicks = 2)
    let clicks;
    for (let i = 0; i < 100 && clicks !== 2; i++) {
        ({ rows: [{ clicks }] } = await pool.query('SELECT clicks FROM urls WHERE short_code = $1', [code]));
        if (clicks !== 2) await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(clicks, 2, 'both redirects must be counted in the clicks column');
});

test('REDIRECT_CACHE_ENABLED=false bypasses Redis completely', async () => {
    assert.equal(redis.isReady, true, 'precondition: Redis is up, so a bypass is due to the flag, not to an outage');
    const code = await seedUrl();
    process.env.REDIRECT_CACHE_ENABLED = 'false';
    try {
        queryStats.reset();
        assert.equal((await get(`/${code}`)).status, 302);
        assert.equal((await get(`/${code}`)).status, 302);
        await waitFor(() => queryStats.snapshot().clickUpdate === 2, 'both click updates');
        assert.equal(queryStats.snapshot().urlLookup, 2, 'with the cache off every request looks the URL up');
        assert.equal(await redis.exists(cacheKey(code)), 0, 'nothing may be written to Redis');
    } finally {
        delete process.env.REDIRECT_CACHE_ENABLED;
    }
});

// Runs last: it closes the Redis connection. This SIMULATES an outage by dropping the client's
// connection; the real kill / freeze procedure is documented in docs/benchmark.md.
test('falls back to PostgreSQL (no 500, process alive) when Redis is unavailable', async () => {
    const code = await seedUrl();
    redis.destroy();
    assert.equal(redis.isReady, false, 'precondition: Redis client is not ready');

    queryStats.reset();
    const res = await get(`/${code}`);
    assert.equal(res.status, 302, 'redirect must still work without Redis');
    assert.equal(res.location, ORIGINAL_URL);
    await waitFor(() => queryStats.snapshot().clickUpdate === 1, 'click update');
    assert.equal(queryStats.snapshot().urlLookup, 1, 'served through the PostgreSQL fallback');

    const again = await get(`/${code}`);
    assert.equal(again.status, 302, 'and keeps working on the next request');
});
