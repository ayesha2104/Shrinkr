# Shrinkr Redirect Benchmark

Measures what the Redis read-through cache changes on the redirect path (`GET /:shortCode`): how many
PostgreSQL queries it issues and how long redirects take, with the cache **OFF** vs **ON**.

> **Read this first.**
> - There are two independent sets of measurements. The sections from *Environment* to *Interpretation*
>   report **sandbox results: 2 vCPU, native PostgreSQL 16.13 + Redis 7.0.15, not containerized, not a
>   laptop.** Postgres, Redis, the app and the load generator all shared those 2 vCPUs, over loopback, with
>   100 rows in the table. The section [Independent reproduction — user's laptop](#independent-reproduction--users-laptop)
>   reports a separate re-run on the user's Windows 11 laptop with PostgreSQL 16.15 and Redis 7.4.9 in
>   Docker Desktop. Neither set is production performance: both are single-machine, loopback, synthetic
>   100-URL runs of one app process.
> - The headline lookup reduction (**98.88%** in the sandbox, **98.86%** in the latest laptop run) is the
>   reduction in **PostgreSQL URL lookup queries** only. It is **not** a reduction in overall database load:
>   every redirect still writes one click-count `UPDATE` (total DB queries fell **49.44%** in the sandbox and
>   **49.43%** on the laptop).
> - The lookup-query reduction is the repeatable result: it appeared in every sandbox and laptop run. The
>   latency and throughput results did **not** reproduce consistently. Laptop performance varies between
>   rounds and between runs (the latest laptop run's cache-OFF rounds alone spanned 894.72–1,358.14
>   requests/sec), an earlier laptop run gave materially different numbers, and the latest laptop p99 was
>   slightly worse with the cache on. Do not quote a latency or throughput improvement from the laptop.

## Environment

> This section, and the Cache OFF, Cache ON, Comparison and Interpretation sections that follow, describe the
> **sandbox** runs. The laptop's environment and results are in
> [Independent reproduction — user's laptop](#independent-reproduction--users-laptop).

| Item | Value |
|---|---|
| Label (as recorded by the tool) | `sandbox, 2 vCPU, native PostgreSQL 16.13 + Redis 7.0.15, not containerized, not my laptop` |
| OS | Linux 6.18.44-fc-v37 (x64), cloud sandbox VM |
| CPU | Intel Xeon @ 2.80 GHz, 2 vCPU (the whole stack shares them) |
| RAM | 7.84 GiB |
| Node.js / npm | v22.22.2 / 10.9.7 |
| PostgreSQL | 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1), default `initdb` config: `shared_buffers=128MB`, `fsync=on`, `synchronous_commit=on`, `max_connections=100`, `log_statement=none`. Server-side SSL was on, but the benchmark connected with `DB_SSL=false`. |
| Redis | 7.0.15, `--save "" --appendonly no`, no `maxmemory` (no eviction) |
| Load generator | Built-in Node `http` module (`scripts/bench/run.js`), 20 keep-alive connections. **autocannon was not used** (npm was unreachable in the sandbox). |
| Docker | **Not used.** Postgres and Redis were installed natively. |
| Network | Loopback only (`127.0.0.1`); no network latency |
| Shrinkr commit | **Not available.** The sandbox copy was not a git repository, so the result files record `git.head: "unavailable"`. The runs used the Task #1 working tree before it was committed. The table below identifies the exact code by hash instead. |

Code that was measured (first 12 hex characters of SHA-256):

| File | sha256[:12] | File | sha256[:12] |
|---|---|---|---|
| `index.js` | `c8511d010254` | `scripts/bench/run.js` | `ba3dfecc2be7` |
| `src/controllers/urlController.js` | `8841d6f5b9e7` | `scripts/bench/localEnv.js` | `1e05afcde1d5` |
| `src/utils/urlCache.js` | `266b1bbe8e90` | `scripts/bench/seed.js` | `ff415de06ca6` |
| `src/utils/queryStats.js` | `e04e955928d1` | `scripts/bench/schema.sql` | `460b7b720132` |
| `src/config/db.js` | `30e9c7abf18a` | `test/redirect-cache.test.js` | `af062cb1c3bb` |
| `src/config/redis.js` | `8b22bdc40821` | `src/middlewares/rateLimiter.js` | `328b623837c2` |

Two complete runs were made on this machine, with identical parameters and identical code:

- **Run A** (2026-09-20 17:46 UTC), the primary run: `docs/benchmark-results.json`
- **Run B** (2026-09-20 17:58 UTC), a verification re-run after the sandbox was restarted:
  `docs/benchmark-results.rerun.json`

Both are reported in full. Neither was chosen for being more favourable; Run A was designated the
primary run before Run B was made.

### Isolation

The tooling can only reach throwaway local services. `scripts/bench/localEnv.js` (loaded first by the
seed script, the benchmark and the tests):

- never reads `.env` (it neuters `dotenv` in-process, and the benchmark spawns the app from an empty
  temporary directory),
- pins every connection variable from `BENCH_*` overrides or local defaults, ignoring any `DB_HOST` /
  `REDIS_HOST` exported in your shell,
- refuses to run unless the database and Redis hosts are loopback addresses, and refuses
  `NODE_ENV=production`.

The benchmark never uses `FLUSHALL`; it deletes only `url:*` keys.

## Dataset and workload

- **100 URLs** in the real `urls` table: `bench000` … `bench099`, all private (`is_public=false`), all
  non-expired. Created by `npm run benchmark:seed` (one `INSERT … SELECT generate_series(…)`, idempotent,
  touches only `bench%` rows). Private on purpose: redirects ignore `is_public`, as in production.
- **10,000 redirect requests** per run, sent over **20 keep-alive connections**.
- **80/20 skew:** 20 URLs (`bench000`–`bench019`, the "hot" set) receive **exactly 8,000** requests
  (80%). The other 80 URLs share the remaining 2,000 (20%). Within each group the choice is uniform. This
  is a two-tier skew, not a Zipf distribution.
- The request sequence comes from a seeded PRNG (`mulberry32`, seed 42) and is shuffled. Every run and
  both modes replay **the identical sequence**. All 100 URLs are touched in every run.
- **Cache OFF:** the app starts with `REDIRECT_CACHE_ENABLED=false`, so the redirect path issues no Redis
  commands at all. Verified per run with Redis's own `INFO commandstats`: 0 `GET`, 0 `SET`, 0 `url:*` keys
  afterwards.
- **Cache ON:** `REDIRECT_CACHE_ENABLED=true`, starting from a **cold** cache. Before **every** run (both
  modes) all `url:*` keys are deleted with `SCAN` + `UNLINK` and the tool checks that none remain, so a
  previous run's cached values cannot leak into the next.
- Each run uses a **fresh app process** (fresh counters and connection pool). Modes are interleaved
  (OFF, ON, OFF, ON, OFF, ON) so slow drift affects both. **3 rounds per mode per run.**
- Before each run, 300 warm-up requests go to `/health` (does not touch URLs or the cache).
- `BENCHMARK_MODE=true` disables the global rate limiter for the benchmark (see below).

### Definitions

| Term | Meaning |
|---|---|
| **URL lookup query** | A `pool.query` matching `SELECT … FROM urls WHERE short_code = …`. This is the query the cache is meant to avoid. |
| **Click update query** | `UPDATE urls SET clicks = clicks + 1 …`. Issued once per successful redirect, cache or no cache, fire-and-forget. |
| **Total DB queries** | Every `pool.query` call (the runs recorded 0 "other" queries, so total = lookups + click updates). Redis operations are never counted. |
| **Latency** | Measured by the load generator per request, from sending it until the response completes (includes Node client overhead). Percentiles use nearest-rank. Reported values are **medians of the 3 per-round values**. |
| **Requests/sec** | 10,000 ÷ time until the last **response** arrived. |
| **Sustained requests/sec** | 10,000 ÷ (that time + the time until every click write had actually been applied in PostgreSQL). See [Comparison](#comparison). |

## Commands

Prerequisites: Node 18+, and a **local throwaway** PostgreSQL and Redis. The defaults the tooling expects
(override with `BENCH_DB_HOST`, `BENCH_DB_PORT`, `BENCH_DB_USER`, `BENCH_DB_PASSWORD`, `BENCH_DB_NAME`,
`BENCH_REDIS_HOST`, `BENCH_REDIS_PORT`; hosts must be loopback):

| | Host | Port | Other |
|---|---|---|---|
| PostgreSQL | 127.0.0.1 | 55433 | user `postgres`, password `bench`, database `shrinkr_bench` |
| Redis | 127.0.0.1 | 56379 | no password |

**Option 1: Docker (`docker-compose.bench.yml`).**

> **Status: executed successfully on the user's laptop.** The file was written in an environment where Docker
> image pulls were unavailable, so it was first only syntax-checked with `docker compose config`, and the
> **sandbox** results in this document were **not** produced with these containers. It was then run on a
> Windows 11 laptop with Docker Desktop (PostgreSQL 16.15 on host port 55433, Redis 7.4.9 on host port
> 56379, both bound to `127.0.0.1`), and the laptop results below were produced with it. It has not been
> tested on other machines.

```bash
cd url-shortner
docker compose -f docker-compose.bench.yml up -d      # schema is created on first start
docker compose -f docker-compose.bench.yml ps          # wait until both are healthy
```

**Option 2:** any local PostgreSQL 16 and Redis 7 on the ports above. `npm run benchmark:seed` creates the
tables in an empty database.

**Run** (from `url-shortner/`):

```bash
npm ci
npm run benchmark:seed          # 100 URLs, safe to re-run
npm test                        # integration tests
```

```bash
# macOS / Linux / Git Bash
BENCH_ENV_LABEL="my laptop, <cpu>, <ram>, <how Postgres/Redis are run>" \
  node scripts/bench/run.js --out ../docs/benchmark-results.mine.json
```

```powershell
# Windows PowerShell
$env:BENCH_ENV_LABEL = "my laptop, <cpu>, <ram>, <how Postgres/Redis are run>"
node scripts/bench/run.js --out ../docs/benchmark-results.mine.json
```

The benchmark is run with `node scripts/bench/run.js` directly rather than `npm run benchmark --`: on the
Windows/npm setup used for the laptop reproduction, npm's argument forwarding interpreted the benchmark's CLI
flags incorrectly. (`npm run benchmark` with no flags, and `npm run benchmark:seed`, still work as scripts.)

`BENCH_ENV_LABEL` is required so a result can never be mistaken for a different machine's. Use `--out`
so you do not overwrite the committed files. Options: `--requests 10000 --rounds 3 --connections 20
--seed 42 --warmup 300`. The runner exits non-zero, and prints `INVALID`, if any run fails its
cross-checks.

**Stop and delete everything:** `docker compose -f docker-compose.bench.yml down -v`

### What every run cross-checks

A run is only reported as valid if all of these hold; every run in both result files passed:

- all 10,000 responses were `302`, and the app process survived;
- the app's click-update counter, `sum(clicks)` in PostgreSQL, and PostgreSQL's own `n_tup_upd`
  statistic all equal 10,000;
- PostgreSQL's own scan counter for the `urls` table equals lookups + click updates + the runner's own
  polling queries (the cost per poll is calibrated at start-up: 5 scans per poll on PG 16.13);
- cache OFF: lookups = 10,000 and Redis saw 0 `GET`/`SET`;
- cache ON: Redis saw exactly 10,000 `GET`s, and exactly one `SET` per lookup.

Click writes are fire-and-forget, so when the last response arrives some are still queued in the app.
The runner waits until all 10,000 are **applied in PostgreSQL** before it stops the app (an earlier version
stopped the app too early and lost 1–3% of clicks, which the cross-check caught).

## Query counter, benchmark switches and other new settings

| Setting | Default | Effect |
|---|---|---|
| `ENABLE_DEBUG_METRICS=true` | off | Mounts `GET /__debug/db-stats` and `POST /__debug/db-stats/reset`. Ignored when `NODE_ENV=production`. |
| `BENCHMARK_MODE=true` | off | Skips **only** the global rate limiter (100 requests / 15 min / IP), so a 10,000-request run isn't throttled. Must be exactly `true`; **ignored (with an error log) when `NODE_ENV=production`**. Per-route limiters stay on. |
| `REDIRECT_CACHE_ENABLED=false` | on | Redirects skip Redis entirely (no reads, no writes). Used for the cache-OFF runs. |
| `REDIS_COMMAND_TIMEOUT_MS` | 250 | Max time a redirect waits for one Redis command before falling back to PostgreSQL. |
| `DB_SSL=false` | SSL on (as before) | Only for a local Postgres with no SSL. |

Read or reset the query counter (development only):

```bash
ENABLE_DEBUG_METRICS=true node index.js
curl http://localhost:3000/__debug/db-stats
# {"total":2,"urlLookup":1,"clickUpdate":1,"other":0,"since":"…"}
curl -X POST http://localhost:3000/__debug/db-stats/reset
```

The counter wraps `pool.query` in `src/config/db.js` and classifies each statement by its SQL text
(`urlLookup`, `clickUpdate`, `other`). It counts PostgreSQL queries only, never Redis operations.

## Cache OFF

Median of 3 rounds, Run A (per-round values in brackets).

| Metric | Value |
|---|---|
| Requests | 10,000 (all `302`) |
| Duration to last response | 5,068 ms  [5,285 / 5,068 / 4,951] |
| Requests/sec | **1,973**  [1,892 / 1,973 / 2,020] |
| URL lookup queries | 10,000 |
| Click update queries | 10,000 |
| Total DB queries | 20,000 |
| p50 / p95 / p99 latency | 9.40 ms / 16.24 ms / 22.93 ms  [p99: 30.60 / 22.93 / 22.00] |
| Click writes still pending when the last response arrived | 0 (median; 2 in one round) |

## Cache ON

Median of 3 rounds, Run A.

| Metric | Value |
|---|---|
| Requests | 10,000 (all `302`) |
| Duration to last response | 2,873 ms  [2,956 / 2,838 / 2,873] |
| Requests/sec **at the last response** | 3,481  [3,383 / 3,523 / 3,481], **not a sustained rate, see below** |
| Sustained requests/sec (click writes applied) | **3,079**  [3,013 / 3,079 / 3,092] |
| URL lookup queries | **112**  [112 / 110 / 118] |
| Click update queries | 10,000 |
| Total DB queries | 10,112 |
| p50 / p95 / p99 latency | 4.77 ms / 11.25 ms / 22.70 ms  [p99: 22.70 / 22.03 / 24.08] |
| Redis commands | 10,000 `GET`, 112 `SET` (one per lookup) |
| Click writes still pending when the last response arrived | ~2,526 (25%); took about 363 ms more to drain |

Cache hit ratio = 1 − 112 ÷ 10,000 = 98.88%. The 112 lookups are 100 first-touch misses plus about 12
extra misses from concurrent requests for a not-yet-cached URL (see [After a cache flush](#3-what-happens-immediately-after-a-cache-flush)).

## Comparison

| Metric | Cache OFF | Cache ON | Change, Run A | Change, Run B (re-run) |
|---|---:|---:|---:|---:|
| **URL lookup queries** | 10,000 | 112 (Run B: 109) | **−98.88%** | −98.91% |
| Click update queries | 10,000 | 10,000 | 0% | 0% |
| **Total DB queries** | 20,000 | 10,112 (Run B: 10,109) | **−49.44%** | −49.46% |
| **p50 latency** | 9.40 ms | 4.77 ms | **−49.19%** | −48.69% (8.90 → 4.57 ms) |
| **p95 latency** | 16.24 ms | 11.25 ms | **−30.71%** | −26.21% (16.96 → 12.51 ms) |
| **p99 latency** | 22.93 ms | 22.70 ms | −1.02% (≈ unchanged) | −13.13% (24.65 → 21.42 ms) |
| **Sustained requests/sec** | 1,973 | 3,079 | **+56.1%** | +55.9% (2,019 → 3,148) |
| Requests/sec at last response (not sustained) | 1,973 | 3,481 | +76.4% | +75.8% (2,019 → 3,549) |

What to conclude, and what not to:

- **URL lookup queries: −98.9%, stable across both runs.** This is a mechanical result. It is confirmed by
  PostgreSQL's own statistics and by Redis's own command counters, and the integration test proves the
  mechanism (below).
- **This is not "98.88% less database load."** Both modes send 10,000 click `UPDATE`s. Total queries fell
  49.4%, and the database's *write* load did not fall at all.
- **p50 ≈ −49% in both runs. p95 fell 26–31%** (Run B was lower than Run A). Quote a range, not the best run.
- **p99: no reliable conclusion.** It moved −1% in Run A and −13% in Run B, and in Run A the per-round
  ranges overlap (OFF 22.0–30.6 ms, ON 22.0–24.1 ms). With 3 rounds per mode I cannot tell a real
  improvement from noise. Do not claim a p99 improvement.
- **Do not quote 3,481 requests/sec as throughput.** In the cache-ON runs about 25% of the click writes
  (~2,500) were still queued inside the app when the last response arrived, and they took another
  ~360–410 ms to drain. Counting that, the sustained rate is ~3,079 vs ~1,973 requests/sec (**+56%**, the same
  in Run B). The gap exists because the cache makes responses faster than the database can absorb the
  fire-and-forget writes.
- **This is not "90% faster."** Nothing measured here supports a 90% figure for anything. The earlier
  "90% database-load reduction" claim could not be verified from this repository and is not reproduced or
  defended by this benchmark.

## Redis failure test

**Requirement:** if Redis is down, `GET /:shortCode` must still redirect through PostgreSQL. It must not
return a 500, hang, or crash the process.

How the design achieves it (`src/config/redis.js`, `src/utils/urlCache.js`): the Redis client is created with
`disableOfflineQueue: true` (with the default, a command sent while Redis is down stays pending until it
reconnects, which would stall the redirect); the cache helpers skip Redis when `redis.isReady` is false;
every Redis command is wrapped in a try/catch and a 250 ms timeout; and Redis errors are logged with a 5 s
throttle and without connection details.

What was verified:

1. **Automated, in the repo:** `npm test` includes a test that **simulates** the outage by destroying the
   Redis client's connection, then checks the redirect returns `302` through PostgreSQL and keeps working.
   It does not kill a Redis server.
2. **Real kill/freeze checks (not in the repo):** during development an ad-hoc script, not part of this
   repository, ran against a throwaway Redis and checked: Redis killed mid-run (20/20 redirects `302`, all via
   PostgreSQL, each within a few milliseconds, process alive, one throttled error log line); Redis restarted (client
   reconnected on its own and caching resumed); Redis **frozen** with `SIGSTOP` (redirects still `302`, each
   bounded at ~504 ms = the 250 ms `GET` timeout + the 250 ms `SET` timeout, no hang); Redis down at start-up
   (server boots, redirects work, caching starts once Redis appears); the click `UPDATE` failing (redirect
   still `302`, failure logged, process alive). Treat these as development evidence, not a repeatable
   artifact, and use the manual procedure below to re-verify.

**Manual procedure** (against your throwaway Postgres/Redis; bash shown, use Git Bash or WSL on Windows):

```bash
# terminal 1: run the app against the throwaway services, from an EMPTY directory so your real .env is never loaded
cd url-shortner && npm run benchmark:seed
export DB_HOST=127.0.0.1 DB_PORT=55433 DB_USER=postgres DB_PASSWORD=bench DB_NAME=shrinkr_bench DB_SSL=false \
       REDIS_HOST=127.0.0.1 REDIS_PORT=56379 REDIS_PASSWORD= JWT_SECRET=local-only PORT=3000 ENABLE_DEBUG_METRICS=true
APP="$PWD/index.js"; cd "$(mktemp -d)" && node "$APP"

# terminal 2
code() { curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/bench001; }
curl -s -X POST localhost:3000/__debug/db-stats/reset >/dev/null
code; code                                   # 302, 302  (miss then hit)
curl -s localhost:3000/__debug/db-stats      # urlLookup: 1  (the second request did no lookup)
docker compose -f docker-compose.bench.yml stop redis    # kill Redis (or stop your local Redis)
code; code                                   # expect 302, 302 via PostgreSQL
curl -s localhost:3000/__debug/db-stats      # urlLookup: 3  (both requests fell back to PostgreSQL)
docker compose -f docker-compose.bench.yml start redis
# terminal 1 logs "Redis ready" again without a restart; then run `code` twice: lookups go up by 1, then stay flat
```

Expected: no `500`, the app process stays alive, one (not hundreds) `Redis client error` log line per
5 seconds.

## Integration test: the cache proof

`test/redirect-cache.test.js` → *"second request for the same short code performs 0 URL lookup queries"*:

1. inserts a fresh **private** URL with a random code and clears its cache key (asserts it is absent);
2. resets the query counter, makes request 1: expects `302` to the original URL, **exactly 1 URL lookup**, and
   the key now present in Redis;
3. resets the counter again, makes request 2: expects `302`, then waits until the fire-and-forget click
   `UPDATE` has been issued, and asserts **`urlLookup === 0`**, `clickUpdate === 1`, `total === 1`;
4. asserts `clicks = 2` in PostgreSQL, so the analytics write really happened.

It asserts on the **lookup category**, not on "zero queries": the click `UPDATE` legitimately still runs.
The test was mutation-checked: breaking the cache (never hitting, never populating) makes it fail, and
breaking the flag or the Redis-down protection fails the other two tests.

## Interpretation

### 1. Why 80/20?

Real link traffic is usually skewed: a few links receive most of the clicks. An 80/20 split is a common,
easy-to-state stand-in for that. It was **assumed, not measured from Shrinkr traffic.** Two honest caveats:

- In this benchmark **the skew barely matters.** With only 100 URLs and TTL = 1 hour, every URL fits in the
  cache after its first request, so misses ≈ the number of distinct URLs (100) plus a few concurrent
  duplicates, and the hit ratio is ~99% whatever the distribution. The 80/20 shape would only start to matter
  when the URL set is larger than what the cache holds or than what the TTL keeps alive.
- It is a two-tier distribution, not a measured or Zipf-shaped one.

### 2. What changes with uniform traffic over 1,000,000 URLs?

The benefit falls a lot, and can nearly vanish. The cache only helps when the same URL is requested again
before its cached copy disappears, and with uniform traffic over 1M URLs repeats are rare.

- A 10,000-request test over 1M URLs would be almost all misses (first touches), so a hit ratio near 0%, plus
  the extra cost of a failed Redis `GET` and a `SET` on every miss.
- Steady state (a back-of-envelope model, **not measured**): with Poisson arrivals at *R* requests/second
  spread uniformly over *N* URLs, a TTL of *T* seconds, and the TTL set on the miss and not refreshed by reads
  (this is how the code works), the hit ratio is *x ÷ (1 + x)* with *x = R·T ÷ N*. For R = 100 req/s,
  N = 1,000,000, T = 3,600 s: x = 0.36, hit ratio ≈ **26%**, so ≈74% of lookups still reach PostgreSQL. At
  R = 1,000 req/s the hit ratio would be ≈78%.
- Memory would also matter: a cached row here is ~206 bytes of JSON, ~280 bytes as measured by Redis
  `MEMORY USAGE` for one key. 1M such keys would be roughly 280 MB (1M × 280 B; not measured at that scale). Redis here has no `maxmemory`, so no eviction policy has been exercised.

### 3. What happens immediately after a cache flush?

Every key is gone, so the first request for each URL misses and goes to PostgreSQL, and the database briefly
carries close to the cache-OFF load (a lookup **and** a click write per request) until the hot set is
repopulated. Two effects are visible or implied here:

- **Concurrent first requests all miss.** Several requests for the same URL that arrive before the first one
  has finished its lookup and written the cache each query PostgreSQL. That is why cache ON did 108–118
  lookups for 100 distinct URLs. This is a *cache stampede*; at scale a popular URL can produce a burst of
  identical queries. **It is not mitigated in this change** (it would need request coalescing / single-flight
  or a lock).
- **Synchronised expiry.** Keys written in a burst all get the same 1 h TTL with no jitter, so they also
  expire at about the same time and can cause a second wave of misses an hour later. Not mitigated either.

### 4. Why does cache effectiveness depend on the access distribution?

Because the saving comes only from cache **hits**, and a hit needs the URL to be requested again while its key
is still in the cache. The hit ratio depends on the distribution of requests over URLs, on the request rate,
on the TTL, and on how many keys the cache can hold. Skewed traffic concentrates requests on a few keys that
are re-requested constantly (high hit ratio); uniform traffic over a huge set spreads them out so most keys
are never seen twice (low hit ratio). And a miss costs *more* than having no cache: a failed `GET` plus a
`SET`, on top of the database lookup. A workload with no repeats would get slower with a cache in front.

### 5. What does this benchmark prove, and not prove?

**It supports:**

- With this cache, on this workload, PostgreSQL URL lookups dropped by ~98.9% (10,000 → ~110), confirmed
  by PostgreSQL's and Redis's own counters, and the repeat-request behaviour is proven by an integration test
  that asserts 0 URL lookups.
- In the sandbox, median redirect latency roughly halved (~49%) and p95 dropped by about 26–31%. The laptop runs did not reproduce a stable latency improvement (run-to-run and round-to-round variation was too large), so this holds for the sandbox only.
- Sustained throughput rose about 56% once click-write draining is counted.
- Redirects survive Redis being unavailable, by falling back to PostgreSQL.

**It does not prove:**

- **Any production number.** The sandbox (2 vCPU shared by everything) and the laptop reproduction are both single-machine, loopback, no network latency.
- **A reduction in overall database load.** Total queries fell 49.4%, click **writes** are unchanged, and
  writes are the more expensive kind.
- **Any p99 improvement.** The sandbox result is unstable (−1% then −13%), and in the latest laptop run the median p99 was slightly worse with the cache on (47.84 ms vs 45.24 ms).
- **Behaviour at scale.** Only 100 URLs (Postgres used sequential scans on a 100-row table, so a lookup here is
  unusually cheap; a large table or a remote database would change both the baseline and the saving), no
  1M-URL dataset, no remote Postgres/Redis latency, one app instance (no cross-instance invalidation),
  synthetic and unmeasured traffic, and no long-running behaviour (TTL expiry, memory, eviction).
- **Statistical significance.** 3 rounds per mode (2 sandbox runs; 1 stored laptop run plus an earlier laptop run whose raw file was not kept), medians only; no confidence intervals.
- **That a 10,000-request test is representative of steady state.** It covers a cold start and ~3 seconds.
- **A comparison with other caching designs.**

## Known limitations of the implementation (documented, not fixed here)

- **Click writes are fire-and-forget.** With the cache on, ~25% (sandbox) and 776–4,164 of 10,000 (latest laptop run, by round) were queued in the app
  when the last response arrived. A crash or SIGTERM at that moment loses them; there is no graceful shutdown. Analytics are
  eventually consistent by design.
- **Cache stampede and synchronised expiry** (see above).
- **No circuit breaker.** While Redis is connected but frozen, each redirect pays the ~500 ms of timeouts.
- **`getUrlByCode`, `updateUrl` and `deleteUrl` still call Redis directly** and return `500` if Redis is down
  (for update/delete, after the database write already succeeded).

Other known issues, **out of scope for this change and untouched:** short codes use `Math.random` with no
collision handling; the global limiter allows only 100 requests per 15 minutes per IP and applies to
redirects; `backup.sql` is tracked in git; `GET /urls/:shortCode` can serve expired URLs from cache.

## Independent reproduction — user's laptop

The benchmark was re-run on the user's own Windows 11 laptop (an ASUS VivoBook 15), using
`docker-compose.bench.yml` and the benchmark tooling from the Task #1 working tree (not yet committed), with
no changes to the application code or the benchmark methodology. These results are **separate from, and do
not replace,** the sandbox results above. This section reports the **latest completed laptop run**, stored in
`docs/benchmark-results.mine.json` (generated 2026-09-20T19:45:04.306Z). The sandbox result files were not touched.

> **Laptop performance varies from run to run, and these are not production numbers.** Local laptop, Docker
> Desktop, loopback services, a synthetic workload, a single app process, 100 URLs, no production traffic, no
> production hardware, and no multi-instance deployment. Treat the latency and throughput figures below as
> one observation of a noisy machine, not as the performance of the cache. The repeatable finding is the
> reduction in PostgreSQL URL-lookup queries. See [Limitations of this reproduction](#limitations-of-this-reproduction).

**An earlier laptop run exists and is not used here.** The same laptop was benchmarked before this run,
and that run's latency and throughput numbers were materially different (more favourable to the cache) from
the ones below. Its raw output is no longer stored in this repository, so it cannot be re-checked. It is deliberately **not** presented as the definitive local result. Both runs showed
the same ~99% reduction in URL-lookup queries.

### Environment (laptop)

| Item | Value |
|---|---|
| Machine | ASUS VivoBook 15 |
| Label (as recorded by the tool) | `ASUS VivoBook 15, Windows 11, Docker Desktop, PostgreSQL 16 + Redis 7` |
| CPU | 12th Gen Intel Core i5-1235U (10 physical cores / 12 logical CPUs; the tool recorded `x12`) |
| RAM | 7.69 GiB |
| OS | Windows 11, build 10.0.26200 (x64) |
| Node.js | v22.21.1 (the tool could not record the npm version) |
| PostgreSQL | 16.15 (Debian 16.15-1.pgdg13+2), in Docker Desktop (`postgres:16` from `docker-compose.bench.yml`). Settings recorded by the tool: `fsync=on`, `synchronous_commit=on`, `shared_buffers=128MB`, `max_connections=100`, `log_statement=none`, `ssl=off`. |
| Redis | 7.4.9, in Docker Desktop (`redis:7`, `--save "" --appendonly no`) |
| Benchmark target | PostgreSQL `127.0.0.1:55433`, Redis `127.0.0.1:56379`; both containers bound to `127.0.0.1` only |
| Load generator | Built-in Node `http` module (`scripts/bench/run.js`), 20 keep-alive connections |
| Shrinkr commit | Recorded as `0c05414` (the last commit) with uncommitted changes: the Task #1 working tree, before it was committed. |
| Not recorded | Power mode / plugged-in state, background load, and Docker Desktop resource limits. |

`docker-compose.bench.yml` **was executed successfully** here (it had previously only been syntax-checked):
both containers ran, and the benchmark connected to them on the documented ports (55433 and 56379) and
passed its cross-checks. The runner's start-up calibration found 1 table scan per poll on this
PostgreSQL 16.15 (5 on 16.13 in the sandbox); the scan-count cross-check uses the calibrated value.

### How it was run

From `url-shortner/`, in Windows PowerShell, with the containers up and the database seeded
(`npm run benchmark:seed`):

```powershell
$env:BENCH_ENV_LABEL = "ASUS VivoBook 15, Windows 11, Docker Desktop, PostgreSQL 16 + Redis 7"
node scripts/bench/run.js --out ../docs/benchmark-results.mine.json --requests 10000 --rounds 3 --connections 20 --seed 42 --warmup 300
```

The benchmark is started with `node scripts/bench/run.js` directly rather than `npm run benchmark --`,
because on this Windows/npm setup npm's argument forwarding interpreted the benchmark's CLI flags
incorrectly. (This was observed on the laptop; the cause was not investigated.) The runner is the same file
either way.

That is: **10,000 redirect requests per run; 100 URLs; 80/20 skew** (20 hot URLs receive exactly 8,000
requests); **20 keep-alive connections; seed 42; 3 rounds each of cache OFF and cache ON** (interleaved
OFF, ON, OFF, ON, OFF, ON; every run starts from a fresh app process and an emptied `url:*` cache);
**300 warm-up requests** to `/health` before each run. The workload and the definitions are exactly those in
[Dataset and workload](#dataset-and-workload).

### Cross-checks

All six runs (3 OFF, 3 ON) passed every cross-check listed under
[What every run cross-checks](#what-every-run-cross-checks): 10,000 `302` responses per run with no other
status and no app error-log lines; the app survived; click updates counted by the app, `sum(clicks)`
in PostgreSQL and PostgreSQL's `n_tup_upd` all equal 10,000; PostgreSQL's table-scan delta equals lookups +
click updates + the runner's calibrated polls; cache OFF saw 0 Redis `GET`/`SET`; cache ON saw exactly
10,000 `GET`s and one `SET` per lookup, with 100 `url:*` keys left afterwards. `validationProblems` is empty for
every run.

### Median over the 3 rounds

| Metric (median of 3 rounds) | Cache OFF | Cache ON | Change |
|---|---:|---:|---:|
| **URL lookup queries** | 10,000 | 114 | **−98.86%** |
| Click update queries | 10,000 | 10,000 | 0% |
| **Total DB queries** | 20,000 | 10,114 | **−49.43%** |
| p50 latency | 20.624 ms | 15.704 ms | varies by round (see below) |
| p95 latency | 30.854 ms | 29.845 ms | varies by round (see below) |
| p99 latency | 45.24 ms | 47.84 ms | slightly worse with the cache on |
| Response req/s (at last response, not sustained) | 943.94 | 1,129.18 | varies by round (see below) |
| Req/s including click drain (sustained) | 942.67 | 1,071.95 | varies by round (see below) |
| Click writes still queued when the last response arrived | — | 1,109 | (before draining) |

Medians are taken per metric independently, so a median p99 does not correspond to a single round. Only the
two query-count rows are treated as results; the latency and throughput rows are reported as measured and are
not summarised as percentages because of the round-to-round spread shown next.

### The three rounds, as measured

| Round | Cache | Response req/s | Req/s incl. click drain | p50 (ms) | p95 (ms) | p99 (ms) | URL lookups | Click writes still queued at last response |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | OFF | 943.94 | 942.67 | 20.624 | 30.714 | 48.094 | 10,000 | 0 |
| 1 | ON | 992.16 | 956.40 | 19.509 | 30.861 | 50.046 | 114 | 776 |
| 2 | OFF | 894.72 | 893.85 | 22.020 | 32.933 | 45.240 | 10,000 | 0 |
| 2 | ON | 1,129.18 | 1,071.95 | 15.704 | 29.845 | 47.840 | 114 | 1,109 |
| 3 | OFF | 1,358.14 | 1,345.35 | 11.996 | 30.854 | 45.074 | 10,000 | 11 |
| 3 | ON | 3,219.34 | 2,150.60 | 4.982 | 9.398 | 31.492 | 129 | 4,164 |

"Req/s incl. click drain" is the sustained figure (see [Definitions](#definitions)); "Response req/s" stops the
clock at the last response and is **not** a sustained rate. Values are copied from the result file.

The spread is the point. **Cache OFF alone** ran at 943.94, 894.72 and 1,358.14 requests/sec in its three
rounds, and its p50 ranged from 11.996 to 22.02 ms, with identical code, identical requests and no cache.
Round 3 was much faster than rounds 1 and 2 in **both** modes. Differences between the ON and OFF medians
are therefore of the same order as the machine's own run-to-run variation, and no latency or throughput
improvement should be claimed from this run.

### Interpretation

- **The repeatable finding is the ~99% reduction in PostgreSQL URL-lookup queries.** With the cache off every
  redirect did a lookup (10,000). With it on there were 114, 114 and 129 (median 114, **−98.86%**). This is a
  mechanical result, confirmed by PostgreSQL's and Redis's own counters, and it appeared in both laptop runs
  and in both sandbox runs. The lookups above the 100 distinct URLs are concurrent requests for a not-yet-cached
  URL (see [After a cache flush](#3-what-happens-immediately-after-a-cache-flush)).
- **It is not a 99% reduction in database load.** Every redirect still runs one click `UPDATE` (10,000 in both
  modes), so total queries fell by **49.43%** (20,000 → 10,114).
- **Latency and throughput are not established by this run.** For p50, p95 and throughput, the spread
  between rounds was larger than the difference between the ON and OFF medians, and the numbers differed
  materially from the earlier laptop run. The p99 median was slightly worse with the cache on (47.84 ms vs 45.24 ms); there is no p99 improvement
  to claim.
- **The cause of the round-to-round variation was not investigated.** Conditions that could matter, such as
  power mode, background load and Docker Desktop resource scheduling, were **not measured** and therefore are
  **not conclusions**. Nothing was changed in response.
- **Click writes lag behind responses when the cache is on.** 776, 1,109 and 4,164 of the 10,000 click writes were
  still queued when the last response arrived (median 1,109), and the response rate overstates what the
  system sustained. This is why "requests/sec including click drain" is the figure to use if a throughput
  number is ever quoted.
- **Do not call any of this "2x faster" or "90% faster".** Nothing measured here supports it.
- **Compared with the sandbox:** the lookup reduction is essentially the same (−98.86% vs −98.88% and
  −98.91%). Latency and throughput are not compared, because they are not stable enough on the laptop to compare.

### Limitations of this reproduction

- A **local laptop** running Docker Desktop, not a server.
- Laptop performance **varies between runs and between rounds** (see above); one stored run, plus an earlier run
  whose raw output was not kept and whose numbers differed materially.
- PostgreSQL and Redis on **loopback** in containers on the same machine: no network latency between the
  app and either service.
- The app, the load generator, PostgreSQL and Redis all **share one machine**.
- A **synthetic workload**: a seeded two-tier 80/20 skew over **100 URLs**, not real traffic.
- A **single app process**; **no multi-instance deployment**, so no cross-instance cache behaviour.
- A 100-row table, where a PostgreSQL lookup is unusually cheap.
- **No production traffic and no production hardware** were involved, and none of these numbers is a
  production result.
- 3 rounds per mode and medians only; no confidence intervals or significance tests.
- It measures a cold start and a few seconds of load, not steady-state behaviour over TTL expiry.

## Reproduce it yourself

Follow [Commands](#commands) on your own machine and record the results here (leave the sandbox rows above
untouched):

| Environment | Date | Run by | Lookup queries OFF → ON | p50 OFF → ON | p95 OFF → ON | p99 OFF → ON | Sustained req/s OFF → ON |
|---|---|---|---|---|---|---|---|
| ASUS VivoBook 15, Windows 11, i5-1235U, 7.69 GiB, Postgres 16.15 + Redis 7.4.9 in Docker Desktop (latest run, median of 3 rounds) | 2026-09-20 | the user | 10,000 → 114 | 20.624 → 15.704 ms | 30.854 → 29.845 ms | 45.24 → 47.84 ms (slightly worse) | 942.67 → 1,071.95 (varies by round) |

Compare like with like: the **lookup-query reduction** should land close to the sandbox numbers (it did:
−98.86% on the laptop vs −98.88% / −98.91% in the sandbox); **latency and throughput values will differ**
with your hardware, and on the laptop they also differed from run to run and round to round. The claim that
survived the independent re-runs is the lookup-query reduction. Latency, p99 and sustained-throughput changes did
not reproduce consistently, so do not lead with them.
