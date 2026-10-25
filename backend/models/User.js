const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const worldBestSchema = new mongoose.Schema(
  {
    worldId: { type: Number, required: true },
    bestScore: { type: Number, default: 0 },
    bestTime: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  googleId: { type: String, unique: true, sparse: true },
  username: { type: String, required: true, unique: true, trim: true },
  usernameLower: { type: String, required: true, unique: true, lowercase: true, trim: true },

  // Progression
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  xpToNext: { type: Number, default: 100 },
  coins: { type: Number, default: 50 },
  gems: { type: Number, default: 0 },
  deathCount: { type: Number, default: 0 },

  // Moves and worlds
  ownedMoves: { type: [String], default: ['hold_1', 'double_1', 'triple_1'] },
  equippedMoves: {
    type: mongoose.Schema.Types.Mixed,
    default: { hold: 'hold_1', double: 'double_1', triple: 'triple_1' },
  },
  unlockedWorlds: { type: [Number], default: [1] },
  worldBests: { type: [worldBestSchema], default: [] },
  campaignScore: { type: Number, default: 0 },

  // Battle mode
  battleWins: { type: Number, default: 0 },
  battleLosses: { type: Number, default: 0 },
  battleRating: { type: Number, default: 0 },
  battleBestScore: { type: Number, default: 0 },

  // Collection
  trophies: { type: [String], default: [] },
  codexEnemies: { type: [String], default: [] },
  ownedSkins: { type: [String], default: ['ember'] },
  activeSkin: { type: String, default: 'ember' },

  // Entitlements (set from verified Play purchases on the client, mirrored here for sync)
  removeAds: { type: Boolean, default: false },
  movePackAll: { type: Boolean, default: false },
  skinPackAll: { type: Boolean, default: false },
  phoenixPassUntil: { type: Number, default: 0 },

  // Settings
  settings: {
    type: mongoose.Schema.Types.Mixed,
    default: { soundEnabled: true, musicEnabled: true, hapticsEnabled: true },
  },

  acceptedLegalPolicies: { type: Boolean, default: false },
  lastActiveAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

userSchema.index({ level: -1, xp: -1 });
userSchema.index({ campaignScore: -1 });
userSchema.index({ battleRating: -1 });

userSchema.methods.comparePassword = async function (candidate) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    email: this.email || null,
    hasPassword: !!this.passwordHash,
    hasGoogle: !!this.googleId,
    username: this.username,
    level: this.level,
    xp: this.xp,
    xpToNext: this.xpToNext,
    coins: this.coins,
    gems: this.gems,
    deathCount: this.deathCount,
    ownedMoves: this.ownedMoves,
    equippedMoves: this.equippedMoves,
    unlockedWorlds: this.unlockedWorlds,
    worldBests: this.worldBests,
    campaignScore: this.campaignScore,
    battleWins: this.battleWins,
    battleLosses: this.battleLosses,
    battleRating: this.battleRating,
    battleBestScore: this.battleBestScore,
    trophies: this.trophies,
    codexEnemies: this.codexEnemies,
    ownedSkins: this.ownedSkins,
    activeSkin: this.activeSkin,
    removeAds: this.removeAds,
    movePackAll: this.movePackAll,
    skinPackAll: this.skinPackAll,
    phoenixPassUntil: this.phoenixPassUntil,
    settings: this.settings,
    acceptedLegalPolicies: this.acceptedLegalPolicies,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.hashPassword = (plain) => bcrypt.hash(plain, 10);
module.exports.USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
