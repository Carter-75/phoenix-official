const crypto = require('crypto');

// Single source of truth for the JWT secret.
// Audit bug 18: the old code fell back to the literal string 'secret'.
// Now: SESSION_SECRET or JWT_SECRET from the environment. In production a
// missing secret is a boot failure. In development we generate an ephemeral
// per-boot secret (tokens simply stop working across restarts) and warn.
let cached = null;

function getJwtSecret() {
  if (cached) return cached;
  const fromEnv = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cached = fromEnv;
    return cached;
  }
  const isProd = process.env.PRODUCTION === 'true' || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  if (isProd) {
    throw new Error('SESSION_SECRET (min 16 chars) must be set in production. Refusing to sign tokens with a fallback secret.');
  }
  cached = crypto.randomBytes(32).toString('hex');
  console.warn('WARN: SESSION_SECRET not set. Using an ephemeral dev secret; tokens will not survive a restart.');
  return cached;
}

module.exports = { getJwtSecret };
