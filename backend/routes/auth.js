const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { signUser, signPendingGoogle, requireAuth, verifyPending } = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client();

function googleAudiences() {
  return (process.env.GOOGLE_CLIENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanUsername(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

async function usernameTaken(username, exceptId) {
  const found = await User.findOne({ usernameLower: username.toLowerCase() });
  return !!found && (!exceptId || found._id.toString() !== exceptId.toString());
}

// Live display-name availability check used by the signup form.
router.get('/username-available', async (req, res) => {
  try {
    const username = cleanUsername(req.query.username);
    if (!User.USERNAME_RE.test(username)) {
      return res.json({ available: false, reason: 'Use 3 to 16 letters, numbers, or underscores.' });
    }
    const taken = await usernameTaken(username);
    return res.json({ available: !taken, reason: taken ? 'That name is taken.' : null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Register with email + password + display name. Creates the real account in one step.
router.post('/register', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    const username = cleanUsername(req.body.username);
    if (!email || !email.includes('@')) return res.status(400).json({ message: 'Enter a valid email.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password needs at least 8 characters.' });
    if (!User.USERNAME_RE.test(username)) {
      return res.status(400).json({ message: 'Name must be 3 to 16 letters, numbers, or underscores.' });
    }
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: 'That email already has an account. Sign in instead.' });
    }
    if (await usernameTaken(username)) {
      return res.status(400).json({ message: 'That name is taken. Pick another.' });
    }
    const user = await User.create({
      email,
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: await User.hashPassword(password),
      acceptedLegalPolicies: !!req.body.acceptedLegalPolicies,
    });
    return res.status(201).json({ user: user.toPublicJSON(), token: signUser(user) });
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ message: 'Email or name already in use.' });
    return res.status(500).json({ error: err.message });
  }
});

// Login with email + password.
router.post('/login', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    const password = req.body.password || '';
    const user = await User.findOne({ email });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: 'No password account for that email. Try Google sign-in.' });
    }
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Wrong email or password.' });
    }
    user.lastActiveAt = new Date();
    await user.save();
    return res.json({ user: user.toPublicJSON(), token: signUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Google native sign-in: client sends the Google ID token, server verifies it.
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'No Google ID token provided.' });
    const audiences = googleAudiences();
    if (audiences.length === 0) {
      return res.status(503).json({ message: 'Google sign-in is not configured on the server yet.' });
    }
    const ticket = await googleClient.verifyIdToken({ idToken, audience: audiences });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return res.status(401).json({ message: 'Google token could not be verified.' });

    let user = await User.findOne({ googleId: payload.sub });
    if (!user && payload.email) {
      const byEmail = await User.findOne({ email: payload.email.toLowerCase() });
      if (byEmail && byEmail.googleId) user = byEmail;
      if (byEmail && !byEmail.googleId && byEmail.passwordHash) {
        return res.status(409).json({
          code: 'LINK_REQUIRED',
          message: 'That email has a password account. Sign in with your password, then link Google in Profile.',
        });
      }
      if (byEmail && !byEmail.googleId && !byEmail.passwordHash) {
        byEmail.googleId = payload.sub;
        await byEmail.save();
        user = byEmail;
      }
    }
    if (!user) {
      return res.json({
        needsUsername: true,
        pendingToken: signPendingGoogle(payload.sub, (payload.email || '').toLowerCase()),
        email: payload.email || null,
      });
    }
    user.lastActiveAt = new Date();
    await user.save();
    return res.json({ user: user.toPublicJSON(), token: signUser(user) });
  } catch (err) {
    console.error('Google auth error:', err.message);
    return res.status(401).json({ message: 'Google sign-in failed. Try again.' });
  }
});

// Finish Google signup by choosing a display name.
router.post('/google/complete', async (req, res) => {
  try {
    const { pendingToken, username: rawName } = req.body;
    if (!pendingToken) return res.status(400).json({ message: 'Missing signup token.' });
    const pending = verifyPending(pendingToken);
    const username = cleanUsername(rawName);
    if (!User.USERNAME_RE.test(username)) {
      return res.status(400).json({ message: 'Name must be 3 to 16 letters, numbers, or underscores.' });
    }
    if (await usernameTaken(username)) {
      return res.status(400).json({ message: 'That name is taken. Pick another.' });
    }
    if (pending.email && (await User.findOne({ email: pending.email }))) {
      return res.status(400).json({ message: 'That email already has an account. Sign in instead.' });
    }
    if (await User.findOne({ googleId: pending.googleId })) {
      return res.status(400).json({ message: 'That Google account is already registered. Sign in instead.' });
    }
    const user = await User.create({
      email: pending.email || undefined,
      googleId: pending.googleId,
      username,
      usernameLower: username.toLowerCase(),
      acceptedLegalPolicies: !!req.body.acceptedLegalPolicies,
    });
    return res.status(201).json({ user: user.toPublicJSON(), token: signUser(user) });
  } catch (err) {
    if (err && err.code === 11000) return res.status(400).json({ message: 'Email or name already in use.' });
    return res.status(401).json({ message: 'Signup session expired. Try Google sign-in again.' });
  }
});

// Link Google to the signed-in password account.
router.post('/link/google', requireAuth, async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'No Google ID token provided.' });
    const audiences = googleAudiences();
    if (audiences.length === 0) return res.status(503).json({ message: 'Google sign-in is not configured yet.' });
    const ticket = await googleClient.verifyIdToken({ idToken, audience: audiences });
    const payload = ticket.getPayload();
    const existing = await User.findOne({ googleId: payload.sub });
    if (existing && existing._id.toString() !== req.user._id.toString()) {
      return res.status(400).json({ message: 'That Google account is linked to a different game account.' });
    }
    req.user.googleId = payload.sub;
    if (!req.user.email && payload.email) req.user.email = payload.email.toLowerCase();
    await req.user.save();
    return res.json({ user: req.user.toPublicJSON() });
  } catch (err) {
    return res.status(401).json({ message: 'Google linking failed. Try again.' });
  }
});

// Add or change a password on the signed-in account (for Google-first accounts).
router.post('/set-password', requireAuth, async (req, res) => {
  try {
    const password = req.body.password || '';
    if (password.length < 8) return res.status(400).json({ message: 'Password needs at least 8 characters.' });
    if (req.user.passwordHash) {
      const current = req.body.currentPassword || '';
      if (!(await req.user.comparePassword(current))) {
        return res.status(401).json({ message: 'Current password is wrong.' });
      }
    }
    req.user.passwordHash = await User.hashPassword(password);
    await req.user.save();
    return res.json({ user: req.user.toPublicJSON() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

router.post('/accept-policies', requireAuth, async (req, res) => {
  req.user.acceptedLegalPolicies = true;
  await req.user.save();
  res.json({ user: req.user.toPublicJSON() });
});

// Delete the account permanently (Play Store requirement).
router.delete('/me', requireAuth, async (req, res) => {
  await User.findByIdAndDelete(req.user._id);
  res.json({ message: 'Account deleted.' });
});

module.exports = router;
