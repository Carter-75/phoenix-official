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
// magenta, and verify by census). Worlds 4 to 10 variants land with
// their theme batches in Stages 7 and 8.
// ---------------------------------------------------------------------------
export interface VariantPalette {
  core: Rgb; // core layer base color (sparse points may take it at full value)
  body: Rgb; // body layer per-vertex base color
  accent: Rgb; // eye and wingtip accents, where the type has them
  coreFrac?: number; // geometry tweak: core radius fraction (Glob family)
  facetCore?: boolean; // geometry tweak: snap core directions to a coarse grid (geode)
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
          // Dark crimson body, scaled to the bat's stacking (see the
          // wing note below): about 1/30 of the target read.
          out.cr = 0.03 + Math.random() * 0.015; out.cg = 0.0; out.cb = 0.002;
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
        // Crimson wings; the purple gradient is not representable at
        // game scale. The bat's physics radius is only about 6 px
        // (size 15 at the game's screen scale), so its 800 points
        // compress into a roughly 50 px silhouette of 0.15-unit
        // sprites and additive stacking runs 30 to 60 deep along the
        // wing band. Red clamps at full long before blue does, so
        // any blue above a whisper keeps summing after red has
        // pinned, and the wing walks to the hostile magenta that
        // rule 1.2.6 reserves for projectiles and telegraphs
        // (measured in four harness passes at blue bases 0.30, 0.12,
        // 0.09 and 0.010: rendered blue reached 0.62 of red). Blue
        // is therefore held at 0.003 maximum, where even the deepest
        // stack stays crimson (blue about 0.18 of red). The purple
        // edge gradient from the design sheet remains a documented
        // deviation in STAGE-2.md, pending a per-type sprite size.
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
          out.cr = 0.03 + edge * 0.03; out.cg = 0.0; out.cb = 0.001 + edge * 0.002;
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
      const p = Math.random();
      if (p < 0.06) {
        // Horn points: two small clusters at the crown.
        const side = Math.random() < 0.5 ? -1 : 1;
        out.x = side * 0.45 * r + (Math.random() - 0.5) * 0.3 * r;
        out.y = 1.05 * r + (Math.random() - 0.5) * 0.3 * r;
        out.z = (Math.random() - 0.5) * 0.3 * r;
        out.cr = 0.5; out.cg = 0.16; out.cb = 0.01;
        out.layer = 0;
      } else if (p < 0.16) {
        // Spark tail: sparse embers trailing below the body.
        out.x = (Math.random() - 0.5) * 0.5 * r;
        out.y = -(0.9 + Math.random() * 1.0) * r;
        out.z = (Math.random() - 0.5) * 0.4 * r;
        const m = Math.random();
        out.cr = 0.35 + m * 0.2; out.cg = 0.08 + m * 0.06; out.cb = 0.0;
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
          out.cr = 1.0; out.cg = 0.82 + m * 0.14; out.cb = 0.38 + m * 0.25; // White-hot heart
          out.layer = 1;
        } else {
          const m = Math.random();
          out.cr = 0.07 + m * 0.04; out.cg = 0.02 + m * 0.012; out.cb = 0.003; // Thin flame skin, stacking-tuned like the Glob membrane
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
      if (i < count * 0.2) {
        // Bright core floating in the ring's hollow.
        const rad = Math.cbrt(Math.random()) * r * 0.3;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        const m = Math.random();
        out.cr = 0.85 + m * 0.15; out.cg = 0.97; out.cb = 1.0; // White-cyan
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
          out.cr = 0.6; out.cg = 0.95; out.cb = 1.0;
          out.layer = 1;
        } else {
          const m = Math.random();
          out.cr = 0.10 + m * 0.06; out.cg = 0.34 + m * 0.14; out.cb = 0.44 + m * 0.16; // Pale cyan ring
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
      if (rad < r * 0.2) {
        const m = Math.random();
        out.cr = 0.45 + m * 0.2; out.cg = 0.85 + m * 0.15; out.cb = 0.68 + m * 0.2; // Pale cell heart
        out.layer = 1;
      } else {
        const m = Math.random();
        out.cr = 0.016 + m * 0.012; out.cg = 0.075 + m * 0.035; out.cb = 0.06 + m * 0.025; // Murky teal cell skin
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
      const p = Math.random();
      if (p < 0.4) {
        const rad = Math.cbrt(Math.random()) * r * 0.45;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        const m = Math.random();
        out.cr = 1.0; out.cg = 0.82 + m * 0.16; out.cb = 0.35 + m * 0.25; // Hot spark heart
        out.layer = 1;
      } else {
        const isLeft = p < 0.7;
        const span = (0.4 + Math.random() * 1.1) * r;
        out.x = isLeft ? -span : span;
        out.y = (Math.random() - 0.5) * 0.5 * r + span * 0.15;
        out.z = (Math.random() - 0.5) * 0.2 * r;
        const m = Math.random();
        out.cr = 0.22 + m * 0.12; out.cg = 0.10 + m * 0.05; out.cb = 0.015; // Dim amber wing
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
        out.cr = 0.8 + m * 0.2; out.cg = 0.95; out.cb = 1.0; // Cyan-white eye
        out.layer = 1;
      } else {
        // Facets: octahedron sampling (flat faces read through the
        // point distribution), elongated on x, squashed on z.
        octahedronVertex(out, r);
        out.x *= 1.35; out.z *= 0.55;
        const m = Math.random();
        out.cr = 0.028 + m * 0.02; out.cg = 0.024 + m * 0.014; out.cb = 0.05 + m * 0.03; // Matte violet-slate, stacking-tuned
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
      const p = Math.random();
      if (p < 0.5) {
        // Dome: a hemisphere like the Glob's, in murky green-brown.
        const rad = Math.cbrt(Math.random()) * r;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(Math.random()); // Hemisphere
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.z = rad * Math.sin(v) * Math.sin(u);
        out.y = (rad * Math.cos(v) - r * 0.45) * 1.05;
        const m = Math.random();
        out.cr = 0.03 + m * 0.016; out.cg = 0.042 + m * 0.02; out.cb = 0.014 + m * 0.008;
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
          out.cr = 0.012 + m * 0.008; out.cg = 0.01 + m * 0.006; out.cb = 0.02 + m * 0.01; // Near-black violet shell
          out.layer = 0;
        }
      } else {
        // Root ribbons: strands trailing below the dome.
        out.x = (Math.random() - 0.5) * 1.1 * r;
        out.y = -(0.55 + Math.random() * 0.85) * r;
        out.z = (Math.random() - 0.5) * 0.5 * r;
        const m = Math.random();
        out.cr = 0.02 + m * 0.012; out.cg = 0.026 + m * 0.012; out.cb = 0.008;
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
        const spike = 1 + 0.38 * Math.abs(Math.sin(u * 3) * Math.sin(v * 4));
        const rad = Math.cbrt(Math.random()) * r * spike;
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        const m = Math.random();
        out.cr = 0.014 + m * 0.01; out.cg = 0.008 + m * 0.006; out.cb = 0.026 + m * 0.014; // Near-black violet
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
      if (Math.abs(facing01) < 0.3 && rad > 0.7 * r) {
        // Rim ring: the great circle where the face plate meets the
        // body, at the surface. The spark-off flash target.
        const m = Math.random();
        out.cr = 0.55 + m * 0.2; out.cg = 0.58 + m * 0.2; out.cb = 0.66 + m * 0.2; // Bright metallic rim
        out.layer = 1;
      } else if (facing01 >= 0.3) {
        // Shield face plate: lighter metallic band.
        const m = Math.random();
        out.cr = 0.075 + m * 0.035; out.cg = 0.08 + m * 0.035; out.cb = 0.1 + m * 0.04;
        out.layer = 0;
      } else {
        // Dark beetle mass behind the face.
        const m = Math.random();
        out.cr = 0.016 + m * 0.01; out.cg = 0.014 + m * 0.008; out.cb = 0.02 + m * 0.01;
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
          out.cr = 1.0; out.cg = 0.72 + m * 0.2; out.cb = 0.3 + m * 0.2; // Hot center
          out.layer = 1;
        } else {
          const m = Math.random();
          out.cr = 0.09 + m * 0.05; out.cg = 0.045 + m * 0.025; out.cb = 0.012 + m * 0.008; // Warm cream-orange fuzz, stacking-tuned
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
        out.cr = 0.05 + m * 0.03; out.cg = 0.028 + m * 0.016; out.cb = 0.008;
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
      const p = Math.random();
      if (p < 0.05) {
        // Two eye accents under the hood.
        const side = Math.random() < 0.5 ? -1 : 1;
        out.x = side * 0.26 * r + (Math.random() - 0.5) * 0.16 * r;
        out.y = 0.62 * r + (Math.random() - 0.5) * 0.14 * r;
        out.z = 0.3 * r + (Math.random() - 0.5) * 0.1 * r;
        const m = Math.random();
        out.cr = 0.85 + m * 0.15; out.cg = 0.8 + m * 0.12; out.cb = 1.0; // Pale violet-white
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
        out.cr = 0.03 + m * 0.016; out.cg = 0.026 + m * 0.012; out.cb = 0.055 + m * 0.025; // Matte slate-violet
        out.layer = 0;
      } else {
        // Trailing body: wisps falling away below the hood, spread
        // thin so the shape reads as sparse cloth, not a solid.
        const t = Math.random();
        out.y = (0.35 - t * 2.0) * r;
        const spread = (0.34 - t * 0.16) * r;
        out.x = (Math.random() - 0.5) * 2 * spread;
        out.z = (Math.random() - 0.5) * 0.5 * r;
        const m = Math.random();
        out.cr = 0.024 + m * 0.012; out.cg = 0.02 + m * 0.01; out.cb = 0.045 + m * 0.02;
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
        out.cr = 0.10 + m * 0.05; out.cg = 0.095 + m * 0.045; out.cb = 0.13 + m * 0.05; // Pale bone-steel
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
        out.cr = 0.045 + m * 0.02; out.cg = 0.04 + m * 0.018; out.cb = 0.06 + m * 0.024; // Cold gray-violet
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
        out.cr = 1.0; out.cg = 0.72 + m * 0.2; out.cb = 0.22 + m * 0.14; // Warm gold
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
          out.cr = 0.5 + m * 0.2; out.cg = 0.36 + m * 0.14; out.cb = 0.1; // Bright rim lip
          out.layer = 1;
        } else {
          const m = Math.random();
          out.cr = 0.05 + m * 0.024; out.cg = 0.036 + m * 0.016; out.cb = 0.012 + m * 0.006; // Deep bronze
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
        out.cr = 1.0; out.cg = 0.88 + m * 0.1; out.cb = 0.45 + m * 0.2; // White-gold heart
        out.layer = 1;
      } else if (p < 0.52) {
        // Swept fins: two flat fans trailing back from the head.
        const isLeft = p < 0.43;
        const span = (0.3 + Math.random() * 1.1) * r;
        out.x = -span * 0.8 + (Math.random() - 0.5) * 0.2 * r;
        out.y = (isLeft ? -1 : 1) * span * 0.55 + (Math.random() - 0.5) * 0.2 * r;
        out.z = -span * 0.2 + (Math.random() - 0.5) * 0.15 * r;
        const m = Math.random();
        out.cr = 0.03 + m * 0.016; out.cg = 0.09 + m * 0.04; out.cb = 0.045 + m * 0.02; // Deep emerald
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
          out.cr = 0.55 + m * 0.2; out.cg = 0.42 + m * 0.16; out.cb = 0.1; // Gold spine accent
          out.layer = 1;
        } else {
          const m = Math.random();
          out.cr = 0.018 + m * 0.01; out.cg = 0.065 + m * 0.03; out.cb = 0.032 + m * 0.014;
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
      const rad = Math.cbrt(Math.random()) * r;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      out.x = rad * Math.sin(v) * Math.cos(u) * 1.1;
      out.y = rad * Math.sin(v) * Math.sin(u) * 0.9;
      out.z = rad * Math.cos(v) * 0.8;
      if (out.y > 0.5 * r && Math.abs(out.x) < 0.35 * r && Math.random() < 0.5) {
        const m = Math.random();
        out.cr = 0.4 + m * 0.18; out.cg = 0.3 + m * 0.13; out.cb = 0.08; // Gold spine
        out.layer = 1;
      } else {
        const m = Math.random();
        out.cr = 0.014 + m * 0.008; out.cg = 0.05 + m * 0.024; out.cb = 0.024 + m * 0.01; // Dim emerald
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
      const p = Math.random();
      if (p < 0.08) {
        // Wingtip sparks at the rear corners.
        const isLeft = Math.random() < 0.5;
        out.x = -1.05 * r + (Math.random() - 0.5) * 0.2 * r;
        out.y = (isLeft ? -1 : 1) * 0.78 * r + (Math.random() - 0.5) * 0.18 * r;
        out.z = (Math.random() - 0.5) * 0.15 * r;
        const m = Math.random();
        out.cr = 0.8 + m * 0.2; out.cg = 0.95; out.cb = 1.0; // Ice-white sparks
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
          out.cr = 0.5 + m * 0.2; out.cg = 0.85 + m * 0.12; out.cb = 0.95; // Bright nose core
          out.layer = 1;
        } else {
          const m = Math.random();
          out.cr = 0.035 + m * 0.016; out.cg = 0.085 + m * 0.035; out.cb = 0.105 + m * 0.04; // Ice cyan-white body
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

  // Boss construction (fiery skull) kept as shipped; its full redesign
  // is the boss stages (9 and 10). White-hot eye sockets are the core
  // layer, which is what the boss phase flashes pulse (Section 3.1).
  boss: {
    count: 4000,
    animated: true,
    sample: (i, count, r, ctx, out) => {
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
