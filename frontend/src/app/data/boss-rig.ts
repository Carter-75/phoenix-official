// Boss rig (visual spec Stage 9): the data-driven boss behavior
// framework every campaign boss plugs into. One record per world
// carries the boss's signature attack, its enrage window, its
// shield tuning, its minion summons, and its movement style; the
// game component runs one shared state machine (pattern schedule,
// telegraphs, enrage, shield and regen phases) against this data,
// so Stage 10's bosses (Worlds 6 to 10) are content, not new code.
//
// Binding rules, from SYSTEMS-OVERHAUL.md and Carter's addenda
// (Oct 25, 2026); none of these are tuning values and the rig code
// may never exceed them:
// - Every attack is telegraphed at least 0.5 s before it can hurt.
// - Enrage moment rolls per run inside [A, B]: A is the world's
//   fresh-profile TTK band top, B about 30 percent beyond it.
// - Shield heal per phase is hard-capped at 5 percent of max boss
//   HP; whole-fight healing is hard-capped at 15 percent; shield
//   phases cannot start at or below 5 percent boss HP; enrage does
//   not reset the whole-fight cap.
// - Boss projectiles are density-capped so a dodge line always
//   exists (BOSS_PROJECTILE_CAP below).
// - Battle mode's rival uses none of this: no enrage, no shields.

import { BOSS_TTK_BANDS } from './balance.constants';

// Signatures from the Oct 29, 2026 redesign; the pattern timelines
// live in pages/game/boss-patterns.ts (one builder per world).
export type BossSignatureId =
  | 'magma_geysers'     // World 1, Cinder Colossus
  | 'eclipse_lances'    // World 2, Umbral Matriarch
  | 'refraction_beams'  // World 3, Prism Sentinel
  | 'thunder_march'     // World 4, Tempest Roc
  | 'soul_scythe'       // World 5, Grave Warden
  | 'coronation'        // World 6, Solar Monarch
  | 'shatter_rings'     // World 7, Glacial Oracle
  | 'twin_breath'       // World 8, Wyrm Sovereign
  | 'fractured_grid'    // World 9, Entropy Engine
  | 'ascension';        // World 10, Phoenix Ascendant

export interface BossDef {
  worldIndex: number;
  signature: BossSignatureId;
  // Seconds of boss fight before enrage can trigger: the roll is
  // uniform inside this window, rolled once per fight at spawn.
  enrageWindowSec: [number, number];
  // Shield HP, sized to break under about 5 s of focused fire at
  // the world's reference upgraded DPS (shield and regen addendum,
  // rule 1). refUpgradedDps is recorded beside it so the sizing
  // stays auditable: shieldHp = refUpgradedDps x 5 s.
  refUpgradedDps: number;
  shieldHp: number;
  // Minion summons (visual spec Section 4 sheets): the type the
  // boss calls, and the alive cap for the heavier types. 'bat'
  // summons use the legacy boss-minion law (5 HP base); the other
  // types spawn through the roster factory at world HP.
  minionType: 'bat' | 'sentry_shard' | 'imp' | 'phantom' | 'pyre_moth' | 'mite';
  minionCap: number; // alive cap for non-bat minions; 0 = uncapped
  minionsPerSummon: number;
  // Movement style: 'chase' is the shipped slow creep toward the
  // player; 'patrolTop' flies wide arcs across the top band (the
  // Storm Wyvern sheet); 'passes' flies slow heavy passes across
  // the whole field (the Dragon Emperor sheet, Stage 10).
  movement: 'chase' | 'patrolTop' | 'passes';
  // Shield shell color: the boss's own palette, never the hostile
  // magenta-red (shield and regen addendum, readability rule).
  shieldColor: [number, number, number];
  shieldColorHex: string;
}

// Hard bounds from the addenda (not tuning values).
export const BOSS_ENRAGE_WARNING_SEC = 5;      // charge-up warning length
export const SHIELD_HEAL_PHASE_CAP_FRAC = 0.05; // per-phase heal cap
export const SHIELD_HEAL_FIGHT_CAP_FRAC = 0.15; // whole-fight heal cap
export const SHIELD_MIN_HP_FRAC = 0.05;         // no shield at or below this HP fraction
export const SHIELD_MIN_SPACING_SEC = 20;       // minimum gap between shield phase starts
export const SHIELD_PHASE_MAX_SEC = 12;         // a shield drops on its own after this
export const SHIELD_REGEN_FRAC_PER_SEC = 0.01;  // 1 percent of max HP per second behind the shield
export const SHIELD_TELEGRAPH_SEC = 1.0;        // gather and snap-on telegraph
export const SHIELD_HP_FRACTIONS = [0.70, 0.45, 0.25]; // scripted HP thresholds that offer a shield phase
export const BOSS_PROJECTILE_CAP = 64;          // live boss-pattern projectiles; a dodge line always exists
export const SIGNATURE_INTERVAL_SEC = 12;       // normal signature cadence
export const SIGNATURE_INTERVAL_ENRAGED_SEC = 8;

function enrageWindowFor(worldIndex: number): [number, number] {
  // Anchored to the world's own fresh band top (S6 re-based
  // BOSS_TTK_BANDS to per-world rows, so this find is per world;
  // before S6 the bands were group rows and the window was the
  // group's).
  const band = BOSS_TTK_BANDS.find(b => b.worldIndexes.includes(worldIndex)) || BOSS_TTK_BANDS[0];
  const a = band.freshSeconds[1];
  return [a, Math.round(a * 1.3)];
}

// Reference upgraded DPS per world: Worlds 1 to 5 are the S4 TTK
// probe's measured upgraded output rounded to a nominal focused
// figure (boss HP / upgraded TTK: 16.9, 39.8, 34.3, 43.8, 42.3);
// Worlds 6 to 10 follow the spec Section 6.3 realistic ranges
// (Worlds 4 to 7 about 45 to 80, Worlds 8 to 10 about 150 to 190
// at full investment). Used only to size shield HP.
const REF_UPGRADED_DPS = [20, 30, 35, 42, 45, 55, 70, 95, 130, 170];
const SHIELD_BREAK_TARGET_SEC = 5;

function def(worldIndex: number, signature: BossSignatureId, extra: Partial<BossDef>): BossDef {
  const ref = REF_UPGRADED_DPS[worldIndex];
  return {
    worldIndex,
    signature,
    enrageWindowSec: enrageWindowFor(worldIndex),
    refUpgradedDps: ref,
    shieldHp: ref * SHIELD_BREAK_TARGET_SEC,
    minionType: 'bat',
    minionCap: 0,
    minionsPerSummon: 3,
    movement: 'chase',
    shieldColor: [1.0, 0.75, 0.3],
    shieldColorHex: '#ffbf4d',
    ...extra,
  };
}

export const BOSS_DEFS: Record<number, BossDef> = {
  0: def(0, 'magma_geysers', { shieldColor: [1.0, 0.62, 0.15], shieldColorHex: '#ff9e26' }),
  1: def(1, 'eclipse_lances', { minionType: 'phantom', minionCap: 2, minionsPerSummon: 1, shieldColor: [0.35, 0.75, 1.0], shieldColorHex: '#59bfff' }),
  2: def(2, 'refraction_beams', { minionType: 'sentry_shard', minionCap: 2, minionsPerSummon: 1, shieldColor: [0.72, 0.45, 1.0], shieldColorHex: '#b873ff' }),
  3: def(3, 'thunder_march', { minionType: 'imp', minionsPerSummon: 2, movement: 'patrolTop', shieldColor: [0.45, 1.0, 0.55], shieldColorHex: '#73ff8c' }),
  4: def(4, 'soul_scythe', { minionType: 'mite', minionCap: 6, minionsPerSummon: 3, movement: 'patrolTop', shieldColor: [0.75, 0.72, 0.85], shieldColorHex: '#bfb8d9' }),
  5: def(5, 'coronation', { shieldColor: [1.0, 0.9, 0.45], shieldColorHex: '#ffe673' }),
  6: def(6, 'shatter_rings', { minionType: 'pyre_moth', minionCap: 3, minionsPerSummon: 1, shieldColor: [0.65, 0.95, 1.0], shieldColorHex: '#a6f2ff' }),
  7: def(7, 'twin_breath', { minionType: 'imp', minionsPerSummon: 2, movement: 'passes', shieldColor: [1.0, 0.85, 0.3], shieldColorHex: '#ffd94d' }),
  8: def(8, 'fractured_grid', { minionType: 'pyre_moth', minionCap: 3, minionsPerSummon: 1, shieldColor: [1.0, 0.45, 0.4], shieldColorHex: '#ff7366' }),
  // World 10 summons Gloomwing variants (the bat law) and, on
  // alternating summons, Mites; the alternation lives in the game
  // component's summon path, so the def keeps the bat record.
  9: def(9, 'ascension', { minionsPerSummon: 2, shieldColor: [0.95, 0.9, 1.0], shieldColorHex: '#f2e6ff' }),
};

export function bossDefFor(worldIndex: number): BossDef {
  return BOSS_DEFS[worldIndex] || BOSS_DEFS[0];
}

// One fight's runtime state, stored on the boss's EnemyData. All
// times are fight-clock seconds (accumulated physics steps), so
// pauses and frame rate never move an enrage or a telegraph.
export interface BossSigState {
  id: BossSignatureId;
  phase: 'telegraph' | 'active';
  startSec: number;      // fight-clock time the telegraph began
  telegraphSec: number;  // telegraph length for this cast
  fireSec: number;       // fight-clock time the attack executes
  data: any;             // per-signature working data (hazards, copies, timeline)
}

export interface BossFightEvent {
  t: number;             // fight-clock seconds
  kind: string;          // spawn | enrage_warning | enraged | shield_telegraph | shield_up | shield_break | shield_down | signature_telegraph | signature_fire | signature_end | hazard_hit
  detail?: string;
}

export interface BossFightState {
  worldIndex: number;
  fightSec: number;
  enrageAtSec: number;   // rolled at spawn inside the def's window
  enrageWarned: boolean;
  enraged: boolean;
  // Shield and regen phase state.
  shieldHp: number;
  shieldMaxHp: number;
  shieldUp: boolean;
  shieldTelegraphStartSec: number; // -1 when no telegraph is running
  shieldUpAtSec: number;
  healedThisFight: number;
  healedThisPhase: number;
  phasesUsed: number;
  lastShieldStartSec: number;
  nextThresholdIdx: number;
  // Signature schedule.
  nextSignatureAtSec: number;
  sig: BossSigState | null;
  events: BossFightEvent[];
  // Stage 10 per-boss extras (additive; only the owning world's
  // executor reads them). World 6: the one-time False Rebirth at
  // 50 percent HP (ash window on the fight clock, then faster
  // fans for the rest of the fight). World 9: the chaos form cycle
  // (form index and the fight time the current form began; the
  // renderer flows points between forms over the first second).
  // World 10: Singularity thresholds consumed (66 then 33 percent),
  // the kit-mirror rotation index, and the below-25-percent finale
  // rage (summons stop; the drill chains into the burst).
  rebirthUsed?: boolean;
  rebirthDone?: boolean;
  ashUntilSec?: number;
  formIdx?: number;
  formStartSec?: number;
  lastChaosPattern?: string;
  singIdx?: number;
  kitIdx?: number;
  finaleRage?: boolean;
  // Redesign: health phase last seen and signature cast count.
  lastPhase?: 1 | 2 | 3;
  castCount?: number;
}

export function createBossFightState(worldIndex: number): BossFightState {
  const d = bossDefFor(worldIndex);
  const [a, b] = d.enrageWindowSec;
  return {
    worldIndex,
    fightSec: 0,
    enrageAtSec: a + Math.random() * (b - a),
    enrageWarned: false,
    enraged: false,
    shieldHp: 0,
    shieldMaxHp: d.shieldHp,
    shieldUp: false,
    shieldTelegraphStartSec: -1,
    shieldUpAtSec: 0,
    healedThisFight: 0,
    healedThisPhase: 0,
    phasesUsed: 0,
    lastShieldStartSec: -999,
    nextThresholdIdx: 0,
    nextSignatureAtSec: 6,
    sig: null,
    events: [],
  };
}

export function bossEvent(st: BossFightState, kind: string, detail?: string) {
  st.events.push({ t: +st.fightSec.toFixed(2), kind, detail });
  if (st.events.length > 300) st.events.splice(0, st.events.length - 300);
}
