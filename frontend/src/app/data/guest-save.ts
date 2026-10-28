// Guest-save sanitizer (final sweep; the playtest round 2 low item).
//
// The guest restore used to read the stored JSON field by field on
// trust: a value of the wrong type (a string where a number lives,
// an object where an array lives) flowed straight into the signals,
// and because the whole restore sits inside one try/catch, a single
// poisoned field could throw and silently wedge the entire save
// (nothing restored, no error shown). This module applies the same
// discipline the mode trio applied to modeRecords: every field is
// cleaned independently, numbers must be finite and are floored and
// clamped to the game's own plausible ranges, arrays keep only
// members of the right shape, ability records are rebuilt against
// the shipped ability table, and world stats are rebuilt against
// BASE_STATS so a missing or poisoned world can never produce a
// NaN stat or a missing world entry downstream.
//
// The output uses the same field names the loader has always read;
// absent or unrecoverable fields are omitted, and the loader's own
// defaults then apply, so a fully poisoned save loads as a clean
// new-player default instead of wedging.
import { WorldStats } from '../models/game.models';
import { ABILITIES, GADGETS, BASE_STATS, WORLD_0_STATS, deterministicAbilityModifiers } from '../constants/game.constants';
import { sanitizeModeRecords } from './mode-records';

const SCREENS = ['menu', 'game', 'shop', 'login', 'profile', 'leaderboard', 'codex', 'crate_opening'];

function cleanInt(v: any, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function cleanFinite(v: any): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function cleanBool(v: any): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function cleanWorldList(v: any): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((w: any) => Number.isInteger(w) && w >= 0 && w <= 9))].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

function cleanStringList(v: any, cap: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((s: any) => typeof s === 'string').slice(0, cap);
}

// One world's stat record, rebuilt field by field. Numeric stats
// must be finite numbers or they fall back to the shipped base;
// ability entries must name a shipped ability and carry a sane
// level, and their modifiers are kept only when every value is a
// finite number in a plausible band, otherwise they are recomputed
// deterministically from the level (the Section 3.5 rule: level
// alone defines the build). Equip slots may only name an ability
// this world actually owns, so a poisoned save cannot equip a
// locked move.
export function sanitizeWorldStats(raw: any, fallback: WorldStats): WorldStats {
  const base: WorldStats = JSON.parse(JSON.stringify(fallback));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const numKeys: (keyof WorldStats)[] = ['maxHealth', 'speed', 'magnetism', 'damage', 'attackSpeed', 'burstDamage', 'auraRadius', 'homingLevel', 'attackRange'];
  for (const k of numKeys) {
    const n = cleanFinite(raw[k]);
    if (n !== undefined) (base as any)[k] = k === 'homingLevel' ? Math.max(0, Math.floor(n)) : n;
  }
  const abilities: Record<string, { level: number, modifiers: Record<string, number> }> = {};
  const rawAbilities = raw.unlockedAbilities;
  if (rawAbilities && typeof rawAbilities === 'object' && !Array.isArray(rawAbilities)) {
    for (const id of Object.keys(rawAbilities)) {
      if (!ABILITIES[id]) continue;
      const entry = rawAbilities[id];
      if (!entry || typeof entry !== 'object') continue;
      const level = cleanInt(entry.level, 1, 30);
      if (level === undefined) continue;
      let modifiers: Record<string, number> | undefined;
      const rawMods = entry.modifiers;
      if (rawMods && typeof rawMods === 'object' && !Array.isArray(rawMods)) {
        const keys = Object.keys(rawMods);
        if (keys.length && keys.every(k => typeof rawMods[k] === 'number' && isFinite(rawMods[k]) && rawMods[k] > 0 && rawMods[k] <= 100)) {
          modifiers = { ...rawMods };
        }
      }
      abilities[id] = { level, modifiers: modifiers ?? deterministicAbilityModifiers(id, level) };
    }
  }
  base.unlockedAbilities = abilities;
  const equip = (v: any) => (typeof v === 'string' && abilities[v]) ? v : null;
  base.activeTapAbility = equip(raw.activeTapAbility);
  base.activeHoldAbility = equip(raw.activeHoldAbility);
  base.activeDoubleAbility = equip(raw.activeDoubleAbility);
  base.activeTripleAbility = equip(raw.activeTripleAbility);
  const gadgets: string[] = Array.isArray(raw.unlockedGadgets)
    ? [...new Set<string>(raw.unlockedGadgets.filter((g: any) => typeof g === 'string' && !!GADGETS[g]))]
    : [];
  base.unlockedGadgets = gadgets;
  base.activeGadget = (typeof raw.activeGadget === 'string' && gadgets.includes(raw.activeGadget)) ? raw.activeGadget : null;
  const plating = cleanInt(raw.aegisPlating, 0, 3);
  base.aegisPlating = plating ?? 0;
  return base;
}

// All ten worlds, always present in the output: worlds missing
// from the save take the shipped defaults (WORLD_0_STATS for world
// 0, BASE_STATS elsewhere), matching the signal's initial shape.
export function sanitizeWorldUpgrades(raw: any): Record<number, WorldStats> {
  const out: Record<number, WorldStats> = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (let w = 0; w < 10; w++) {
    out[w] = sanitizeWorldStats(src[w] ?? src[String(w)], w === 0 ? WORLD_0_STATS : BASE_STATS);
  }
  return out;
}

// The whole guest save. Returns an object holding only the fields
// that survived cleaning; the loader applies what is present over
// its defaults.
export function sanitizeGuestSave(raw: any): any {
  const out: any = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  const level = cleanInt(raw.level, 0, 100000); if (level !== undefined) out.level = level;
  const xp = cleanInt(raw.xp, 0, Number.MAX_SAFE_INTEGER); if (xp !== undefined) out.xp = xp;
  const trophies = cleanStringList(raw.trophies, 500); if (trophies !== undefined) out.trophies = trophies;
  const coins = cleanInt(raw.coins, 0, 1e12); if (coins !== undefined) out.coins = coins;
  const gems = cleanInt(raw.gems, 0, 1e9); if (gems !== undefined) out.gems = gems;

  for (const k of ['hasPurchasedGems', 'acceptedLegalPolicies', 'hasCosmicTrail', 'hasGoldenAura', 'hasCelestialShield', 'hasRemoveAds', 'toggleCosmicTrail', 'toggleGoldenAura', 'toggleCelestialShield']) {
    const b = cleanBool(raw[k]); if (b !== undefined) out[k] = b;
  }

  if (typeof raw.activeScreen === 'string' && SCREENS.includes(raw.activeScreen)) out.activeScreen = raw.activeScreen;
  // Vestigial under the automatic per-world skin design (no
  // picker, nothing reads a stored selection), but a valid save
  // round-trips losslessly: pass a plausible id through.
  if (typeof raw.selectedSkinId === 'string' && raw.selectedSkinId.length <= 64) out.selectedSkinId = raw.selectedSkinId;

  const unlockedWorlds = cleanWorldList(raw.unlockedWorlds);
  if (unlockedWorlds !== undefined) out.unlockedWorlds = unlockedWorlds.includes(0) ? unlockedWorlds : [0, ...unlockedWorlds];
  const beatenWorlds = cleanWorldList(raw.beatenWorlds);
  if (beatenWorlds !== undefined) out.beatenWorlds = beatenWorlds;

  if (raw.modeRecords !== undefined) out.modeRecords = sanitizeModeRecords(raw.modeRecords);

  const selectedWorldIndex = cleanInt(raw.selectedWorldIndex, 0, 9);
  if (selectedWorldIndex !== undefined) out.selectedWorldIndex = selectedWorldIndex;

  for (const k of ['coinMultiplier', 'xpMultiplier']) {
    const n = cleanFinite(raw[k]);
    if (n !== undefined && n > 0 && n <= 1000) out[k] = n;
  }

  if (typeof raw.lastCrateMonth === 'string' && /^\d{4}-\d{2}$/.test(raw.lastCrateMonth)) out.lastCrateMonth = raw.lastCrateMonth;
  const pendingCratesCount = cleanInt(raw.pendingCratesCount, 0, 3);
  if (pendingCratesCount !== undefined) out.pendingCratesCount = pendingCratesCount;
  const reviveTokens = cleanInt(raw.reviveTokens, 0, 999);
  if (reviveTokens !== undefined) out.reviveTokens = reviveTokens;

  const unlockedEnemies = cleanStringList(raw.unlockedEnemies, 100);
  if (unlockedEnemies !== undefined) out.unlockedEnemies = unlockedEnemies;

  if (raw.worldUpgrades !== undefined) out.worldUpgrades = sanitizeWorldUpgrades(raw.worldUpgrades);
  if (typeof raw.modifiersVersion === 'number' && isFinite(raw.modifiersVersion)) out.modifiersVersion = raw.modifiersVersion;

  return out;
}
