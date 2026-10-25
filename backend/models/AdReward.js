const mongoose = require('mongoose');

// One row per AdMob server-side verification callback, keyed by Google's
// transaction_id so a replayed callback can never grant twice.
const adRewardSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  kind: { type: String },
  rewardItem: { type: String },
  rewardAmount: { type: Number },
  grantedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AdReward', adRewardSchema);
