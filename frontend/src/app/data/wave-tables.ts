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
// Stage 6 completes the set: all 10 worlds carry tables and every
// roster type has shipped, so no entry sits inert and the spawner's
// legacy hardcoded chance gates are retired (the composer routes
// every world; the legacy branch remains only as a fallback for a
// world index with no table, of which there are none).

export type SpawnTypeId = 'slime' | 'bat' | 'golem' | 'imp' | 'wisp' | 'pod' | 'mite' | 'sentry_shard' | 'seedmother' | 'rift_mine' | 'shieldback' | 'pyre_moth' | 'phantom' | 'wraith' | 'chanter' | 'serpent' | 'darter';

export interface WaveEntry {
  type: string; // SpawnTypeId once shipped; later-stage types are inert until they exist
  weight: number;
  pack?: [number, number]; // [min, max] bodies per successful roll, default [1, 1]
  // Stage 4: a placed entry does not roll for composition. When the
  // composer picks it, it lays a fixed pattern of Rift Mines at an
  // in-field anchor instead of spawning the entry type off screen
  // (the design sheet calls for pre-placed mine patterns in Verdant
  // Canopy, Golden Sands, and Abyssal Rift pre-boss waves). Stage 6
  // wired those three tables, closing the Stage 4 deviation: the
  // pre-boss bands of Worlds 4, 8, and 10 now carry placed entries.
  placed?: boolean;
  // Stage 6: a per-type alive cap as composition data (Section 5.1
  // late band rule: at most one Elite-class enemy alive before the
  // Abyssal Rift). When the live count of this entry's type reaches
  // the cap, the entry sits out the roll like a zero weight.
  maxOfType?: number;
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
        { type: 'pyre_moth', weight: 2 }, // Stage 4: live since the type shipped
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 10, entries: [
        { type: 'slime', weight: 8, pack: [2, 3] },
        { type: 'imp', weight: 6, pack: [1, 2] },
        { type: 'bat', weight: 5 },
        { type: 'golem', weight: 1 },
        { type: 'pyre_moth', weight: 2 }, // Stage 4: live since the type shipped
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
  // live) and the Wisp, with Crystal Globs carrying the band; mid
  // sprinkles Mites under Wisp pressure; late crosses Brood Pods
  // with the Shard line.
  2: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'wisp', weight: 6, pack: [1, 2] },
        { type: 'slime', weight: 5, pack: [1, 2] },
        { type: 'sentry_shard', weight: 4 }, // Stage 4: live since the type shipped
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'wisp', weight: 6 },
        { type: 'pod', weight: 4 },
        { type: 'mite', weight: 4, pack: [3, 5] },
        { type: 'slime', weight: 4, pack: [1, 2] },
        { type: 'bat', weight: 3 },
        { type: 'sentry_shard', weight: 4 }, // Stage 4: live since the type shipped
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'pod', weight: 6 },
        { type: 'wisp', weight: 5 },
        { type: 'bat', weight: 4 },
        { type: 'mite', weight: 4, pack: [3, 5] },
        { type: 'slime', weight: 3, pack: [1, 2] },
        { type: 'sentry_shard', weight: 5 }, // Stage 4: live since the type shipped
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'pod', weight: 6 },
        { type: 'wisp', weight: 5 },
        { type: 'bat', weight: 4 },
        { type: 'mite', weight: 4, pack: [3, 5] },
        { type: 'slime', weight: 3, pack: [1, 2] },
        { type: 'sentry_shard', weight: 5 }, // Stage 4: live since the type shipped
      ] },
    ],
  },
  // World 4, Verdant Canopy (Stage 6): early teaches the Thornmother
  // (Seedmother) and the minefield she lays; mid is minefield
  // navigation under Gloomwing harassment; late runs the Loom
  // Serpent through the minefield with Storm Sprite (Cinder Imp)
  // dives; the pre-boss band carries the sheet's pre-placed Rift
  // Mine pattern alongside the peak.
  3: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'slime', weight: 6, pack: [1, 2] },
        { type: 'seedmother', weight: 3 },
        { type: 'bat', weight: 3 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'bat', weight: 6 },
        { type: 'slime', weight: 6, pack: [1, 2] },
        { type: 'seedmother', weight: 4 },
        { type: 'imp', weight: 2 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'serpent', weight: 3, maxOfType: 1 },
        { type: 'imp', weight: 5, pack: [1, 2] },
        { type: 'bat', weight: 5 },
        { type: 'slime', weight: 4, pack: [1, 2] },
        { type: 'seedmother', weight: 3 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'serpent', weight: 3, maxOfType: 1 },
        { type: 'imp', weight: 6, pack: [1, 2] },
        { type: 'bat', weight: 5 },
        { type: 'slime', weight: 5, pack: [2, 3] },
        { type: 'seedmother', weight: 3 },
        { type: 'rift_mine', weight: 3, pack: [4, 4], placed: true },
      ] },
    ],
  },
  // World 5, Ashen Peaks (Stage 6): early teaches the Shieldback
  // wall and the Shroud Phantom; mid advances the wall while
  // Phantoms flank; late puts the Ash Golem turret behind the
  // Shieldback line, with Sentry Shard guests and single Lance
  // Wraith guests in the late waves (sheet 14).
  4: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'shieldback', weight: 5 },
        { type: 'phantom', weight: 5 },
        { type: 'bat', weight: 2 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'shieldback', weight: 6 },
        { type: 'phantom', weight: 5 },
        { type: 'golem', weight: 3 },
        { type: 'bat', weight: 3 },
        { type: 'sentry_shard', weight: 2 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'golem', weight: 4 },
        { type: 'shieldback', weight: 6 },
        { type: 'phantom', weight: 5 },
        { type: 'sentry_shard', weight: 3 },
        { type: 'wraith', weight: 2 },
        { type: 'bat', weight: 3 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'golem', weight: 4 },
        { type: 'shieldback', weight: 6 },
        { type: 'phantom', weight: 6 },
        { type: 'sentry_shard', weight: 3 },
        { type: 'wraith', weight: 2 },
        { type: 'bat', weight: 3 },
      ] },
    ],
  },
  // World 6, Crystal Caverns (Stage 6): early teaches the Prism
  // Shard (Sentry Shard) and the Wisp; mid is the War Chanter
  // buffing Shard and Geode Pod groups; late is Shieldbacks with a
  // Chanter behind them (kill the Chanter first, per Section 5.1).
  5: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'sentry_shard', weight: 6 },
        { type: 'wisp', weight: 5, pack: [1, 2] },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'sentry_shard', weight: 5 },
        { type: 'pod', weight: 4 },
        { type: 'chanter', weight: 3 },
        { type: 'wisp', weight: 4 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'shieldback', weight: 5 },
        { type: 'chanter', weight: 4 },
        { type: 'sentry_shard', weight: 4 },
        { type: 'pod', weight: 4 },
        { type: 'wisp', weight: 3 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'shieldback', weight: 5 },
        { type: 'chanter', weight: 4 },
        { type: 'sentry_shard', weight: 5 },
        { type: 'pod', weight: 5 },
        { type: 'wisp', weight: 4 },
      ] },
    ],
  },
  // World 7, Neon Nebula (Stage 6): early teaches the Storm Darter
  // and the Rime Moth (Pyre Moth); mid crosses Darter passes with
  // Neon Wisp orbits; late combines Frostwraith (Phantom) and
  // Darter timing, with Sentry Shard guests throughout.
  6: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'darter', weight: 5 },
        { type: 'pyre_moth', weight: 4 },
        { type: 'wisp', weight: 3 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'darter', weight: 6 },
        { type: 'wisp', weight: 5 },
        { type: 'pyre_moth', weight: 4 },
        { type: 'sentry_shard', weight: 2 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'phantom', weight: 5 },
        { type: 'darter', weight: 6 },
        { type: 'wisp', weight: 4 },
        { type: 'pyre_moth', weight: 3 },
        { type: 'sentry_shard', weight: 2 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'phantom', weight: 5 },
        { type: 'darter', weight: 6 },
        { type: 'wisp', weight: 5 },
        { type: 'pyre_moth', weight: 4 },
        { type: 'sentry_shard', weight: 2 },
      ] },
    ],
  },
  // World 8, Golden Sands (Stage 6): early teaches the Gilded
  // Shieldback and the Lance Wraith; mid is Wraith locks while
  // Shieldbacks advance (dodge the line, flank the wall); late is
  // Desert Seedmother minefields under Wraith fire; the pre-boss
  // band carries the sheet's pre-placed Rift Mine pattern.
  7: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'shieldback', weight: 6 },
        { type: 'wraith', weight: 5 },
        { type: 'golem', weight: 2 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'wraith', weight: 6 },
        { type: 'shieldback', weight: 6 },
        { type: 'golem', weight: 3 },
        { type: 'imp', weight: 3 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'seedmother', weight: 5 },
        { type: 'wraith', weight: 6 },
        { type: 'shieldback', weight: 5 },
        { type: 'golem', weight: 2 },
        { type: 'imp', weight: 3 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'seedmother', weight: 5 },
        { type: 'wraith', weight: 6 },
        { type: 'shieldback', weight: 5 },
        { type: 'golem', weight: 3 },
        { type: 'imp', weight: 3 },
        { type: 'rift_mine', weight: 3, pack: [4, 4], placed: true },
      ] },
    ],
  },
  // World 9, Blood Moon (Stage 6): early teaches the Blood Chanter
  // and the Phantom; mid is the Chanter-buffed Bloodwyrm (Loom
  // Serpent); late is everything the moon taught at blood-rain
  // density, with Heart Pods, Blood Moths, and Lance Wraith guests.
  8: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'chanter', weight: 4 },
        { type: 'phantom', weight: 5 },
        { type: 'pyre_moth', weight: 3 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'serpent', weight: 3, maxOfType: 1 },
        { type: 'chanter', weight: 4 },
        { type: 'phantom', weight: 5 },
        { type: 'pod', weight: 4 },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'pod', weight: 5 },
        { type: 'phantom', weight: 5 },
        { type: 'pyre_moth', weight: 5 },
        { type: 'chanter', weight: 4 },
        { type: 'serpent', weight: 3, maxOfType: 1 },
        { type: 'wraith', weight: 3 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'pod', weight: 5 },
        { type: 'phantom', weight: 6 },
        { type: 'pyre_moth', weight: 5 },
        { type: 'chanter', weight: 4 },
        { type: 'serpent', weight: 3, maxOfType: 1 },
        { type: 'wraith', weight: 3 },
      ] },
    ],
  },
  // World 10, Abyssal Rift (Stage 6): the full roster. Early is
  // rotating alumni from the early worlds; mid is pairings from all
  // nine worlds in rotation; late and pre-boss run the full roster
  // weighted to the heavy classes, with the pre-boss band carrying
  // the sheet's pre-placed Rift Mine pattern. (The sheet's
  // elite-tinted 1.5 times HP variants are a Stage 8 World 10 item,
  // not a table property; no HP law changes here.)
  9: {
    lullSeconds: 5,
    bands: [
      { fromPhase: 0.0, toPhase: 0.25, maxAlive: 5, entries: [
        { type: 'slime', weight: 5, pack: [1, 2] },
        { type: 'bat', weight: 4 },
        { type: 'imp', weight: 4 },
        { type: 'wisp', weight: 4 },
      ] },
      { fromPhase: 0.25, toPhase: 0.55, maxAlive: 8, entries: [
        { type: 'golem', weight: 3 },
        { type: 'pod', weight: 4 },
        { type: 'sentry_shard', weight: 4 },
        { type: 'phantom', weight: 4 },
        { type: 'pyre_moth', weight: 3 },
        { type: 'mite', weight: 3, pack: [3, 5] },
      ] },
      { fromPhase: 0.55, toPhase: 0.85, maxAlive: 10, entries: [
        { type: 'serpent', weight: 3, maxOfType: 2 },
        { type: 'shieldback', weight: 4 },
        { type: 'chanter', weight: 4 },
        { type: 'darter', weight: 4 },
        { type: 'wraith', weight: 4 },
        { type: 'seedmother', weight: 3 },
        { type: 'wisp', weight: 3 },
        { type: 'bat', weight: 3 },
      ] },
      { fromPhase: 0.85, toPhase: 1.0, maxAlive: 12, entries: [
        { type: 'serpent', weight: 3, maxOfType: 2 },
        { type: 'shieldback', weight: 4 },
        { type: 'darter', weight: 5 },
        { type: 'chanter', weight: 4 },
        { type: 'phantom', weight: 4 },
        { type: 'pod', weight: 4 },
        { type: 'rift_mine', weight: 3, pack: [4, 4], placed: true },
      ] },
    ],
  },
};
