import { Rgb } from '../../models/game.models';

// ---------------------------------------------------------------------------
// Shared entity builder (visual spec Section 3.1). One construction per
// entity type, defined once here and used by both the game renderer
// (particle-bg) and the codex previews, so the two can never drift into
// separate copies again. A definition is data plus a per-vertex sampler:
// geometry (positions), palette (colors), and a layer flag per vertex
// (1 = the bright core or accent, the target of the shared hit flash;
// 0 = matte body mass). Behaviors, speeds, and sizes do not live here;
// the builder only answers "what does this type look like".
//
// The unit radius r is supplied by the caller in its own convention:
// the game passes size / 30 (its long-standing mapping from the physics
// body radius), the codex passes size / 2 (its preview framing). The
// shapes are identical either way because every sampler is written in
// multiples of r.
//
// Historical note: the pre-builder game code computed per-vertex enemy
// palettes inside createEntityMesh and then overwrote them with a flat
// per-type color times jitter later in the same function, so the layered
// palettes below were written but never visible in game. The builder
// makes them the actual colors. Flat single-color types (pickups,
// projectiles, aura) keep the shipped flat color times jitter look,
// with one deliberate exception: enemy projectiles and the boss
// annihilation barrage now take the hostile color (rule 1.2.6).
// ---------------------------------------------------------------------------

export interface BirdColorSource {
  basePositions: Float32Array;
  colorAt: (index: number) => [number, number, number];
}

export interface EntityBuildContext {
  r: number;
  hostile: Rgb; // hostile intent color, read from world theme data
  ownerId?: string;
  owner?: string; // S2: 'player' | 'enemy', for the move projectile colors
  gameMode?: string;
  bird?: BirdColorSource | null;
  // Stage 6: the world the entity is being built for. Enemy variant
  // skins (visual spec Section 4) are keyed by it; absent (codex
  // previews) means the type's default construction.
  worldIndex?: number;
  // Stage 9: the boss's shield palette from the rig data, read by
  // the boss_shield sampler only.
  shieldColor?: Rgb;
  // Stage 10: the Chaos Demon's form index (0 brute, 1 many-winged,
  // 2 serpent), read by the World 9 boss sampler only. The renderer
  // builds all three forms and flows between them.
  form?: number;
}

// ---------------------------------------------------------------------------
// Enemy variant skins (visual spec Section 4, Stage 6 batch 1). A
// variant is a palette swap plus at most one geometry tweak; hitbox
// and behavior never change, so the variant lives entirely in this
// builder as alternate per-vertex colors for the types a world
// restyles. Values are in the same stacking-tuned scale as the
// default samplers (per-vertex bases near 1/15 to 1/40 of the target
// read, because additive sprites stack deep at game scale; the Stage
// 2 Gloomwing note is the standing warning: keep the blue base low
// relative to red wherever a wing must not walk to the hostile
// magenta, and verify by census). Worlds 4 to 6 variants landed
// with Stage 7 and Worlds 7 to 10 with Stage 8, which completes
// the variant map: every world now restyles its sheet's types.
// ---------------------------------------------------------------------------
export interface VariantPalette {
  core: Rgb; // core layer base color (sparse points may take it at full value)
  body: Rgb; // body layer per-vertex base color
  accent: Rgb; // eye and wingtip accents, where the type has them
  coreFrac?: number; // geometry tweak: core radius fraction (Glob family)
  facetCore?: boolean; // geometry tweak: snap core directions to a coarse grid (geode)
  // Stage 7 additions, used only by the samplers that have the
  // zones: a Shieldback variant recolors its bright rim ring and
  // its shield face plate separately from the dark mass behind.
  rim?: Rgb; // Shieldback rim ring base color
  face?: Rgb; // Shieldback face plate base color
  // Stage 7: the Thornmother's one geometry tweak: her dome and
  // her Thorn Mines' shells carry the mine family's spike factor.
  thorned?: boolean;
  // Stage 8: the Desert Seedmother's mines (Golden Sands sheet)
  // are sand-buried: the Rift Mine sampler flattens the shell's
  // lower half so the mine reads half-sunk, its blinking core the
  // only part showing. Positions only; the physics body is not
  // built here and does not change.
  buried?: boolean;
}

export const VARIANT_PALETTES: Record<number, Record<string, VariantPalette>> = {
  // World 2, Cerulean Depths (world index 1).
  1: {
    // Bubble Glob: membrane pale blue, core visible like an air
    // bubble (the core fraction grows: the one geometry tweak).
    slime: { core: [0.92, 0.98, 1.0], body: [0.030, 0.052, 0.088], accent: [0.92, 0.98, 1.0], coreFrac: 0.52 },
    // Deepwing: navy body, bioluminescent teal eyes and wingtips.
    // The wing base keeps red near zero so deep stacks read navy,
    // never the hostile magenta (Stage 2 stacking warning).
    bat: { core: [0.10, 0.85, 0.75], body: [0.006, 0.012, 0.034], accent: [0.10, 0.85, 0.75] },
    // Reef Golem: rocks darker and cooler, core teal.
    golem: { core: [0.15, 0.90, 0.80], body: [0.30, 0.44, 0.48], accent: [0.15, 0.90, 0.80] },
  },
  // World 3, Amethyst Void (world index 2).
  2: {
    // Crystal Glob: membrane amethyst, core a hard bright geode
    // center (faceted: the one geometry tweak).
    slime: { core: [0.88, 0.72, 1.0], body: [0.052, 0.010, 0.082], accent: [0.88, 0.72, 1.0], facetCore: true },
    // Voidwing: purple-black body, violet accents. Blue outweighs
    // red in the wing base so stacks read violet, not magenta.
    bat: { core: [0.62, 0.30, 1.0], body: [0.016, 0.004, 0.030], accent: [0.62, 0.30, 1.0] },
  },
  // World 4, Verdant Canopy (world index 3). Stage 7 batch.
  3: {
    // Moss Glob: membrane mossy green, core pale (sheet).
    slime: { core: [0.80, 1.0, 0.55], body: [0.008, 0.068, 0.014], accent: [0.80, 1.0, 0.55] },
    // Canopy Gloomwing: green-black body, gold accents (sheet).
    // The wing base keeps red low and green ahead of it, so deep
    // stacks read forest-dark with gold at the sparse accents,
    // never the hostile magenta.
    bat: { core: [0.95, 0.78, 0.25], body: [0.006, 0.020, 0.008], accent: [0.95, 0.78, 0.25] },
    // Storm Sprite (the Cinder Imp in this world): electric
    // green-white (sheet). Core near-white green, skin a thin
    // electric green, horns and spark tail pale green.
    imp: { core: [0.78, 1.0, 0.82], body: [0.010, 0.058, 0.020], accent: [0.45, 0.85, 0.40] },
    // Thornmother (the Seedmother in this world): the dome is
    // thorned (the one geometry tweak) and brown-green; the eggs
    // inside are her Thorn Mines, hostile hearts under root-brown
    // shells.
    seedmother: { core: [0.90, 0.30, 0.45], body: [0.078, 0.058, 0.015], accent: [0.052, 0.040, 0.010], thorned: true },
    // Thorn Mine (the Rift Mine in this world): green and brown
    // shell with a root tangle (the thorned spike factor runs
    // stronger); the hostile heart is unchanged.
    rift_mine: { core: [1.0, 0.18, 0.42], body: [0.030, 0.027, 0.008], accent: [0.030, 0.027, 0.008], thorned: true },
  },
  // World 5, Ashen Peaks (world index 4). The desaturated world:
  // every variant here is gray or ember. Stage 7 batch.
  4: {
    // Ash Golem: rocks pale gray, core a dull ember (sheet).
    golem: { core: [0.55, 0.22, 0.06], body: [0.30, 0.30, 0.30], accent: [0.55, 0.22, 0.06] },
    // Ashwing: gray body, ember eye (sheet). The wing base is a
    // true neutral gray; stacks stay gray, and the ember lives
    // only in the sparse core accents.
    bat: { core: [0.85, 0.35, 0.10], body: [0.030, 0.030, 0.030], accent: [0.85, 0.35, 0.10] },
  },
  // World 6, Crystal Caverns (world index 5). Stage 7 batch.
  5: {
    // Prism Shard (the Sentry Shard in this world): brighter
    // facets, core white (sheet).
    sentry_shard: { core: [1.0, 1.0, 1.0], body: [0.020, 0.075, 0.095], accent: [1.0, 1.0, 1.0] },
    // Crystalback (the Shieldback in this world): the shield face
    // is a crystal plate (sheet): cyan-bright rim, pale crystal
    // face, deep blue mass behind.
    shieldback: { core: [0.45, 0.85, 0.95], body: [0.008, 0.020, 0.030], accent: [0.45, 0.85, 0.95], rim: [0.45, 0.85, 0.95], face: [0.050, 0.110, 0.130] },
    // Geode Pod (the Brood Pod in this world): rocky shell,
    // crystal cells (sheet). Cell hearts go cyan-white; the shell
    // is a warm rock gray so the cells read as crystals in stone.
    pod: { core: [0.35, 0.85, 1.0], body: [0.038, 0.036, 0.034], accent: [0.35, 0.85, 1.0] },
  },
  // World 7, Neon Nebula (world index 6). Stage 8 batch. The
  // world's ice identity rides in the variants: pale ice bodies
  // and white cores against the nebula's magenta.
  6: {
    // Neon Wisp (the Aether Wisp in this world): ring tinted
    // pink, core pink-white (sheet). The ring base keeps green
    // near zero so stacks read pink-magenta, and the core is a
    // saturated pink-white so it never matches the default's
    // cyan (a near-neutral white core read as no separation in
    // the Stage 8 portrait census, so the pink was deepened).
    wisp: { core: [1.0, 0.34, 0.56], body: [0.150, 0.010, 0.052], accent: [1.0, 0.30, 0.64] },
    // Frostwraith (the Shroud Phantom in this world): pale body,
    // snow trail (sheet). Hood and trailing wisps go pale
    // blue-gray, clearly brighter than the default's slate
    // violet; the eyes stay ice white.
    phantom: { core: [0.90, 0.97, 1.0], body: [0.066, 0.078, 0.104], accent: [0.90, 0.97, 1.0] },
    // Rime Moth (the Pyre Moth in this world): ice blue-white
    // body (sheet); the warm cream-orange fuzz goes pale ice,
    // the hot center an ice-white core.
    pyre_moth: { core: [0.90, 0.97, 1.0], body: [0.045, 0.065, 0.088], accent: [0.90, 0.97, 1.0] },
  },
  // World 8, Golden Sands (world index 7). Stage 8 batch. Matte
  // sand and stone everywhere; gold lives on the Shieldback's
  // face, bronze and tan on the rest.
  7: {
    // Gilded Shieldback: shield face gold-bronze (sheet). The
    // rim ring goes full gold, the face plate a bronze band,
    // the mass behind a dark warm brown.
    shieldback: { core: [0.95, 0.68, 0.22], body: [0.030, 0.020, 0.006], accent: [0.95, 0.68, 0.22], rim: [0.95, 0.68, 0.22], face: [0.088, 0.058, 0.016] },
    // Desert Seedmother: a sandy dome the color of the dunes;
    // her eggs keep their hostile hearts (they are mines) under
    // sand-dark shells.
    seedmother: { core: [1.0, 0.18, 0.42], body: [0.088, 0.046, 0.012], accent: [0.062, 0.033, 0.009] },
    // The Desert Seedmother's mines, sand-buried (sheet): the
    // shell is sand-matte and its lower half is flattened (the
    // buried tweak in the Rift Mine sampler), so mostly the
    // blinking hostile core shows.
    rift_mine: { core: [1.0, 0.18, 0.42], body: [0.056, 0.042, 0.013], accent: [0.056, 0.042, 0.013], buried: true },
    // Sandstone Golem: rocks tan, core amber (sheet). The body
    // value is the rock tint multiplier, as in the other golem
    // variants: tan stone against the default's gray.
    golem: { core: [0.95, 0.62, 0.10], body: [0.52, 0.40, 0.20], accent: [0.95, 0.62, 0.10] },
  },
  // World 9, Blood Moon (world index 8). Stage 8 batch. Every
  // variant is a shade of the moon's own red.
  8: {
    // Blood Chanter: bell body dark red (sheet); the note-sparks
    // go blood crimson (blue kept low, so they read blood, not
    // the hostile magenta), the rim lip a dull dried red.
    chanter: { core: [0.97, 0.13, 0.12], body: [0.125, 0.010, 0.013], accent: [0.55, 0.07, 0.06] },
    // Blood Moth (the Pyre Moth in this world): deep red body
    // (sheet); the warm fuzz and hot center both go blood.
    pyre_moth: { core: [1.0, 0.26, 0.18], body: [0.076, 0.010, 0.012], accent: [1.0, 0.26, 0.18] },
    // Bloodwyrm (the Loom Serpent in this world): deep red
    // segmented ribbon (sheet). Head core blood-white, fins and
    // skull mass deep red, the gold spine gone ember-red.
    serpent: { core: [1.0, 0.36, 0.26], body: [0.056, 0.008, 0.010], accent: [0.50, 0.14, 0.07] },
    serpent_segment: { core: [0.44, 0.12, 0.06], body: [0.044, 0.007, 0.009], accent: [0.44, 0.12, 0.06] },
    // Heart Pod (the Brood Pod in this world): the cells
    // visibly beat (sheet). The beat itself is the renderer's
    // scale pulse for pods in this world (particle-bg); here
    // the cell hearts go blood pink and the shell a dark
    // blood-brown.
    pod: { core: [1.0, 0.13, 0.11], body: [0.115, 0.022, 0.018], accent: [1.0, 0.13, 0.11] },
  },
  // World 10, Abyssal Rift (world index 9). Stage 8 batch. The
  // whole roster returns Rift-touched (World 10 sheet): deep
  // palettes shifted toward black with white accents, cores at
  // full brightness. One treatment for every type: bodies go
  // black-violet, cores and accents go star white (the palette's
  // bright band, 0.95 / 0.90 / 1.0), and the hostile hearts that
  // are hostile by rule (mine cores, the wraith's eye, the
  // mother's eggs) stay hostile.
  9: {
    slime: { core: [0.95, 0.90, 1.0], body: [0.014, 0.007, 0.027], accent: [0.95, 0.90, 1.0] },
    bat: { core: [0.95, 0.90, 1.0], body: [0.010, 0.005, 0.021], accent: [0.95, 0.90, 1.0] },
    golem: { core: [0.95, 0.90, 1.0], body: [0.17, 0.15, 0.24], accent: [0.95, 0.90, 1.0] },
    imp: { core: [0.95, 0.90, 1.0], body: [0.012, 0.006, 0.025], accent: [0.72, 0.58, 1.0] },
    wisp: { core: [0.97, 0.94, 1.0], body: [0.016, 0.008, 0.031], accent: [0.97, 0.94, 1.0] },
    pod: { core: [0.95, 0.90, 1.0], body: [0.016, 0.010, 0.025], accent: [0.95, 0.90, 1.0] },
    mite: { core: [0.95, 0.90, 1.0], body: [0.020, 0.012, 0.034], accent: [0.95, 0.90, 1.0] },
    sentry_shard: { core: [0.97, 0.94, 1.0], body: [0.014, 0.010, 0.029], accent: [0.97, 0.94, 1.0] },
    seedmother: { core: [1.0, 0.18, 0.42], body: [0.020, 0.012, 0.031], accent: [0.012, 0.008, 0.023] },
    rift_mine: { core: [1.0, 0.18, 0.42], body: [0.010, 0.006, 0.021], accent: [0.010, 0.006, 0.021] },
    shieldback: { core: [0.95, 0.90, 1.0], body: [0.010, 0.007, 0.019], accent: [0.95, 0.90, 1.0], rim: [0.92, 0.88, 1.0], face: [0.032, 0.025, 0.054] },
    pyre_moth: { core: [0.97, 0.94, 1.0], body: [0.016, 0.010, 0.029], accent: [0.97, 0.94, 1.0] },
    phantom: { core: [0.95, 0.90, 1.0], body: [0.013, 0.009, 0.024], accent: [0.95, 0.90, 1.0] },
    wraith: { core: [1.0, 0.18, 0.42], body: [0.016, 0.012, 0.031], accent: [0.058, 0.048, 0.088] },
    chanter: { core: [0.95, 0.90, 1.0], body: [0.018, 0.010, 0.031], accent: [0.42, 0.36, 0.58] },
    serpent: { core: [0.72, 0.45, 1.0], body: [0.014, 0.008, 0.026], accent: [0.55, 0.38, 0.95] },
    serpent_segment: { core: [0.42, 0.28, 0.78], body: [0.012, 0.007, 0.023], accent: [0.42, 0.28, 0.78] },
    darter: { core: [0.97, 0.94, 1.0], body: [0.014, 0.010, 0.029], accent: [0.97, 0.94, 1.0] },
  },
};

export function variantFor(ctx: EntityBuildContext, type: string): VariantPalette | undefined {
  if (ctx.worldIndex === undefined) return undefined;
  return VARIANT_PALETTES[ctx.worldIndex]?.[type];
}

export interface BuiltEntity {
  count: number;
  positions: Float32Array;
  colors: Float32Array;
  layer: Uint8Array; // 1 = core/accent vertex, 0 = body vertex
  animated: boolean; // caller retains basePositions for vertex animation
}

interface VertexOut {
  x: number; y: number; z: number;
  cr: number; cg: number; cb: number;
  layer: number;
}

type Sampler = (i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) => void;

interface EntityVisualDef {
  count: number;
  animated: boolean;
  sample: Sampler;
}

const jitter = () => 0.8 + Math.random() * 0.4;

function flatColor(out: VertexOut, rgb: Rgb) {
  const j = jitter();
  out.cr = rgb[0] * j; out.cg = rgb[1] * j; out.cb = rgb[2] * j;
  out.layer = 0;
}

function sphereVertex(out: VertexOut, r: number) {
  const u = Math.random() * Math.PI * 2;
  const v = Math.acos(2 * Math.random() - 1);
  const rad = Math.cbrt(Math.random()) * r;
  out.x = rad * Math.sin(v) * Math.cos(u);
  out.y = rad * Math.sin(v) * Math.sin(u);
  out.z = rad * Math.cos(v);
}

// Amber-gold, the player's fire color in every mode (rule 1.2.6). In
// AI vs AI the bottom AI keeps its fuchsia identity, as shipped.
const PLAYER_FIRE: Rgb = [0.984, 0.749, 0.141]; // 0xfbbf24
const AI_VS_AI_BOTTOM_FIRE: Rgb = [0.851, 0.275, 0.937]; // 0xd946ef
const AI_ABILITY_RED: Rgb = [1.0, 0.2, 0.2]; // 0xff3333, rival ability tint as shipped

// ---------------------------------------------------------------------------
// Stage 9 boss constructions. The boss def dispatches on the build
// context's world index: each world gets its Section 4 sheet body.
// World 1 keeps the shipped fiery skull (it was always the Inferno
// Guardian); Worlds 2 to 5 landed in Stage 9 and Worlds 6 to 10 in
// Stage 10 (the phoenix master sampler, the Ice Empress, the Dragon
// Emperor, and the Chaos Demon's three forms, below the Reaper).
// ---------------------------------------------------------------------------

function sampleBossSkull(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  if (p < 0.6) {
    // Skull dome (upper half sphere)
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(Math.random()); // Top half
    const rad = r * 1.5 + (Math.random() - 0.5) * 0.3 * r;
    out.x = rad * Math.sin(v) * Math.cos(u);
    out.z = rad * Math.sin(v) * Math.sin(u);
    out.y = rad * Math.cos(v) + r * 0.5; // Shift up
    if (out.y > r * 0.8 && out.y < r * 1.5 && out.z > r * 0.5 && Math.abs(Math.abs(out.x) - r * 0.6) < r * 0.4) {
      // Eye socket: pushed in, hollow and glowing
      out.z -= r * 0.8;
      out.cr = 1.0; out.cg = 1.0; out.cb = 1.0; // White hot eyes
      out.layer = 1;
    } else {
      const heat = 1.0 - (out.y / (r * 2));
      out.cr = 1.0; out.cg = heat * 0.5; out.cb = 0.0; // Orange to red gradient
      out.layer = 0;
    }
  } else if (p < 0.85) {
    // Jaw (lower half, detached slightly)
    out.x = (Math.random() - 0.5) * r * 2.2;
    out.y = -r * 0.5 + (Math.random() - 0.5) * 0.4 * r;
    out.z = (Math.random() - 0.5) * r * 1.8 + (Math.abs(out.x) * 0.5); // Curved jaw
    out.cr = 0.8; out.cg = 0.2; out.cb = 0.0; // Darker red jaw
    out.layer = 0;
  } else {
    // Floating horns/crown
    const isLeft = Math.random() > 0.5;
    const t = Math.random();
    const spread = t * r * 1.5;
    out.x = isLeft ? -(r + spread) : (r + spread);
    out.y = r * 1.5 + t * r * 2 + (Math.random() - 0.5) * 0.3 * r;
    out.z = -t * r + (Math.random() - 0.5) * 0.3 * r; // Horns curve back
    out.cr = 1.0; out.cg = 0.6 - t * 0.6; out.cb = 0.0; // Orange to red horns
    out.layer = 0;
  }
}

// Shadow Lord (World 2): a tall hooded silhouette of dark points
// with a bright mask face: the anti-phoenix, a moving hole in the
// light with cold accents (Section 4 sheet).
function sampleBossShadowWraith(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  if (p < 0.70) {
    // Cloak: a tapered cone, wide hem to narrow hood.
    const t = Math.random(); // 0 hem, 1 hood top
    const a = Math.random() * Math.PI * 2;
    const rad = (1.25 - t * 0.8) * r * Math.sqrt(Math.random());
    out.x = Math.cos(a) * rad;
    out.z = Math.sin(a) * rad * 0.7;
    out.y = -1.25 * r + t * 2.8 * r;
    // Faint cold rim on the silhouette edge; the mass stays near black.
    if (rad > (1.25 - t * 0.8) * r * 0.82) { out.cr = 0.05; out.cg = 0.16; out.cb = 0.38; }
    else { out.cr = 0.015; out.cg = 0.025; out.cb = 0.07; }
    out.layer = 0;
  } else if (p < 0.86) {
    // Cloak ribbons streaming below the hem.
    const t = Math.random();
    const lane = (i % 5) - 2;
    out.x = lane * 0.28 * r + Math.sin(t * 5 + i) * 0.12 * r;
    out.y = -1.25 * r - t * 1.1 * r;
    out.z = (Math.random() - 0.5) * 0.3 * r;
    out.cr = 0.03; out.cg = 0.06; out.cb = 0.16;
    out.layer = 0;
  } else {
    // Mask: a pale disc high on the front, two bright eyes (core).
    const a = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * 0.42 * r;
    out.x = Math.cos(a) * rad;
    out.y = 0.95 * r + Math.sin(a) * rad * 0.8;
    out.z = 0.78 * r;
    const eyeL = Math.hypot(out.x + 0.18 * r, out.y - 1.0 * r);
    const eyeR = Math.hypot(out.x - 0.18 * r, out.y - 1.0 * r);
    if (Math.min(eyeL, eyeR) < 0.085 * r) { out.cr = 1.0; out.cg = 1.0; out.cb = 1.0; out.layer = 1; }
    else { out.cr = 0.32; out.cg = 0.42; out.cb = 0.58; out.layer = 0; }
  }
}

// Crystal Titan (World 3): interlocking crystal plates around a
// bright geode core (Section 4 sheet).
function sampleBossCrystalTitan(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  if (p < 0.82) {
    // One of five plate clusters on a rough shell; the point lands
    // in a small faceted volume around the cluster center.
    const centers: Array<[number, number, number]> = [
      [0, 1.05, 0.2], [-1.05, 0.35, -0.2], [1.05, 0.35, -0.2], [-0.6, -0.75, 0.3], [0.6, -0.75, 0.3]
    ];
    const c = centers[i % centers.length];
    out.x = c[0] * r + (Math.random() - 0.5) * 0.85 * r;
    out.y = c[1] * r + (Math.random() - 0.5) * 0.85 * r;
    out.z = c[2] * r + (Math.random() - 0.5) * 0.7 * r;
    if (Math.random() < 0.12) { out.cr = 0.3; out.cg = 0.8; out.cb = 1.0; } // cyan facet accents
    else { const s = 0.7 + Math.random() * 0.6; out.cr = 0.38 * s; out.cg = 0.12 * s; out.cb = 0.75 * s; }
    out.layer = 0;
  } else {
    // Geode core: bright, the chest that opens to fire.
    sphereVertex(out, r * 0.55);
    out.cr = 0.95; out.cg = 0.75; out.cb = 1.0;
    out.layer = 1;
  }
}

// Storm Wyvern (World 4): a long ribbon body with two huge wings
// and a horned head (Section 4 sheet).
function sampleBossStormWyvern(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  if (p < 0.42) {
    // Spine: a long body along x with a gentle S-curve.
    const t = Math.random(); // 0 tail, 1 head
    out.x = (-1.9 + t * 3.5) * r;
    out.y = Math.sin(t * 4.2) * 0.28 * r + (Math.random() - 0.5) * (0.5 - Math.abs(t - 0.45) * 0.5) * r;
    out.z = (Math.random() - 0.5) * 0.35 * r;
    const s = 0.7 + Math.random() * 0.5;
    out.cr = 0.10 * s; out.cg = 0.48 * s; out.cb = 0.16 * s;
    out.layer = 0;
  } else if (p < 0.88) {
    // Wings: two triangular fans off the spine's midsection, one
    // sweeping up-back, one down-back (in the sampler plane).
    const up = i % 2 === 0;
    const t = Math.random();
    const reach = (0.4 + t * 1.6) * r;
    out.x = (0.1 - t * 1.5) * r + (Math.random() - 0.5) * 0.2 * r;
    out.y = (up ? 1 : -1) * reach * (0.55 + Math.random() * 0.3);
    out.z = (Math.random() - 0.5) * 0.25 * r;
    if (Math.random() < 0.10) { out.cr = 0.95; out.cg = 0.8; out.cb = 0.25; out.layer = 1; } // gold rim sparks
    else { const s = 0.6 + Math.random() * 0.5; out.cr = 0.05 * s; out.cg = 0.34 * s; out.cb = 0.10 * s; out.layer = 0; }
  } else {
    // Horned head at the front of the spine.
    sphereVertex(out, r * 0.42);
    out.x += 1.85 * r; out.y += 0.35 * r;
    if (Math.random() < 0.10) { out.cr = 0.9; out.cg = 1.0; out.cb = 0.85; out.layer = 1; } // electric eye glints
    else { const s = 0.8 + Math.random() * 0.4; out.cr = 0.12 * s; out.cg = 0.55 * s; out.cb = 0.2 * s; out.layer = 0; }
  }
}

// Void Reaper (World 5): a tall hooded phantom in ash grays with a
// long scythe arm; the one desaturated boss (Section 4 sheet).
function sampleBossVoidReaper(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  if (p < 0.62) {
    // Cloak cone, tattered hem (bottom points trail to random lengths).
    const t = Math.random();
    const a = Math.random() * Math.PI * 2;
    const rad = (1.15 - t * 0.72) * r * Math.sqrt(Math.random());
    out.x = Math.cos(a) * rad;
    out.z = Math.sin(a) * rad * 0.7;
    out.y = -1.2 * r + t * 2.7 * r - (t < 0.12 ? Math.random() * 0.5 * r : 0);
    const g = 0.13 + Math.random() * 0.10;
    out.cr = g; out.cg = g; out.cb = g * 1.1;
    out.layer = 0;
  } else if (p < 0.80) {
    // Scythe: a pale arc of points swept to one side.
    const t = Math.random();
    const a = -0.5 + t * 1.7;
    const rad = 1.85 * r;
    out.x = 0.55 * r + Math.cos(a) * rad * 0.62;
    out.y = 0.55 * r + Math.sin(a) * rad * 0.62;
    out.z = (Math.random() - 0.5) * 0.12 * r;
    const g = 0.62 + Math.random() * 0.25;
    out.cr = g; out.cg = g; out.cb = g * 1.05;
    out.layer = 0;
  } else if (p < 0.90) {
    // Hood interior: near-black, with two dull ember eyes (core).
    sphereVertex(out, r * 0.5);
    out.y += 1.15 * r; out.z += 0.3 * r;
    const eyeL = Math.hypot(out.x + 0.16 * r, out.y - 1.2 * r);
    const eyeR = Math.hypot(out.x - 0.16 * r, out.y - 1.2 * r);
    if (Math.min(eyeL, eyeR) < 0.08 * r) { out.cr = 0.95; out.cg = 0.45; out.cb = 0.15; out.layer = 1; }
    else { out.cr = 0.04; out.cg = 0.04; out.cb = 0.05; out.layer = 0; }
  } else {
    // Tattered cloak ribbons below the hem.
    const t = Math.random();
    const lane = (i % 4) - 1.5;
    out.x = lane * 0.3 * r + Math.sin(t * 4 + i) * 0.1 * r;
    out.y = -1.2 * r - t * 0.9 * r;
    out.z = (Math.random() - 0.5) * 0.25 * r;
    const g = 0.09 + Math.random() * 0.06;
    out.cr = g; out.cg = g; out.cb = g;
    out.layer = 0;
  }
}

// ---------------------------------------------------------------------------
// Stage 10 boss constructions (Worlds 6 to 10).
// ---------------------------------------------------------------------------

interface PhoenixBossPalette {
  body: [number, number, number];
  wing: [number, number, number];
  bright: [number, number, number];
  heart: [number, number, number];
  crown: boolean;
  plumes: number;
}

// The phoenix master design at boss scale: a frontal flying
// figure, crested head with the beak pointing at the viewer, two
// broad layered wings, a tapered body with a bright heart, and
// long tail plumes streaming down and back. Only two bosses may
// carry the bird silhouette (readability rule 1.2.3): the Phoenix
// King (hostile gold-white, crown crest, three plumes) and the
// Eternal Phoenix (divine white and gold, ray crest, violet heart,
// five plumes).
function sampleBossPhoenix(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut, pal: PhoenixBossPalette) {
  const p = Math.random();
  const shade = () => 0.7 + Math.random() * 0.55;
  if (p < 0.30) {
    // Wings: layered fans from the shoulders, three rows deep,
    // primaries on the trailing edge with bright tips.
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(Math.random() * 3);
    const t = Math.random();
    out.x = side * (0.35 + t * 1.65) * r;
    out.y = (0.62 - t * 0.42 - row * 0.16) * r + (Math.random() - 0.5) * 0.08 * r;
    out.z = (Math.random() - 0.5) * 0.14 * r - t * 0.18 * r;
    if (row === 2 && t > 0.78 && Math.random() < 0.5) {
      out.cr = pal.bright[0]; out.cg = pal.bright[1]; out.cb = pal.bright[2]; out.layer = 1;
    } else {
      const s = shade(); out.cr = pal.wing[0] * s; out.cg = pal.wing[1] * s; out.cb = pal.wing[2] * s; out.layer = 0;
    }
  } else if (p < 0.52) {
    // Body: a tapered ellipsoid, neck to hips.
    sphereVertex(out, r * 0.5);
    out.y = out.y * 1.45 - 0.05 * r;
    out.z = out.z * 0.7 + 0.08 * r;
    const s = shade(); out.cr = pal.body[0] * s; out.cg = pal.body[1] * s; out.cb = pal.body[2] * s;
    out.layer = 0;
  } else if (p < 0.66) {
    // Head and beak: the head rides high on the body; the beak is
    // a bright cone pointing forward and down at the viewer.
    if (Math.random() < 0.68) {
      sphereVertex(out, r * 0.30);
      out.x += 0; out.y += 0.88 * r; out.z += 0.18 * r;
      const eyeL = Math.hypot(out.x + 0.13 * r, out.y - 0.93 * r);
      const eyeR = Math.hypot(out.x - 0.13 * r, out.y - 0.93 * r);
      if (Math.min(eyeL, eyeR) < 0.07 * r) { out.cr = pal.heart[0]; out.cg = pal.heart[1]; out.cb = pal.heart[2]; out.layer = 1; }
      else { const s = shade(); out.cr = pal.body[0] * s * 1.15; out.cg = pal.body[1] * s * 1.15; out.cb = pal.body[2] * s * 1.15; out.layer = 0; }
    } else {
      const t = Math.random();
      const rad = (1 - t) * 0.09 * r;
      const a = Math.random() * Math.PI * 2;
      out.x = Math.cos(a) * rad;
      out.y = 0.82 * r - t * 0.16 * r + Math.sin(a) * rad * 0.6;
      out.z = 0.38 * r + t * 0.48 * r;
      out.cr = pal.bright[0]; out.cg = pal.bright[1]; out.cb = pal.bright[2]; out.layer = 1;
    }
  } else if (p < 0.78) {
    // Crest: the King's crown of five gold spikes, or the
    // Eternal's ray halo arc behind the head.
    if (pal.crown) {
      const k = i % 5;
      const t = Math.random();
      out.x = (k - 2) * 0.11 * r * (0.5 + t * 0.7);
      out.y = 1.10 * r + t * 0.40 * r * (1 - Math.abs(k - 2) * 0.17);
      out.z = 0.10 * r - t * 0.08 * r;
      if (Math.random() < 0.55) { out.cr = pal.bright[0]; out.cg = pal.bright[1]; out.cb = pal.bright[2]; out.layer = 1; }
      else { const s = shade(); out.cr = pal.wing[0] * s; out.cg = pal.wing[1] * s; out.cb = pal.wing[2] * s; out.layer = 0; }
    } else {
      const a = Math.PI * (0.12 + Math.random() * 0.76);
      const rad = 0.55 * r;
      out.x = Math.cos(a) * rad;
      out.y = 0.88 * r + Math.sin(a) * rad * 0.8;
      out.z = -0.12 * r;
      out.cr = pal.bright[0]; out.cg = pal.bright[1]; out.cb = pal.bright[2]; out.layer = 1;
    }
  } else if (p < 0.88) {
    // The heart: the bright core at the chest (layer 1).
    sphereVertex(out, r * 0.26);
    out.y += 0.28 * r; out.z += 0.26 * r;
    out.cr = pal.heart[0]; out.cg = pal.heart[1]; out.cb = pal.heart[2];
    out.layer = 1;
  } else {
    // Tail plumes: long ribbons streaming down and back from the
    // hips, swaying by lane, tips bright.
    const lane = i % pal.plumes;
    const t = Math.random();
    out.x = (lane - (pal.plumes - 1) / 2) * 0.17 * r * (0.4 + t * 0.85) + Math.sin(t * 3.2 + lane * 1.7) * 0.09 * r;
    out.y = -0.45 * r - t * 1.75 * r;
    out.z = -0.08 * r - t * 0.38 * r;
    if (t > 0.88 && Math.random() < 0.5) { out.cr = pal.bright[0]; out.cg = pal.bright[1]; out.cb = pal.bright[2]; out.layer = 1; }
    else { const s = shade() * (1 - t * 0.35); out.cr = pal.wing[0] * s; out.cg = pal.wing[1] * s; out.cb = pal.wing[2] * s; out.layer = 0; }
  }
}

// Phoenix King (World 6): the master design in hostile gold-white
// with a crown crest and a long royal tail (three plumes).
function sampleBossPhoenixKing(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  sampleBossPhoenix(i, count, r, ctx, out, {
    body: [0.48, 0.34, 0.09], wing: [0.62, 0.47, 0.15], bright: [1.0, 0.88, 0.42], heart: [1.0, 0.96, 0.82], crown: true, plumes: 3
  });
}

// Eternal Phoenix (World 10): the master design in divine white
// and gold with a ray crest and a violet heart.
function sampleBossEternalPhoenix(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  sampleBossPhoenix(i, count, r, ctx, out, {
    body: [0.74, 0.68, 0.52], wing: [0.86, 0.80, 0.62], bright: [1.0, 1.0, 1.0], heart: [0.72, 0.50, 1.0], crown: false, plumes: 5
  });
}

// Ice Empress (World 7): a tall crystalline figure: an icicle-point
// skirt, a narrow torso, a shard crown, and a rotating halo of ice
// motes (the halo is a flat ring of bright points; the boss mesh's
// slow wobble makes it shimmer rather than spin).
function sampleBossIceEmpress(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  const shade = () => 0.7 + Math.random() * 0.55;
  if (p < 0.34) {
    // Skirt: a cone of ice points, waist to hem, with icicle
    // spikes hanging past the hem line.
    const t = Math.random();
    const a = Math.random() * Math.PI * 2;
    const rad = (0.30 + t * 0.78) * r * Math.sqrt(Math.random());
    out.x = Math.cos(a) * rad;
    out.z = Math.sin(a) * rad * 0.7;
    out.y = 0.22 * r - t * 1.75 * r - (Math.random() < 0.30 ? Math.random() * 0.30 * r : 0);
    if (Math.random() < 0.10) { out.cr = 0.65; out.cg = 0.95; out.cb = 1.0; out.layer = 1; }
    else { const s = shade(); out.cr = 0.34 * s; out.cg = 0.52 * s; out.cb = 0.66 * s; out.layer = 0; }
  } else if (p < 0.56) {
    // Torso and arms: a narrow tall ellipsoid with two thin arm
    // lines angled down and out.
    if (Math.random() < 0.72) {
      sphereVertex(out, r * 0.30);
      out.y = out.y * 1.7 + 0.78 * r;
      out.z *= 0.7;
      const s = shade(); out.cr = 0.40 * s; out.cg = 0.60 * s; out.cb = 0.74 * s; out.layer = 0;
    } else {
      const side = i % 2 === 0 ? 1 : -1;
      const t = Math.random();
      out.x = side * (0.24 + t * 0.42) * r;
      out.y = (0.95 - t * 0.55) * r;
      out.z = 0.05 * r;
      const s = shade(); out.cr = 0.36 * s; out.cg = 0.56 * s; out.cb = 0.70 * s; out.layer = 0;
    }
  } else if (p < 0.68) {
    // Head and shard crown: five ice spikes above a pale head.
    if (Math.random() < 0.55) {
      sphereVertex(out, r * 0.25);
      out.y += 1.38 * r; out.z += 0.06 * r;
      const eyeL = Math.hypot(out.x + 0.10 * r, out.y - 1.40 * r);
      const eyeR = Math.hypot(out.x - 0.10 * r, out.y - 1.40 * r);
      if (Math.min(eyeL, eyeR) < 0.055 * r) { out.cr = 0.65; out.cg = 0.95; out.cb = 1.0; out.layer = 1; }
      else { const s = shade(); out.cr = 0.46 * s; out.cg = 0.64 * s; out.cb = 0.76 * s; out.layer = 0; }
    } else {
      const k = i % 5;
      const t = Math.random();
      out.x = (k - 2) * 0.10 * r * (0.5 + t * 0.6);
      out.y = 1.58 * r + t * 0.42 * r * (1 - Math.abs(k - 2) * 0.15);
      out.z = (Math.random() - 0.5) * 0.06 * r;
      out.cr = 0.65; out.cg = 0.95; out.cb = 1.0; out.layer = 1;
    }
  } else if (p < 0.86) {
    // Halo: a flat ring of ice motes circling the figure at waist
    // height, bright enough to read as its own element.
    const a = Math.random() * Math.PI * 2;
    const rad = 1.45 * r + (Math.random() - 0.5) * 0.10 * r;
    out.x = Math.cos(a) * rad;
    out.z = Math.sin(a) * rad * 0.55;
    out.y = 0.55 * r + (Math.random() - 0.5) * 0.08 * r;
    if (Math.random() < 0.6) { out.cr = 0.65; out.cg = 0.95; out.cb = 1.0; out.layer = 1; }
    else { const s = shade(); out.cr = 0.34 * s; out.cg = 0.52 * s; out.cb = 0.66 * s; out.layer = 0; }
  } else {
    // Satellite shards: six small crystal clusters orbiting low.
    const c = i % 6;
    const a = (c / 6) * Math.PI * 2;
    out.x = Math.cos(a) * 1.08 * r + (Math.random() - 0.5) * 0.22 * r;
    out.y = -0.35 * r + (Math.random() - 0.5) * 0.22 * r;
    out.z = Math.sin(a) * 0.5 * r + (Math.random() - 0.5) * 0.22 * r;
    const s = shade(); out.cr = 0.40 * s; out.cg = 0.60 * s; out.cb = 0.74 * s; out.layer = 0;
  }
}

// Dragon Emperor (World 8): a ribbon body at boss scale with four
// wings, a horned bearded head, and a spade-point tail. The most
// mobile boss before the finale; its body is built for the passes
// its movement hook flies.
function sampleBossDragonEmperor(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const p = Math.random();
  const shade = () => 0.7 + Math.random() * 0.55;
  if (p < 0.40) {
    // Spine: a heavy ribbon along x with a slow S-curve.
    const t = Math.random();
    out.x = (-2.05 + t * 3.7) * r;
    out.y = Math.sin(t * 3.9) * 0.26 * r + (Math.random() - 0.5) * 0.44 * r;
    out.z = (Math.random() - 0.5) * 0.36 * r;
    const s = shade(); out.cr = 0.44 * s; out.cg = 0.29 * s; out.cb = 0.08 * s; out.layer = 0;
  } else if (p < 0.78) {
    // Four wings: a large front pair and a smaller rear pair,
    // triangular fans off the spine, gold rims on the edges.
    const pair = i % 2; // 0 front, 1 rear
    const up = Math.floor(i / 2) % 2 === 0;
    const t = Math.random();
    const baseX = pair === 0 ? 0.55 : -0.55;
    const reach = (pair === 0 ? 1.55 : 1.05) * (0.35 + t * 0.65);
    out.x = (baseX - t * 1.05) * r + (Math.random() - 0.5) * 0.16 * r;
    out.y = (up ? 1 : -1) * reach * r * (0.5 + Math.random() * 0.3);
    out.z = (Math.random() - 0.5) * 0.2 * r;
    if (Math.random() < 0.10) { out.cr = 1.0; out.cg = 0.85; out.cb = 0.3; out.layer = 1; }
    else { const s = shade(); out.cr = 0.30 * s; out.cg = 0.18 * s; out.cb = 0.05 * s; out.layer = 0; }
  } else if (p < 0.90) {
    // Horned bearded head at the front of the spine.
    if (Math.random() < 0.55) {
      sphereVertex(out, r * 0.48);
      out.x += 1.98 * r; out.y += 0.30 * r;
      const eyeL = Math.hypot(out.x - 2.05 * r, out.y - 0.42 * r);
      const eyeR = Math.hypot(out.x - 1.90 * r, out.y - 0.42 * r);
      if (Math.min(eyeL, eyeR) < 0.08 * r) { out.cr = 1.0; out.cg = 0.9; out.cb = 0.4; out.layer = 1; }
      else { const s = shade(); out.cr = 0.50 * s; out.cg = 0.34 * s; out.cb = 0.10 * s; out.layer = 0; }
    } else if (Math.random() < 0.5) {
      // Horns: two arcs sweeping up and back from the skull.
      const side = i % 2 === 0 ? 1 : -1;
      const t = Math.random();
      out.x = (1.95 - t * 0.75) * r;
      out.y = (0.55 + t * 0.75) * r;
      out.z = side * (0.18 + t * 0.30) * r;
      const s = shade(); out.cr = 0.66 * s; out.cg = 0.55 * s; out.cb = 0.30 * s; out.layer = 0;
    } else {
      // Beard: strands trailing down and back from the jaw.
      const lane = (i % 5) - 2;
      const t = Math.random();
      out.x = (1.90 - t * 0.45) * r + lane * 0.05 * r;
      out.y = (0.05 - t * 0.85) * r;
      out.z = lane * 0.07 * r + (Math.random() - 0.5) * 0.06 * r;
      const s = shade(); out.cr = 0.60 * s; out.cg = 0.52 * s; out.cb = 0.34 * s; out.layer = 0;
    }
  } else {
    // Spade tail: a flattened diamond plate at the tail's end,
    // the one crimson accent on the body.
    const t = Math.random();
    const a = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random());
    out.x = -2.30 * r + Math.cos(a) * rad * 0.30 * r - t * 0.15 * r;
    out.y = Math.sin(a) * rad * 0.55 * r;
    out.z = (Math.random() - 0.5) * 0.08 * r;
    const s = shade(); out.cr = 0.52 * s; out.cg = 0.13 * s; out.cb = 0.09 * s; out.layer = 0;
  }
}

// Chaos Demon (World 9): one core of chaos points cycling between
// three silhouettes (horned brute, many-winged thing, serpent);
// the renderer builds all three and flows the points between
// forms. Each form leans on one of the Roulette announcement
// colors: red for the brute, violet for the winged, white accents
// for the serpent.
function sampleBossChaosDemon(i: number, count: number, r: number, ctx: EntityBuildContext, out: VertexOut) {
  const form = ctx.form || 0;
  const p = Math.random();
  const shade = () => 0.7 + Math.random() * 0.55;
  if (form === 1) {
    // Many-winged thing: a bright violet core wrapped in six
    // wing fans, three to a side, stacked like a seraph.
    if (p < 0.30) {
      sphereVertex(out, r * 0.55);
      if (Math.random() < 0.4) { out.cr = 0.62; out.cg = 0.30; out.cb = 1.0; out.layer = 1; }
      else { const s = shade(); out.cr = 0.20 * s; out.cg = 0.10 * s; out.cb = 0.34 * s; out.layer = 0; }
    } else {
      const wing = i % 6;
      const side = wing < 3 ? 1 : -1;
      const row = wing % 3;
      const t = Math.random();
      out.x = side * (0.30 + t * 1.45) * r;
      out.y = (0.75 - row * 0.62 - t * 0.30) * r + (Math.random() - 0.5) * 0.08 * r;
      out.z = (Math.random() - 0.5) * 0.16 * r - t * 0.15 * r;
      if (t > 0.8 && Math.random() < 0.4) { out.cr = 0.85; out.cg = 0.65; out.cb = 1.0; out.layer = 1; }
      else { const s = shade(); out.cr = 0.16 * s; out.cg = 0.08 * s; out.cb = 0.30 * s; out.layer = 0; }
    }
  } else if (form === 2) {
    // Serpent: a long ribbon with a horned head, white scale
    // accents over a near-black violet body.
    if (p < 0.82) {
      const t = Math.random();
      out.x = (-1.95 + t * 3.6) * r;
      out.y = Math.sin(t * 5.2) * 0.34 * r + (Math.random() - 0.5) * 0.3 * r;
      out.z = (Math.random() - 0.5) * 0.26 * r;
      if (Math.random() < 0.14) { out.cr = 0.95; out.cg = 0.95; out.cb = 1.0; out.layer = 1; }
      else { const s = shade(); out.cr = 0.10 * s; out.cg = 0.06 * s; out.cb = 0.17 * s; out.layer = 0; }
    } else {
      sphereVertex(out, r * 0.40);
      out.x += 1.85 * r; out.y += 0.30 * r;
      if (Math.random() < 0.2) { out.cr = 1.0; out.cg = 1.0; out.cb = 1.0; out.layer = 1; }
      else { const s = shade(); out.cr = 0.14 * s; out.cg = 0.08 * s; out.cb = 0.22 * s; out.layer = 0; }
    }
  } else {
    // Horned brute: a broad heavy mass, two horn arcs, thick arm
    // columns, and a red core at the chest.
    if (p < 0.52) {
      sphereVertex(out, r * 0.85);
      out.x *= 1.35; out.z *= 0.75;
      const s = shade(); out.cr = 0.24 * s; out.cg = 0.06 * s; out.cb = 0.07 * s; out.layer = 0;
    } else if (p < 0.66) {
      sphereVertex(out, r * 0.22);
      out.y += 0.05 * r; out.z += 0.55 * r;
      out.cr = 1.0; out.cg = 0.25; out.cb = 0.28; out.layer = 1;
    } else if (p < 0.82) {
      // Horns: two heavy arcs above the shoulders.
      const side = i % 2 === 0 ? 1 : -1;
      const t = Math.random();
      out.x = side * (0.55 + t * 0.65) * r;
      out.y = (0.85 + Math.sin(t * Math.PI * 0.5) * 0.55) * r;
      out.z = (Math.random() - 0.5) * 0.12 * r;
      const s = shade(); out.cr = 0.40 * s; out.cg = 0.30 * s; out.cb = 0.22 * s; out.layer = 0;
    } else {
      // Arms: two thick columns hanging at the sides.
      const side = i % 2 === 0 ? 1 : -1;
      const t = Math.random();
      out.x = side * (1.05 + (Math.random() - 0.5) * 0.22) * r;
      out.y = (0.45 - t * 1.5) * r;
      out.z = (Math.random() - 0.5) * 0.2 * r;
      const s = shade(); out.cr = 0.20 * s; out.cg = 0.05 * s; out.cb = 0.06 * s; out.layer = 0;
    }
  }
}

const DEFS: Record<string, EntityVisualDef> = {
  // 1. Ember Glob (was slime). Chaser. Two layers kept from the shipped
  // construction and finished per Section 3.3: a dense bright core
  // (white-yellow, molten) inside a translucent membrane hemisphere
  // (deep orange-red). The old toxic green belonged to the Verdant
  // Canopy variant story, not the default skin.
  slime: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      const variant = variantFor(ctx, 'slime');
      const isCore = i < count * 0.3;
      const coreFrac = variant?.coreFrac ?? 0.4;
      const rad = isCore ? Math.cbrt(Math.random()) * r * coreFrac : Math.cbrt(Math.random()) * r;
      let u = Math.random() * Math.PI * 2;
      let v = Math.acos(Math.random()); // Hemisphere
      if (variant?.facetCore && isCore) {
        // Geode tweak (Crystal Glob): snap the core's directions to
        // a coarse angular grid so the bright center reads faceted
        // instead of smooth. Positions only; the body is untouched.
        u = Math.round(u / (Math.PI / 3)) * (Math.PI / 3);
        v = Math.round(v / (Math.PI / 4)) * (Math.PI / 4);
      }
      out.x = rad * Math.sin(v) * Math.cos(u);
      out.z = rad * Math.sin(v) * Math.sin(u);
      out.y = (rad * Math.cos(v) - r * 0.5) * (isCore ? 0.9 : 1.1);
      if (isCore) {
        const m = Math.random();
        if (variant) {
          const s = 0.87 + m * 0.26;
          out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s;
        } else {
          out.cr = 1.0; out.cg = 0.85 + m * 0.15; out.cb = 0.35 + m * 0.3; // White-yellow
        }
        out.layer = 1;
      } else if (variant) {
        const m = Math.random();
        const s = 0.75 + m * 0.55;
        out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s;
        out.layer = 0;
      } else {
        // Deep orange-red, tuned for the game's actual stacking:
        // sprites are 0.15 world units and the dome is 1.33 wide, so
        // a membrane pixel sums roughly 15 sprites. Base values are
        // therefore near 1/15 of the target read: red about 0.06
        // (sums to orange), green about 0.02 (sums under 0.4, so the
        // hue survives instead of clamping to cream, which is what
        // 0.72, 0.42 and 0.26 base reds all did at this stacking).
        // The bright core shows through as the white-yellow heart.
        const m = Math.random();
        out.cr = 0.05 + m * 0.03; out.cg = 0.018 + m * 0.01; out.cb = 0.004;
        out.layer = 0;
      }
    },
  },

  // 2. Gloomwing (was bat). Weaver. Shipped construction kept: dark
  // crimson body (20 percent of points), two big wings (80 percent)
  // with purple-edged gradient, red eye accents as the core layer.
  bat: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      const variant = variantFor(ctx, 'bat');
      const p = Math.random();
      if (p < 0.2) {
        out.x = (Math.random() - 0.5) * 0.6 * r;
        out.y = (Math.random() - 0.5) * 0.8 * r;
        out.z = (Math.random() - 0.5) * 0.6 * r;
        if (out.y > 0.2 * r && Math.abs(out.x) > 0.1 * r && out.z > 0.2 * r) {
          if (variant) { out.cr = variant.accent[0]; out.cg = variant.accent[1]; out.cb = variant.accent[2]; }
          else { out.cr = 1.0; out.cg = 0.0; out.cb = 0.0; } // Red glowing eyes
          out.layer = 1;
        } else if (variant) {
          const s = 0.8 + Math.random() * 0.5;
          out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s;
          out.layer = 0;
        } else {
          // Dark body, scaled to the bat's stacking (see the wing
          // note below): about 1/30 of the target read at the old
          // sprite size. The final sweep's smaller bat sprites
          // (0.08, in entity-sync) thin the stack, and the body
          // takes a whisper of violet with it so the whole bird
          // sits in the wing's family.
          out.cr = 0.03 + Math.random() * 0.015; out.cg = 0.0; out.cb = 0.010;
          out.layer = 0;
        }
      } else {
        const isLeft = p < 0.6;
        const span = Math.random() * r * 2.5; // Wing span
        const depth = (Math.random() - 0.5) * 0.3 * r;
        const swoop = Math.sin((span / (r * 2.5)) * Math.PI) * 0.5 * r; // Wing curve
        out.x = isLeft ? -span : span;
        out.y = swoop + (Math.random() - 0.5) * 0.2 * r;
        out.z = depth - (span * 0.2); // Wings angle slightly back
        const edge = span / (r * 2.5);
        // Wing color history: at the shipped 0.15-unit sprites the
        // bat's 800 points compress into a roughly 50 px silhouette
        // and additive stacking runs 30 to 60 deep along the wing
        // band, so red clamped at full long before blue finished
        // summing and any blue above a whisper walked the wing to
        // the hostile magenta rule 1.2.6 reserves (Stage 2 measured
        // rendered blue at 0.62 of red from a 0.010 base); the wings
        // shipped crimson with blue held at 0.003. The final sweep
        // took the route STAGE-2.md recorded: the bat now renders
        // at a per-type 0.08 sprite size (entity-sync), cutting the
        // wing stack to roughly 9 to 17 deep. The first sweep pass
        // at that size kept a red-leaning gradient (root red base
        // 0.045, blue 0.020) and the harness screenshot showed the
        // wing reading pink, because at a 9 to 17 stack red still
        // led blue about 2 to 1. The shipped gradient therefore
        // puts blue at roughly twice red along the whole wing:
        // root (0.020, 0.004, 0.045) opening to edge
        // (0.014, 0.005, 0.062), rendering around (0.25, 0.05,
        // 0.55) at the root and (0.2, 0.07, 0.85) at the edge:
        // violet at every depth, with red never above about 0.35,
        // so it cannot read as the bright hostile magenta-red
        // (1.0, 0.18, 0.42) either. Variant wings below keep their
        // whisper bases; their palettes were tuned per world and
        // are out of this change's scope.
        if (variant) {
          // Variant wings: the variant body color deepening toward
          // the edge, with the accent lit at the wingtips (Deepwing
          // teal, Voidwing violet). Bases stay in the same whisper
          // range as the default wing so the stacking math in the
          // note above still holds; the accent enters at 5 percent
          // strength and only past 80 percent span, where the wing
          // is thinnest and stacks are shallowest.
          const tip = edge > 0.8 ? (edge - 0.8) * 0.25 : 0;
          out.cr = variant.body[0] * (1 + edge) + variant.accent[0] * tip;
          out.cg = variant.body[1] * (1 + edge) + variant.accent[1] * tip;
          out.cb = variant.body[2] * (1 + edge) + variant.accent[2] * tip;
        } else {
          out.cr = 0.020 - edge * 0.006; out.cg = 0.004 + edge * 0.001; out.cb = 0.045 + edge * 0.017;
        }
        out.layer = 0;
      }
    },
  },

  // 3. Bastion Golem (was golem). Shooter (turret). Shipped construction
  // kept: bright magma core (20 percent, the core layer) inside orbiting
  // jagged rocks (80 percent, matte dark). The renderer speeds the rock
  // orbit up as the shot timer charges (Section 3.3 telegraph).
  golem: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      const variant = variantFor(ctx, 'golem');
      const p = Math.random();
      if (p < 0.2) {
        const rad = Math.cbrt(Math.random()) * r * 0.6;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        if (variant) {
          const s = 0.8 + Math.random() * 0.4;
          out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s;
        } else {
          out.cr = 1.0; out.cg = 0.2 + Math.random() * 0.4; out.cb = 0.0; // Hot orange/red magma
        }
        out.layer = 1;
      } else {
        const cx = (Math.random() - 0.5) * r * 2.5;
        const cy = (Math.random() - 0.5) * r * 3;
        const cz = (Math.random() - 0.5) * r * 2.5;
        out.x = cx + (Math.random() - 0.5) * 0.5 * r;
        out.y = cy + (Math.random() - 0.5) * 0.5 * r;
        out.z = cz + (Math.random() - 0.5) * 0.5 * r;
        const gray = 0.1 + Math.random() * 0.15;
        if (variant) {
          // Variant rocks (Reef Golem): darker than the default
          // rock and tinted by the variant body color.
          out.cr = gray * variant.body[0] * 1.6; out.cg = gray * variant.body[1] * 1.6; out.cb = gray * variant.body[2] * 1.6;
        } else {
          out.cr = gray; out.cg = gray * 0.8; out.cb = gray * 0.8; // Dark rocky color
        }
        out.layer = 0;
      }
    },
  },

  // 4. Cinder Imp (Stage 3). Charger. A small teardrop of flame,
  // mostly core with almost no body mass (Section 3.3): a white-hot
  // heart inside a thin flame skin, two horn points at the crown, and
  // a sparse spark tail trailing below. The renderer swells and
  // whitens it through the charge telegraph off the published
  // attackCharge, so the sampler only draws the resting shape.
  imp: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 7 variant: the Storm Sprite (Verdant Canopy) restyles
      // every zone electric green-white; positions and layers are
      // the default imp's, palette only.
      const variant = variantFor(ctx, 'imp');
      const p = Math.random();
      if (p < 0.06) {
        // Horn points: two small clusters at the crown.
        const side = Math.random() < 0.5 ? -1 : 1;
        out.x = side * 0.45 * r + (Math.random() - 0.5) * 0.3 * r;
        out.y = 1.05 * r + (Math.random() - 0.5) * 0.3 * r;
        out.z = (Math.random() - 0.5) * 0.3 * r;
        if (variant) { out.cr = variant.accent[0] * 0.6; out.cg = variant.accent[1] * 0.6; out.cb = variant.accent[2] * 0.6; }
        else { out.cr = 0.5; out.cg = 0.16; out.cb = 0.01; }
        out.layer = 0;
      } else if (p < 0.16) {
        // Spark tail: sparse embers trailing below the body.
        out.x = (Math.random() - 0.5) * 0.5 * r;
        out.y = -(0.9 + Math.random() * 1.0) * r;
        out.z = (Math.random() - 0.5) * 0.4 * r;
        const m = Math.random();
        if (variant) { out.cr = variant.accent[0] * (0.35 + m * 0.25); out.cg = variant.accent[1] * (0.35 + m * 0.25); out.cb = variant.accent[2] * (0.35 + m * 0.25); }
        else { out.cr = 0.35 + m * 0.2; out.cg = 0.08 + m * 0.06; out.cb = 0.0; }
        out.layer = 0;
      } else {
        // Teardrop body: a sphere sample pinched toward the crown so
        // the flame tip reads. The inner 60 percent of body points
        // are the core layer (the imp is mostly core by design).
        const rad = Math.cbrt(Math.random()) * r;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        let x = rad * Math.sin(v) * Math.cos(u);
        let y = rad * Math.cos(v) * 1.15;
        const z = rad * Math.sin(v) * Math.sin(u);
        const tip = Math.max(0, y) / (1.15 * r);
        x *= 1 - tip * 0.55; // pinch toward the crown
        out.x = x; out.y = y; out.z = z;
        if (rad < r * 0.62) {
          const m = Math.random();
          if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
          else { out.cr = 1.0; out.cg = 0.82 + m * 0.14; out.cb = 0.38 + m * 0.25; } // White-hot heart
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
          else { out.cr = 0.07 + m * 0.04; out.cg = 0.02 + m * 0.012; out.cb = 0.003; } // Thin flame skin, stacking-tuned like the Glob membrane
          out.layer = 0;
        }
      }
    },
  },

  // 5. Aether Wisp (Stage 3). Orbiter. A hollow ring of points
  // around a bright core (Section 3.3): the negative space in the
  // middle is its identity. The ring spans 300 degrees with a 60
  // degree gap; the renderer rotates the vertices, so the gap
  // travels. Nothing else in the game is a broken ring, and at 30 px
  // it never reads as the 200-point coin circle.
  wisp: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variants: the Neon Wisp (Neon Nebula) wears a
      // pink ring around a white core; the Rift-touched wisp
      // (Abyssal Rift) a black-violet ring around a star-white
      // core. Positions unchanged.
      const variant = variantFor(ctx, 'wisp');
      if (i < count * 0.2) {
        // Bright core floating in the ring's hollow.
        const rad = Math.cbrt(Math.random()) * r * 0.3;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        const m = Math.random();
        if (variant) { const s = 0.85 + m * 0.15; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
        else { out.cr = 0.85 + m * 0.15; out.cg = 0.97; out.cb = 1.0; } // White-cyan
        out.layer = 1;
      } else {
        // Ring: the vertex index walks the 300 degree arc so the gap
        // is structural, not a sampling accident. Beads every 50th
        // ring vertex burn brighter as the core layer.
        const u = (i - count * 0.2) / (count * 0.8);
        const a = Math.PI / 6 + u * (Math.PI * 5 / 3); // 30 deg to 330 deg
        const rad = r * (1 + (Math.random() - 0.5) * 0.35);
        out.x = Math.cos(a) * rad;
        out.y = Math.sin(a) * rad;
        out.z = (Math.random() - 0.5) * 0.36 * r;
        if (i % 50 === 0) {
          if (variant) { out.cr = variant.accent[0]; out.cg = variant.accent[1]; out.cb = variant.accent[2]; }
          else { out.cr = 0.6; out.cg = 0.95; out.cb = 1.0; }
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
          else { out.cr = 0.10 + m * 0.06; out.cg = 0.34 + m * 0.14; out.cb = 0.44 + m * 0.16; } // Pale cyan ring
          out.layer = 0;
        }
      }
    },
  },

  // 6. Brood Pod (Stage 3). Splitter. A fat sphere of clustered
  // cells, each cell a mini-glob with its own pale heart (Section
  // 3.3). Cell centers sit on a golden-angle spiral so the cluster
  // is even; the renderer thins the surface as health drops, so the
  // damage state reads on the body.
  pod: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      const CELLS = 14;
      const k = i % CELLS;
      const cy = 1 - (k / (CELLS - 1)) * 2;
      const crad = Math.sqrt(Math.max(0, 1 - cy * cy));
      const theta = k * 2.39996; // golden angle
      const cx = Math.cos(theta) * crad * 0.52 * r;
      const cyy = cy * 0.52 * r;
      const cz = Math.sin(theta) * crad * 0.52 * r;
      const rad = Math.cbrt(Math.random()) * r * 0.44;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      out.x = cx + rad * Math.sin(v) * Math.cos(u);
      out.y = cyy + rad * Math.sin(v) * Math.sin(u);
      out.z = cz + rad * Math.cos(v);
      // Stage 7 variant: the Geode Pod (Crystal Caverns) grows
      // crystal cells in a rocky shell; positions unchanged.
      const variant = variantFor(ctx, 'pod');
      if (rad < r * (variant ? 0.3 : 0.2)) {
        const m = Math.random();
        if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
        else { out.cr = 0.45 + m * 0.2; out.cg = 0.85 + m * 0.15; out.cb = 0.68 + m * 0.2; } // Pale cell heart
        out.layer = 1;
      } else {
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.016 + m * 0.012; out.cg = 0.075 + m * 0.035; out.cb = 0.06 + m * 0.025; } // Murky teal cell skin
        out.layer = 0;
      }
    },
  },

  // 7. Mite (Stage 3). Swarmer. A 16 px spark with a single wing
  // pair, drawn at the size floor (Section 3.3): a bright core mote
  // and two small wing fans the renderer flaps like the Gloomwing's,
  // faster. Only 200 points; a pack of five costs less than one
  // standard enemy.
  mite: {
    count: 200,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variant: the Rift-touched mite (Abyssal Rift)
      // burns star white at the heart with black-violet wings.
      const variant = variantFor(ctx, 'mite');
      const p = Math.random();
      if (p < 0.4) {
        const rad = Math.cbrt(Math.random()) * r * 0.45;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        const m = Math.random();
        if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
        else { out.cr = 1.0; out.cg = 0.82 + m * 0.16; out.cb = 0.35 + m * 0.25; } // Hot spark heart
        out.layer = 1;
      } else {
        const isLeft = p < 0.7;
        const span = (0.4 + Math.random() * 1.1) * r;
        out.x = isLeft ? -span : span;
        out.y = (Math.random() - 0.5) * 0.5 * r + span * 0.15;
        out.z = (Math.random() - 0.5) * 0.2 * r;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.22 + m * 0.12; out.cg = 0.10 + m * 0.05; out.cb = 0.015; } // Dim amber wing
        out.layer = 0;
      }
    },
  },

  // 8. Sentry Shard (Stage 4). Shooter (turret, aimed). A floating
  // crystal octahedron grown to enemy scale (Section 3.3): matte
  // violet-slate facets with one bright cyan-white core eye, so it
  // never reads as the 200-point gem pickup (ten times the visual
  // weight, and it rotates to track the player). The long axis is x;
  // the renderer turns it toward the published facing.
  sentry_shard: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      if (i < count * 0.18) {
        // Core eye: a tight bright cluster at the center, bulging
        // slightly toward the viewer.
        const rad = Math.cbrt(Math.random()) * r * 0.22;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v) + r * 0.18;
        const m = Math.random();
        // Stage 7 variant: the Prism Shard (Crystal Caverns) burns
        // white at the eye and brighter cyan through the facets.
        const variant = variantFor(ctx, 'sentry_shard');
        if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
        else { out.cr = 0.8 + m * 0.2; out.cg = 0.95; out.cb = 1.0; } // Cyan-white eye
        out.layer = 1;
      } else {
        // Facets: octahedron sampling (flat faces read through the
        // point distribution), elongated on x, squashed on z.
        octahedronVertex(out, r);
        out.x *= 1.35; out.z *= 0.55;
        const m = Math.random();
        const variant = variantFor(ctx, 'sentry_shard');
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.028 + m * 0.02; out.cg = 0.024 + m * 0.014; out.cb = 0.05 + m * 0.03; } // Matte violet-slate, stacking-tuned
        out.layer = 0;
      }
    },
  },

  // 9. Seedmother (Stage 4). Anchor. A big translucent dome with
  // four visible mine-eggs inside (Section 3.3): dark shells with
  // hostile-bright cores, so the field she will lay is visible on
  // her body before it exists. Root-ribbon strands trail below.
  seedmother: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 7 variant: the Thornmother (Verdant Canopy). Her one
      // geometry tweak is the thorned dome: the mine family's spike
      // factor pushes dome points outward in a thorny silhouette.
      // Colors go brown-green; the eggs keep their hostile hearts
      // (they are Thorn Mines) under root-brown shells.
      const variant = variantFor(ctx, 'seedmother');
      const p = Math.random();
      if (p < 0.5) {
        // Dome: a hemisphere like the Glob's, in murky green-brown.
        let rad = Math.cbrt(Math.random()) * r;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(Math.random()); // Hemisphere
        if (variant?.thorned) rad *= 1 + 0.30 * Math.abs(Math.sin(u * 3) * Math.sin(v * 4));
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.z = rad * Math.sin(v) * Math.sin(u);
        out.y = (rad * Math.cos(v) - r * 0.45) * 1.05;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.03 + m * 0.016; out.cg = 0.042 + m * 0.02; out.cb = 0.014 + m * 0.008; }
        out.layer = 0;
      } else if (p < 0.82) {
        // Mine-eggs: four fixed spheres inside the dome. The inner
        // points of each egg are the core layer in the hostile
        // color (a mine's heart, visible through the dome).
        const EGGS = [[0.36, 0.1, 0.1], [-0.36, 0.1, -0.08], [0.28, -0.34, -0.14], [-0.28, -0.34, 0.16]];
        const egg = EGGS[i % 4];
        const rad = Math.cbrt(Math.random()) * r * 0.2;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = egg[0] * r + rad * Math.sin(v) * Math.cos(u);
        out.y = egg[1] * r + rad * Math.sin(v) * Math.sin(u);
        out.z = egg[2] * r + rad * Math.cos(v);
        if (rad < r * 0.08) {
          out.cr = ctx.hostile[0]; out.cg = ctx.hostile[1]; out.cb = ctx.hostile[2];
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
          else { out.cr = 0.012 + m * 0.008; out.cg = 0.01 + m * 0.006; out.cb = 0.02 + m * 0.01; } // Near-black violet shell
          out.layer = 0;
        }
      } else {
        // Root ribbons: strands trailing below the dome.
        out.x = (Math.random() - 0.5) * 1.1 * r;
        out.y = -(0.55 + Math.random() * 0.85) * r;
        out.z = (Math.random() - 0.5) * 0.5 * r;
        const m = Math.random();
        if (variant) { const s = 0.5 + m * 0.4; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.02 + m * 0.012; out.cg = 0.026 + m * 0.012; out.cb = 0.008; }
        out.layer = 0;
      }
    },
  },

  // 10. Rift Mine (Stage 4). Hazard. A 20 px spiked sphere, near
  // black violet with a blinking hostile core (Section 3.3): the
  // blink is the telegraph, driven by the renderer off the
  // published attackCharge. Only 400 points; a field of them is
  // cheap by design.
  rift_mine: {
    count: 400,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      if (i < count * 0.22) {
        // Hostile core heart.
        const rad = Math.cbrt(Math.random()) * r * 0.34;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        out.cr = ctx.hostile[0]; out.cg = ctx.hostile[1]; out.cb = ctx.hostile[2];
        out.layer = 1;
      } else {
        // Spiked shell: sphere directions pushed out along a
        // low-frequency spike pattern so the silhouette is thorny,
        // not round.
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        // Stage 7 variant: the Thorn Mine (Verdant Canopy) runs
        // the spike factor stronger (the root tangle) and wears a
        // green-brown shell; the hostile heart above is unchanged.
        // Stage 8 variant: the Desert mine (Golden Sands) is
        // sand-buried: the shell's lower half is flattened so the
        // mine reads half-sunk in the dune, its core the part
        // that shows. Positions only; the physics body is built
        // elsewhere and keeps the round hitbox.
        const variant = variantFor(ctx, 'rift_mine');
        const spikeAmp = variant?.thorned ? 0.55 : 0.38;
        const spike = 1 + spikeAmp * Math.abs(Math.sin(u * 3) * Math.sin(v * 4));
        const rad = Math.cbrt(Math.random()) * r * spike;
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        if (variant?.buried && out.y < 0) out.y *= 0.45;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.014 + m * 0.01; out.cg = 0.008 + m * 0.006; out.cb = 0.026 + m * 0.014; } // Near-black violet
        out.layer = 0;
      }
    },
  },

  // 11. Shieldback (Stage 4). Bulwark. A heavy beetle mass whose
  // front 180 degrees (local +x, which the renderer turns toward
  // the player via the published facing) is a smooth shield face:
  // a lighter metallic band with a bright rim ring as the core
  // layer (Section 3.3). The body behind the face stays dark, so
  // the protected side reads at a glance.
  shieldback: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      const rad = Math.cbrt(Math.random()) * r;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      out.x = rad * Math.sin(v) * Math.cos(u) * 1.1;
      out.y = rad * Math.sin(v) * Math.sin(u) * 0.92;
      out.z = rad * Math.cos(v) * 0.8;
      const facing01 = out.x / (1.1 * r); // -1 behind .. +1 at the shield face
      // Stage 7 variant: the Crystalback (Crystal Caverns) wears a
      // crystal plate: cyan-bright rim, pale crystal face, deep
      // blue mass. Positions and the facing math are unchanged.
      const variant = variantFor(ctx, 'shieldback');
      if (Math.abs(facing01) < 0.3 && rad > 0.7 * r) {
        // Rim ring: the great circle where the face plate meets the
        // body, at the surface. The spark-off flash target.
        const m = Math.random();
        if (variant?.rim) { const s = 0.8 + m * 0.4; out.cr = variant.rim[0] * s; out.cg = variant.rim[1] * s; out.cb = variant.rim[2] * s; }
        else { out.cr = 0.55 + m * 0.2; out.cg = 0.58 + m * 0.2; out.cb = 0.66 + m * 0.2; } // Bright metallic rim
        out.layer = 1;
      } else if (facing01 >= 0.3) {
        // Shield face plate: lighter metallic band.
        const m = Math.random();
        if (variant?.face) { const s = 0.75 + m * 0.55; out.cr = variant.face[0] * s; out.cg = variant.face[1] * s; out.cb = variant.face[2] * s; }
        else { out.cr = 0.075 + m * 0.035; out.cg = 0.08 + m * 0.035; out.cb = 0.1 + m * 0.04; }
        out.layer = 0;
      } else {
        // Dark beetle mass behind the face.
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.016 + m * 0.01; out.cg = 0.014 + m * 0.008; out.cb = 0.02 + m * 0.01; }
        out.layer = 0;
      }
    },
  },

  // 12. Pyre Moth (Stage 4). Burster. A soft fuzzy ball of flame
  // with two large slow wings (Section 3.3): warm cream-orange body
  // over a hot center core. Pretty, which is the trap; the renderer
  // strobes the whole body through its fuse off the published
  // attackCharge.
  pyre_moth: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variants: the Rime Moth (Neon Nebula) is ice
      // blue-white, the Blood Moth (Blood Moon) deep red, the
      // Rift-touched moth (Abyssal Rift) black-violet with a
      // star-white center. Positions unchanged.
      const variant = variantFor(ctx, 'pyre_moth');
      const p = Math.random();
      if (p < 0.55) {
        // Fuzzy body: sphere sample with radius jitter so the edge
        // is soft, not machined.
        const rad = Math.cbrt(Math.random()) * r * (0.82 + Math.random() * 0.36);
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        if (rad < r * 0.4) {
          const m = Math.random();
          if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
          else { out.cr = 1.0; out.cg = 0.72 + m * 0.2; out.cb = 0.3 + m * 0.2; } // Hot center
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
          else { out.cr = 0.09 + m * 0.05; out.cg = 0.045 + m * 0.025; out.cb = 0.012 + m * 0.008; } // Warm cream-orange fuzz, stacking-tuned
          out.layer = 0;
        }
      } else {
        // Two large wings, swept up and back.
        const isLeft = p < 0.775;
        const span = (0.5 + Math.random() * 1.5) * r;
        out.x = isLeft ? -span : span;
        out.y = span * 0.42 + (Math.random() - 0.5) * 0.3 * r;
        out.z = -span * 0.25 + (Math.random() - 0.5) * 0.2 * r;
        const m = Math.random();
        if (variant) { const s = 0.55 + m * 0.4; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.05 + m * 0.03; out.cg = 0.028 + m * 0.016; out.cb = 0.008; }
        out.layer = 0;
      }
    },
  },

  // 13. Shroud Phantom (Stage 5). Phaser. A hooded trailing shape
  // of sparse points, about 60 px tall (Section 3.3): a hood arc
  // over two pale eye accents (the core layer), and a body that
  // dissolves into trailing wisps below. The renderer drives its
  // opacity through the phase cycle off the published state, so
  // the sampler only draws the solid shape.
  phantom: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variants: the Frostwraith (Neon Nebula) is pale
      // with a snow trail; the Rift-touched phantom (Abyssal
      // Rift) is black-violet with star-white eyes. Positions
      // unchanged.
      const variant = variantFor(ctx, 'phantom');
      const p = Math.random();
      if (p < 0.05) {
        // Two eye accents under the hood.
        const side = Math.random() < 0.5 ? -1 : 1;
        out.x = side * 0.26 * r + (Math.random() - 0.5) * 0.16 * r;
        out.y = 0.62 * r + (Math.random() - 0.5) * 0.14 * r;
        out.z = 0.3 * r + (Math.random() - 0.5) * 0.1 * r;
        const m = Math.random();
        if (variant) { const s = 0.85 + m * 0.15; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
        else { out.cr = 0.85 + m * 0.15; out.cg = 0.8 + m * 0.12; out.cb = 1.0; } // Pale violet-white
        out.layer = 1;
      } else if (p < 0.38) {
        // Hood: a dome arc over the head, open at the face.
        const rad = Math.cbrt(Math.random()) * r * 0.62;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(Math.random() * 0.9); // upper cap
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = 0.5 * r + rad * Math.cos(v);
        out.z = rad * Math.sin(v) * Math.sin(u) * 0.8 - 0.08 * r;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.03 + m * 0.016; out.cg = 0.026 + m * 0.012; out.cb = 0.055 + m * 0.025; } // Matte slate-violet
        out.layer = 0;
      } else {
        // Trailing body: wisps falling away below the hood, spread
        // thin so the shape reads as sparse cloth, not a solid.
        // For the Frostwraith this trail is the sheet's snow
        // trail: the same pale body color, a step dimmer.
        const t = Math.random();
        out.y = (0.35 - t * 2.0) * r;
        const spread = (0.34 - t * 0.16) * r;
        out.x = (Math.random() - 0.5) * 2 * spread;
        out.z = (Math.random() - 0.5) * 0.5 * r;
        const m = Math.random();
        if (variant) { const s = 0.6 + m * 0.45; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.024 + m * 0.012; out.cg = 0.02 + m * 0.01; out.cb = 0.045 + m * 0.02; }
        out.layer = 0;
      }
    },
  },

  // 14. Lance Wraith (Stage 5). Sniper. A tall thin spear figure,
  // about 70 px long, built along local x like the Sentry Shard so
  // the renderer can align the body to its aim line via the
  // published facing (Section 3.3). One bright aiming eye in the
  // hostile color is the core layer: it is the telegraph's source.
  wraith: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variant: the Rift-touched wraith (Abyssal Rift)
      // carries a white-violet spearhead on a black-violet
      // shaft. The aiming eye stays hostile in every world: it
      // is the telegraph's source. Positions unchanged.
      const variant = variantFor(ctx, 'wraith');
      const p = Math.random();
      if (p < 0.07) {
        // Aiming eye: a tight hostile-bright cluster ahead of center.
        const rad = Math.cbrt(Math.random()) * r * 0.16;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = 0.85 * r + rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v) + 0.22 * r;
        out.cr = ctx.hostile[0]; out.cg = ctx.hostile[1]; out.cb = ctx.hostile[2];
        out.layer = 1;
      } else if (p < 0.3) {
        // Spearhead: a flat diamond at the front of the shaft.
        const t = Math.random();
        out.x = (1.05 + t * 0.55) * r;
        out.y = (Math.random() - 0.5) * (0.5 - t * 0.34) * r;
        out.z = (Math.random() - 0.5) * 0.16 * r;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
        else { out.cr = 0.10 + m * 0.05; out.cg = 0.095 + m * 0.045; out.cb = 0.13 + m * 0.05; } // Pale bone-steel
        out.layer = 0;
      } else {
        // Shaft and trailing fins: a thin line of points with a
        // forked tail, sparse toward the back.
        const t = Math.random();
        out.x = (1.0 - t * 2.6) * r;
        const fin = t > 0.82 ? (t - 0.82) * 2.4 * r : 0;
        out.y = (Math.random() < 0.5 ? -1 : 1) * fin * Math.random() + (Math.random() - 0.5) * 0.09 * r;
        out.z = (Math.random() - 0.5) * 0.09 * r;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.045 + m * 0.02; out.cg = 0.04 + m * 0.018; out.cb = 0.06 + m * 0.024; } // Cold gray-violet
        out.layer = 0;
      }
    },
  },

  // 15. War Chanter (Stage 5). Support. A bell-shaped body, about
  // 50 px, with a ring of orbiting note-sparks (Section 3.3): the
  // bell profile flares at the rim, and the sparks sit on a circle
  // in the screen plane that the renderer rotates slowly, so the
  // ring visibly orbits. The sparks are the core layer in warm gold;
  // the hostile read of its pulse comes from the separate expanding
  // pulse ring and the tint wash on the enemies it buffs.
  chanter: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variants: the Blood Chanter (Blood Moon) tolls
      // in dark red with blood-crimson sparks; the Rift-touched
      // chanter (Abyssal Rift) in black-violet with star-white
      // sparks. Positions unchanged.
      const variant = variantFor(ctx, 'chanter');
      if (i < count * 0.16) {
        // Note-sparks: evenly spaced on the orbit circle so the
        // ring is structural, with jitter so it still reads as
        // sparks, not a drawn circle.
        const a = (i / (count * 0.16)) * Math.PI * 2;
        const rad = r * 1.12 * (1 + (Math.random() - 0.5) * 0.1);
        out.x = Math.cos(a) * rad;
        out.y = Math.sin(a) * rad * 0.92;
        out.z = (Math.random() - 0.5) * 0.2 * r;
        const m = Math.random();
        if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
        else { out.cr = 1.0; out.cg = 0.72 + m * 0.2; out.cb = 0.22 + m * 0.14; } // Warm gold
        out.layer = 1;
      } else {
        // Bell: a lathed profile, narrow crown, swelling body,
        // flared rim at the bottom.
        const t = Math.random(); // 0 at the crown, 1 at the rim
        out.y = (0.85 - t * 1.8) * r;
        const profile = 0.3 + 0.52 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62) + (t > 0.85 ? (t - 0.85) * 1.5 : 0);
        const a = Math.random() * Math.PI * 2;
        const rad = Math.cbrt(Math.random()) * r * profile;
        out.x = Math.cos(a) * rad;
        out.z = Math.sin(a) * rad * 0.6;
        if (t > 0.93 && Math.random() < 0.5) {
          const m = Math.random();
          if (variant) { const s = 0.8 + m * 0.4; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
          else { out.cr = 0.5 + m * 0.2; out.cg = 0.36 + m * 0.14; out.cb = 0.1; } // Bright rim lip
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
          else { out.cr = 0.05 + m * 0.024; out.cg = 0.036 + m * 0.016; out.cb = 0.012 + m * 0.006; } // Deep bronze
          out.layer = 0;
        }
      }
    },
  },

  // 17. Loom Serpent head (Stage 5). Weaver (elite). A bright head
  // core with two swept fins and a gold spine line (Section 3.3);
  // the ribbon body is published as separate serpent_segment
  // entities so the segments can gap and bunch honestly.
  serpent: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variants: the Bloodwyrm (Blood Moon) runs deep
      // red with an ember spine; the Rift-touched serpent
      // (Abyssal Rift) black-violet with a star-white heart and
      // a violet-white spine. Positions unchanged.
      const variant = variantFor(ctx, 'serpent');
      const p = Math.random();
      if (p < 0.34) {
        // Bright head core.
        const rad = Math.cbrt(Math.random()) * r * 0.52;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u) + 0.25 * r;
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        const m = Math.random();
        if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
        else { out.cr = 1.0; out.cg = 0.88 + m * 0.1; out.cb = 0.45 + m * 0.2; } // White-gold heart
        out.layer = 1;
      } else if (p < 0.52) {
        // Swept fins: two flat fans trailing back from the head.
        const isLeft = p < 0.43;
        const span = (0.3 + Math.random() * 1.1) * r;
        out.x = -span * 0.8 + (Math.random() - 0.5) * 0.2 * r;
        out.y = (isLeft ? -1 : 1) * span * 0.55 + (Math.random() - 0.5) * 0.2 * r;
        out.z = -span * 0.2 + (Math.random() - 0.5) * 0.15 * r;
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.03 + m * 0.016; out.cg = 0.09 + m * 0.04; out.cb = 0.045 + m * 0.02; } // Deep emerald
        out.layer = 0;
      } else {
        // Skull mass around the core, tapering toward the neck.
        const rad = Math.cbrt(Math.random()) * r;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u) * 1.15 - 0.1 * r;
        out.y = rad * Math.sin(v) * Math.sin(u) * 0.9;
        out.z = rad * Math.cos(v) * 0.8;
        if (out.y > 0.55 * r && Math.abs(out.x) < 0.3 * r) {
          const m = Math.random();
          if (variant) { const s = 0.8 + m * 0.4; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
          else { out.cr = 0.55 + m * 0.2; out.cg = 0.42 + m * 0.16; out.cb = 0.1; } // Gold spine accent
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
          else { out.cr = 0.018 + m * 0.01; out.cg = 0.065 + m * 0.03; out.cb = 0.032 + m * 0.014; }
          out.layer = 0;
        }
      }
    },
  },

  // Loom Serpent ribbon segment (Stage 5): a dimmer emerald glob
  // with a small gold spine cluster, published per segment by the
  // game along the head's recent path.
  serpent_segment: {
    count: 300,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variants follow the head's: Bloodwyrm segments
      // run deep red, Rift-touched segments black-violet.
      const variant = variantFor(ctx, 'serpent_segment');
      const rad = Math.cbrt(Math.random()) * r;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      out.x = rad * Math.sin(v) * Math.cos(u) * 1.1;
      out.y = rad * Math.sin(v) * Math.sin(u) * 0.9;
      out.z = rad * Math.cos(v) * 0.8;
      if (out.y > 0.5 * r && Math.abs(out.x) < 0.35 * r && Math.random() < 0.5) {
        const m = Math.random();
        if (variant) { const s = 0.8 + m * 0.4; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
        else { out.cr = 0.4 + m * 0.18; out.cg = 0.3 + m * 0.13; out.cb = 0.08; } // Gold spine
        out.layer = 1;
      } else {
        const m = Math.random();
        if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
        else { out.cr = 0.014 + m * 0.008; out.cg = 0.05 + m * 0.024; out.cb = 0.024 + m * 0.01; } // Dim emerald
        out.layer = 0;
      }
    },
  },

  // 16. Storm Darter (Stage 5). Mobile shooter. A sleek arrowhead,
  // about 44 px long along local x, with swept fins and bright
  // wingtip sparks (Section 3.3). The renderer aligns it to its
  // travel direction via the published facing, and the sparks flare
  // through the line-up off the published attackCharge.
  darter: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Stage 8 variant: the Rift-touched darter (Abyssal Rift)
      // keeps the ice-white read but over a black-violet body,
      // its sparks and nose gone full star white. Positions
      // unchanged.
      const variant = variantFor(ctx, 'darter');
      const p = Math.random();
      if (p < 0.08) {
        // Wingtip sparks at the rear corners.
        const isLeft = Math.random() < 0.5;
        out.x = -1.05 * r + (Math.random() - 0.5) * 0.2 * r;
        out.y = (isLeft ? -1 : 1) * 0.78 * r + (Math.random() - 0.5) * 0.18 * r;
        out.z = (Math.random() - 0.5) * 0.15 * r;
        const m = Math.random();
        if (variant) { const s = 0.87 + m * 0.26; out.cr = variant.accent[0] * s; out.cg = variant.accent[1] * s; out.cb = variant.accent[2] * s; }
        else { out.cr = 0.8 + m * 0.2; out.cg = 0.95; out.cb = 1.0; } // Ice-white sparks
        out.layer = 1;
      } else {
        // Arrowhead: a swept delta, nose at +x, width tapering with
        // the sweep so the fins read as one shape with the body.
        const t = Math.random(); // 0 tail, 1 nose
        out.x = (-1.25 + t * 2.65) * r;
        const halfWidth = (t < 0.35 ? 0.25 + t * 1.5 : 0.78 - (t - 0.35) * 1.13) * r;
        out.y = (Math.random() - 0.5) * 2 * halfWidth * Math.sqrt(Math.random());
        out.z = (Math.random() - 0.5) * 0.22 * r;
        if (t > 0.82) {
          const m = Math.random();
          if (variant) { const s = 0.8 + m * 0.4; out.cr = variant.core[0] * s; out.cg = variant.core[1] * s; out.cb = variant.core[2] * s; }
          else { out.cr = 0.5 + m * 0.2; out.cg = 0.85 + m * 0.12; out.cb = 0.95; } // Bright nose core
          out.layer = 1;
        } else {
          const m = Math.random();
          if (variant) { const s = 0.75 + m * 0.55; out.cr = variant.body[0] * s; out.cg = variant.body[1] * s; out.cb = variant.body[2] * s; }
          else { out.cr = 0.035 + m * 0.016; out.cg = 0.085 + m * 0.035; out.cb = 0.105 + m * 0.04; } // Ice cyan-white body
          out.layer = 0;
        }
      }
    },
  },

  // The Lance Wraith's lock-on line (Stage 5): a thin stretched
  // sprite in the hostile color, published by the game between the
  // wraith's eye and the player's position while it locks. Points
  // run along local x; the renderer rotates the mesh to the
  // published facing and brightens it with the lock progress.
  wraith_line: {
    count: 120,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      out.x = -r + (i / Math.max(1, count - 1)) * 2 * r;
      out.y = (Math.random() - 0.5) * 0.05 * r;
      out.z = (Math.random() - 0.5) * 0.05 * r;
      flatColor(out, ctx.hostile);
      out.layer = 1;
    },
  },

  // The War Chanter's buff pulse ring (Stage 5): points on a circle
  // in the screen plane; the game publishes it expanding across the
  // buff radius in the hostile color, and the renderer fades it
  // over the published attackCharge.
  chanter_pulse: {
    count: 160,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const a = (i / count) * Math.PI * 2;
      out.x = Math.cos(a) * r;
      out.y = Math.sin(a) * r;
      out.z = (Math.random() - 0.5) * 0.08 * r;
      flatColor(out, ctx.hostile);
      out.layer = 0;
    },
  },

  // Boss construction (Stage 9): dispatches on the build context's
  // world index to the per-world samplers above. White-hot cores are
  // layer 1, which is what the boss phase flashes and the rig's
  // telegraph and enrage charges brighten (Section 3.1).
  boss: {
    count: 4000,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      switch (ctx.worldIndex) {
        case 1: sampleBossShadowWraith(i, count, r, ctx, out); break;
        case 2: sampleBossCrystalTitan(i, count, r, ctx, out); break;
        case 3: sampleBossStormWyvern(i, count, r, ctx, out); break;
        case 4: sampleBossVoidReaper(i, count, r, ctx, out); break;
        case 5: sampleBossPhoenixKing(i, count, r, ctx, out); break;
        case 6: sampleBossIceEmpress(i, count, r, ctx, out); break;
        case 7: sampleBossDragonEmperor(i, count, r, ctx, out); break;
        case 8: sampleBossChaosDemon(i, count, r, ctx, out); break;
        case 9: sampleBossEternalPhoenix(i, count, r, ctx, out); break;
        default: sampleBossSkull(i, count, r, ctx, out); break;
      }
    },
  },

  // The Shadow Lord's split copies (Stage 9): the wraith sampler at
  // a dimmer read; copies are display only and never hittable. The
  // real boss keeps the full-bright build, which is the subtle tell
  // the sheet asks for alongside the brighter eye.
  boss_shadow: {
    count: 1600,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sampleBossShadowWraith(i, count, r, ctx, out);
      out.cr *= 0.55; out.cg *= 0.55; out.cb *= 0.55;
    },
  },

  // The boss shield shell (Stage 9, shield and regen addendum): a
  // translucent sphere shell in the boss's own palette, published
  // while a shield phase gathers or holds. Its color arrives on the
  // build context from the rig data; never the hostile color.
  boss_shield: {
    count: 700,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const rad = r * 1.55;
      out.x = rad * Math.sin(v) * Math.cos(u);
      out.y = rad * Math.sin(v) * Math.sin(u);
      out.z = rad * Math.cos(v);
      flatColor(out, ctx.shieldColor ?? [0.6, 0.85, 1.0]);
      out.layer = 0;
    },
  },

  // One shard of the Crystal Titan's signature ring (Stage 9): a
  // small faceted octahedron in crystal violet-white.
  boss_shard: {
    count: 120,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      octahedronVertex(out, r);
      if (Math.random() < 0.25) { out.cr = 0.85; out.cg = 0.9; out.cb = 1.0; out.layer = 1; }
      else { const s = 0.7 + Math.random() * 0.5; out.cr = 0.45 * s; out.cg = 0.2 * s; out.cb = 0.85 * s; out.layer = 0; }
    },
  },

  // The Inferno Guardian's flame ring telegraph (Stage 9): a flat
  // ring of hostile points at the wave's radius; the ground flare
  // that announces the Flame Ring Wave.
  boss_ring: {
    count: 260,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const a = (i / count) * Math.PI * 2;
      const rr = r * (0.96 + Math.random() * 0.08);
      out.x = Math.cos(a) * rr;
      out.y = Math.sin(a) * rr;
      out.z = (Math.random() - 0.5) * 0.06 * r;
      flatColor(out, ctx.hostile);
      out.layer = 1;
    },
  },

  // One flame pillar of the ring wave (Stage 9): a vertical column
  // of hostile points, dim at the top, white-hot at the base.
  boss_pillar: {
    count: 240,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const a = Math.random() * Math.PI * 2;
      const rr = r * 0.8 * Math.sqrt(Math.random());
      out.x = Math.cos(a) * rr;
      out.z = Math.sin(a) * rr * 0.5;
      out.y = (Math.random() * 2.6 - 1.3) * r;
      if (out.y < -0.5 * r) { flatColor(out, [1.0, 0.85, 0.6]); out.layer = 1; }
      else flatColor(out, ctx.hostile);
    },
  },

  // The Storm Wyvern's lightning column telegraph (Stage 9): a thin
  // full-height column of hostile points at the strike line. The
  // game publishes size as half the viewport height, so the sampler
  // spans the field vertically.
  boss_column: {
    count: 420,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      out.x = (Math.random() - 0.5) * 0.7;
      out.y = (Math.random() * 2 - 1) * r;
      out.z = (Math.random() - 0.5) * 0.7;
      if (Math.abs(out.x) < 0.10) { flatColor(out, [1.0, 0.95, 0.9]); out.layer = 1; }
      else flatColor(out, ctx.hostile);
    },
  },

  // The Void Reaper's Harvest Arc telegraph (Stage 9): a crescent
  // line of hostile points along the sweep's path. The span matches
  // the rig's arc data (1.9 rad); the game publishes the radius as
  // size and the locked angle as facing.
  boss_arc: {
    count: 320,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const a = ((i / count) - 0.5) * 1.9;
      const rr = r * (0.97 + Math.random() * 0.06);
      out.x = Math.cos(a) * rr;
      out.y = Math.sin(a) * rr;
      out.z = (Math.random() - 0.5) * 0.05 * r;
      flatColor(out, ctx.hostile);
      out.layer = 1;
    },
  },

  // The locked dash line (Stage 10): Royal Decree and the Eternal
  // Drill publish it from the boss to the locked target for the
  // whole wind-up, so the dash is never a surprise. A thin strip
  // of hostile points along the local x axis; the renderer rotates
  // it to the published facing.
  boss_line: {
    count: 220,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      out.x = -r + (i / Math.max(1, count - 1)) * 2 * r;
      out.y = (Math.random() - 0.5) * 0.045 * r;
      out.z = (Math.random() - 0.5) * 0.045 * r;
      flatColor(out, ctx.hostile);
      out.layer = 1;
    },
  },

  // The Emperor's Breath cone (Stage 10): a wedge of hostile
  // points from the maw, narrow at the source and widening with
  // range, drawn for the full 0.8 s telegraph and burning while
  // the cone is live. Points near the maw are the bright core
  // layer, so the glow builds visibly during the telegraph.
  boss_cone: {
    count: 700,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const t = Math.sqrt(Math.random()); // denser near the maw
      const half = 0.61 * (0.30 + 0.70 * t);
      const a = (Math.random() * 2 - 1) * half;
      const rad = t * r;
      out.x = Math.cos(a) * rad;
      out.y = Math.sin(a) * rad;
      out.z = (Math.random() - 0.5) * 0.05 * r;
      flatColor(out, ctx.hostile);
      out.layer = t < 0.25 ? 1 : 0;
    },
  },

  heart: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const t = Math.random() * Math.PI * 2;
      const rad = Math.random() * r * 0.05;
      out.x = 16 * Math.pow(Math.sin(t), 3) * rad;
      out.y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * rad;
      out.z = (Math.random() - 0.5) * r * 0.2;
      flatColor(out, [0.925, 0.282, 0.6]); // 0xec4899
    },
  },

  gem: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => { octahedronVertex(out, r); flatColor(out, [0.753, 0.518, 0.988]); }, // 0xc084fc
  },

  xp_orb: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => { octahedronVertex(out, r); flatColor(out, [0.22, 0.741, 0.973]); }, // 0x38bdf8
  },

  coin: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const angle = Math.random() * Math.PI * 2;
      const rad = r * 0.8 + (Math.random() - 0.5) * r * 0.2;
      out.x = Math.cos(angle) * rad;
      out.y = Math.sin(angle) * rad;
      out.z = (Math.random() - 0.5) * r * 0.1;
      flatColor(out, [0.98, 0.8, 0.082]); // 0xfacc15
    },
  },

  // Spark Cell pickup (systems spec Section 5.4, stage S5): a small
  // battery cell that restores stamina on pickup. Bright electric
  // cyan with a white core, drawn as a squat cylinder of points so
  // it never reads as a coin (flat ring), a gem (violet octahedron)
  // or an XP orb (blue octahedron).
  spark_cell: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      if (i < count * 0.3) {
        // White-hot core column.
        const rad = Math.cbrt(Math.random()) * r * 0.3;
        const u = Math.random() * Math.PI * 2;
        out.x = rad * Math.cos(u);
        out.z = rad * Math.sin(u);
        out.y = (Math.random() - 0.5) * r * 1.1;
        flatColor(out, [0.95, 1.0, 1.0]);
        out.layer = 1;
      } else {
        // Cyan shell: two rings and a side wall.
        const u = Math.random() * Math.PI * 2;
        const ring = Math.random();
        const rad = r * (0.55 + Math.random() * 0.1);
        out.x = rad * Math.cos(u);
        out.z = rad * Math.sin(u);
        out.y = ring < 0.3 ? r * 0.55 : ring < 0.6 ? -r * 0.55 : (Math.random() - 0.5) * r * 1.1;
        flatColor(out, [0.30, 0.90, 1.0]);
      }
    },
  },

  // Overcharge pickup (systems spec Section 5.4, stage S5): the
  // next move cast ignores its cooldown. A violet-white orb with a
  // bright equatorial band; violet is the cooldown family's color
  // in the HUD, and no other pickup uses it at this size.
  overcharge: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r * 0.8);
      if (Math.abs(out.y) < r * 0.16) {
        flatColor(out, [0.98, 0.95, 1.0]); // Bright band
        out.layer = 1;
      } else {
        flatColor(out, [0.62, 0.38, 0.98]); // Violet shell
      }
    },
  },

  aura: {
    count: 500,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const angle = Math.random() * Math.PI * 2;
      out.x = Math.cos(angle) * r;
      out.y = Math.sin(angle) * r;
      out.z = (Math.random() - 0.5) * 0.5;
      flatColor(out, ctx.ownerId === 'ai1' ? AI_ABILITY_RED : [0.024, 0.714, 0.831]); // 0x06b6d4
    },
  },

  // Flame Tornado zone (final sweep; systems spec Sections 3.3 and
  // 4.5): a filled disc wound into a spiral, so the standing zone
  // reads as a vortex once the renderer spins the mesh. Player zones
  // are warm flame (bright core, orange body, bright rim) so a
  // friendly zone never reads as danger; an enemy cast takes the
  // hostile ramp, because for the player it IS a danger zone. The
  // disc is large and the points sparse (stacking depth under 1),
  // so colors are written at full strength like the pickups, not in
  // the stacking-tuned enemy scale.
  flame_tornado: {
    count: 600,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const frac = Math.sqrt(Math.random());
      const angle = Math.random() * Math.PI * 2 + frac * 5.0;
      out.x = Math.cos(angle) * frac * r;
      out.y = Math.sin(angle) * frac * r;
      out.z = (Math.random() - 0.5) * 0.1 * r;
      const isPlayer = ctx.owner === 'player' || ctx.ownerId === 'player';
      if (isPlayer) {
        if (frac < 0.3) { flatColor(out, [1.0, 0.85, 0.45]); out.layer = 1; }
        else if (frac > 0.85) { flatColor(out, [1.0, 0.75, 0.25]); }
        else { flatColor(out, [0.95, 0.45, 0.08]); }
      } else {
        if (frac < 0.3) { flatColor(out, [1.0, 0.35, 0.55]); out.layer = 1; }
        else if (frac > 0.85) { flatColor(out, [1.0, 0.18, 0.42]); }
        else { flatColor(out, [0.85, 0.15, 0.38]); }
      }
    },
  },

  // Solar Bomb orb (final sweep; systems spec Section 3.3): a slow
  // bright sphere with a white-hot core. Player casts burn gold;
  // an enemy cast takes the hostile shell, since the landing zone
  // is a threat the player must leave.
  solar_bomb: {
    count: 300,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      const isPlayer = ctx.owner === 'player' || ctx.ownerId === 'player';
      if (i < count * 0.3) {
        sphereVertex(out, r * 0.5);
        flatColor(out, isPlayer ? [1.0, 0.95, 0.7] : [1.0, 0.6, 0.7]);
        out.layer = 1;
      } else {
        sphereVertex(out, r);
        flatColor(out, isPlayer ? [1.0, 0.75, 0.15] : [0.95, 0.25, 0.45]);
      }
    },
  },

  fire: {
    count: 800,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      out.x = (Math.random() - 0.5) * r * 2.5;
      out.y = (Math.random() - 0.5) * r * 2.5;
      out.z = (Math.random() - 0.5) * r * 2.5;
      const rand = Math.random();
      if (rand > 0.6) { out.cr = 1.0; out.cg = 0.8; out.cb = 0.0; } // Yellow
      else if (rand > 0.3) { out.cr = 1.0; out.cg = 0.3; out.cb = 0.0; } // Orange
      else { out.cr = 0.8; out.cg = 0.0; out.cb = 0.0; } // Red
      out.layer = 0;
    },
  },

  egg: {
    count: 800,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      // Golden torus knot core plus swirling vortex shell
      const t = Math.random() * Math.PI * 2;
      const p = 3; const q = 4;
      const radKnot = Math.cos(q * t) + 2;
      const knotX = radKnot * Math.cos(p * t) * r * 0.3;
      const knotY = radKnot * Math.sin(p * t) * r * 0.3;
      const knotZ = -Math.sin(q * t) * r * 0.3;
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI;
      const vortexR = r * 1.5 * (1 - Math.pow(Math.random(), 3));
      if (Math.random() > 0.3) {
        out.x = knotX + (Math.random() - 0.5) * r * 0.1;
        out.y = knotY + (Math.random() - 0.5) * r * 0.1;
        out.z = knotZ + (Math.random() - 0.5) * r * 0.1;
      } else {
        out.x = vortexR * Math.sin(v) * Math.cos(u);
        out.y = vortexR * Math.sin(v) * Math.sin(u);
        out.z = vortexR * Math.cos(v);
      }
      const rand = Math.random();
      if (rand > 0.8) { out.cr = 1.0; out.cg = 1.0; out.cb = 0.8; } // White/gold
      else if (rand > 0.4) { out.cr = 1.0; out.cg = 0.8; out.cb = 0.0; } // Bright gold
      else { out.cr = 1.0; out.cg = 0.3; out.cb = 0.0; } // Fiery orange
      out.layer = 0;
    },
  },

  // The turret companion copies the player bird's construction and
  // colors; the game renderer's per-frame animation rewrites its
  // vertices from the bird's base positions, so the initial positions
  // here only seed the shape.
  turret: {
    count: 4000,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      out.x = 0; out.y = 0; out.z = 0;
      out.layer = 0;
      if (ctx.bird && ctx.bird.basePositions.length > i * 3 + 2) {
        const baseX = ctx.bird.basePositions[i * 3];
        const baseY = ctx.bird.basePositions[i * 3 + 1];
        const baseZ = ctx.bird.basePositions[i * 3 + 2];
        const flapAmount = Math.abs(baseX) * 0.5;
        const flapPhase = (Date.now() * 0.01) - baseZ * 2.0;
        const flapOffset = Math.sin(flapPhase) * flapAmount;
        out.x = baseX * 0.4 * r;
        out.y = (baseY + flapOffset) * 0.4 * r;
        out.z = baseZ * 0.4 * r;
        const c = ctx.bird.colorAt(i);
        out.cr = c[0]; out.cg = c[1]; out.cb = c[2];
      } else {
        out.cr = 1; out.cg = 1; out.cb = 1;
      }
    },
  },

  // The battle rival: same construction as the player bird (rewritten
  // per frame by the game renderer), colors inverted from the bird's.
  enemy_phoenix: {
    count: 4000,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r);
      out.layer = 0;
      if (ctx.bird) {
        const c = ctx.bird.colorAt(i);
        out.cr = 1.0 - c[0]; out.cg = 1.0 - c[1]; out.cb = 1.0 - c[2];
      } else {
        out.cr = 1; out.cg = 0.2; out.cb = 0.2;
      }
    },
  },

  projectile_player: {
    count: 100,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r);
      const base = ctx.ownerId === 'player' && ctx.gameMode === 'ai_vs_ai' ? AI_VS_AI_BOTTOM_FIRE : PLAYER_FIRE;
      flatColor(out, base);
    },
  },

  // Hostile fire (rule 1.2.6): the magenta-red from the world theme
  // data, passed in by the caller. This covers golem shots, boss
  // minions' fire, and the battle rival's shots alike, because all of
  // them are type projectile_enemy regardless of owner.
  projectile_enemy: {
    count: 100,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r);
      flatColor(out, ctx.hostile);
    },
  },

  // The boss annihilation barrage is hostile fire too (rule 1.2.6).
  annihilation_fire: {
    count: 800,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r);
      flatColor(out, ctx.hostile);
    },
  },

  // S2 move projectiles. One builder per move type so each move has
  // its own silhouette; color follows the same ownership rule as the
  // basic shots (player fire amber, hostile magenta-red), so a rival
  // cast reads hostile at a glance.
  dart: {
    count: 60,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      octahedronVertex(out, r);
      flatColor(out, ctx.owner === 'enemy' ? ctx.hostile : (ctx.ownerId === 'player' && ctx.gameMode === 'ai_vs_ai' ? AI_VS_AI_BOTTOM_FIRE : PLAYER_FIRE));
    },
  },

  talon: {
    count: 120,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r);
      flatColor(out, ctx.owner === 'enemy' ? ctx.hostile : (ctx.ownerId === 'player' && ctx.gameMode === 'ai_vs_ai' ? AI_VS_AI_BOTTOM_FIRE : PLAYER_FIRE));
    },
  },

  spark: {
    count: 50,
    animated: true,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r * 0.8);
      const base = ctx.owner === 'enemy' ? ctx.hostile : (ctx.ownerId === 'player' && ctx.gameMode === 'ai_vs_ai' ? AI_VS_AI_BOTTOM_FIRE : PLAYER_FIRE);
      flatColor(out, base);
      out.cr *= 1.4; out.cg *= 1.4; out.cb *= 1.4; // sparks burn brighter than a bolt
    },
  },

  lance: {
    count: 220,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      octahedronVertex(out, r);
      flatColor(out, ctx.owner === 'enemy' ? ctx.hostile : (ctx.ownerId === 'player' && ctx.gameMode === 'ai_vs_ai' ? AI_VS_AI_BOTTOM_FIRE : PLAYER_FIRE));
    },
  },

  // S4: Phoenix Nova bolts. A larger, brighter orb than the basic
  // shots, in the same ownership colors, so an ultimate ring reads
  // as an ultimate at a glance.
  nova: {
    count: 200,
    animated: false,
    sample: (i, count, r, ctx, out) => {
      sphereVertex(out, r);
      const base = ctx.owner === 'enemy' ? ctx.hostile : (ctx.ownerId === 'player' && ctx.gameMode === 'ai_vs_ai' ? AI_VS_AI_BOTTOM_FIRE : PLAYER_FIRE);
      flatColor(out, base);
      out.cr *= 1.35; out.cg *= 1.35; out.cb *= 1.35;
    },
  },
};

function octahedronVertex(out: VertexOut, r: number) {
  let x = (Math.random() - 0.5) * r;
  let y = (Math.random() - 0.5) * r * 2;
  let z = (Math.random() - 0.5) * r;
  const sum = Math.abs(x / r) + Math.abs(y / (r * 2)) + Math.abs(z / r);
  if (sum > 0.5) {
    x /= (sum * 2); y /= (sum * 2); z /= (sum * 2);
  }
  out.x = x; out.y = y; out.z = z;
}

const DEFAULT_DEF: EntityVisualDef = {
  count: 800,
  animated: false,
  sample: (i, count, r, ctx, out) => {
    sphereVertex(out, r);
    flatColor(out, [1, 1, 1]);
  },
};

export function buildEntityGeometry(type: string, ctx: EntityBuildContext): BuiltEntity {
  const def = DEFS[type] || DEFAULT_DEF;
  const count = def.count;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const layer = new Uint8Array(count);
  const out: VertexOut = { x: 0, y: 0, z: 0, cr: 1, cg: 1, cb: 1, layer: 0 };
  for (let i = 0; i < count; i++) {
    def.sample(i, count, ctx.r, ctx, out);
    const idx = i * 3;
    positions[idx] = out.x; positions[idx + 1] = out.y; positions[idx + 2] = out.z;
    colors[idx] = out.cr; colors[idx + 1] = out.cg; colors[idx + 2] = out.cb;
    layer[i] = out.layer;
  }
  return { count, positions, colors, layer, animated: def.animated };
}
