// Redis read-through cache for URL rows, used by the redirect handler.
//
// Design rule: the cache is an optimisation, never a dependency. Every function
// here resolves (never throws) and reports "no cached value" / "not stored" when
// Redis is down, slow, or returns garbage, so callers fall back to PostgreSQL.
//
// Cache key and value shape are shared with getUrlByCode/updateUrl/deleteUrl in
// urlController.js: key `url:<shortCode>`, value = the full `urls` row as JSON.

const redis = require('../config/redis');

const TTL_SECONDS = 3600; // 1 hour, same as before
const COMMAND_TIMEOUT_MS = Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || 250;

const cacheKey = (shortCode) => `url:${shortCode}`;

// REDIRECT_CACHE_ENABLED=false makes the redirect path skip Redis entirely (no reads, no writes).
// It exists so the benchmark can measure "cache OFF" on the same code. Default: enabled.
// Read on every call (not once at startup) so tests can toggle it.
const cacheEnabled = () => process.env.REDIRECT_CACHE_ENABLED !== 'false';

// Log at most one cache problem per 5 seconds so an outage under load doesn't flood the logs.
let lastLogAt = 0;
let suppressed = 0;
function logCacheProblem(operation, err) {
    const now = Date.now();
    if (now - lastLogAt < 5000) {
        suppressed += 1;
        return;
    }
    const extra = suppressed > 0 ? ` (+${suppressed} similar errors suppressed)` : '';
    console.error(`Redis cache ${operation} failed, falling back to PostgreSQL: ${err.name}: ${err.message}${extra}`);
    lastLogAt = now;
    suppressed = 0;
}

// A connected-but-unresponsive Redis would otherwise stall every redirect.
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis command timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Returns the cached URL row, or null on a miss OR whenever Redis can't answer.
async function getCachedUrl(shortCode) {
    // Cache disabled, or Redis down / still (re)connecting: don't even try, go straight to PostgreSQL.
    if (!cacheEnabled() || !redis.isReady) return null;
    try {
        const raw = await withTimeout(redis.get(cacheKey(shortCode)), COMMAND_TIMEOUT_MS);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Anything that isn't a row-shaped object (e.g. "null", "42", a truncated write) counts as a miss.
        return parsed && typeof parsed === 'object' && typeof parsed.original_url === 'string' ? parsed : null;
    } catch (err) {
        logCacheProblem('get', err);
        return null;
    }
}

// Best-effort write. Returns true if stored, false otherwise.
async function setCachedUrl(shortCode, urlData) {
    if (!cacheEnabled() || !redis.isReady) return false;
    try {
        await withTimeout(
            redis.set(cacheKey(shortCode), JSON.stringify(urlData), { EX: TTL_SECONDS }),
            COMMAND_TIMEOUT_MS
        );
        return true;
    } catch (err) {
        logCacheProblem('set', err);
        return false;
    }
}

// Best-effort invalidation after a write (update/delete). Returns true if the key is gone from Redis.
// Unlike get/set this does NOT honour REDIRECT_CACHE_ENABLED: deleting is always safe and keeps the
// cache clean if the flag is flipped back on. If Redis can't be reached the committed database write
// still stands; the stale entry then lives until its TTL (<= 1h), which is logged so it is visible.
async function invalidateCachedUrl(shortCode) {
    if (!redis.isReady) {
        logCacheProblem('invalidate', new Error('Redis not ready; entry may stay stale until its TTL expires'));
        return false;
    }
    try {
        await withTimeout(redis.del(cacheKey(shortCode)), COMMAND_TIMEOUT_MS);
        return true;
    } catch (err) {
        logCacheProblem('invalidate', err);
        return false;
    }
}

module.exports = { getCachedUrl, setCachedUrl, invalidateCachedUrl, cacheKey, TTL_SECONDS };
