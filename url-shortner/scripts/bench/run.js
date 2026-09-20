// Redirect benchmark: cache OFF vs cache ON, on throwaway LOCAL Postgres + Redis.
//
//   npm run benchmark:seed
//   BENCH_ENV_LABEL="<describe this machine>" npm run benchmark
//
// Options: --requests 10000 --rounds 3 --connections 20 --seed 42 --warmup 300 --out <file.json>
//
// Workload: 100 seeded URLs; 20% of them ("hot") receive exactly 80% of the requests, the other 80% of
// URLs share the remaining 20%. The request sequence is generated from a seeded PRNG, so every run (and
// every mode) replays the identical sequence.
//
// Each run starts a FRESH app process (fresh in-memory state and counters), clears every url:* key in the
// throwaway Redis first, and is followed by cross-checks against Postgres' and Redis' own statistics.
// Modes are interleaved (OFF, ON, OFF, ON, ...) so slow drift affects both equally.
//
// Safety: scripts/bench/localEnv.js refuses non-loopback hosts and never reads .env; the app is
// spawned from an empty temp directory with pinned connection settings.

const { childEnv, pinned, BENCH_URL_COUNT, codeFor } = require('./localEnv'); // must be first
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('redis');

const APP_ENTRY = path.join(__dirname, '..', '..', 'index.js');

// ---------- CLI ----------
function parseArgs(argv) {
    const opts = {
        requests: 10000, rounds: 3, connections: 20, seed: 42, warmup: 300,
        hotFraction: 0.2, hotShare: 0.8,
        out: path.join(__dirname, '..', '..', '..', 'docs', 'benchmark-results.json')
    };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (!(key in opts)) throw new Error(`unknown option ${argv[i]}`);
        opts[key] = key === 'out' ? argv[i + 1] : Number(argv[i + 1]);
    }
    return opts;
}

// ---------- workload ----------
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildWorkload({ requests, seed, hotFraction, hotShare }) {
    const rand = mulberry32(seed);
    const hotCount = Math.round(BENCH_URL_COUNT * hotFraction);
    const hotRequests = Math.round(requests * hotShare);
    const list = [];
    for (let i = 0; i < hotRequests; i++) list.push(codeFor(Math.floor(rand() * hotCount)));
    for (let i = 0; i < requests - hotRequests; i++) {
        list.push(codeFor(hotCount + Math.floor(rand() * (BENCH_URL_COUNT - hotCount))));
    }
    for (let i = list.length - 1; i > 0; i--) { // Fisher-Yates shuffle, seeded
        const j = Math.floor(rand() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    const hotCodes = new Set(Array.from({ length: hotCount }, (_, i) => codeFor(i)));
    return {
        list,
        hotCount,
        hotRequests,
        realisedHotShare: list.filter((c) => hotCodes.has(c)).length / list.length,
        distinctUrls: new Set(list).size
    };
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hr = () => process.hrtime.bigint();
const ms = (a, b) => Number(b - a) / 1e6;

function percentile(sorted, p) { // nearest-rank
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
function median(values) {
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

function request(agent, port, urlPath) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: urlPath, agent }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', () => resolve(0));
    });
}

async function getJson(port, urlPath, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, agent: false }, (res) => {
            let body = '';
            res.on('data', (d) => (body += d));
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.end();
    });
}

// ---------- the app under test ----------
async function startApp({ cacheEnabled }) {
    const port = await freePort();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shrinkr-bench-')); // empty dir => dotenv finds no .env
    const env = childEnv({
        PORT: String(port),
        BENCHMARK_MODE: 'true',
        ENABLE_DEBUG_METRICS: 'true',
        REDIRECT_CACHE_ENABLED: cacheEnabled ? 'true' : 'false'
    });
    const child = spawn(process.execPath, [APP_ENTRY], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const logs = [];
    const collect = (d) => logs.push(...d.toString().split('\n').filter(Boolean));
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const app = { child, port, logs, cwd };

    const deadline = Date.now() + 15000;
    const ready = () => logs.some((l) => /Server running/.test(l)) && logs.some((l) => /Database connected/.test(l))
        && (!cacheEnabled || logs.some((l) => /Redis ready/.test(l)));
    while (!ready()) {
        if (child.exitCode !== null) throw new Error(`app exited during startup:\n${logs.join('\n')}`);
        if (Date.now() > deadline) throw new Error(`app did not become ready:\n${logs.join('\n')}`);
        await sleep(50);
    }
    return app;
}

async function stopApp(app) {
    const wasAlive = app.child.exitCode === null && app.child.signalCode === null;
    app.child.kill('SIGTERM');
    await new Promise((resolve) => (app.child.exitCode !== null ? resolve() : app.child.once('exit', resolve)));
    fs.rmSync(app.cwd, { recursive: true, force: true });
    return wasAlive;
}

// ---------- load generator ----------
async function runLoad(port, codes, connections) {
    const agent = new http.Agent({ keepAlive: true, maxSockets: connections });
    const latencies = new Float64Array(codes.length);
    const statuses = {};
    let next = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= codes.length) return;
            const t0 = hr();
            const status = await request(agent, port, '/' + codes[i]);
            latencies[i] = ms(t0, hr());
            statuses[status] = (statuses[status] || 0) + 1;
        }
    }
    const start = hr();
    await Promise.all(Array.from({ length: connections }, worker));
    const wallMs = ms(start, hr());
    agent.destroy();
    const sorted = Array.from(latencies).sort((a, b) => a - b);
    return {
        wallMs,
        statuses,
        latency: {
            min: sorted[0], mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
            p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted[sorted.length - 1]
        }
    };
}

// ---------- database / redis side measurements ----------
async function pgStats(pool) {
    await pool.query('SELECT pg_stat_force_next_flush()');
    // seq_scan + idx_scan: with only 100 rows the planner may pick a sequential scan for the lookup,
    // so count every scan of the urls table, whichever kind. One lookup or one click UPDATE = one scan.
    const { rows } = await pool.query(
        `SELECT (seq_scan + COALESCE(idx_scan, 0))::bigint AS scans, n_tup_upd
         FROM pg_stat_user_tables WHERE relname = 'urls'`
    );
    return { scans: Number(rows[0].scans), tupUpd: Number(rows[0].n_tup_upd) };
}
const CLICKS_SQL = "SELECT COALESCE(sum(clicks), 0)::bigint AS n FROM urls WHERE short_code LIKE 'bench%'";
let runnerUrlQueries = 0; // the runner's own polls of urls, so their scans can be subtracted from Postgres' counter
const sumClicks = async (pool) => {
    runnerUrlQueries += 1;
    return Number((await pool.query(CLICKS_SQL)).rows[0].n);
};

// One poll can register MORE than one scan in Postgres' statistics (measured: 5 on PG 16.13), so the
// cost of a poll is calibrated once at startup instead of being assumed to be 1.
async function calibrateScansPerPoll(pool) {
    const K = 20;
    const before = await settledPgStats(pool);
    for (let i = 0; i < K; i++) await pool.query(CLICKS_SQL);
    const after = await settledPgStats(pool);
    const perPoll = (after.scans - before.scans) / K;
    if (!Number.isInteger(perPoll)) throw new Error(`could not calibrate scans per poll (delta ${after.scans - before.scans} over ${K} polls)`);
    return perPoll;
}

async function redisCommandCalls(redis) {
    const info = await redis.info('commandstats');
    const calls = (name) => Number((info.match(new RegExp(`cmdstat_${name}:calls=(\\d+)`)) || [0, 0])[1]);
    return { get: calls('get'), set: calls('set') };
}
async function clearUrlKeys(redis) { // only url:* keys of the throwaway Redis; never FLUSHALL
    const keys = [];
    for await (const batch of redis.scanIterator({ MATCH: 'url:*', COUNT: 500 })) keys.push(...[].concat(batch));
    for (let i = 0; i < keys.length; i += 500) await redis.unlink(keys.slice(i, i + 500));
    return keys.length;
}
async function countUrlKeys(redis) {
    let n = 0;
    for await (const batch of redis.scanIterator({ MATCH: 'url:*', COUNT: 500 })) n += [].concat(batch).length;
    return n;
}

// Postgres flushes per-backend statistics lazily; poll until two consecutive reads agree.
async function settledPgStats(pool) {
    let prev = await pgStats(pool);
    for (let i = 0; i < 12; i++) {
        await sleep(1200);
        const cur = await pgStats(pool);
        if (cur.scans === prev.scans && cur.tupUpd === prev.tupUpd) return cur;
        prev = cur;
    }
    return prev;
}

// ---------- one measured run ----------
async function measuredRun({ mode, round, workload, opts, pool, redis }) {
    const cacheEnabled = mode === 'on';
    const clearedKeys = await clearUrlKeys(redis); // cold cache for BOTH modes
    if ((await countUrlKeys(redis)) !== 0) throw new Error('url:* keys remain after clearing');

    const app = await startApp({ cacheEnabled });
    try {
        // warm the Node http stack / pg pool without touching the URLs or the cache
        for (let i = 0; i < opts.warmup; i++) await request(new http.Agent({ keepAlive: false }), app.port, '/health');
        await getJson(app.port, '/__debug/db-stats/reset', 'POST');

        const clicksBefore = await sumClicks(pool);
        const pgBefore = await settledPgStats(pool);
        const redisBefore = await redisCommandCalls(redis);

        const load = await runLoad(app.port, workload.list, opts.connections);

        const loadEnd = hr();
        const ok302 = load.statuses[302] || 0;

        // The click UPDATE is fire-and-forget, so when the last response arrives some updates may still be
        // queued inside the app's connection pool. Wait until every one is APPLIED in Postgres (not merely
        // issued) before stopping the app, and record how much was pending and how long draining took.
        const queriesBeforeDrain = runnerUrlQueries;
        let applied;
        let pendingWhenLoadEnded = null;
        const drainDeadline = Date.now() + 60000;
        for (;;) {
            applied = (await sumClicks(pool)) - clicksBefore;
            if (pendingWhenLoadEnded === null) pendingWhenLoadEnded = ok302 - applied;
            if (applied >= ok302 || Date.now() > drainDeadline) break;
            await sleep(50);
        }
        const clickDrainMs = ms(loadEnd, hr());
        const runnerQueriesInWindow = runnerUrlQueries - queriesBeforeDrain;
        const dbStats = await getJson(app.port, '/__debug/db-stats'); // final: everything issued

        const redisAfter = await redisCommandCalls(redis);
        const cachedKeys = await countUrlKeys(redis);
        const appErrors = app.logs.filter((l) => /Error|error|failed|Unhandled/.test(l) && !/BENCHMARK_MODE/.test(l));
        // Postgres backends flush their statistics lazily (idle backends can wait ~10s) but always on exit.
        // So stop the app FIRST (closing its connections), then read Postgres' own counters.
        const alive = await stopApp(app);
        await sleep(1500);
        const pgAfter = await settledPgStats(pool);

        const total = workload.list.length;
        const run = {
            mode, round, clearedKeysBeforeRun: clearedKeys,
            requests: total,
            responses302: ok302,
            otherResponses: Object.fromEntries(Object.entries(load.statuses).filter(([s]) => s !== '302')),
            durationMs: round2(load.wallMs),
            requestsPerSec: round2(total / (load.wallMs / 1000)),
            clicksPendingWhenLoadEnded: pendingWhenLoadEnded,
            clickDrainMs: round2(clickDrainMs),
            requestsPerSecIncludingClickDrain: round2(total / ((load.wallMs + clickDrainMs) / 1000)),
            latencyMs: mapValues(load.latency, round3),
            db: { total: dbStats.total, urlLookup: dbStats.urlLookup, clickUpdate: dbStats.clickUpdate, other: dbStats.other },
            crossChecks: {
                clicksAppliedInPostgres: applied,
                runnerPollsInWindow: runnerQueriesInWindow,
                runnerPollScans: runnerQueriesInWindow * opts.scansPerPoll,
                postgresTableScansDelta: pgAfter.scans - pgBefore.scans,
                postgresRowsUpdatedDelta: pgAfter.tupUpd - pgBefore.tupUpd,
                redisGetCalls: redisAfter.get - redisBefore.get,
                redisSetCalls: redisAfter.set - redisBefore.set,
                urlKeysInRedisAfterRun: cachedKeys
            },
            appProcessSurvivedRun: alive,
            appErrorLogLines: appErrors.length
        };
        return run;
    } catch (err) {
        await stopApp(app).catch(() => {});
        throw err;
    }
}
const round2 = (n) => round(n, 2);
const round3 = (n) => round(n, 3);
const mapValues = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

// Invariants that must hold for a run to be trusted.
function validate(run, opts) {
    const problems = [];
    const n = run.requests;
    if (run.responses302 !== n) problems.push(`expected ${n} x 302, got ${run.responses302} (others: ${JSON.stringify(run.otherResponses)})`);
    if (run.appProcessSurvivedRun !== true) problems.push('app process died during the run');
    if (run.db.clickUpdate !== n) problems.push(`click UPDATE count ${run.db.clickUpdate} != ${n}`);
    if (run.crossChecks.clicksAppliedInPostgres !== n) problems.push(`sum(clicks) grew by ${run.crossChecks.clicksAppliedInPostgres}, expected ${n}`);
    if (run.crossChecks.postgresRowsUpdatedDelta !== run.db.clickUpdate) {
        problems.push(`Postgres n_tup_upd delta ${run.crossChecks.postgresRowsUpdatedDelta} != counted click updates ${run.db.clickUpdate}`);
    }
    const expectedScans = run.db.urlLookup + run.db.clickUpdate + run.crossChecks.runnerPollScans;
    if (run.crossChecks.postgresTableScansDelta !== expectedScans) {
        problems.push(`Postgres scans-of-urls delta ${run.crossChecks.postgresTableScansDelta} != lookups+clicks+runner polls ${expectedScans}`);
    }
    if (run.db.other !== 0) problems.push(`unexpected 'other' queries: ${run.db.other}`);
    if (run.mode === 'off') {
        if (run.db.urlLookup !== n) problems.push(`cache OFF should do ${n} lookups, did ${run.db.urlLookup}`);
        if (run.crossChecks.redisGetCalls !== 0 || run.crossChecks.redisSetCalls !== 0) problems.push('cache OFF touched Redis GET/SET');
        if (run.crossChecks.urlKeysInRedisAfterRun !== 0) problems.push('cache OFF left url:* keys in Redis');
    } else {
        if (run.crossChecks.redisGetCalls !== n) problems.push(`cache ON should issue ${n} Redis GETs, issued ${run.crossChecks.redisGetCalls}`);
        if (run.db.urlLookup !== run.crossChecks.redisSetCalls) problems.push('cache ON: every lookup should be followed by exactly one Redis SET');
    }
    return problems;
}

function summarise(runs) {
    const by = (mode) => runs.filter((r) => r.mode === mode);
    const stat = (mode) => {
        const rs = by(mode);
        return {
            runs: rs.length,
            requestsPerSec: { median: round2(median(rs.map((r) => r.requestsPerSec))), all: rs.map((r) => r.requestsPerSec) },
            p50Ms: { median: round3(median(rs.map((r) => r.latencyMs.p50))), all: rs.map((r) => r.latencyMs.p50) },
            p95Ms: { median: round3(median(rs.map((r) => r.latencyMs.p95))), all: rs.map((r) => r.latencyMs.p95) },
            p99Ms: { median: round3(median(rs.map((r) => r.latencyMs.p99))), all: rs.map((r) => r.latencyMs.p99) },
            durationMs: { median: round2(median(rs.map((r) => r.durationMs))), all: rs.map((r) => r.durationMs) },
            clicksPendingWhenLoadEnded: { median: median(rs.map((r) => r.clicksPendingWhenLoadEnded)), all: rs.map((r) => r.clicksPendingWhenLoadEnded) },
            clickDrainMs: { median: round2(median(rs.map((r) => r.clickDrainMs))), all: rs.map((r) => r.clickDrainMs) },
            requestsPerSecIncludingClickDrain: { median: round2(median(rs.map((r) => r.requestsPerSecIncludingClickDrain))), all: rs.map((r) => r.requestsPerSecIncludingClickDrain) },
            urlLookupQueries: { median: median(rs.map((r) => r.db.urlLookup)), all: rs.map((r) => r.db.urlLookup) },
            clickUpdateQueries: { median: median(rs.map((r) => r.db.clickUpdate)), all: rs.map((r) => r.db.clickUpdate) },
            totalDbQueries: { median: median(rs.map((r) => r.db.total)), all: rs.map((r) => r.db.total) }
        };
    };
    const off = stat('off'), on = stat('on');
    const pct = (a, b) => round(((a - b) / a) * 100, 2);
    return {
        cacheOff: off,
        cacheOn: on,
        derived: {
            note: 'Derived from the medians above. Which of these (if any) is a defensible headline metric is decided separately.',
            urlLookupQueryReductionPct: pct(off.urlLookupQueries.median, on.urlLookupQueries.median),
            totalDbQueryReductionPct: pct(off.totalDbQueries.median, on.totalDbQueries.median),
            p50LatencyChangePct: pct(off.p50Ms.median, on.p50Ms.median),
            p95LatencyChangePct: pct(off.p95Ms.median, on.p95Ms.median),
            p99LatencyChangePct: pct(off.p99Ms.median, on.p99Ms.median),
            throughputChangePct: round(((on.requestsPerSec.median - off.requestsPerSec.median) / off.requestsPerSec.median) * 100, 2),
            cacheHitRatioOn: round(1 - on.urlLookupQueries.median / runs[0].requests, 4)
        }
    };
}

async function environment(pool, redis) {
    const sh = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unavailable'; } };
    const settings = {};
    for (const name of ['fsync', 'synchronous_commit', 'shared_buffers', 'max_connections', 'log_statement', 'ssl']) {
        settings[name] = (await pool.query(`SHOW ${name}`)).rows[0][name];
    }
    const redisInfo = await redis.info('server');
    const cpus = os.cpus();
    const repoRoot = path.join(__dirname, '..', '..', '..');
    return {
        label: process.env.BENCH_ENV_LABEL,
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        cpu: `${cpus[0].model} x${cpus.length}`,
        ramGiB: round(os.totalmem() / 2 ** 30, 2),
        node: process.version,
        npm: sh('npm', ['--version']),
        postgres: (await pool.query('SELECT version()')).rows[0].version,
        postgresSettings: settings,
        redis: (redisInfo.match(/redis_version:(\S+)/) || [])[1],
        loadGenerator: 'built-in Node http (scripts/bench/run.js); autocannon not used',
        git: {
            head: sh('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD']),
            uncommittedChanges: sh('git', ['-C', repoRoot, 'status', '--porcelain']) === '' ? 'no' : 'yes (or git unavailable)'
        },
        target: `${pinned.DB_HOST}:${pinned.DB_PORT}/${pinned.DB_NAME} and ${pinned.REDIS_HOST}:${pinned.REDIS_PORT} (loopback only)`
    };
}

// ---------- main ----------
(async () => {
    const opts = parseArgs(process.argv.slice(2));
    if (!process.env.BENCH_ENV_LABEL) {
        console.error('Set BENCH_ENV_LABEL to describe the machine, e.g.\n' +
            '  BENCH_ENV_LABEL="my laptop, 8 vCPU, Postgres 16 + Redis 7 in Docker" npm run benchmark');
        process.exit(1);
    }

    const pool = new Pool({
        host: pinned.DB_HOST, port: Number(pinned.DB_PORT), user: pinned.DB_USER, password: pinned.DB_PASSWORD,
        database: pinned.DB_NAME, ssl: false, max: 1 // one backend: keeps pg_stat flush accounting exact
    });
    const redis = createClient({ socket: { host: pinned.REDIS_HOST, port: Number(pinned.REDIS_PORT) } });
    redis.on('error', () => {});
    try {
        await redis.connect();
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM urls WHERE short_code LIKE 'bench%'");
        if (rows[0].n !== BENCH_URL_COUNT) throw new Error(`found ${rows[0].n} benchmark URLs, expected ${BENCH_URL_COUNT}. Run: npm run benchmark:seed`);
        // Reset click counters so runs are comparable and sum(clicks) checks start from a known value.
        await pool.query("UPDATE urls SET clicks = 0 WHERE short_code LIKE 'bench%'");
        opts.scansPerPoll = await calibrateScansPerPoll(pool);
    } catch (err) {
        console.error(`Cannot start benchmark: ${err.message}`);
        console.error('Are the throwaway Postgres/Redis running? (docker compose -f docker-compose.bench.yml up -d)');
        process.exit(1);
    }

    const env = await environment(pool, redis);
    if (env.postgresSettings.log_statement !== 'none') {
        console.warn(`WARNING: Postgres log_statement=${env.postgresSettings.log_statement}; statement logging distorts benchmark numbers.`);
    }
    const workload = buildWorkload(opts);
    console.log(`Environment label: ${env.label}`);
    console.log(`${env.cpu}, ${env.ramGiB} GiB RAM, ${env.postgres.split(',')[0]}, Redis ${env.redis}, Node ${env.node}`);
    console.log(`Workload: ${opts.requests} requests over ${BENCH_URL_COUNT} URLs; ${workload.hotCount} hot URLs get ${workload.hotRequests} ` +
        `(${round(workload.realisedHotShare * 100, 1)}%) of requests; ${workload.distinctUrls} distinct URLs touched; ` +
        `${opts.connections} keep-alive connections; seed ${opts.seed}; ${opts.rounds} rounds x (OFF, ON)\n`);

    const runs = [];
    let failed = false;
    for (let r = 1; r <= opts.rounds; r++) {
        for (const mode of ['off', 'on']) {
            process.stdout.write(`round ${r} cache ${mode.toUpperCase().padEnd(3)} ... `);
            const run = await measuredRun({ mode, round: r, workload, opts, pool, redis });
            const problems = validate(run, opts);
            runs.push({ ...run, validationProblems: problems });
            console.log(`${String(run.requestsPerSec).padStart(8)} req/s  p50 ${run.latencyMs.p50}ms  p95 ${run.latencyMs.p95}ms  p99 ${run.latencyMs.p99}ms  ` +
                `DB lookups ${run.db.urlLookup}  clicks ${run.db.clickUpdate} (pending at end ${run.clicksPendingWhenLoadEnded}, drained in ${run.clickDrainMs}ms)  ${problems.length ? 'INVALID: ' + problems.join('; ') : 'checks ok'}`);
            if (problems.length) failed = true;
        }
    }

    const summary = summarise(runs);
    const result = {
        generatedAt: new Date().toISOString(),
        environment: env,
        parameters: { ...opts, out: undefined, note_scansPerPoll: 'calibrated at startup: how many scans of urls one runner clicks-poll registers in pg_stat_user_tables', hotUrls: workload.hotCount, urlsTotal: BENCH_URL_COUNT, realisedHotShare: workload.realisedHotShare, distinctUrlsTouched: workload.distinctUrls },
        methodology: {
            cacheOff: 'App started with REDIRECT_CACHE_ENABLED=false: the redirect path issues no Redis GET/SET (verified via Redis INFO commandstats).',
            cacheOn: 'App started with REDIRECT_CACHE_ENABLED=true after every url:* key in the throwaway Redis was deleted (cold cache).',
            lookupVsClick: 'urlLookup = SELECT ... FROM urls WHERE short_code; clickUpdate = UPDATE urls SET clicks = clicks + 1. The click UPDATE happens on every redirect in both modes.',
            isolation: 'Local throwaway Postgres/Redis only. .env is never read; the app runs from an empty temp dir with pinned settings.'
        },
        summary,
        runs
    };
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(result, null, 2) + '\n');

    const s = summary;
    console.log('\nMedians over rounds   |  cache OFF |  cache ON');
    console.log(`Requests/sec          | ${String(s.cacheOff.requestsPerSec.median).padStart(10)} | ${String(s.cacheOn.requestsPerSec.median).padStart(9)}`);
    console.log(`URL lookup queries    | ${String(s.cacheOff.urlLookupQueries.median).padStart(10)} | ${String(s.cacheOn.urlLookupQueries.median).padStart(9)}`);
    console.log(`Click UPDATE queries  | ${String(s.cacheOff.clickUpdateQueries.median).padStart(10)} | ${String(s.cacheOn.clickUpdateQueries.median).padStart(9)}`);
    console.log(`Total DB queries      | ${String(s.cacheOff.totalDbQueries.median).padStart(10)} | ${String(s.cacheOn.totalDbQueries.median).padStart(9)}`);
    console.log(`Req/s incl. click drain| ${String(s.cacheOff.requestsPerSecIncludingClickDrain.median).padStart(9)} | ${String(s.cacheOn.requestsPerSecIncludingClickDrain.median).padStart(9)}`);
    console.log(`Clicks pending at end | ${String(s.cacheOff.clicksPendingWhenLoadEnded.median).padStart(10)} | ${String(s.cacheOn.clicksPendingWhenLoadEnded.median).padStart(9)}`);
    console.log(`p50 (ms)              | ${String(s.cacheOff.p50Ms.median).padStart(10)} | ${String(s.cacheOn.p50Ms.median).padStart(9)}`);
    console.log(`p95 (ms)              | ${String(s.cacheOff.p95Ms.median).padStart(10)} | ${String(s.cacheOn.p95Ms.median).padStart(9)}`);
    console.log(`p99 (ms)              | ${String(s.cacheOff.p99Ms.median).padStart(10)} | ${String(s.cacheOn.p99Ms.median).padStart(9)}`);
    console.log(`\nResults written to ${path.relative(process.cwd(), opts.out)}`);
    console.log(failed ? '\nSOME RUNS FAILED VALIDATION - do not use these numbers.' : '\nAll runs passed validation.');

    await redis.quit();
    await pool.end();
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
