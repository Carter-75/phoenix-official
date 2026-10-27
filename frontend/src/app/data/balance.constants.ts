// Balance constants for the Phoenix Fall overhaul.
//
// Source of truth: ~/workspace/phoenix-design/SYSTEMS-OVERHAUL.md
// (Sections 1, 3, and 6, plus the decision log). This file lands the spec's
// anchor tables as typed data (systems stage S0, with visual Stage 0) so
// later stages and the playtest harness import one copy of the numbers
// instead of restating them.
//
// Only one value in this file is wired into gameplay in this stage: the
// boss HP constants below, read by entity-spawner.service. Everything else
// is reference data for the stages that implement it.
//
// Boss HP growth: Carter's decision (spec decision log, Oct 25, 2026) sets
// the growth base to 1.42 per world, the midpoint of the shipped 1.5 and
// the proposed 1.34. World 1 boss HP stays 1000; world 2 becomes 1420.

export const BOSS_BASE_HP = 1000;
export const BOSS_HP_GROWTH = 1.42;

export function bossMaxHp(worldIndex: number): number {
  return Math.floor(BOSS_BASE_HP * Math.pow(BOSS_HP_GROWTH, worldIndex));
}

// Enemy HP world scaling is a separate law from boss growth and does not
// change (spec Section 1.7). Recorded here as an anchor only; the spawner
// keeps applying it as before.
export const ENEMY_HP_WORLD_GROWTH = 1.5;

// ---------------------------------------------------------------------------
// Section 1.1 anchors
// ---------------------------------------------------------------------------

export const AUTO_FIRE = {
  damageAtBaseStats: 10,
  intervalMsAtBaseStats: 1500,
  dpsAtBaseStats: 6.67, // 10 damage per 1.5 s; PI 1.0 is defined against this
};

export const PLAYER_ANCHORS = {
  cruiseCrossingSeconds: 1.4, // one full-width crossing at base speed stat
  turnRateCapRadPerSec: 5.5,
  enemySpeedCeilingLuPerSec: 1.685, // the bat; nothing may exceed it (halved with cruise in the Oct 25, 2026 speed retune; was 3.37)
  contactDamageStandard: 10,
  contactDamageBoss: 50,
  heartDropChance: 0.1,
  heartHeal: 20,
  coinEvPerNormalKill: 6.0,
  xpCurve: 'floor(100 x 1.05^level)', // shipped curve; the Temp 1.2 curve was not adopted
};

export interface EnemyClassAnchor {
  id: string;
  displayName: string;
  ttkClass: 'fragile' | 'standard' | 'sturdy' | 'armored' | 'minion';
  hpWorld0: number;
  speedCapLuPerSec: number;
  xp: number;
  notes: string;
}

// World 0 values; HP scales by ENEMY_HP_WORLD_GROWTH per world index.
export const ENEMY_CLASS_ANCHORS: EnemyClassAnchor[] = [
  { id: 'bat', displayName: 'Bat (Gloomwing)', ttkClass: 'fragile', hpWorld0: 10, speedCapLuPerSec: 1.685, xp: 5, notes: 'Fastest thing in the game; the speed ceiling.' },
  { id: 'slime', displayName: 'Slime (Ember Glob)', ttkClass: 'standard', hpWorld0: 20, speedCapLuPerSec: 0.24, xp: 2, notes: '' },
  { id: 'golem', displayName: 'Golem (Bastion Golem)', ttkClass: 'armored', hpWorld0: 200, speedCapLuPerSec: 0.005, xp: 20, notes: 'Aimed shot every 3 s.' },
  { id: 'boss_minion', displayName: 'Boss minion (bat variant)', ttkClass: 'minion', hpWorld0: 5, speedCapLuPerSec: 1.685, xp: 5, notes: 'Summoned only.' },
];

// ---------------------------------------------------------------------------
// Section 1.2 reference profiles. All TTK and survivability math in the spec
// uses exactly these two loadouts; scripted balance checks instantiate them.
// ---------------------------------------------------------------------------

export interface ReferenceProfile {
  id: 'F' | 'U';
  name: string;
  stats: {
    maxHealth: number; // before the level HP bonus
    speed: number;
    magnetism: number;
    damage: number;
    attackSpeed: number;
    burstDamage: number;
    auraRadius: number;
    homingLevel: number;
    attackRange: number;
  };
  moveDamageMultiplier: number;
  notes: string;
}

export const PROFILE_F: ReferenceProfile = {
  id: 'F',
  name: 'Profile F (fresh at world)',
  stats: { maxHealth: 100, speed: 2.0, magnetism: 1.0, damage: 10, attackSpeed: 1.0, burstDamage: 20, auraRadius: 250, homingLevel: 0, attackRange: 400 },
  moveDamageMultiplier: 1.0,
  notes: 'BASE_STATS as shipped, burst and aura unlocked at level 1 (the world 0 starting grant), no other purchases. The level HP bonus applies at the world entry level in WORLD_ENTRY.',
};

export const PROFILE_U: ReferenceProfile = {
  id: 'U',
  name: 'Profile U (appropriately upgraded)',
  stats: { maxHealth: 150, speed: 2.0, magnetism: 1.0, damage: 14, attackSpeed: 1.3, burstDamage: 20, auraRadius: 250, homingLevel: 0, attackRange: 400 },
  // The level 8 deterministic damage modifier on the standard
  // target curve (1 + (5.0 - 1) x 8/30 = 2.0667), corrected in S6:
  // this record previously said 1.6, which no shipped code path
  // ever produced.
  moveDamageMultiplier: 2.0667,
  notes: 'Profile F plus damage +4 steps (14), attackSpeed +0.3 (1.3), maxHealth +5 steps (150 before level bonus), one move per input family unlocked, equipped moves at level 8 with deterministic modifiers (damage 2.0667 on the standard target curve). Cost, restated in S6 from the seeded economy run: the core (passives 4,772 plus unlocks 2,200 = 6,972) is what about three clears earn (observed 8,091); the level 8 upgrade tail on the four equipped moves costs about 23,300 more at the flattened x1.25 ability curve (S6), so the full profile is a mid-game build at about 30,300 coins total, not a three-clear build. The earlier "roughly 6,000 to 8,000" figure priced the core only.',
};

export const REFERENCE_PROFILES: Record<'F' | 'U', ReferenceProfile> = { F: PROFILE_F, U: PROFILE_U };

// Section 6.1 and 6.2: expected entry level is about 10 per world already
// cleared; the level HP bonus is +10 max HP per level, capped at +200, and
// is computed from the stored level (never stored itself).
export const LEVEL_HP_BONUS = { perLevel: 10, cap: 200 };

// The level HP bonus is computed from the stored level at run
// start, never stored (Section 6.2 ruling). Wired live in S6: the
// game component adds this to the world record's maxHealth when a
// campaign run starts.
export function levelHpBonusFor(level: number): number {
  return Math.min(LEVEL_HP_BONUS.cap, Math.max(0, Math.floor(level)) * LEVEL_HP_BONUS.perLevel);
}

// Ability upgrade price growth (S6 economy decision, under
// Carter's balance latitude): the shop and the Battle AI price an
// ability upgrade at floor(upgrade base x GROWTH^(level-1)). The
// shipped x1.5 curve made the level 8 tail on four equipped moves
// cost 49,859 coins against about 8,091 for three seeded clears,
// and a level 30 step cost tens of millions; x1.25 puts the tail
// at about 23,300 and the final step in the low hundreds of
// thousands. Passive step costs keep their own capped x1.5 curve
// (ten steps maximum, proven affordable in S5) and do not use this.
export const ABILITY_UPGRADE_GROWTH = 1.25;

// World 10 elite tint (visual spec Sections 4 and 6.4, deferred by
// Stage 8 because that stage could not change HP): in the Abyssal
// Rift, Sturdy and Armored class types spawn as elite-tinted
// variants at 1.5 times HP. A content multiplier on the type,
// applied once at spawn; it is not a scaling law and stacks with
// nothing else. The Loom Serpent is the roster's own Elite class
// and is not tinted again.
export const WORLD10_ELITE_TYPES: ReadonlySet<string> = new Set(['pod', 'sentry_shard', 'golem', 'seedmother', 'shieldback']);
export const ELITE_HP_MULTIPLIER = 1.5;

export const WORLD_ENTRY: Array<{ worldIndex: number; expectedEntryLevel: number }> = [
  { worldIndex: 0, expectedEntryLevel: 0 },
  { worldIndex: 1, expectedEntryLevel: 10 },
  { worldIndex: 2, expectedEntryLevel: 20 },
  { worldIndex: 3, expectedEntryLevel: 30 },
  { worldIndex: 4, expectedEntryLevel: 40 },
  { worldIndex: 5, expectedEntryLevel: 50 },
  { worldIndex: 6, expectedEntryLevel: 60 },
  { worldIndex: 7, expectedEntryLevel: 70 },
  { worldIndex: 8, expectedEntryLevel: 80 },
  { worldIndex: 9, expectedEntryLevel: 90 },
];

// ---------------------------------------------------------------------------
// Section 1.3 time-to-kill bands: seconds of focused fire on one target at
// the world's own scaling. Ranges are [min, max] seconds; null means the
// combination is not expected to be attempted.
// ---------------------------------------------------------------------------

export interface EnemyTtkBand {
  ttkClass: string;
  label: string;
  world0Hp: number;
  freshAutoFireOnly: [number, number] | null;
  freshRotation: [number, number] | null;
  upgradedRotation: [number, number] | null;
  notes: string;
}

export const ENEMY_TTK_BANDS: EnemyTtkBand[] = [
  { ttkClass: 'fragile', label: 'Fragile', world0Hp: 10, freshAutoFireOnly: [0.5, 1.5], freshRotation: [0.5, 1.5], upgradedRotation: [0, 1], notes: 'Upgraded rotation: under 1 s.' },
  { ttkClass: 'standard', label: 'Standard', world0Hp: 20, freshAutoFireOnly: [1.5, 3.5], freshRotation: [1.5, 3], upgradedRotation: [1, 2], notes: '' },
  { ttkClass: 'sturdy', label: 'Sturdy', world0Hp: 60, freshAutoFireOnly: [6, 10], freshRotation: [4, 8], upgradedRotation: [2.5, 5], notes: '' },
  { ttkClass: 'armored', label: 'Armored', world0Hp: 200, freshAutoFireOnly: [25, 35], freshRotation: [12, 25], upgradedRotation: [8, 15], notes: '' },
  { ttkClass: 'elite', label: 'Elite', world0Hp: 400, freshAutoFireOnly: null, freshRotation: [25, 45], upgradedRotation: [20, 40], notes: 'Fresh auto-fire only is not expected against Elite.' },
];

// Section 1.4 boss TTK bands. S6 re-base (Oct 27, 2026, under
// Carter's standing balance latitude): the bands are now per
// world and anchored to the S6 probe, which measured every
// fight on the fight clock (Stage 9's two-clock method). Fresh
// measured: 134, 66, 110, 148, 200 in Worlds 1 to 5; World 6
// derived 277 and World 10 derived 833 from DPS-slope windows
// (Worlds 7 to 9 fresh interpolated between the slope
// anchors). Upgraded measured: 37, 28, 42, 60, 68, 104, 151,
// 199; Worlds 9 and 10 derived 222 and 341 from slopes. The
// pre-S6 bands (75-150 / 90-180 / 100-190 fresh) were sim
// numbers from before the boss rig existed: shield phases now
// add up to 15 percent healing plus shield downtime to every
// fight, and the 1.42 HP law puts the finale bosses at 11.6k to
// 23.5k HP, which no honest profile kills inside the old tops.
// Enrage windows anchor to each world's fresh top in
// boss-rig.ts, so the windows moved with the bands; the
// fairness invariants are untouched.
export interface BossTtkBand {
  label: string;
  worldIndexes: number[];
  freshSeconds: [number, number];
  upgradedSeconds: [number, number];
  notes: string;
}

export const BOSS_TTK_BANDS: BossTtkBand[] = [
  { label: 'World 1', worldIndexes: [0], freshSeconds: [60, 170], upgradedSeconds: [25, 90], notes: 'S6 measured fresh 134, upgraded 37.' },
  { label: 'World 2', worldIndexes: [1], freshSeconds: [50, 170], upgradedSeconds: [20, 90], notes: 'S6 measured fresh 66, upgraded 28.' },
  { label: 'World 3', worldIndexes: [2], freshSeconds: [60, 170], upgradedSeconds: [25, 90], notes: 'S6 measured fresh 110, upgraded 42.' },
  { label: 'World 4', worldIndexes: [3], freshSeconds: [85, 200], upgradedSeconds: [40, 115], notes: 'S6 measured fresh 148, upgraded 60.' },
  { label: 'World 5', worldIndexes: [4], freshSeconds: [85, 260], upgradedSeconds: [40, 115], notes: 'S6 measured fresh 200, upgraded 68.' },
  { label: 'World 6', worldIndexes: [5], freshSeconds: [120, 360], upgradedSeconds: [45, 135], notes: 'S6 fresh derived 277 (DPS slope), upgraded measured 104.' },
  { label: 'World 7', worldIndexes: [6], freshSeconds: [140, 500], upgradedSeconds: [55, 195], notes: 'S6 fresh interpolated, upgraded measured 151.' },
  { label: 'World 8', worldIndexes: [7], freshSeconds: [160, 680], upgradedSeconds: [60, 260], notes: 'S6 fresh interpolated, upgraded measured 199.' },
  { label: 'World 9', worldIndexes: [8], freshSeconds: [200, 880], upgradedSeconds: [70, 290], notes: 'S6 fresh interpolated, upgraded derived 222 (DPS slope).' },
  { label: 'World 10', worldIndexes: [9], freshSeconds: [260, 1080], upgradedSeconds: [85, 440], notes: 'S6 derived fresh 833, upgraded 341 (DPS slopes).' },
];

// ---------------------------------------------------------------------------
// Section 1.5 survivability budget, counted in hits taken by the mid-skill
// harness bot at Profile F. Boss contact (50 damage) counts as 5 hits.
// ---------------------------------------------------------------------------

export const SURVIVABILITY_HIT_BUDGET = {
  profile: 'F' as const,
  botDefinition: 'Mid-skill pilot: dodges telegraphed attacks with 0.4 s reaction, does not dodge contact optimally, uses moves on cooldown.',
  hitsBySegment: { early: 3, mid: 4, late: 4, preBoss: 2, boss: 5 },
  maxRunDamagePressure: 180,
  bossContactCountsAsHits: 5,
  medianFirstClearEndHpPercent: [20, 60] as [number, number],
};

// ---------------------------------------------------------------------------
// Section 1.6 power index rules. PI = (expected damage per cast against the
// intended target profile, divided by cooldown in seconds) / 6.67.
// ---------------------------------------------------------------------------

export const PI_RULES = {
  baselineDps: 6.67,
  tapAndDoubleBand: [0.8, 2.2] as [number, number],
  holdMax: 2.6,
  defensiveCreditCap: 0.5,
  ultimateBossHpCapFraction: 0.25, // no single ultimate cast deals more than this share of current boss HP; enforced dynamically at cast time
  ultimateMinCooldownSeconds: 45,
};

// ---------------------------------------------------------------------------
// Section 5 (stage S5): passives, drops, multiplier stacking, and the
// crate and exchange rulings. These records are the single source the
// shop, the game loop, and the harness all read: the lane and cap
// table drives the shop cards and every purchase path's refusal.
// ---------------------------------------------------------------------------

export type PassiveLane = 'offense' | 'survival' | 'utility';

export interface PassiveDef {
  stat: string; // WorldStats field
  name: string;
  lane: PassiveLane;
  stepAmount: number; // stat gained per step
  baseValue: number; // the stat's value at step 0
  stepCost: number; // coin cost of step 1; later steps grow by the shop's 1.5 law
  capSteps: number; // hard cap in steps (spec Section 5.2)
  maxValue: number; // the stat's hard cap value at capSteps
}

export const PASSIVES: PassiveDef[] = [
  // Offense lane
  { stat: 'damage', name: 'Power', lane: 'offense', stepAmount: 1, baseValue: 10, stepCost: 250, capSteps: 10, maxValue: 20 },
  { stat: 'attackSpeed', name: 'Tempo', lane: 'offense', stepAmount: 0.1, baseValue: 1, stepCost: 300, capSteps: 10, maxValue: 2.0 },
  { stat: 'homingLevel', name: 'Seeker', lane: 'offense', stepAmount: 1, baseValue: 0, stepCost: 300, capSteps: 5, maxValue: 5 },
  // Survival lane
  { stat: 'maxHealth', name: 'Vitality', lane: 'survival', stepAmount: 10, baseValue: 100, stepCost: 100, capSteps: 10, maxValue: 200 },
  { stat: 'speed', name: 'Swiftness', lane: 'survival', stepAmount: 0.1, baseValue: 2, stepCost: 150, capSteps: 6, maxValue: 2.6 },
  { stat: 'aegisPlating', name: 'Aegis Plating', lane: 'survival', stepAmount: 1, baseValue: 0, stepCost: 400, capSteps: 3, maxValue: 3 },
  // Utility lane
  { stat: 'magnetism', name: 'Magnetism', lane: 'utility', stepAmount: 0.1, baseValue: 1, stepCost: 200, capSteps: 10, maxValue: 2.0 },
  { stat: 'attackRange', name: 'Reach', lane: 'utility', stepAmount: 50, baseValue: 400, stepCost: 250, capSteps: 5, maxValue: 650 },
  { stat: 'auraRadius', name: 'Aura', lane: 'utility', stepAmount: 10, baseValue: 250, stepCost: 400, capSteps: 10, maxValue: 350 },
];

export const PASSIVE_BY_STAT: Record<string, PassiveDef> = Object.fromEntries(PASSIVES.map(p => [p.stat, p]));

// Multiplier stacking (spec Section 5.5): permanent x temporary is
// capped before any proc; the Golden Aura's 10 percent x5 proc is
// not part of the stack and applies after the cap, unchanged.
export const MULTIPLIER_CAPS = { coin: 10, xp: 4 };

// Pickup drop table (spec Section 5.4). Class membership comes from
// the Section 1.2 roster classes; see ENEMY_CLASS_ANCHORS for names.
export const DROP_RULES = {
  heartBaseChance: 0.10, // any non-mine kill
  heartSturdyChance: 0.12, // Sturdy class and up
  heartHealValue: 20,
  gemEliteChance: 0.25, // Elite class kills: 1 gem
  sparkCellChance: 0.08, // Swift and Dart class kills
  sparkCellStamina: 50,
  overchargeChance: 0.02, // Armored class kills and up
  overchargeWindowMs: 10000, // the charged cast must happen within this window
};

// Crate rulings (spec Section 5.6): a crate's contents are fixed
// values; the display is the grant and the grant is the display, and
// no multiplier of any kind applies to crate contents.
export const CRATE_CONTENTS = { coins: 5000, gems: 100 };

// The ad-granted upgrade ceiling (spec Section 5.6): a rewarded ad
// may grant a step or unlock whose current coin cost is at most
// this; above it the ad option is not offered.
export const AD_UPGRADE_MAX_COST = 1000;

// The gem exchange (spec Section 5.6): exactly this many coins per
// gem, granted directly (no multiplier), presented as a plain
// exchange with no spin.
export const GEM_EXCHANGE_COINS_PER_GEM = 1500;

// ---------------------------------------------------------------------------
// Mode trio stage (Oct 27, 2026): Endless escalation and per-world
// Battle rival scaling. Both are content tables; the game loop reads
// them, nothing restates the numbers elsewhere.
// ---------------------------------------------------------------------------

// Endless escalation: a step every stepSeconds of survival. Inside a
// step the wave composer replays the world's own band table from
// early to pre-boss (phase = position inside the step), so the
// composition pressure the campaign spreads over one run recurs in
// miniature, minus the pre-boss lull (no boss is coming) and minus
// the boss itself. Across steps the pressure grows through enemy HP:
// hpScale multiplies the world's own HP law by growthPerStep^step,
// capped at hpCap. 1.12 per step reaches about 2x at step 6 (4.5
// minutes) and the 4x cap at step 12 (9 minutes): a fresh profile
// should feel step 0 as the world's early bands and be genuinely
// squeezed by step 4 to 6, while the cap keeps late Endless a
// density and dodge problem instead of a pure HP wall. The band
// maxAlive caps (12 at most) and the 45k live-points budget are
// untouched, so density stays inside the shipped fairness caps.
export const ENDLESS_ESCALATION = {
  stepSeconds: 45,
  hpGrowthPerStep: 1.12,
  hpCap: 4,
};

export function endlessHpScale(step: number): number {
  const s = Math.max(0, Math.floor(step));
  return Math.min(ENDLESS_ESCALATION.hpCap, Math.pow(ENDLESS_ESCALATION.hpGrowthPerStep, s));
}

export function endlessStepAt(survivalSeconds: number): number {
  return Math.floor(Math.max(0, survivalSeconds) / ENDLESS_ESCALATION.stepSeconds);
}

export function endlessPhaseAt(survivalSeconds: number): number {
  const t = Math.max(0, survivalSeconds);
  return (t % ENDLESS_ESCALATION.stepSeconds) / ENDLESS_ESCALATION.stepSeconds;
}

// Per-world Battle rival scaling: the rival's stat block starts as a
// clone of the player's own world record (which already grows world
// by world through upgrades), and Battle has always multiplied its
// health by 10 to make a duel-length pool. This table adds the
// per-world tier Carter asked for on top of that clone:
//   hp:         extra health multiplier, 1.00 in World 1 rising to
//               2.08 in World 10, so late-world rivals stay duel
//               length against late-world player damage.
//   damage:     multiplier on the rival's damage and burstDamage
//               stats, 1.00 rising to 1.45. Speed and attack speed
//               are deliberately NOT scaled: the player's learned
//               dodge timing and the fairness invariants depend on
//               them, and the duel tightens through health and hit
//               weight instead.
//   levelBonus: added to the rival's ability levels (which are the
//               average of the player's equipped levels, the shipped
//               parity rule): +1 from World 4, +2 from World 7, the
//               loadout tier rising with the world.
export interface RivalWorldScaling {
  hp: number;
  damage: number;
  levelBonus: number;
}

export const RIVAL_WORLD_SCALING: RivalWorldScaling[] = Array.from({ length: 10 }, (_, w) => ({
  hp: 1 + 0.12 * w,
  damage: 1 + 0.05 * w,
  levelBonus: Math.min(2, Math.floor(w / 3)),
}));

export function rivalScalingFor(worldIndex: number): RivalWorldScaling {
  const w = Math.min(9, Math.max(0, Math.floor(worldIndex)));
  return RIVAL_WORLD_SCALING[w];
}

// Section 3.3 per-move power index data. Damage is stated in SU
// (1 SU = 10 damage at the base damage stat, scaling with the damage stat
// unless a move says otherwise). pi is null where the spec does not cost
// the move by sustained PI: ultimates are burst-capped instead, and
// Inferno Wave is a swarm clearer whose single-target PI is low by design.
export interface MovePiData {
  id: string;
  name: string;
  family: 'tap' | 'double' | 'hold' | 'triple';
  catalogId: string | null; // temp-catalog id the identity comes from, if any
  damage: string;
  damageSuTotal: number | null; // single-cast SU total where the spec states one
  cooldownSeconds: number;
  intendedTargets: string;
  pi: number | null;
  piNote: string; // the trade the move pays, per rule 1.6.4
}

export const MOVE_PI_DATA: MovePiData[] = [
  // TAP family
  { id: 'fire_dart', name: 'Fire Dart', family: 'tap', catalogId: 'double_1', damage: '1.5 SU single projectile', damageSuTotal: 1.5, cooldownSeconds: 2, intendedTargets: 'single target', pi: 1.1, piNote: 'Pays for its low cooldown with single-target-only and no homing.' },
  { id: 'drill_attack', name: 'Drill Attack', family: 'tap', catalogId: null, damage: 'contact 6 SU per enemy crossed', damageSuTotal: null, cooldownSeconds: 20, intendedTargets: 'path (enemies crossed)', pi: 1.0, piNote: 'About 1.0 plus defensive value. Numbers unchanged from the shipped move.' },
  { id: 'burst', name: 'Burst', family: 'tap', catalogId: null, damage: 'radial ring of 8 projectiles, 0.8 SU each (6.4 SU total)', damageSuTotal: 6.4, cooldownSeconds: 6, intendedTargets: '2.5 targets (large ring)', pi: 1.07, piNote: 'PI 0.27 against a single target. Pays for true area with per-hit damage (0.8 vs the old fan 1.5) and +1 s cooldown; the fan identity moved to Phoenix Talon.' },
  { id: 'fire_breath', name: 'Fire Breath', family: 'tap', catalogId: null, damage: '20 pellets x 0.5 SU over 1 s', damageSuTotal: 10, cooldownSeconds: 8, intendedTargets: 'single target, short-range cone', pi: 1.9, piNote: 'PI 1.9 point-blank, about 1.1 at a realistic 60 percent pellet land rate. Numbers unchanged; pays with a 1 s committed channel.' },
  { id: 'meteor_rush', name: 'Meteor Rush', family: 'tap', catalogId: 'double_6', damage: '3 SU to each enemy crossed', damageSuTotal: null, cooldownSeconds: 10, intendedTargets: '2 enemies crossed', pi: 0.9, piNote: 'Pays versus Drill with half the per-enemy damage and no damage reduction during the rush.' },
  // DOUBLE family
  { id: 'phoenix_talon', name: 'Phoenix Talon', family: 'double', catalogId: 'double_7', damage: '3 slashes x 1.5 SU fan', damageSuTotal: 4.5, cooldownSeconds: 7, intendedTargets: 'fan (multi-target)', pi: 0.96, piNote: 'Inherits the old Burst fan at double-family scale; pays for reach with the triple-tap input.' },
  { id: 'spark_storm', name: 'Spark Storm', family: 'double', catalogId: 'double_4', damage: '6 homing sparks x 0.8 SU', damageSuTotal: 4.8, cooldownSeconds: 9, intendedTargets: 'up to 6 separate targets', pi: 0.8, piNote: 'Pays for homing with the joint-lowest per-hit damage in the roster.' },
  { id: 'fire_lance', name: 'Fire Lance', family: 'double', catalogId: 'double_3', damage: '3.5 SU piercing line', damageSuTotal: 3.5, cooldownSeconds: 8, intendedTargets: '2 targets (line)', pi: 1.3, piNote: 'PI 0.66 against a single target. Pays for pierce with a narrow line and no tracking.' },
  { id: 'flame_tornado', name: 'Flame Tornado', family: 'double', catalogId: 'triple_3', damage: 'zone 3 s: 0.5 SU per 0.5 s tick per enemy inside (3 SU per enemy at full duration)', damageSuTotal: 3, cooldownSeconds: 12, intendedTargets: 'single target at realistic 50 percent uptime', pi: 1.25, piNote: 'Pays for area denial with zero burst and a stationary zone enemies can walk out of.' },
  { id: 'solar_bomb', name: 'Solar Bomb', family: 'double', catalogId: 'triple_5', damage: '5 SU', damageSuTotal: 5, cooldownSeconds: 9, intendedTargets: 'medium area', pi: 0.83, piNote: 'Pays for the biggest non-ultimate single hit with a 0.4 s fuse after it lands.' },
  // HOLD family (all also pay the 1.5 s planted charge of spec Section 3.2)
  { id: 'phoenix_turret', name: 'Phoenix Turret', family: 'hold', catalogId: null, damage: 'baby phoenix fire plus return explosion of 5 x base damage', damageSuTotal: null, cooldownSeconds: 14, intendedTargets: 'single seeker target', pi: 1.5, piNote: 'Costed as a deployable, about 1.5 sustained while active. Cooldown rose from 12 to 14 as the charge payment; hatch delay is part of its risk.' },
  { id: 'aura', name: 'Aura', family: 'hold', catalogId: null, damage: '0.25 SU per tick, 2 ticks per second, for 5 s', damageSuTotal: null, cooldownSeconds: 17, intendedTargets: 'self zone (medium)', pi: 0.5, piNote: 'About 0.5 plus zone safety value. Cooldown rose from 15 to 17 as the charge payment.' },
  { id: 'phoenix_inferno', name: 'Phoenix Inferno', family: 'hold', catalogId: 'hold_1', damage: 'beam 1.2 SU per 0.25 s tick while channeled, up to 3 s (14.4 SU full channel)', damageSuTotal: 14.4, cooldownSeconds: 14, intendedTargets: 'single target', pi: 1.27, piNote: 'Sustained across the full cycle. The channel forces Feather Brake speed and the cooldown only starts when the beam stops.' },
  { id: 'inferno_wave', name: 'Inferno Wave', family: 'hold', catalogId: 'hold_4', damage: 'expanding ring, 3 SU to every enemy it crosses', damageSuTotal: null, cooldownSeconds: 16, intendedTargets: 'large ring (swarm)', pi: null, piNote: 'Swarm clearer; single-target PI is low by design. Pays for full-screen reach with low per-target damage and the joint-longest hold cooldown.' },
  { id: 'rebirth', name: 'Rebirth', family: 'hold', catalogId: null, damage: 'on death: revive at full HP plus a shockwave that clears projectiles and damages nearby enemies', damageSuTotal: null, cooldownSeconds: 75, intendedTargets: 'self', pi: 0.5, piNote: 'Defensive move, credited at the 0.5 cap of rule 1.6.3. Cooldown rose from 60 to 75 as the charge payment.' },
  // TRIPLE family (ultimates): exempt from sustained PI, burst-capped instead
  { id: 'phoenix_nova', name: 'Phoenix Nova', family: 'triple', catalogId: 'hold_5', damage: '25 SU to everything within Large radius, clamped by the burst cap', damageSuTotal: 25, cooldownSeconds: 60, intendedTargets: 'large area', pi: null, piNote: 'Ultimate: capped at 25 percent of current boss HP per cast, dynamically clamped.' },
  { id: 'supernova', name: 'Supernova', family: 'triple', catalogId: 'triple_8', damage: '18 SU at the target point after a 0.8 s swelling fuse', damageSuTotal: 18, cooldownSeconds: 75, intendedTargets: 'medium area at a target point', pi: null, piNote: 'Ultimate: capped at 25 percent of current boss HP per cast, dynamically clamped. The fuse delay is its risk.' },
  { id: 'divine_wrath', name: 'Divine Wrath', family: 'triple', catalogId: 'hold_8', damage: '5 strikes of 3 SU over 2 s (15 SU total)', damageSuTotal: 15, cooldownSeconds: 70, intendedTargets: 'large area, grouped targets', pi: null, piNote: 'Ultimate: capped at 25 percent of current boss HP per cast, dynamically clamped.' },
  { id: 'phoenix_singularity', name: 'Phoenix Singularity', family: 'triple', catalogId: 'hold_24', damage: '2 s pull, then 15 SU detonation', damageSuTotal: 15, cooldownSeconds: 90, intendedTargets: 'medium area', pi: null, piNote: 'Ultimate: capped at 25 percent of current boss HP per cast, dynamically clamped. The pull can gather enemies toward the player if placed badly.' },
];
