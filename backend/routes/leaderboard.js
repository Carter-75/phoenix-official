const express = require('express');
const User = require('../models/User');

const router = express.Router();

// Global leaderboard: level first, then XP (Phoenix-Fall's ordering).
router.get('/global', async (req, res) => {
  try {
    const rows = await User.find({ username: { $exists: true } })
      .sort({ level: -1, xp: -1 })
      .limit(100)
      .select('username level xp trophies');
    res.json(rows.map((r, i) => ({ rank: i + 1, username: r.username, level: r.level, xp: r.xp, trophies: (r.trophies || []).length })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Campaign leaderboard: total of per-world best scores.
router.get('/campaign', async (req, res) => {
  try {
    const rows = await User.find({ campaignScore: { $gt: 0 } })
      .sort({ campaignScore: -1 })
      .limit(100)
      .select('username campaignScore level');
    res.json(rows.map((r, i) => ({ rank: i + 1, username: r.username, score: r.campaignScore, level: r.level })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-world leaderboard: /leaderboard/world/3
router.get('/world/:worldId', async (req, res) => {
  try {
    const worldId = Math.floor(Number(req.params.worldId));
    if (!Number.isFinite(worldId) || worldId < 1 || worldId > 10) {
      return res.status(400).json({ message: 'worldId must be 1 to 10.' });
    }
    const users = await User.find({ 'worldBests.worldId': worldId, 'worldBests.bestScore': { $gt: 0 } })
      .select('username worldBests')
      .lean();
    const rows = users
      .map((u) => {
        const best = (u.worldBests || []).find((x) => x.worldId === worldId);
        return best && best.bestScore > 0
          ? { username: u.username, score: best.bestScore, timeSec: best.bestTime, completed: !!best.completed }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map((r, i) => ({ rank: i + 1, ...r }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Battle leaderboard: rating first, then wins.
router.get('/battle', async (req, res) => {
  try {
    const rows = await User.find({ battleRating: { $gt: 0 } })
      .sort({ battleRating: -1, battleWins: -1 })
      .limit(100)
      .select('username battleRating battleWins battleLosses battleBestScore');
    res.json(
      rows.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        rating: r.battleRating,
        wins: r.battleWins,
        losses: r.battleLosses,
        bestScore: r.battleBestScore,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
