require('dotenv').config();
const { createClient } = require('redis');

const options = {
    // Fail fast instead of queueing commands while Redis is down or reconnecting.
    // With the default (queueing), a redirect would hang until Redis came back.
    // A rejected command is treated as a cache miss by utils/urlCache.js.
    disableOfflineQueue: true,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
};

// Send AUTH only when a password is configured (managed Redis). A local, password-less
// Redis rejects AUTH. When REDIS_PASSWORD is set this is identical to the previous config.
if (process.env.REDIS_PASSWORD) {
    options.username = 'default';
    options.password = process.env.REDIS_PASSWORD;
}

const client = createClient(options);

// The client emits an 'error' on every failed reconnect attempt; log at most one per 5s.
// Only code/message are logged - never the connection options (they contain the password).
let lastErrorLogAt = 0;
client.on('error', (err) => {
    const now = Date.now();
    if (now - lastErrorLogAt < 5000) return;
    lastErrorLogAt = now;
    console.error(`Redis client error: ${err.code || err.name}: ${err.message}`);
});
client.on('ready', () => console.log('Redis ready'));
client.on('end', () => console.log('Redis connection closed'));

// Deliberately NOT connected on import: index.js calls client.connect() at startup,
// and tests/scripts decide for themselves whether they want a Redis connection.
module.exports = client;
