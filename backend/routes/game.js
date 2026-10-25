const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const clampInt = (v, min, max, fallback) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback;
const stringArray = (v, maxLen) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, maxLen) : null;
const intArray = (v, maxLen) =>
  Array.isArray(v) ? v.filter((x) => Number.isFinite(x)).map((x) => Math.floor(x)).slice(0, maxLen) : null;

// Push local progress up. Server keeps personal bests for scores and never
// lowers a world best, everything else is last-write-wins within sane ranges
// (same validation approach as Phoenix-Fall's /sync, with wider coverage).
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    const b = req.body || {};

    u.level = clampInt(b.level, 1, 10000, u.level);
    u.xp = clampInt(b.xp, 0, 999999999, u.xp);
    u.xpToNext = clampInt(b.xpToNext, 100, 999999999, u.xpToNext);
    u.coins = clampInt(b.coins, 0, 99999999, u.coins);
    u.gems = clampInt(b.gems, 0, 9999999, u.gems);
    u.deathCount = clampInt(b.deathCount, 0, 9999999, u.deathCount);

    const owned = stringArray(b.ownedMoves, 200);
    if (owned) u.ownedMoves = owned;
    if (b.equippedMoves && typeof b.equippedMoves === 'object') {
      u.equippedMoves = {
        hold: typeof b.equippedMoves.hold === 'string' ? b.equippedMoves.hold : u.equippedMoves.hold,
        double: typeof b.equippedMoves.double === 'string' ? b.equippedMoves.double : u.equippedMoves.double,
        triple: typeof b.equippedMoves.triple === 'string' ? b.equippedMoves.triple : u.equippedMoves.triple,
      };
      u.markModified('equippedMoves');
    }
    const worlds = intArray(b.unlockedWorlds, 10);
    if (worlds) u.unlockedWorlds = Array.from(new Set([1, ...worlds.filter((w) => w >= 1 && w <= 10)]));

    if (Array.isArray(b.worldBests)) {
      for (const wb of b.worldBests.slice(0, 10)) {
        if (!wb || !Number.isFinite(wb.worldId)) continue;
        const worldId = Math.floor(wb.worldId);
        if (worldId < 1 || worldId > 10) continue;
        let entry = u.worldBests.find((x) => x.worldId === worldId);
        if (!entry) {
          u.worldBests.push({ worldId, bestScore: 0, bestTime: 0, completed: false });
          entry = u.worldBests.find((x) => x.worldId === worldId);
        }
        entry.bestScore = Math.max(entry.bestScore || 0, clampInt(wb.bestScore, 0, 999999999, 0));
        const t = clampInt(wb.bestTime, 0, 999999, 0);
        if (t > 0 && (entry.bestTime === 0 || t < entry.bestTime)) entry.bestTime = t;
        if (wb.completed) entry.completed = true;
      }
      u.markModified('worldBests');
      u.campaignScore = u.worldBests.reduce((sum, x) => sum + (x.bestScore || 0), 0);
    }

    const trophies = stringArray(b.trophies, 200);
    if (trophies) u.trophies = Array.from(new Set([...(u.trophies || []), ...trophies]));
    const codex = stringArray(b.codexEnemies, 200);
    if (codex) u.codexEnemies = Array.from(new Set([...(u.codexEnemies || []), ...codex]));
    const skins = stringArray(b.ownedSkins, 50);
    if (skins) u.ownedSkins = Array.from(new Set(['ember', ...skins]));
    if (typeof b.activeSkin === 'string' && u.ownedSkins.includes(b.activeSkin)) u.activeSkin = b.activeSkin;

    if (typeof b.removeAds === 'boolean') u.removeAds = u.removeAds || b.removeAds;
    if (typeof b.movePackAll === 'boolean') u.movePackAll = u.movePackAll || b.movePackAll;
    if (typeof b.skinPackAll === 'boolean') u.skinPackAll = u.skinPackAll || b.skinPackAll;
    u.phoenixPassUntil = Math.max(u.phoenixPassUntil || 0, clampInt(b.phoenixPassUntil, 0, 9999999999999, 0));

    if (b.settings && typeof b.settings === 'object') {
      u.settings = {
        soundEnabled: b.settings.soundEnabled !== false,
        musicEnabled: b.settings.musicEnabled !== false,
        hapticsEnabled: b.settings.hapticsEnabled !== false,
      };
      u.markModified('settings');
    }

    u.lastActiveAt = new Date();
    await u.save();
    return res.json({ user: u.toPublicJSON() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Record a finished world run. Returns the updated personal bests.
router.post('/score/world', requireAuth, async (req, res) => {
  try {
    const worldId = clampInt(req.body.worldId, 1, 10, 0);
    if (!worldId) return res.status(400).json({ message: 'worldId must be 1 to 10.' });
    const score = clampInt(req.body.score, 0, 999999999, 0);
    const timeSec = clampInt(req.body.timeSec, 0, 999999, 0);
    const completed = !!req.body.completed;

    const u = req.user;
    let entry = u.worldBests.find((x) => x.worldId === worldId);
    if (!entry) {
      u.worldBests.push({ worldId, bestScore: 0, bestTime: 0, completed: false });
      entry = u.worldBests.find((x) => x.worldId === worldId);
    }
    const isBest = score > (entry.bestScore || 0);
    entry.bestScore = Math.max(entry.bestScore || 0, score);
    if (timeSec > 0 && (entry.bestTime === 0 || timeSec < entry.bestTime)) entry.bestTime = timeSec;
    if (completed) {
      entry.completed = true;
      const next = worldId + 1;
      if (next <= 10 && !u.unlockedWorlds.includes(next)) u.unlockedWorlds.push(next);
    }
    u.markModified('worldBests');
    u.campaignScore = u.worldBests.reduce((sum, x) => sum + (x.bestScore || 0), 0);
    await u.save();
    return res.json({ isBest, worldBests: u.worldBests, campaignScore: u.campaignScore });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Record a finished battle. Rating: +25 win, -15 loss, floor 0.
router.post('/score/battle', requireAuth, async (req, res) => {
  try {
    const won = !!req.body.won;
    const score = clampInt(req.body.score, 0, 999999999, 0);
    const u = req.user;
    if (won) {
      u.battleWins += 1;
      u.battleRating += 25;
    } else {
      u.battleLosses += 1;
      u.battleRating = Math.max(0, u.battleRating - 15);
    }
    u.battleBestScore = Math.max(u.battleBestScore || 0, score);
    await u.save();
    return res.json({
      battleWins: u.battleWins,
      battleLosses: u.battleLosses,
      battleRating: u.battleRating,
      battleBestScore: u.battleBestScore,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
