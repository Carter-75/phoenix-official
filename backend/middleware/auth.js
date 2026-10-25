const jwt = require('jsonwebtoken');
const User = require('../models/User');

function secret() {
  return process.env.JWT_SECRET || 'dev-only-secret-change-me';
}

function signUser(user) {
  return jwt.sign({ id: user._id.toString() }, secret(), { expiresIn: '30d' });
}

// Short-lived token used only to finish Google signup (pick a username).
// Carries no password material, ever.
function signPendingGoogle(googleId, email) {
  return jwt.sign({ pending: true, googleId, email }, secret(), { expiresIn: '15m' });
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Sign in required' });
    const payload = jwt.verify(token, secret());
    if (payload.pending) return res.status(401).json({ message: 'Finish signup first' });
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: 'Account not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Session expired, sign in again' });
  }
}

function verifyPending(token) {
  const payload = jwt.verify(token, secret());
  if (!payload.pending) throw new Error('Not a pending token');
  return payload;
}

module.exports = { signUser, signPendingGoogle, requireAuth, verifyPending };
