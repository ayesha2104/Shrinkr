// API integration tests: real Express app + real PostgreSQL (+ real Redis when it is reachable).
//
//   docker compose -f docker-compose.bench.yml up -d     # throwaway Postgres + Redis (or any local ones)
//   npm test
//
// scripts/bench/localEnv.js pins everything to LOCAL throwaway services, refuses non-loopback hosts and
// never reads your .env. Rows created here are removed in test.after().
//
// Redis is OPTIONAL for this file. Tests that assert on Redis state call needRedis(t) and are reported
// as SKIPPED (not passed) when Redis is unreachable. Everything else - auth, ownership, visibility, expiry,
// validation, clicks, rate limits - also runs with Redis down, which is itself the degraded-mode path.

require('../scripts/bench/localEnv'); // must be first

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const app = require('../index');
const pool = require('../src/config/db');
const redis = require('../src/config/redis');
const generateShortCode = require('../src/utils/generateShortCode');

const TARGET = 'https://example.com/api-test';
const RUN = crypto.randomBytes(3).toString('hex');
const key = (code) => `url:${code}`;
const randomIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;

let server;
let port;
let redisUp = false;
const createdCodes = [];

// ---- helpers ---------------------------------------------------------------------------------

// Every call comes from its own fake client IP (trust proxy = 1 makes Express use X-Forwarded-For),
// so the per-IP rate limiters don't couple unrelated tests. Rate-limit tests pass a fixed ip.
function request(method, path, { body, token, ip = randomIp(), rawBody } = {}) {
    return new Promise((resolve, reject) => {
        const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined;
        const headers = { 'X-Forwarded-For': ip };
        if (payload !== undefined) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
            let text = '';
            res.on('data', (c) => (text += c));
            res.on('end', () => {
                let json;
                try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
                resolve({ status: res.statusCode, headers: res.headers, text, json });
            });
        });
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

async function registerUser(label) {
    const email = `apitest-${RUN}-${label}@example.com`;
    const password = 'correct-horse-battery';
    const res = await request('POST', '/auth/register', { body: { email, password } });
    assert.equal(res.status, 201, `register ${label}: ${res.text}`);
    return { email, password, id: res.json.user.id, token: res.json.token };
}

async function createUrl(user, extra = {}) {
    const res = await request('POST', '/urls', { token: user && user.token, body: { original_url: TARGET, ...extra } });
    assert.equal(res.status, 201, `create: ${res.text}`);
    createdCodes.push(res.json.data.short_code);
    return res.json.data;
}

async function dbRow(code) {
    return (await pool.query('SELECT * FROM urls WHERE short_code = $1', [code])).rows[0];
}

async function waitFor(predicate, description, timeoutMs = 3000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail(`timed out waiting for: ${description}`);
}

function needRedis(t) {
    if (!redisUp) {
        t.skip('Redis is not reachable - start the throwaway Redis (docker-compose.bench.yml) to run this test');
        return false;
    }
    return true;
}

let alice;
let bob;

test.before(async () => {
    try {
        await pool.query('SELECT 1 FROM urls LIMIT 1');
        await pool.query('SELECT 1 FROM users LIMIT 1');
    } catch (err) {
        throw new Error(`PostgreSQL / schema not ready (${err.message}). See docs/benchmark.md for the throwaway database.`);
    }
    redis.connect().catch(() => {});
    await waitFor(() => redis.isReady, 'Redis', 1500).then(() => { redisUp = true; }, () => { redisUp = false; });

    server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    port = server.address().port;

    alice = await registerUser('alice');
    bob = await registerUser('bob');
});

test.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
        await pool.query('DELETE FROM urls WHERE short_code = ANY($1)', [createdCodes]);
        await pool.query('DELETE FROM users WHERE email LIKE $1', [`apitest-${RUN}-%`]); // cascades to their urls
        if (redisUp && redis.isReady) await redis.del(createdCodes.map(key));
    } finally {
        if (redis.isOpen) redis.destroy();
        await pool.end();
    }
});

// ---- short code generation -------------------------------------------------------------------

test('generateShortCode returns 6 alphanumeric characters', () => {
    for (let i = 0; i < 200; i++) assert.match(generateShortCode(), /^[A-Za-z0-9]{6}$/);
});

test('createUrl retries with a new code when the generated one already exists', async (t) => {
    const taken = await createUrl(alice);
    const takenCode = taken.short_code;
    // Force the generator to produce takenCode on its first attempt by feeding it the right indexes.
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const forced = [...takenCode].map((c) => chars.indexOf(c));
    const realRandomInt = crypto.randomInt;
    let calls = 0;
    t.mock.method(crypto, 'randomInt', (...args) => (calls < forced.length ? forced[calls++] : realRandomInt(...args)));

    // fixed ip: the default random ip would itself consume crypto.randomInt and shift the mocked sequence
    const res = await request('POST', '/urls', { ip: '10.9.9.9', token: bob.token, body: { original_url: TARGET } });
    assert.equal(res.status, 201, res.text);
    createdCodes.push(res.json.data.short_code);
    assert.ok(calls >= forced.length, 'the generator must have been forced to produce the taken code first');
    assert.notEqual(res.json.data.short_code, takenCode, 'must not reuse the existing code');
    assert.equal((await dbRow(takenCode)).user_id, alice.id, 'the existing row must be untouched');
});

test('createUrl gives up with a JSON 500 after repeated collisions', async (t) => {
    const taken = await createUrl(alice);
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const forced = [...taken.short_code].map((c) => chars.indexOf(c));
    let i = 0;
    t.mock.method(crypto, 'randomInt', () => forced[i++ % forced.length]); // always the taken code
    t.mock.method(console, 'error', () => {});
    const res = await request('POST', '/urls', { ip: '10.9.9.10', body: { original_url: TARGET } });
    assert.equal(res.status, 500);
    assert.equal(i, 5 * forced.length, 'exactly 5 attempts (MAX_SHORT_CODE_ATTEMPTS) before giving up');
    assert.deepEqual(res.json, { error: 'Internal server error' });
});

// ---- authentication --------------------------------------------------------------------------

test('register stores a bcrypt hash and never returns it', async () => {
    const user = await registerUser('hash');
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    assert.match(rows[0].password_hash, /^\$2[aby]\$10\$/, 'bcrypt, cost 10');
    assert.notEqual(rows[0].password_hash, user.password);
    const res = await request('POST', '/auth/login', { body: { email: user.email, password: user.password } });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('password'), 'no password material in the response');
});

test('register rejects duplicates (409) and invalid input (400)', async () => {
    const dup = await request('POST', '/auth/register', { body: { email: alice.email, password: alice.password } });
    assert.equal(dup.status, 409);
    for (const body of [{ email: 'not-an-email', password: 'longenough1' }, { email: 'x@example.com', password: 'short' }, {}]) {
        const res = await request('POST', '/auth/register', { body });
        assert.equal(res.status, 400, JSON.stringify(body));
    }
});

test('login: wrong password and unknown email give the same 401', async () => {
    const wrong = await request('POST', '/auth/login', { body: { email: alice.email, password: 'wrong-password-1' } });
    const unknown = await request('POST', '/auth/login', { body: { email: `nobody-${RUN}@example.com`, password: 'wrong-password-1' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.json, unknown.json);
});

test('JWT: valid token accepted; missing, garbage, wrong-secret, expired and alg=none tokens rejected', async () => {
    const me = await request('GET', '/auth/me', { token: alice.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, alice.id);

    assert.equal((await request('GET', '/auth/me')).status, 401);
    assert.equal((await request('GET', '/auth/me', { token: 'garbage' })).status, 401);

    const forged = jwt.sign({ id: alice.id, email: alice.email }, 'some-other-secret');
    assert.equal((await request('GET', '/auth/me', { token: forged })).status, 401);

    const expired = jwt.sign({ id: alice.id, email: alice.email }, process.env.JWT_SECRET, { expiresIn: -10 });
    const exp = await request('GET', '/auth/me', { token: expired });
    assert.equal(exp.status, 401);
    assert.equal(exp.json.error, 'Token expired');

    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: alice.id, email: alice.email })}.`;
    assert.equal((await request('GET', '/auth/me', { token: none })).status, 401);

    // HS512 with the right secret is still refused: verification is pinned to HS256
    const hs512 = jwt.sign({ id: alice.id, email: alice.email }, process.env.JWT_SECRET, { algorithm: 'HS512' });
    assert.equal((await request('GET', '/auth/me', { token: hs512 })).status, 401);
});

// ---- URL creation / validation / expiry -------------------------------------------------------

test('create: only http(s) URLs are accepted', async () => {
    for (const bad of ['javascript:alert(1)', 'ftp://example.com/x', 'file:///etc/passwd', 'not a url', '']) {
        const res = await request('POST', '/urls', { body: { original_url: bad } });
        assert.equal(res.status, 400, `should reject ${JSON.stringify(bad)}`);
    }
    // scheme matching is case-insensitive, but only for http/https
    for (const bad of ['JavaScript:alert(1)', 'FILE:///etc/passwd', 'FTP://example.com/x', 'DATA:text/html,x', '//example.com', 'http://']) {
        const res = await request('POST', '/urls', { body: { original_url: bad } });
        assert.equal(res.status, 400, `should reject ${JSON.stringify(bad)}`);
    }
    assert.equal((await request('POST', '/urls', { body: {} })).status, 400);
    const ok = await request('POST', '/urls', { body: { original_url: 'http://example.com/a?b=c#d' } });
    assert.equal(ok.status, 201);
    createdCodes.push(ok.json.data.short_code);
});

test('create: http/https schemes are accepted case-insensitively and the URL is stored exactly as sent', async () => {
    for (const url of ['HTTP://EXAMPLE.COM', 'HTTPS://x.io', 'Https://example.com/Path?Q=1#Frag']) {
        const res = await request('POST', '/urls', { body: { original_url: url } });
        assert.equal(res.status, 201, `${url}: ${res.text}`);
        createdCodes.push(res.json.data.short_code);
        assert.equal(res.json.data.original_url, url, 'stored string must not be rewritten');
        assert.equal((await dbRow(res.json.data.short_code)).original_url, url);
        const redirect = await request('GET', `/${res.json.data.short_code}`);
        assert.equal(redirect.status, 302);
        assert.equal(redirect.headers.location, url);
    }
});

test('create: an invalid optional-auth token falls back to an anonymous link (existing behaviour, not a 401)', async () => {
    const wrongSecret = jwt.sign({ id: alice.id, email: alice.email }, 'some-other-secret');
    const expired = jwt.sign({ id: alice.id, email: alice.email }, process.env.JWT_SECRET, { expiresIn: -10 });
    for (const [label, token] of [['garbage', 'not-a-jwt'], ['wrong secret', wrongSecret], ['expired', expired]]) {
        const res = await request('POST', '/urls', { token, body: { original_url: TARGET } });
        assert.equal(res.status, 201, `${label}: ${res.text}`);
        createdCodes.push(res.json.data.short_code);
        assert.equal(res.json.data.user_id, null, `${label}: the link must be anonymous, not owned by the token's claimed user`);
    }
    // ...and none of those links leaked into the claimed user's list
    const list = await request('GET', '/urls', { token: alice.token });
    assert.ok(list.json.data.every((r) => r.user_id === alice.id));
});

test('create: expiration_days must be an integer 1..365 (default 30)', async () => {
    for (const bad of [0, -1, 366, 1.5, 'abc']) {
        const res = await request('POST', '/urls', { body: { original_url: TARGET, expiration_days: bad } });
        assert.equal(res.status, 400, `expiration_days=${JSON.stringify(bad)}`);
    }
    const dayMs = 24 * 60 * 60 * 1000;
    for (const [days, expected] of [[1, 1], [365, 365], [undefined, 30]]) {
        const before = Date.now();
        const row = await createUrl(alice, days === undefined ? {} : { expiration_days: days });
        const delta = new Date(row.expires_at).getTime() - before;
        assert.ok(Math.abs(delta - expected * dayMs) < 2 * 60 * 1000, `${expected} days -> expires_at off by ${delta - expected * dayMs}ms`);
    }
});

test('create: anonymous URLs have no owner; logged-in URLs belong to the caller; default is private', async () => {
    const anon = await request('POST', '/urls', { body: { original_url: TARGET } });
    createdCodes.push(anon.json.data.short_code);
    assert.equal(anon.json.data.user_id, null);
    const mine = await createUrl(alice);
    assert.equal(mine.user_id, alice.id);
    assert.equal(mine.is_public, false);
});

test('malformed JSON body -> 400 JSON; unknown route -> 404 JSON', async () => {
    const bad = await request('POST', '/urls', { rawBody: '{"original_url": ' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json, { error: 'Malformed JSON body' });
    const nf = await request('GET', '/no/such/route');
    assert.equal(nf.status, 404);
    assert.ok(nf.json && nf.json.error);
});

// ---- redirects, expiry, clicks ---------------------------------------------------------------

test('redirect: 302 to the original URL; unknown code 404', async () => {
    const row = await createUrl(alice);
    const res = await request('GET', `/${row.short_code}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, TARGET);
    assert.equal((await request('GET', '/zzzzzz9')).status, 404);
});

// expires_at is `timestamp without time zone`: the app writes JS Dates (process-local wall time), so the test
// does too. Using the DB's NOW() would mix time zones whenever Postgres and Node differ (UTC container vs local).
test('expiry: an expired link is 410 for redirect and metadata, and a link expiring in the future still works', async () => {
    const expired = await createUrl(alice, { is_public: true });
    await pool.query("UPDATE urls SET expires_at = $2 WHERE short_code = $1", [expired.short_code, new Date(Date.now() - 1000)]);
    assert.equal((await request('GET', `/${expired.short_code}`)).status, 410);
    assert.equal((await request('GET', `/urls/${expired.short_code}`, { token: alice.token })).status, 410);

    const live = await createUrl(alice, { is_public: true });
    await pool.query("UPDATE urls SET expires_at = $2 WHERE short_code = $1", [live.short_code, new Date(Date.now() + 60000)]);
    assert.equal((await request('GET', `/${live.short_code}`)).status, 302);
});

test('clicks: every redirect increments the counter, including 20 concurrent ones', async () => {
    const row = await createUrl(alice);
    for (let i = 0; i < 3; i++) assert.equal((await request('GET', `/${row.short_code}`)).status, 302);
    await waitFor(async () => (await dbRow(row.short_code)).clicks === 3, 'clicks = 3');

    const results = await Promise.all(Array.from({ length: 20 }, () => request('GET', `/${row.short_code}`)));
    assert.ok(results.every((r) => r.status === 302));
    await waitFor(async () => (await dbRow(row.short_code)).clicks === 23, 'clicks = 23 (no lost updates)');
});

// ---- visibility & ownership -------------------------------------------------------------------

test('visibility: private metadata is visible only to its owner; public metadata to everyone', async () => {
    const priv = await createUrl(alice, { is_public: false });
    const pub = await createUrl(alice, { is_public: true });

    assert.equal((await request('GET', `/urls/${priv.short_code}`)).status, 403, 'anonymous');
    assert.equal((await request('GET', `/urls/${priv.short_code}`, { token: bob.token })).status, 403, 'other user');
    const own = await request('GET', `/urls/${priv.short_code}`, { token: alice.token });
    assert.equal(own.status, 200);
    assert.equal(own.json.data.short_code, priv.short_code);

    assert.equal((await request('GET', `/urls/${pub.short_code}`)).status, 200, 'anonymous, public');
    assert.equal((await request('GET', `/urls/${pub.short_code}`, { token: bob.token })).status, 200, 'other user, public');

    // Documented behaviour: is_public gates metadata only; the redirect itself works for anyone with the code.
    assert.equal((await request('GET', `/${priv.short_code}`)).status, 302);
});

test('ownership: another user (or nobody) cannot update or delete; the row stays unchanged', async () => {
    const row = await createUrl(alice, { is_public: false });
    const attempt = { original_url: 'https://evil.example/hijack', is_public: true };

    assert.equal((await request('PUT', `/urls/${row.short_code}`, { body: attempt })).status, 401);
    assert.equal((await request('PUT', `/urls/${row.short_code}`, { token: bob.token, body: attempt })).status, 403);
    assert.equal((await request('DELETE', `/urls/${row.short_code}`)).status, 401);
    assert.equal((await request('DELETE', `/urls/${row.short_code}`, { token: bob.token })).status, 403);

    const after = await dbRow(row.short_code);
    assert.equal(after.original_url, TARGET);
    assert.equal(after.is_public, false);
    assert.equal(after.user_id, alice.id);

    assert.equal((await request('PUT', '/urls/nope1234', { token: alice.token, body: attempt })).status, 404);
    assert.equal((await request('DELETE', '/urls/nope1234', { token: alice.token })).status, 404);
});

test('ownership: anonymously-created URLs cannot be modified by any logged-in user', async () => {
    const anon = await request('POST', '/urls', { body: { original_url: TARGET } });
    const code = anon.json.data.short_code;
    createdCodes.push(code);
    assert.equal((await request('PUT', `/urls/${code}`, { token: alice.token, body: { is_public: true } })).status, 403);
    assert.equal((await request('DELETE', `/urls/${code}`, { token: alice.token })).status, 403);
    assert.ok(await dbRow(code));
});

test('GET /urls requires auth and returns only the caller\'s URLs', async () => {
    assert.equal((await request('GET', '/urls')).status, 401);
    const a = await createUrl(alice);
    const b = await createUrl(bob);
    const res = await request('GET', '/urls', { token: alice.token });
    assert.equal(res.status, 200);
    const codes = res.json.data.map((r) => r.short_code);
    assert.ok(codes.includes(a.short_code));
    assert.ok(!codes.includes(b.short_code));
    assert.ok(res.json.data.every((r) => r.user_id === alice.id));
    assert.equal(res.json.count, res.json.data.length);
});

test('update: owner can change URL and visibility; invalid values are rejected without writing', async () => {
    const row = await createUrl(alice, { is_public: false });
    const ok = await request('PUT', `/urls/${row.short_code}`, {
        token: alice.token, body: { original_url: 'https://example.org/new', is_public: true }
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.data.original_url, 'https://example.org/new');
    assert.equal(ok.json.data.is_public, true);

    const partial = await request('PUT', `/urls/${row.short_code}`, { token: alice.token, body: { is_public: false } });
    assert.equal(partial.status, 200);
    assert.equal(partial.json.data.original_url, 'https://example.org/new', 'omitted field keeps its value');

    const upper = await request('PUT', `/urls/${row.short_code}`, { token: alice.token, body: { original_url: 'HTTPS://Example.ORG/Up' } });
    assert.equal(upper.status, 200, upper.text);
    assert.equal(upper.json.data.original_url, 'HTTPS://Example.ORG/Up', 'update also accepts an uppercase scheme, stored as sent');
    assert.equal((await request('PUT', `/urls/${row.short_code}`, { token: alice.token, body: { original_url: 'https://example.org/new' } })).status, 200);

    for (const body of [{ original_url: 'javascript:alert(1)' }, { original_url: 'JAVASCRIPT:alert(1)' }, { original_url: 'FILE:///etc/passwd' }, { original_url: 'nope' }, { is_public: 'maybe' }, { clicks: 999 }]) {
        const res = await request('PUT', `/urls/${row.short_code}`, { token: alice.token, body });
        assert.equal(res.status, 400, JSON.stringify(body));
    }
    const after = await dbRow(row.short_code);
    assert.equal(after.original_url, 'https://example.org/new');
    assert.equal(after.clicks, 0);
});

test('delete: owner deletes; link then 404s', async () => {
    const row = await createUrl(alice);
    assert.equal((await request('DELETE', `/urls/${row.short_code}`, { token: alice.token })).status, 200);
    assert.equal(await dbRow(row.short_code), undefined);
    assert.equal((await request('GET', `/${row.short_code}`)).status, 404);
});

// ---- rate limiting ---------------------------------------------------------------------------

test('rate limit: the 6th URL creation within a minute from one IP is 429 (JSON)', async () => {
    const ip = randomIp();
    for (let i = 1; i <= 5; i++) {
        const res = await request('POST', '/urls', { ip, body: { original_url: TARGET } });
        assert.equal(res.status, 201, `request ${i}`);
        createdCodes.push(res.json.data.short_code);
    }
    const limited = await request('POST', '/urls', { ip, body: { original_url: TARGET } });
    assert.equal(limited.status, 429);
    assert.ok(limited.json && limited.json.error, 'JSON error body');
    // another client is unaffected
    assert.equal((await request('POST', '/urls', { body: { original_url: TARGET } })).status, 201);
});

test('rate limit: auth endpoints are throttled per IP (21st attempt in the window is 429)', async () => {
    const ip = randomIp();
    for (let i = 1; i <= 20; i++) {
        const res = await request('POST', '/auth/login', { ip, body: { email: 'bad' } });
        assert.equal(res.status, 400, `attempt ${i}`);
    }
    const limited = await request('POST', '/auth/login', { ip, body: { email: 'bad' } });
    assert.equal(limited.status, 429);
});

// ---- Redis cache behaviour (needs a reachable Redis) ----------------------------------------

test('cache: populated with key url:<code>, TTL 3600s, value is the row as JSON', async (t) => {
    if (!needRedis(t)) return;
    const row = await createUrl(alice, { is_public: true });
    assert.equal(await redis.exists(key(row.short_code)), 0, 'creating a URL does not pre-populate the cache');
    assert.equal((await request('GET', `/${row.short_code}`)).status, 302);
    const ttl = await redis.ttl(key(row.short_code));
    assert.ok(ttl > 3590 && ttl <= 3600, `ttl was ${ttl}`);
    const cached = JSON.parse(await redis.get(key(row.short_code)));
    assert.equal(cached.short_code, row.short_code);
    assert.equal(cached.original_url, TARGET);
});

test('cache: metadata endpoint serves from cache but still enforces privacy per caller', async (t) => {
    if (!needRedis(t)) return;
    const row = await createUrl(alice, { is_public: false });
    assert.equal((await request('GET', `/urls/${row.short_code}`, { token: alice.token })).status, 200); // populates
    assert.equal(await redis.exists(key(row.short_code)), 1);
    const hit = await request('GET', `/urls/${row.short_code}`, { token: alice.token });
    assert.match(hit.json.message, /from cache/);
    assert.equal((await request('GET', `/urls/${row.short_code}`)).status, 403, 'anonymous must not read a cached private row');
    assert.equal((await request('GET', `/urls/${row.short_code}`, { token: bob.token })).status, 403, 'other user must not either');
});

test('cache invalidation: update removes the entry, redirect and visibility reflect the change immediately', async (t) => {
    if (!needRedis(t)) return;
    const row = await createUrl(alice, { is_public: false });
    assert.equal((await request('GET', `/${row.short_code}`)).headers.location, TARGET); // cached
    assert.equal((await request('GET', `/urls/${row.short_code}`)).status, 403);           // cached row, anon denied

    const upd = await request('PUT', `/urls/${row.short_code}`, {
        token: alice.token, body: { original_url: 'https://example.org/updated', is_public: true }
    });
    assert.equal(upd.status, 200);
    assert.equal(await redis.exists(key(row.short_code)), 0, 'entry must be deleted by the update');
    assert.equal((await request('GET', `/${row.short_code}`)).headers.location, 'https://example.org/updated');
    assert.equal((await request('GET', `/urls/${row.short_code}`)).status, 200, 'now public, no stale 403');
});

test('cache invalidation: delete removes the entry and the code 404s', async (t) => {
    if (!needRedis(t)) return;
    const row = await createUrl(alice);
    assert.equal((await request('GET', `/${row.short_code}`)).status, 302);
    assert.equal(await redis.exists(key(row.short_code)), 1);
    assert.equal((await request('DELETE', `/urls/${row.short_code}`, { token: alice.token })).status, 200);
    assert.equal(await redis.exists(key(row.short_code)), 0);
    assert.equal((await request('GET', `/${row.short_code}`)).status, 404);
});

test('cache: expiry is enforced on cached rows (TTL cannot extend a link\'s life)', async (t) => {
    if (!needRedis(t)) return;
    const row = await createUrl(alice, { is_public: true });
    assert.equal((await request('GET', `/${row.short_code}`)).status, 302);
    assert.equal((await request('GET', `/urls/${row.short_code}`)).status, 200); // cached
    assert.equal(await redis.exists(key(row.short_code)), 1);
    await pool.query("UPDATE urls SET expires_at = $2 WHERE short_code = $1", [row.short_code, new Date(Date.now() - 1000)]);
    // The cached copy still has the OLD expires_at, so refresh it to the expired row the way a real expiry would look:
    await redis.set(key(row.short_code), JSON.stringify(await dbRow(row.short_code)), { EX: 3600 });
    assert.equal((await request('GET', `/${row.short_code}`)).status, 410);
    assert.equal((await request('GET', `/urls/${row.short_code}`)).status, 410);
});

test('cache: malformed entries are treated as misses (no 500) and are repaired', async (t) => {
    if (!needRedis(t)) return;
    const row = await createUrl(alice);
    for (const garbage of ['{not json', 'null', '42', '"str"', '{"short_code":"x"}']) {
        await redis.set(key(row.short_code), garbage, { EX: 60 });
        const res = await request('GET', `/${row.short_code}`);
        assert.equal(res.status, 302, `garbage ${garbage}`);
        assert.equal(res.headers.location, TARGET);
    }
    const repaired = JSON.parse(await redis.get(key(row.short_code)));
    assert.equal(repaired.original_url, TARGET);
});

// ---- Redis unavailable (runs last: it closes the connection; harmless if Redis was never up) ---

test('Redis down: reads, updates and deletes still succeed from PostgreSQL (no 500s)', async (t) => {
    if (redis.isOpen) redis.destroy();
    assert.equal(redis.isReady, false, 'precondition: Redis client is not ready');
    t.mock.method(console, 'error', () => {}); // the cache logs its (expected) problems

    const row = await createUrl(alice, { is_public: true });
    assert.equal((await request('GET', `/${row.short_code}`)).status, 302);
    assert.equal((await request('GET', `/urls/${row.short_code}`)).status, 200);

    const upd = await request('PUT', `/urls/${row.short_code}`, { token: alice.token, body: { original_url: 'https://example.org/down' } });
    assert.equal(upd.status, 200, `update must not fail because the cache is down: ${upd.text}`);
    assert.equal((await request('GET', `/${row.short_code}`)).headers.location, 'https://example.org/down');

    assert.equal((await request('DELETE', `/urls/${row.short_code}`, { token: alice.token })).status, 200);
    assert.equal((await request('GET', `/${row.short_code}`)).status, 404);
});
