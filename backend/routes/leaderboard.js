const express = require('express');
const router = express.Router();
const User = require('../models/user');

router.get('/', async (req, res) => {
    try {
        // Sort by level descending, then xp descending
        const topPlayers = await User.find({ username: { $exists: true } })
                                     .sort({ level: -1, xp: -1 })
                                     .limit(100)
                                     .select('username level xp trophies');
                                     
        res.json(topPlayers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Per-world per-mode boards (mode trio, Oct 27, 2026): one board
// for every world in every mode, beside the two global boards
// above, whose shapes are unchanged. Sort keys (also documented in
// frontend/src/app/data/mode-records.ts):
//   normal:  bestClearSec asc, clearKills desc, level desc;
//            only players who cleared the world appear.
//   endless: bestTimeSec desc, bestKills desc, level desc; only
//            players with a recorded Endless run appear.
//   battle:  bestScore desc, bestTimeSec desc, bestCoins desc,
//            level desc; only players with a scored battle appear.
// Every row carries the player's level, like both global boards.
// Records live in a Mixed map on the user document, so the board
// is assembled in JS from the users who hold a record for the
// world; at this game's scale that is a small, honest read.
router.get('/world/:world/:mode', async (req, res) => {
    try {
        const world = Number(req.params.world);
        const mode = req.params.mode;
        if (!Number.isInteger(world) || world < 0 || world > 9 || !['normal', 'endless', 'battle'].includes(mode)) {
            return res.status(400).json({ error: 'Unknown world or mode' });
        }
        const users = await User.find({ username: { $exists: true } })
                                .select('username level trophies modeRecords')
                                .lean();
        const rows = [];
        for (const u of users) {
            const rec = u.modeRecords && (u.modeRecords[world] || u.modeRecords[String(world)]);
            const r = rec && rec[mode];
            if (!r) continue;
            if (mode === 'normal' && !r.cleared) continue;
            if (mode === 'endless' && !(r.bestTimeSec > 0)) continue;
            if (mode === 'battle' && !(r.bestScore > 0)) continue;
            rows.push({ username: u.username, level: u.level || 0, trophies: u.trophies || [], ...r });
        }
        const byLevel = (a, b) => (b.level || 0) - (a.level || 0);
        if (mode === 'normal') rows.sort((a, b) => (a.bestClearSec - b.bestClearSec) || (b.clearKills - a.clearKills) || byLevel(a, b));
        else if (mode === 'endless') rows.sort((a, b) => (b.bestTimeSec - a.bestTimeSec) || (b.bestKills - a.bestKills) || byLevel(a, b));
        else rows.sort((a, b) => (b.bestScore - a.bestScore) || (b.bestTimeSec - a.bestTimeSec) || (b.bestCoins - a.bestCoins) || byLevel(a, b));
        res.json(rows.slice(0, 100));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/battle', async (req, res) => {
    try {
        const topPlayers = await User.find({ username: { $exists: true }, battleHighscore: { $gt: 0 } })
                                     .sort({ battleHighscore: -1 })
                                     .limit(100)
                                     // S6 level audit: every leaderboard row
                                     // carries the player's level (the
                                     // survival board always did; the
                                     // battle board did not return it).
                                     .select('username level battleHighscore battleBestTime battleBestCoins trophies');
                                     
        res.json(topPlayers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
