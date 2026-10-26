// Per-world wave tables (visual spec Section 5.1, the composer model).
// Content, not logic: for each world that has a table, the spawner
// reads the band matching the current survival-phase progress and
// rolls a weighted entry from it. The spawn timer, the delay curve,
// the audio intensity modulation, and every speed and HP law stay
// exactly as they are; a table only decides WHAT an attempt produces
// (type, pack size) and how many bodies may be alive at once
// (maxAlive, the composition lever that keeps a band honest instead
// of stacking spawns without limit).
//
// Phase progress is the survival phase fraction: 0 at realm start,
// 1 when the boss arrives at the world BGM end (or the 300 s timer
// fallback; spec Section 5.1 defines run progress exactly that way).
// The pre-boss band carries the deliberate lull as data (lullSeconds:
// no spawns in the final seconds before the boss trigger), never as
// a code special case.
//
// Worlds without a table keep the legacy hardcoded chance gates
// untouched; their tables land with their roster stages. An entry
// whose type has not shipped yet (Pyre Moth in World 1, Sentry Shard
// in World 3, both Stage 4) is listed at its spec weight and treated
// as weight zero by the composer until the type exists, so the tables
// below are already the final Section 5 mixes.

export type SpawnTypeId = 'slime' | 'bat' | 'golem' | 'imp' | 'wisp' | 'pod' | 'mite';

export interface WaveEntry {
  type: string; // SpawnTypeId once shipped; later-stage types are inert until they exist
  weight: number;
  pack?: [number, number]; // [min, max] bodies per successful roll, default [1, 1]
}

export interface WaveBand {
  fromPhase: number; // inclusive, 0..1 of the survival phase
  toPhase: number; // exclusive, except the last band which includes 1
  maxAlive: number; // composition cap: spawn attempts above this produce nothing
  entries: WaveEntry[];
}

export interface WorldWaveTable {
  bands: WaveBand[];
  lullSeconds: number; // quiet window at the end of the last band (0 = no lull)
}

export const WAVE_TABLES: Record<number, WorldWaveTable> = {
  // World 1, Ember Wastes (spec Section 5.1 signature row): early
  // teaches Glob, then Gloomwing; mid pairs the Bastion Golem turret
  // with Glob waves; late runs Cinder Imp dash lanes through Glob
  // packs (Pyre Moths join at Stage 4); pre-boss peaks, then the lull.
  0: {
    lullSeconds: 5,
    bands: [
      // Band caps and weights tuned across the Stage 3 budget
      // re-check (see STAGE-3.md for the run table): the first
      // filed composer run cut the old composition's 121 weighted
      // hits to 32, and the remaining pressure measured as Golem
      // volleys and raw density in the late bands, so the Golem
      // weight halves outside its signature mid band and every
      // cap comes down one notch. Composition data is the only
      // lever the stage contract allows.
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 4, entries: [
        { type: 'slime', weight: 10, pack: [1, 2] },
        { type: 'bat', weight: 2 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 5, entries: [
        { type: 'slime', weight: 10, pack: [1, 2] },
        { type: 'bat', weight: 3 },
        { type: 'golem', weight: 2 },
      ] },
      // Late cap 8 to 7 and Glob packs 2-3 to 2-2 in the final
      // confirmation pass: late was the one band still straddling
      // its budget (4 and 9 across the two runs at cap 8).
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 7, entries: [
        { type: 'slime', weight: 8, pack: [2, 2] },
        { type: 'imp', weight: 5, pack: [1, 2] },
        { type: 'bat', weight: 4 },
        { type: 'golem', weight: 1 },
        { type: 'pyre_moth', weight: 2 }, // Stage 4 type: weight zero until it ships
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 10, entries: [
        { type: 'slime', weight: 8, pack: [2, 3] },
        { type: 'imp', weight: 6, pack: [1, 2] },
        { type: 'bat', weight: 5 },
        { type: 'golem', weight: 1 },
        { type: 'pyre_moth', weight: 2 }, // Stage 4 type: weight zero until it ships
      ] },
    ],
  },
  // World 2, Cerulean Depths: early teaches Bubble Glob, then the
  // Aether Wisp debut; mid drifts Brood Pods in under Wisp orbits;
  // late splits Pods under Wisp pressure with Deepwing flanks.
  1: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'slime', weight: 10, pack: [1, 2] },
        { type: 'wisp', weight: 3, pack: [1, 2] },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'slime', weight: 7, pack: [1, 2] },
        { type: 'wisp', weight: 5 },
        { type: 'pod', weight: 4 },
        { type: 'bat', weight: 3 },
        { type: 'golem', weight: 1 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'pod', weight: 6 },
        { type: 'wisp', weight: 6 },
        { type: 'bat', weight: 5 },
        { type: 'slime', weight: 5, pack: [1, 2] },
        { type: 'golem', weight: 1 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'pod', weight: 6 },
        { type: 'wisp', weight: 6 },
        { type: 'bat', weight: 5 },
        { type: 'slime', weight: 5, pack: [1, 2] },
        { type: 'golem', weight: 1 },
      ] },
    ],
  },
  // World 3, Amethyst Void: early teaches the Sentry Shard (Stage 4,
  // inert for now) and the Wisp, with Crystal Globs carrying the band
  // until the Shard ships; mid sprinkles Mites under Wisp pressure;
  // late crosses Brood Pods with the Shard line once it exists.
  2: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'wisp', weight: 6, pack: [1, 2] },
        { type: 'slime', weight: 5, pack: [1, 2] },
        { type: 'sentry_shard', weight: 4 }, // Stage 4 type: weight zero until it ships
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'wisp', weight: 6 },
        { type: 'pod', weight: 4 },
        { type: 'mite', weight: 4, pack: [3, 5] },
        { type: 'slime', weight: 4, pack: [1, 2] },
        { type: 'bat', weight: 3 },
        { type: 'sentry_shard', weight: 4 }, // Stage 4 type: weight zero until it ships
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'pod', weight: 6 },
        { type: 'wisp', weight: 5 },
        { type: 'bat', weight: 4 },
        { type: 'mite', weight: 4, pack: [3, 5] },
        { type: 'slime', weight: 3, pack: [1, 2] },
        { type: 'sentry_shard', weight: 5 }, // Stage 4 type: weight zero until it ships
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'pod', weight: 6 },
        { type: 'wisp', weight: 5 },
        { type: 'bat', weight: 4 },
        { type: 'mite', weight: 4, pack: [3, 5] },
        { type: 'slime', weight: 3, pack: [1, 2] },
        { type: 'sentry_shard', weight: 5 }, // Stage 4 type: weight zero until it ships
      ] },
    ],
  },
};
