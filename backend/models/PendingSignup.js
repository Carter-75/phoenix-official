const mongoose = require('mongoose');

// A signup that has authenticated (email/password or Google) but has not yet
// chosen a username. The record lives ONLY on the server: the client holds a
// short-lived pending JWT that references this record's id. Audit bug 18: the
// old flow parked the hashed password inside the JWT itself. Never again.
// Records auto-expire after 30 minutes via the TTL index on expiresAt.
const pendingSignupSchema = new mongoose.Schema({
  email: { type: String, lowercase: true, index: true },
  passwordHash: { type: String }, // bcrypt hash, never the plain password
  googleId: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000), index: { expires: 0 } }
});

module.exports = mongoose.model('PendingSignup', pendingSignupSchema);
