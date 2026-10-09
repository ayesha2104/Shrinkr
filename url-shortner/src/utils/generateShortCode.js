const crypto = require('crypto');

const CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;

// Uses crypto.randomInt (CSPRNG, unbiased) rather than Math.random so codes are not predictable.
// Uniqueness is NOT guaranteed here: the UNIQUE constraint on urls.short_code is the source of
// truth, and createUrl retries on a collision.
const generateShortCode = () => {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CHARACTERS[crypto.randomInt(CHARACTERS.length)];
    }
    return code;
};

module.exports = generateShortCode;
