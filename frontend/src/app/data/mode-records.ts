// Per-world per-mode records (mode trio stage, Oct 27, 2026).
//
// Carter's grid: every world has three modes (Normal campaign,
// Endless survival, Battle duel), and personal bests live per world
// per mode, next to the two global boards which stay exactly as
// they are. This module is the one shape those records take
// everywhere: the guest save, the account sync payload, and the
// server record the leaderboard routes read.
//
// Records are scores, never currency. Nothing in this module (or in
// the sync handler that merges it server-side) grants coins, gems,
// unlocks, or entitlements; the merge functions only ever keep the
// better score, the same personal-best rule the battle globals
// already used.
//
// Board sort keys (implemented in backend/routes/leaderboard.js):
//   Normal:  bestClearSec ascending (fastest clear first), then
//            clearKills descending, then level descending. Only
//            players who cleared the world appear.
//   Endless: bestTimeSec descending, then bestKills descending,
//            then level descending. Only players with a recorded
//            Endless run in the world appear.
//   Battle:  bestScore descending, then bestTimeSec descending,
//            then bestCoins descending, then level descending.
//            Only players with a scored battle in the world appear.
// Every row on every board also carries the player's level.

export interface NormalRecord {
  cleared: boolean;
  bestClearSec: number; // seconds inside the world segment on the fastest clear
  clearKills: number; // kills during that same fastest clear
}

export interface EndlessRecord {
  bestTimeSec: number; // longest survival, seconds
  bestKills: number; // most kills in one run (independent best)
  runs: number; // completed runs recorded (best-merged as a max across devices, never summed, so a sync can never double count)
}

export interface BattleWorldRecord {
  bestScore: number; // the existing battle score formula's best in this world
  bestTimeSec: number;
  bestCoins: number;
  // AI vs AI results in this world, accumulated totals. Records
  // only: the per-world Battle board ranks the player's own battle
  // record above; AI vs AI has no player score to rank.
  ai1Wins: number;
  ai2Wins: number;
}

export interface WorldModeRecords {
  normal?: NormalRecord;
  endless?: EndlessRecord;
  battle?: BattleWorldRecord;
}

export type ModeRecords = Record<number, WorldModeRecords>;

export type TrioMode = 'normal' | 'endless' | 'battle';

const WORLD_COUNT = 10;
const MAX_SEC = 7 * 24 * 3600; // a week of seconds: far past any real run, blocks absurd values
const MAX_COUNT = 1e9;

function cleanNum(v: any, max: number): number {
  const n = typeof v === 'number' && isFinite(v) ? Math.floor(v) : 0;
  return Math.min(max, Math.max(0, n));
}

// Defensive shape pass, applied on every load path (guest restore,
// server sync-in, server sync handler mirrors it): unknown worlds,
// unknown modes, and out-of-range numbers are dropped or clamped,
// never trusted.
export function sanitizeModeRecords(input: any): ModeRecords {
  const out: ModeRecords = {};
  if (!input || typeof input !== 'object') return out;
  for (let w = 0; w < WORLD_COUNT; w++) {
    const src = input[w] ?? input[String(w)];
    if (!src || typeof src !== 'object') continue;
    const rec: WorldModeRecords = {};
    if (src.normal && typeof src.normal === 'object' && src.normal.cleared) {
      rec.normal = {
        cleared: true,
        bestClearSec: cleanNum(src.normal.bestClearSec, MAX_SEC),
        clearKills: cleanNum(src.normal.clearKills, MAX_COUNT)
      };
    }
    if (src.endless && typeof src.endless === 'object') {
      const e = {
        bestTimeSec: cleanNum(src.endless.bestTimeSec, MAX_SEC),
        bestKills: cleanNum(src.endless.bestKills, MAX_COUNT),
        runs: cleanNum(src.endless.runs, MAX_COUNT)
      };
      if (e.bestTimeSec > 0 || e.bestKills > 0 || e.runs > 0) rec.endless = e;
    }
    if (src.battle && typeof src.battle === 'object') {
      const b = {
        bestScore: cleanNum(src.battle.bestScore, MAX_COUNT),
        bestTimeSec: cleanNum(src.battle.bestTimeSec, MAX_SEC),
        bestCoins: cleanNum(src.battle.bestCoins, MAX_COUNT),
        ai1Wins: cleanNum(src.battle.ai1Wins, MAX_COUNT),
        ai2Wins: cleanNum(src.battle.ai2Wins, MAX_COUNT)
      };
      if (b.bestScore > 0 || b.bestTimeSec > 0 || b.bestCoins > 0 || b.ai1Wins > 0 || b.ai2Wins > 0) rec.battle = b;
    }
    if (rec.normal || rec.endless || rec.battle) out[w] = rec;
  }
  return out;
}

// Best-merge of two record sets (local into server, server into
// local at login): the result is the better score on every field,
// under the sort orders above. Never sums, never lowers a best.
export function mergeModeRecords(a: ModeRecords, b: ModeRecords): ModeRecords {
  const out = sanitizeModeRecords(a);
  const other = sanitizeModeRecords(b);
  for (let w = 0; w < WORLD_COUNT; w++) {
    const x = out[w];
    const y = other[w];
    if (!y) continue;
    if (!x) { out[w] = y; continue; }
    if (y.normal) {
      if (!x.normal
        || y.normal.bestClearSec < x.normal.bestClearSec
        || (y.normal.bestClearSec === x.normal.bestClearSec && y.normal.clearKills > x.normal.clearKills)) {
        x.normal = y.normal;
      }
    }
    if (y.endless) {
      if (!x.endless) x.endless = y.endless;
      else {
        x.endless = {
          bestTimeSec: Math.max(x.endless.bestTimeSec, y.endless.bestTimeSec),
          bestKills: Math.max(x.endless.bestKills, y.endless.bestKills),
          runs: Math.max(x.endless.runs, y.endless.runs)
        };
      }
    }
    if (y.battle) {
      if (!x.battle) x.battle = y.battle;
      else {
        x.battle = {
          bestScore: Math.max(x.battle.bestScore, y.battle.bestScore),
          bestTimeSec: Math.max(x.battle.bestTimeSec, y.battle.bestTimeSec),
          bestCoins: Math.max(x.battle.bestCoins, y.battle.bestCoins),
          ai1Wins: Math.max(x.battle.ai1Wins, y.battle.ai1Wins),
          ai2Wins: Math.max(x.battle.ai2Wins, y.battle.ai2Wins)
        };
      }
    }
  }
  return out;
}
