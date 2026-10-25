const express = require('express');
const passport = require('passport');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/user');
const PendingSignup = require('../models/PendingSignup');
const Entitlement = require('../models/Entitlement');
const { getJwtSecret } = require('../config/secret');

const SUB_PRODUCT_ID = 'com.phoenix.sub.monthly';
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public client IDs from capacitor.config.ts (client IDs are not secrets).
const DEFAULT_GOOGLE_AUDIENCES = [
  '108585498879-v35d0d196d4djglodbbjok452pr1e04r.apps.googleusercontent.com',
  '108585498879-o171u9a80ssqfkojpd8hohgq6dumk0iu.apps.googleusercontent.com'
];

function generateToken(user) {
  return jwt.sign({ id: user._id ? user._id : user.id }, getJwtSecret(), { expiresIn: '30d' });
}

function generatePendingToken(pendingId) {
  return jwt.sign({ pending: true, pendingId }, getJwtSecret(), { expiresIn: '30m' });
}

// Strip secrets and attach server-derived entitlement state.
async function publicUser(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.pushSubscriptions;
  const now = new Date();
  const sub = await Entitlement.findOne({
    userId: user._id, productId: SUB_PRODUCT_ID,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }).lean();
  obj.hasActiveSub = !!sub;
  obj.isSubscribed = !!sub;
  return obj;
}

// Auth middleware for the username step: the bearer token must be a pending
// token whose server-side PendingSignup record still exists.
async function requirePending(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Pending signup token required.' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (!payload.pending || !payload.pendingId) throw new Error('not pending');
    const pending = await PendingSignup.findById(payload.pendingId);
    if (!pending) return res.status(401).json({ message: 'Signup session expired. Please start again.' });
    req.pending = pending;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Signup session expired. Please start again.' });
  }
}

async function usernameTaken(username) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!(await User.findOne({ username: new RegExp(`^${escaped}$`, 'i') }).lean());
}

// Step 1 of email signup: validate and park a server-side pending record.
// Nothing sensitive ever travels inside the token (audit bug 18).
router.post('/register', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Please enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'An account with this email already exists. Log in instead.' });

    const passwordHash = await bcrypt.hash(password, 10);
    await PendingSignup.deleteMany({ email });
    const pending = await PendingSignup.create({ email, passwordHash });

    res.status(201).json({
      user: { isTemp: true, email },
      token: generatePendingToken(pending._id)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login: returns { user, token }. The client stores the token and sends it
// as a Bearer header on every later call (audit bug 5).
router.post('/login', (req, res, next) => {
  passport.authenticate('local', { session: false }, async (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ message: info?.message || 'Login failed' });
    const pub = await publicUser(user);
    res.json({ user: pub, token: generateToken(user) });
  })(req, res, next);
});

// Step 2 of signup (email or Google): pick a unique display name, which
// creates the real account in one step.
router.post('/complete-signup', requirePending, async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ message: 'Username must be 3-16 characters: letters, numbers, underscore.' });
    }
    if (await usernameTaken(username)) {
      return res.status(400).json({ message: 'That username is taken. Try another.' });
    }
    const pending = req.pending;
    if (pending.email) {
      const clash = await User.findOne({ email: pending.email });
      if (clash) return res.status(400).json({ message: 'An account with this email already exists. Log in instead.' });
    }
    const user = new User({
      username,
      email: pending.email,
      // Already a bcrypt hash; the model's pre-save hook leaves hashes alone.
      password: pending.passwordHash,
      googleId: pending.googleId
    });
    await user.save();
    await PendingSignup.findByIdAndDelete(pending._id);
    const pub = await publicUser(user);
    res.status(201).json({ user: pub, token: generateToken(user) });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'That username or email is already in use.' });
    res.status(500).json({ message: err.message });
  }
});

// Google web flow
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

router.get('/google/callback', (req, res, next) => {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:4200';
  passport.authenticate('google', { session: false }, async (err, user) => {
    if (err || !user) return res.redirect(`${frontend}/login?error=google`);
    try {
      if (user.isPendingGoogle) {
        await PendingSignup.deleteMany({ $or: [{ googleId: user.googleId }, { email: user.email }] });
        const pending = await PendingSignup.create({ googleId: user.googleId, email: user.email });
        return res.redirect(`${frontend}/login?mode=set-username&token=${generatePendingToken(pending._id)}`);
      }
      return res.redirect(`${frontend}/login?token=${generateToken(user)}`);
    } catch (e) {
      return res.redirect(`${frontend}/login?error=google`);
    }
  })(req, res, next);
});

// Google native flow (Capacitor Google Auth plugin sends an ID token)
router.post('/google/native', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'idToken required' });
    const audiences = process.env.GOOGLE_CLIENT_IDS
      ? process.env.GOOGLE_CLIENT_IDS.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_GOOGLE_AUDIENCES;
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = (payload.email || '').toLowerCase();

    let user = await User.findOne({ googleId });
    if (!user && email) user = await User.findOne({ email });
    if (user) {
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
      const pub = await publicUser(user);
      return res.json({ user: pub, token: generateToken(user) });
    }
    await PendingSignup.deleteMany({ $or: [{ googleId }, { email }] });
    const pending = await PendingSignup.create({ googleId, email });
    res.json({ user: { isTemp: true, email }, token: generatePendingToken(pending._id) });
  } catch (err) {
    res.status(401).json({ message: 'Google sign-in could not be verified.' });
  }
});

router.get('/user', passport.authenticate('jwt', { session: false }), async (req, res) => {
  res.json(await publicUser(req.user));
});

// Cloud sync with server-side economy guardrails (audit bug 19).
// The client may report progress, but it may not mint premium state:
//  - coin and gem balances may only grow by capped deltas per sync
//  - gem-priced cosmetics and doublers may only flip on when the same sync
//    shows the gem cost actually being spent
//  - hasRemoveAds, subscription state, boost, and revive-token increases are
//    granted ONLY by /api/billing/verify and /api/ads/ssv and are ignored here
router.post('/sync', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const b = req.body || {};
    const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    const prevCoins = user.coins || 0;
    const prevGems = user.gems || 0;

    if (b.level !== undefined) user.level = clamp(Math.floor(num(b.level, user.level)), 0, 100000);
    if (b.xp !== undefined) user.xp = clamp(Math.floor(num(b.xp, user.xp)), 0, 1e12);
    if (b.coins !== undefined) {
      const want = clamp(Math.floor(num(b.coins, prevCoins)), 0, 1e10);
      user.coins = want > prevCoins ? Math.min(want, prevCoins + 5000000) : want;
    }
    if (b.gems !== undefined) {
      const want = clamp(Math.floor(num(b.gems, prevGems)), 0, 1e9);
      user.gems = want > prevGems ? Math.min(want, prevGems + 1000) : want;
    }
    const gemSpend = Math.max(0, prevGems - (typeof b.gems === 'number' ? Math.floor(b.gems) : prevGems));

    if (Array.isArray(b.unlockedWorlds)) {
      const merged = new Set([...(user.unlockedWorlds || []), ...b.unlockedWorlds.filter(n => Number.isInteger(n) && n >= 0 && n <= 9)]);
      user.unlockedWorlds = [...merged].sort((a, c) => a - c);
    }
    if (b.worldUpgrades && typeof b.worldUpgrades === 'object') {
      const json = JSON.stringify(b.worldUpgrades);
      if (json.length < 2_000_000) user.worldUpgrades = b.worldUpgrades;
    }
    if (Array.isArray(b.trophies)) user.trophies = [...new Set([...(user.trophies || []), ...b.trophies.map(String).slice(0, 200)])];
    if (Array.isArray(b.unlockedEnemies)) user.unlockedEnemies = [...new Set([...(user.unlockedEnemies || []), ...b.unlockedEnemies.map(String).slice(0, 200)])];

    // Gem-priced unlocks: honoured only when the gems left the balance.
    const gemGated = [
      ['hasCosmicTrail', 200], ['hasGoldenAura', 300], ['hasCelestialShield', 400]
    ];
    for (const [field, cost] of gemGated) {
      if (b[field] === true && !user[field] && gemSpend >= cost) user[field] = true;
      if (b[field] === false) user[field] = false;
    }
    if (b.toggleCosmicTrail !== undefined) user.toggleCosmicTrail = !!b.toggleCosmicTrail;
    if (b.toggleGoldenAura !== undefined) user.toggleGoldenAura = !!b.toggleGoldenAura;
    if (b.toggleCelestialShield !== undefined) user.toggleCelestialShield = !!b.toggleCelestialShield;
    if (b.coinMultiplier === 2 && user.coinMultiplier !== 2 && gemSpend >= 50) user.coinMultiplier = 2;
    if (b.xpMultiplier === 2 && user.xpMultiplier !== 2 && gemSpend >= 50) user.xpMultiplier = 2;
    if (b.hasPurchasedGems === true) user.hasPurchasedGems = true;

    if (b.pendingCratesCount !== undefined) user.pendingCratesCount = clamp(Math.floor(num(b.pendingCratesCount, user.pendingCratesCount)), 0, 3);
    if (typeof b.lastCrateMonth === 'string') user.lastCrateMonth = b.lastCrateMonth.slice(0, 7);
    if (b.acceptedLegalPolicies === true) user.acceptedLegalPolicies = true;

    // Revive tokens may only ever decrease through sync (spending). Increases
    // come from verified ad rewards and purchases only.
    if (b.reviveTokens !== undefined) {
      user.reviveTokens = clamp(Math.floor(num(b.reviveTokens, user.reviveTokens)), 0, user.reviveTokens || 0);
    }

    // Battle stats are personal bests: keep the better value.
    for (const f of ['battleHighscore', 'battleBestTime', 'battleBestCoins']) {
      if (b[f] !== undefined) user[f] = Math.max(user[f] || 0, clamp(Math.floor(num(b[f], 0)), 0, 1e10));
    }

    user.lastActiveAt = new Date();
    await user.save();
    res.json(await publicUser(user));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/logout', (req, res) => {
  res.json({ success: true });
});

router.post('/accept-policies', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    req.user.acceptedLegalPolicies = true;
    await req.user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Account deletion (Play requirement). Removes the account and its grants.
router.delete('/user', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const id = req.user._id;
    await Entitlement.deleteMany({ userId: id });
    await User.findByIdAndDelete(id);
    res.json({ success: true, message: 'Account deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
