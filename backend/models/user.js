const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true, lowercase: true },
  password: { type: String, required: function() { return !this.googleId; } },
  googleId: { type: String, unique: true, sparse: true },
  username: { type: String, required: true, unique: true },
  
  // Game Stats
  level: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  coins: { type: Number, default: 100 },
  gems: { type: Number, default: 0 },
  unlockedWorlds: { type: [Number], default: [0] },
  worldUpgrades: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Systems S1: version flag for the deterministic ability-modifier
  // migration. The client recomputes stored modifiers from stored
  // levels only while this is below its current version, so the flag
  // has to round-trip through sync like the save itself does.
  modifiersVersion: { type: Number, default: 0 },
  trophies: { type: [String], default: [] },
  unlockedEnemies: { type: [String], default: [] },
  
  // Battle Mode Stats
  battleHighscore: { type: Number, default: 0 },
  battleBestTime: { type: Number, default: 0 },
  battleBestCoins: { type: Number, default: 0 },
  
  // Premium Items
  hasCosmicTrail: { type: Boolean, default: false },
  hasGoldenAura: { type: Boolean, default: false },
  hasCelestialShield: { type: Boolean, default: false },
  hasPurchasedGems: { type: Boolean, default: false },
  toggleCosmicTrail: { type: Boolean, default: true },
  toggleGoldenAura: { type: Boolean, default: true },
  toggleCelestialShield: { type: Boolean, default: true },

  // Progression
  coinMultiplier: { type: Number, default: 1 },
  xpMultiplier: { type: Number, default: 1 },

  // Subscription crates (written by sync; eligibility is server-derived)
  pendingCratesCount: { type: Number, default: 0 },
  lastCrateMonth: { type: String, default: '' },

  // Server-granted only (set by /api/billing/verify or /api/ads/ssv, never by /auth/sync)
  hasRemoveAds: { type: Boolean, default: false },
  reviveTokens: { type: Number, default: 0 },
  boostExpiresAt: { type: Number, default: 0 },
  boostMultiplier: { type: Number, default: 1 },

  
  // Compliance
  acceptedLegalPolicies: { type: Boolean, default: false },
  
  // Notifications
  pushSubscriptions: { type: Array, default: [] },
  lastActiveAt: { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now }
});

// Indexes for optimization
userSchema.index({ level: -1, xp: -1 }); // Optimizes leaderboard queries
userSchema.index({ battleHighscore: -1 }); // Optimizes battle leaderboard queries

userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
