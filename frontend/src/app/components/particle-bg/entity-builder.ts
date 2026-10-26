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
      const isCore = i < count * 0.3;
      const rad = isCore ? Math.cbrt(Math.random()) * r * 0.4 : Math.cbrt(Math.random()) * r;
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random()); // Hemisphere
      out.x = rad * Math.sin(v) * Math.cos(u);
      out.z = rad * Math.sin(v) * Math.sin(u);
      out.y = (rad * Math.cos(v) - r * 0.5) * (isCore ? 0.9 : 1.1);
      if (isCore) {
        const m = Math.random();
        out.cr = 1.0; out.cg = 0.85 + m * 0.15; out.cb = 0.35 + m * 0.3; // White-yellow
        out.layer = 1;
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
      const p = Math.random();
      if (p < 0.2) {
        out.x = (Math.random() - 0.5) * 0.6 * r;
        out.y = (Math.random() - 0.5) * 0.8 * r;
        out.z = (Math.random() - 0.5) * 0.6 * r;
        if (out.y > 0.2 * r && Math.abs(out.x) > 0.1 * r && out.z > 0.2 * r) {
          out.cr = 1.0; out.cg = 0.0; out.cb = 0.0; // Red glowing eyes
          out.layer = 1;
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
        out.cr = 0.03 + edge * 0.03; out.cg = 0.0; out.cb = 0.001 + edge * 0.002;
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
      const p = Math.random();
      if (p < 0.2) {
        const rad = Math.cbrt(Math.random()) * r * 0.6;
        const u = Math.random() * Math.PI * 2;
        const v = Math.acos(2 * Math.random() - 1);
        out.x = rad * Math.sin(v) * Math.cos(u);
        out.y = rad * Math.sin(v) * Math.sin(u);
        out.z = rad * Math.cos(v);
        out.cr = 1.0; out.cg = 0.2 + Math.random() * 0.4; out.cb = 0.0; // Hot orange/red magma
        out.layer = 1;
      } else {
        const cx = (Math.random() - 0.5) * r * 2.5;
        const cy = (Math.random() - 0.5) * r * 3;
        const cz = (Math.random() - 0.5) * r * 2.5;
        out.x = cx + (Math.random() - 0.5) * 0.5 * r;
        out.y = cy + (Math.random() - 0.5) * 0.5 * r;
        out.z = cz + (Math.random() - 0.5) * 0.5 * r;
        const gray = 0.1 + Math.random() * 0.15;
        out.cr = gray; out.cg = gray * 0.8; out.cb = gray * 0.8; // Dark rocky color
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
