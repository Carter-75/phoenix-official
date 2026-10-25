const mongoose = require('mongoose');

// Server-granted proof of a purchase or verified reward. Written ONLY by
// /api/billing/verify (after Google Play Developer API verification) or by
// the AdMob SSV handler. /auth/sync never creates these, which is what closes
// the audit bug 19 hole (clients minting currency and premium flags).
const entitlementSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productId: { type: String, required: true },
  source: { type: String, enum: ['play', 'ssv', 'admin'], required: true },
  transactionId: { type: String, unique: true, sparse: true },
  expiresAt: { type: Date, default: null }, // subscriptions
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Entitlement', entitlementSchema);
