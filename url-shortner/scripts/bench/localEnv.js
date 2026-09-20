// Safety layer shared by scripts/bench/* and test/*.  REQUIRE THIS FIRST.
//
// Goal: these tools may only ever talk to throwaway LOCAL Postgres/Redis, and must never
// pick up the developer's real .env (which points at production).
//
// Why it is needed: src/config/db.js and src/config/redis.js call dotenv.config(), and
// dotenv fills any variable that is not already set from ./.env. So this module:
//   1. replaces dotenv with a no-op inside this process (the .env file is never read here),
//   2. force-sets every connection variable from BENCH_* overrides or local defaults
//      (an unprefixed DB_HOST/REDIS_HOST exported in your shell is deliberately ignored),
//   3. refuses to continue unless the DB and Redis hosts are loopback addresses,
//   4. refuses to continue when NODE_ENV=production.
// childEnv() gives the benchmark runner the same pinned values for the app process it spawns.

const fs = require('fs');
const path = require('path');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

// Defaults match docker-compose.bench.yml. Override any with BENCH_<NAME>, e.g. BENCH_DB_PORT=5433.
const DEFAULTS = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '55433',
    DB_USER: 'postgres',
    DB_PASSWORD: 'bench',
    DB_NAME: 'shrinkr_bench',
    DB_SSL: 'false',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '56379',
    REDIS_PASSWORD: '',
    JWT_SECRET: 'bench-only-not-a-secret',
    JWT_EXPIRY: '7d'
};

// Every key the app could otherwise read from .env: names come from the committed .env.example
// (names only), plus BASE_URL. Any of these not listed in DEFAULTS is pinned to ''.
function exampleKeys() {
    try {
        const text = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
        return text.split(/\r?\n/).map((l) => (l.match(/^([A-Z0-9_]+)=/) || [])[1]).filter(Boolean);
    } catch (err) {
        return [];
    }
}
const KEYS = [...new Set([...Object.keys(DEFAULTS), ...exampleKeys(), 'BASE_URL', 'PORT'])];

const pinned = {};
for (const key of KEYS) {
    const override = process.env[`BENCH_${key}`];
    pinned[key] = override !== undefined ? override : (DEFAULTS[key] !== undefined ? DEFAULTS[key] : '');
}

if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run benchmark/test tooling with NODE_ENV=production.');
}
for (const key of ['DB_HOST', 'REDIS_HOST']) {
    if (!LOOPBACK.has(pinned[key])) {
        throw new Error(
            `Refusing to run: ${key}="${pinned[key]}" is not a loopback address. ` +
            'Benchmarks and tests must only use throwaway local Postgres/Redis, never shared or production services.'
        );
    }
}

// (1) make dotenv a no-op for this process so ./.env is never read
const dotenvPath = require.resolve('dotenv');
require.cache[dotenvPath] = {
    id: dotenvPath, filename: dotenvPath, loaded: true, children: [], paths: [],
    exports: { config: () => ({ parsed: {} }) }
};

// (2) force-set the pinned values
for (const key of KEYS) process.env[key] = pinned[key];
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';

// Environment for a spawned app process: the shell env, with every pinned key overridden.
function childEnv(extra = {}) {
    return { ...process.env, ...pinned, NODE_ENV: 'benchmark', ...extra };
}

// The benchmark dataset: 100 URLs with predictable codes (short_code is varchar(10)).
const BENCH_URL_COUNT = 100;
const BENCH_CODE_PREFIX = 'bench';
const codeFor = (i) => `${BENCH_CODE_PREFIX}${String(i).padStart(3, '0')}`;

module.exports = { childEnv, pinned, BENCH_URL_COUNT, BENCH_CODE_PREFIX, codeFor };
