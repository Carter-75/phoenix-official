// Drawn mob sprites (Fix Round 2, A5: Carter's rule, stated
// twice on Oct 28, 2026: no enemy and no boss may render as a
// particle cloud). Every mob is a drawn body in the same approach
// as the player phoenix (phoenix-sprite.ts): vector shapes painted
// once onto offscreen canvases, then one textured plane per mob in
// the scene. Particles remain only for effects.
//
// Palettes: each type has a hand-authored DISPLAY palette taken
// from its design-sheet identity in entity-builder.ts (the
// samplers' per-vertex bases are stacking-tuned and far too dim
// to paint with). Where a world restyles a type, VARIANT_PALETTES
// supplies the core and accent and a normalized body, so the
// per-world variants survive the move to sprites. Every palette
// color passes the same 0.70 perceived-luminance cap the points
// builds use (FOE_LUMINANCE_CAP in entity-sync.ts), so the player
// stays uniquely brightest by the same discipline.
//
// Geometry, hitboxes, speeds, HP, spawns, rigs, and behavior are
// untouched: the sprite plane is sized from the points geometry's
// own extents (measured in entity-sync at build), so a mob
// occupies exactly the footprint it always did.
import * as THREE from 'three';
import { VARIANT_PALETTES } from './entity-builder';

export type Rgb = [number, number, number];
export interface MobPalette { core: Rgb; body: Rgb; accent: Rgb; deep: Rgb; }

const LUM_CAP = 0.70;
function capLum(c: Rgb): Rgb {
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (lum <= LUM_CAP) return c;
  const s = LUM_CAP / lum;
  return [c[0] * s, c[1] * s, c[2] * s];
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function scale(c: Rgb, s: number): Rgb { return [c[0] * s, c[1] * s, c[2] * s]; }
// A variant body base (stacking-tuned, often near 0.01 to 0.05)
// lifted to display strength while keeping its hue.
function liftBody(c: Rgb): Rgb {
  const m = Math.max(c[0], c[1], c[2]);
  if (m <= 0.001) return c;
  const s = 0.5 / m;
  return [Math.min(1, c[0] * s), Math.min(1, c[1] * s), Math.min(1, c[2] * s)];
}

// Base display palettes per type, from the design sheets.
const BASE: Record<string, { core: Rgb; body: Rgb; accent: Rgb }> = {
  // Ember Glob: white-yellow molten core, deep orange-red membrane.
  slime: { core: [1.0, 0.88, 0.5], body: [0.78, 0.24, 0.05], accent: [1.0, 0.55, 0.15] },
  // Gloomwing: violet wings (the points-era bat rendered violet:
  // root about (0.25, 0.05, 0.55) opening to (0.2, 0.07, 0.85) at
  // the edge, entity-builder's shipped gradient), dark violet
  // body mass, red eyes. Fix Round 4: the A5 sprite's first
  // palette made the wings dark crimson (body luminance 0.14)
  // and Carter's phone read the bat as black; the violet family
  // is restored and brightened toward the luminance cap.
  bat: { core: [1.0, 0.16, 0.1], body: [0.38, 0.16, 0.78], accent: [0.62, 0.35, 1.0] },
  // Bastion Golem: magma core, matte dark rock.
  golem: { core: [1.0, 0.52, 0.12], body: [0.3, 0.26, 0.24], accent: [1.0, 0.68, 0.25] },
  // Cinder Imp: white-hot heart, flame skin, ember horns.
  imp: { core: [1.0, 0.95, 0.82], body: [0.92, 0.36, 0.05], accent: [0.85, 0.3, 0.04] },
  // Aether Wisp: bright core inside a broken cyan ring.
  wisp: { core: [0.88, 0.98, 1.0], body: [0.25, 0.62, 0.8], accent: [0.6, 0.9, 1.0] },
  // Brood Pod: pale cell hearts in a dusky organic cluster.
  pod: { core: [0.95, 0.82, 0.6], body: [0.42, 0.22, 0.28], accent: [0.85, 0.5, 0.35] },
  // Mite: bright spark mote, small wing fans.
  mite: { core: [1.0, 0.8, 0.45], body: [0.7, 0.35, 0.12], accent: [1.0, 0.9, 0.6] },
  // Sentry Shard: violet-slate crystal, cyan-white eye.
  sentry_shard: { core: [0.85, 0.98, 1.0], body: [0.32, 0.28, 0.48], accent: [0.5, 0.85, 0.95] },
  // Seedmother: dark dome, hostile-bright mine eggs inside.
  seedmother: { core: [1.0, 0.3, 0.15], body: [0.25, 0.18, 0.12], accent: [0.9, 0.35, 0.1] },
  // Rift Mine: near-black violet spikes, hostile core.
  rift_mine: { core: [1.0, 0.25, 0.2], body: [0.14, 0.08, 0.22], accent: [0.5, 0.2, 0.6] },
  // Shieldback: dark beetle mass, bright metallic shield face.
  shieldback: { core: [0.95, 0.9, 0.8], body: [0.2, 0.16, 0.14], accent: [0.75, 0.65, 0.45] },
  // Pyre Moth: cream-orange fuzzy body, hot center.
  pyre_moth: { core: [1.0, 0.6, 0.2], body: [0.92, 0.72, 0.45], accent: [1.0, 0.85, 0.55] },
  // Shroud Phantom: dusky hood, pale eyes, trailing wisps.
  phantom: { core: [0.9, 0.92, 1.0], body: [0.3, 0.28, 0.42], accent: [0.65, 0.6, 0.85] },
  // Lance Wraith: dark spear figure, hostile aiming eye.
  wraith: { core: [1.0, 0.22, 0.12], body: [0.22, 0.18, 0.3], accent: [0.6, 0.55, 0.8] },
  // War Chanter: bronze bell, warm gold note sparks.
  chanter: { core: [1.0, 0.8, 0.4], body: [0.5, 0.32, 0.14], accent: [1.0, 0.85, 0.5] },
  // Loom Serpent head: white-gold heart, deep emerald skull, gold spine.
  serpent: { core: [1.0, 0.88, 0.45], body: [0.05, 0.3, 0.16], accent: [0.85, 0.65, 0.2] },
  serpent_segment: { core: [0.85, 0.65, 0.2], body: [0.04, 0.24, 0.13], accent: [0.85, 0.65, 0.2] },
  // Storm Darter: sleek slate arrowhead, bright wingtip sparks.
  darter: { core: [0.9, 0.95, 1.0], body: [0.25, 0.3, 0.45], accent: [0.65, 0.85, 1.0] },
};

// Boss display palettes per world index (boss themes in order:
// Cinder Colossus, Umbral Matriarch, Prism Sentinel, Tempest Roc,
// Grave Warden, Solar Monarch, Glacial Oracle, Wyrm Sovereign,
// Entropy Engine, Phoenix Ascendant).
const BOSS_BASE: Array<{ core: Rgb; body: Rgb; accent: Rgb }> = [
  { core: [1.0, 0.5, 0.1], body: [0.3, 0.14, 0.1], accent: [1.0, 0.75, 0.3] },
  { core: [0.75, 0.35, 1.0], body: [0.14, 0.08, 0.24], accent: [0.6, 0.85, 1.0] },
  { core: [0.9, 1.0, 1.0], body: [0.3, 0.55, 0.75], accent: [1.0, 0.6, 0.95] },
  { core: [0.95, 0.95, 0.5], body: [0.2, 0.26, 0.42], accent: [0.55, 0.85, 1.0] },
  { core: [0.45, 1.0, 0.75], body: [0.12, 0.14, 0.18], accent: [0.6, 0.75, 0.7] },
  { core: [1.0, 0.85, 0.35], body: [0.7, 0.35, 0.08], accent: [1.0, 0.95, 0.55] },
  { core: [0.8, 0.95, 1.0], body: [0.35, 0.55, 0.8], accent: [0.9, 1.0, 1.0] },
  { core: [1.0, 0.55, 0.15], body: [0.18, 0.32, 0.22], accent: [0.95, 0.8, 0.4] },
  { core: [0.6, 1.0, 0.9], body: [0.25, 0.1, 0.35], accent: [1.0, 0.35, 0.55] },
  { core: [1.0, 0.95, 0.7], body: [0.95, 0.45, 0.12], accent: [1.0, 0.85, 0.35] },
];

export function mobPalette(type: string, worldIndex: number, form = 0): MobPalette {
  let base = BASE[type];
  if (type === 'boss') base = BOSS_BASE[worldIndex] ?? BOSS_BASE[0];
  if (type === 'boss_shadow') base = BOSS_BASE[1];
  if (!base) base = BASE['slime'];
  let { core, body, accent } = base;
  const v = VARIANT_PALETTES[worldIndex]?.[type === 'boss_shadow' ? 'boss' : type];
  if (v && type !== 'boss' && type !== 'boss_shadow') {
    core = v.core;
    accent = v.accent;
    body = mix(liftBody(v.body), body, 0.35);
    if (v.face) body = mix(v.face, body, 0.4);
  }
  const pal: MobPalette = {
    core: capLum(core), body: capLum(body), accent: capLum(accent),
    deep: capLum(scale(body, 0.38)),
  };
  if (type === 'boss_shadow') {
    pal.core = scale(pal.core, 0.55); pal.body = scale(pal.body, 0.55);
    pal.accent = scale(pal.accent, 0.55); pal.deep = scale(pal.deep, 0.55);
  }
  return pal;
}

// ------------------------------------------------------------------
// Canvas painting. Every painter draws its creature facing UP
// (head toward the top of the canvas) inside a unit box: cx, cy is
// the center, u is the half-extent. frame is 0 or 1 for the flap
// types (bat, mite, pyre_moth).
// ------------------------------------------------------------------
function css(c: Rgb, a = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}
function poly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function circ(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
}
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: Rgb, a = 0.55) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(c, a));
  g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  circ(ctx, x, y, r); ctx.fill();
}
function eye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: Rgb) {
  glow(ctx, x, y, r * 3.2, c, 0.5);
  ctx.fillStyle = css(c);
  circ(ctx, x, y, r); ctx.fill();
}

type Painter = (ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number, pal: MobPalette, frame: number) => void;

const PAINTERS: Record<string, Painter> = {
  slime(ctx, cx, cy, u, pal) {
    // Membrane dome with a molten heart.
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx - 0.92 * u, cy + 0.75 * u], [cx - 0.95 * u, cy + 0.1 * u], [cx - 0.7 * u, cy - 0.55 * u], [cx - 0.3 * u, cy - 0.88 * u], [cx + 0.3 * u, cy - 0.88 * u], [cx + 0.7 * u, cy - 0.55 * u], [cx + 0.95 * u, cy + 0.1 * u], [cx + 0.92 * u, cy + 0.75 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.body, 0.9);
    circ(ctx, cx, cy + 0.08 * u, 0.78 * u); ctx.fill();
    glow(ctx, cx, cy + 0.05 * u, 0.62 * u, pal.core, 0.8);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy + 0.05 * u, 0.34 * u); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.85);
    circ(ctx, cx - 0.3 * u, cy - 0.42 * u, 0.1 * u); ctx.fill();
    circ(ctx, cx + 0.42 * u, cy - 0.2 * u, 0.07 * u); ctx.fill();
  },
  bat(ctx, cx, cy, u, pal, frame) {
    const lift = frame === 0 ? -0.55 : 0.25; // wing tip height by flap frame
    for (const s of [-1, 1]) {
      // Wing membrane: a violet gradient, body color at the root
      // opening to the bright accent at the tip (the points-era
      // bat's shipped root-to-edge gradient, Fix Round 4).
      const grad = ctx.createLinearGradient(cx, cy, cx + s * 0.98 * u, cy + lift * u);
      grad.addColorStop(0, css(pal.body));
      grad.addColorStop(1, css(pal.accent));
      ctx.fillStyle = grad;
      poly(ctx, [
        [cx + s * 0.12 * u, cy - 0.1 * u],
        [cx + s * 0.98 * u, cy + lift * u],
        [cx + s * 0.86 * u, cy + (lift + 0.34) * u],
        [cx + s * 0.62 * u, cy + (lift + 0.2) * u],
        [cx + s * 0.55 * u, cy + (lift + 0.48) * u],
        [cx + s * 0.3 * u, cy + 0.34 * u],
        [cx + s * 0.1 * u, cy + 0.3 * u],
      ]); ctx.fill();
      ctx.fillStyle = css(pal.accent, 0.75);
      poly(ctx, [
        [cx + s * 0.9 * u, cy + lift * u + 0.04 * u],
        [cx + s * 0.98 * u, cy + lift * u],
        [cx + s * 0.86 * u, cy + (lift + 0.34) * u],
      ]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    circ(ctx, cx, cy + 0.05 * u, 0.3 * u); ctx.fill();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.14 * u, cy - 0.32 * u], [cx - 0.05 * u, cy - 0.12 * u], [cx - 0.2 * u, cy - 0.1 * u]]); ctx.fill();
    poly(ctx, [[cx + 0.14 * u, cy - 0.32 * u], [cx + 0.05 * u, cy - 0.12 * u], [cx + 0.2 * u, cy - 0.1 * u]]); ctx.fill();
    eye(ctx, cx - 0.11 * u, cy - 0.05 * u, 0.05 * u, pal.core);
    eye(ctx, cx + 0.11 * u, cy - 0.05 * u, 0.05 * u, pal.core);
  },
  golem(ctx, cx, cy, u, pal) {
    // Orbiting rocks drawn on the rim (the renderer spins the
    // whole sprite at the shipped orbit rate, faster as the shot
    // charges, which is the golem's telegraph).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const rx = cx + Math.cos(a) * 0.88 * u, ry = cy + Math.sin(a) * 0.88 * u;
      ctx.fillStyle = css(pal.deep);
      poly(ctx, [[rx - 0.16 * u, ry + 0.05 * u], [rx - 0.05 * u, ry - 0.13 * u], [rx + 0.08 * u, ry - 0.16 * u], [rx + 0.17 * u, ry - 0.02 * u], [rx + 0.1 * u, ry + 0.14 * u], [rx - 0.06 * u, ry + 0.16 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.body, 0.8);
      poly(ctx, [[rx - 0.05 * u, ry - 0.13 * u], [rx + 0.08 * u, ry - 0.16 * u], [rx + 0.06 * u, ry + 0.02 * u], [rx - 0.08 * u, ry + 0.04 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx - 0.55 * u, cy + 0.62 * u], [cx - 0.68 * u, cy - 0.1 * u], [cx - 0.4 * u, cy - 0.55 * u], [cx - 0.05 * u, cy - 0.72 * u], [cx + 0.38 * u, cy - 0.6 * u], [cx + 0.66 * u, cy - 0.15 * u], [cx + 0.55 * u, cy + 0.6 * u], [cx + 0.1 * u, cy + 0.72 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.45 * u, cy + 0.5 * u], [cx - 0.55 * u, cy - 0.08 * u], [cx - 0.3 * u, cy - 0.45 * u], [cx + 0.3 * u, cy - 0.48 * u], [cx + 0.55 * u, cy - 0.1 * u], [cx + 0.45 * u, cy + 0.52 * u], [cx, cy + 0.6 * u]]); ctx.fill();
    glow(ctx, cx, cy, 0.5 * u, pal.core, 0.85);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy, 0.26 * u); ctx.fill();
    ctx.strokeStyle = css(pal.accent, 0.8); ctx.lineWidth = 0.045 * u;
    ctx.beginPath(); ctx.moveTo(cx - 0.4 * u, cy - 0.3 * u); ctx.lineTo(cx - 0.1 * u, cy + 0.05 * u); ctx.lineTo(cx - 0.3 * u, cy + 0.4 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 0.42 * u, cy - 0.25 * u); ctx.lineTo(cx + 0.15 * u, cy + 0.1 * u); ctx.stroke();
  },
  imp(ctx, cx, cy, u, pal) {
    // Teardrop flame: wide base low, tip high (it charges head
    // first), two horns at the crown, spark tail below.
    ctx.fillStyle = css(pal.body);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 0.95 * u);
    ctx.bezierCurveTo(cx + 0.55 * u, cy - 0.35 * u, cx + 0.62 * u, cy + 0.3 * u, cx + 0.34 * u, cy + 0.62 * u);
    ctx.bezierCurveTo(cx + 0.15 * u, cy + 0.85 * u, cx - 0.15 * u, cy + 0.85 * u, cx - 0.34 * u, cy + 0.62 * u);
    ctx.bezierCurveTo(cx - 0.62 * u, cy + 0.3 * u, cx - 0.55 * u, cy - 0.35 * u, cx, cy - 0.95 * u);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.accent);
      poly(ctx, [[cx + s * 0.3 * u, cy - 0.62 * u], [cx + s * 0.52 * u, cy - 1.0 * u], [cx + s * 0.48 * u, cy - 0.5 * u]]); ctx.fill();
    }
    glow(ctx, cx, cy + 0.12 * u, 0.45 * u, pal.core, 0.9);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy + 0.12 * u, 0.2 * u); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.9);
    circ(ctx, cx - 0.12 * u, cy + 0.82 * u, 0.05 * u); ctx.fill();
    circ(ctx, cx + 0.08 * u, cy + 0.95 * u, 0.04 * u); ctx.fill();
  },
  wisp(ctx, cx, cy, u, pal) {
    // Broken ring (300 degrees) around a bright core.
    ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.3 * u;
    ctx.beginPath(); ctx.arc(cx, cy, 0.68 * u, -0.35, Math.PI * 1.72); ctx.stroke();
    ctx.strokeStyle = css(pal.accent, 0.8); ctx.lineWidth = 0.12 * u;
    ctx.beginPath(); ctx.arc(cx, cy, 0.68 * u, -0.35, Math.PI * 0.5); ctx.stroke();
    glow(ctx, cx, cy, 0.4 * u, pal.core, 0.85);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy, 0.17 * u); ctx.fill();
  },
  pod(ctx, cx, cy, u, pal) {
    // Cluster of cells, each with a pale heart.
    const cells: Array<[number, number, number]> = [
      [0, -0.42, 0.4], [-0.44, -0.14, 0.42], [0.44, -0.14, 0.42], [-0.3, 0.34, 0.44], [0.3, 0.34, 0.44], [0, 0.08, 0.48], [-0.05, 0.62, 0.34],
    ];
    for (const [dx, dy, r] of cells) {
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx + dx * u, cy + dy * u, r * u); ctx.fill();
      ctx.fillStyle = css(pal.deep, 0.55);
      circ(ctx, cx + dx * u, cy + dy * u + r * 0.35 * u, r * 0.7 * u); ctx.fill();
      glow(ctx, cx + dx * u, cy + dy * u, r * 0.55 * u, pal.core, 0.5);
      ctx.fillStyle = css(pal.core, 0.95);
      circ(ctx, cx + dx * u, cy + dy * u, r * 0.3 * u); ctx.fill();
    }
  },
  mite(ctx, cx, cy, u, pal, frame) {
    const lift = frame === 0 ? -0.5 : 0.3;
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.accent, 0.75);
      poly(ctx, [[cx + s * 0.1 * u, cy - 0.05 * u], [cx + s * 0.95 * u, cy + lift * u], [cx + s * 0.7 * u, cy + (lift + 0.42) * u], [cx + s * 0.15 * u, cy + 0.28 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy + 0.05 * u, 0.34 * u); ctx.fill();
    glow(ctx, cx, cy, 0.4 * u, pal.core, 0.85);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy, 0.16 * u); ctx.fill();
  },
  sentry_shard(ctx, cx, cy, u, pal) {
    // Tall crystal octahedron; the eye bulges toward the facing
    // (top of the canvas is the facing direction).
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx, cy - 1.0 * u], [cx + 0.52 * u, cy - 0.1 * u], [cx, cy + 1.0 * u], [cx - 0.52 * u, cy - 0.1 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx, cy - 1.0 * u], [cx + 0.52 * u, cy - 0.1 * u], [cx, cy + 0.15 * u], [cx - 0.52 * u, cy - 0.1 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.5);
    poly(ctx, [[cx, cy - 1.0 * u], [cx + 0.2 * u, cy - 0.3 * u], [cx, cy + 0.15 * u], [cx - 0.2 * u, cy - 0.3 * u]]); ctx.fill();
    eye(ctx, cx, cy - 0.18 * u, 0.13 * u, pal.core);
  },
  seedmother(ctx, cx, cy, u, pal) {
    // Root strands trail below the dome.
    ctx.strokeStyle = css(pal.deep); ctx.lineWidth = 0.09 * u;
    for (const dx of [-0.5, -0.18, 0.18, 0.5]) {
      ctx.beginPath(); ctx.moveTo(cx + dx * u, cy + 0.45 * u);
      ctx.quadraticCurveTo(cx + dx * 1.3 * u, cy + 0.75 * u, cx + dx * 0.8 * u, cy + 0.98 * u); ctx.stroke();
    }
    ctx.fillStyle = css(pal.deep);
    circ(ctx, cx, cy + 0.05 * u, 0.92 * u); ctx.fill();
    ctx.fillStyle = css(pal.body, 0.92);
    circ(ctx, cx, cy, 0.85 * u); ctx.fill();
    // Four mine eggs inside: dark shells, bright hearts.
    for (const [dx, dy] of [[-0.38, -0.25], [0.38, -0.25], [-0.2, 0.28], [0.25, 0.3]] as Array<[number, number]>) {
      ctx.fillStyle = css(pal.deep);
      circ(ctx, cx + dx * u, cy + dy * u, 0.24 * u); ctx.fill();
      glow(ctx, cx + dx * u, cy + dy * u, 0.22 * u, pal.core, 0.75);
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx + dx * u, cy + dy * u, 0.09 * u); ctx.fill();
    }
  },
  rift_mine(ctx, cx, cy, u, pal) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * 0.55 * u, y1 = cy + Math.sin(a) * 0.55 * u;
      const x2 = cx + Math.cos(a) * 0.98 * u, y2 = cy + Math.sin(a) * 0.98 * u;
      const px = Math.cos(a + Math.PI / 2) * 0.13 * u, py = Math.sin(a + Math.PI / 2) * 0.13 * u;
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[x1 + px, y1 + py], [x2, y2], [x1 - px, y1 - py]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    circ(ctx, cx, cy, 0.62 * u); ctx.fill();
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy, 0.5 * u); ctx.fill();
    glow(ctx, cx, cy, 0.42 * u, pal.core, 0.85);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy, 0.18 * u); ctx.fill();
  },
  shieldback(ctx, cx, cy, u, pal) {
    // Dark beetle mass behind; the shield face is the top (the
    // facing direction): a metallic band with a bright rim ring.
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.12 * u, 0.88 * u, 0.82 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.18 * u, 0.74 * u, 0.68 * u, 0, 0, Math.PI * 2); ctx.fill();
    // Shield face plate.
    ctx.fillStyle = css(pal.accent, 0.85);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.42 * u, 0.78 * u, 0.42 * u, 0, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.4 * u, 0.62 * u, 0.32 * u, 0, Math.PI, Math.PI * 2); ctx.fill();
    // Bright rim ring along the face edge.
    ctx.strokeStyle = css(pal.core); ctx.lineWidth = 0.09 * u;
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.42 * u, 0.78 * u, 0.42 * u, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    eye(ctx, cx - 0.2 * u, cy + 0.05 * u, 0.05 * u, pal.core);
    eye(ctx, cx + 0.2 * u, cy + 0.05 * u, 0.05 * u, pal.core);
  },
  pyre_moth(ctx, cx, cy, u, pal, frame) {
    const lift = frame === 0 ? -0.4 : 0.35;
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body, 0.85);
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.55 * u, cy + lift * 0.5 * u, 0.52 * u, 0.3 * u, s * (0.5 + lift * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(pal.accent, 0.5);
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.55 * u, cy + lift * 0.5 * u, 0.34 * u, 0.19 * u, s * (0.5 + lift * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    glow(ctx, cx, cy, 0.55 * u, pal.core, 0.7);
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy, 0.42 * u); ctx.fill();
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy, 0.2 * u); ctx.fill();
    eye(ctx, cx - 0.13 * u, cy - 0.18 * u, 0.045 * u, pal.deep);
    eye(ctx, cx + 0.13 * u, cy - 0.18 * u, 0.045 * u, pal.deep);
  },
  phantom(ctx, cx, cy, u, pal) {
    // Hood over a body that dissolves into trailing wisps.
    ctx.fillStyle = css(pal.body, 0.95);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 0.95 * u);
    ctx.bezierCurveTo(cx + 0.62 * u, cy - 0.9 * u, cx + 0.7 * u, cy - 0.2 * u, cx + 0.55 * u, cy + 0.3 * u);
    ctx.lineTo(cx + 0.38 * u, cy + 0.95 * u);
    ctx.lineTo(cx + 0.18 * u, cy + 0.45 * u);
    ctx.lineTo(cx, cy + 1.0 * u);
    ctx.lineTo(cx - 0.18 * u, cy + 0.45 * u);
    ctx.lineTo(cx - 0.38 * u, cy + 0.95 * u);
    ctx.lineTo(cx - 0.55 * u, cy + 0.3 * u);
    ctx.bezierCurveTo(cx - 0.7 * u, cy - 0.2 * u, cx - 0.62 * u, cy - 0.9 * u, cx, cy - 0.95 * u);
    ctx.fill();
    ctx.fillStyle = css(pal.deep, 0.9);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.42 * u, 0.34 * u, 0.4 * u, 0, 0, Math.PI * 2); ctx.fill();
    eye(ctx, cx - 0.14 * u, cy - 0.45 * u, 0.055 * u, pal.core);
    eye(ctx, cx + 0.14 * u, cy - 0.45 * u, 0.055 * u, pal.core);
    ctx.fillStyle = css(pal.accent, 0.6);
    poly(ctx, [[cx - 0.06 * u, cy + 0.5 * u], [cx + 0.06 * u, cy + 0.5 * u], [cx, cy + 0.98 * u]]); ctx.fill();
  },
  wraith(ctx, cx, cy, u, pal) {
    // Spear figure: head at the top (the aim direction), long
    // shaft through a cloaked body.
    ctx.fillStyle = css(pal.accent);
    poly(ctx, [[cx, cy - 1.0 * u], [cx + 0.13 * u, cy - 0.62 * u], [cx - 0.13 * u, cy - 0.62 * u]]); ctx.fill();
    ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.1 * u;
    ctx.beginPath(); ctx.moveTo(cx, cy - 0.65 * u); ctx.lineTo(cx, cy + 0.85 * u); ctx.stroke();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.16 * u, cy - 0.35 * u], [cx + 0.16 * u, cy - 0.35 * u], [cx + 0.34 * u, cy + 0.8 * u], [cx, cy + 0.6 * u], [cx - 0.34 * u, cy + 0.8 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.deep);
    circ(ctx, cx, cy - 0.38 * u, 0.17 * u); ctx.fill();
    eye(ctx, cx, cy - 0.4 * u, 0.06 * u, pal.core);
  },
  chanter(ctx, cx, cy, u, pal) {
    // Note sparks on a ring around a bronze bell.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = cx + Math.cos(a) * 0.85 * u, y = cy + Math.sin(a) * 0.85 * u;
      glow(ctx, x, y, 0.16 * u, pal.core, 0.6);
      ctx.fillStyle = css(pal.core);
      circ(ctx, x, y, 0.06 * u); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx - 0.14 * u, cy - 0.85 * u], [cx + 0.14 * u, cy - 0.85 * u], [cx + 0.3 * u, cy + 0.3 * u], [cx + 0.55 * u, cy + 0.62 * u], [cx - 0.55 * u, cy + 0.62 * u], [cx - 0.3 * u, cy + 0.3 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.1 * u, cy - 0.78 * u], [cx + 0.1 * u, cy - 0.78 * u], [cx + 0.24 * u, cy + 0.3 * u], [cx + 0.44 * u, cy + 0.58 * u], [cx - 0.44 * u, cy + 0.58 * u], [cx - 0.24 * u, cy + 0.3 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.62 * u, 0.48 * u, 0.1 * u, 0, 0, Math.PI * 2); ctx.fill();
    glow(ctx, cx, cy - 0.2 * u, 0.3 * u, pal.core, 0.5);
  },
  serpent(ctx, cx, cy, u, pal) {
    // Head: swept fins behind a skull with a gold spine line.
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.15 * u, cy - 0.1 * u], [cx + s * 0.95 * u, cy + 0.35 * u], [cx + s * 0.5 * u, cy + 0.45 * u], [cx + s * 0.2 * u, cy + 0.3 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.62 * u, 0.72 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.05 * u, 0.5 * u, 0.6 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.07 * u;
    ctx.beginPath(); ctx.moveTo(cx, cy - 0.62 * u); ctx.lineTo(cx, cy + 0.55 * u); ctx.stroke();
    glow(ctx, cx, cy - 0.12 * u, 0.36 * u, pal.core, 0.8);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy - 0.12 * u, 0.17 * u); ctx.fill();
    eye(ctx, cx - 0.24 * u, cy - 0.32 * u, 0.05 * u, pal.accent);
    eye(ctx, cx + 0.24 * u, cy - 0.32 * u, 0.05 * u, pal.accent);
  },
  serpent_segment(ctx, cx, cy, u, pal) {
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.85 * u, 0.75 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.7 * u, 0.6 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.9);
    circ(ctx, cx, cy - 0.28 * u, 0.09 * u); ctx.fill();
    circ(ctx, cx, cy + 0.02 * u, 0.07 * u); ctx.fill();
    circ(ctx, cx, cy + 0.3 * u, 0.05 * u); ctx.fill();
  },
  darter(ctx, cx, cy, u, pal) {
    // Sleek arrowhead pointing up (the travel direction), swept
    // fins, bright wingtips.
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx, cy - 1.0 * u], [cx + 0.2 * u, cy - 0.2 * u], [cx + 0.85 * u, cy + 0.55 * u], [cx + 0.3 * u, cy + 0.5 * u], [cx + 0.22 * u, cy + 0.85 * u], [cx - 0.22 * u, cy + 0.85 * u], [cx - 0.3 * u, cy + 0.5 * u], [cx - 0.85 * u, cy + 0.55 * u], [cx - 0.2 * u, cy - 0.2 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx, cy - 0.8 * u], [cx + 0.1 * u, cy - 0.1 * u], [cx, cy + 0.6 * u], [cx - 0.1 * u, cy - 0.1 * u]]); ctx.fill();
    glow(ctx, cx, cy - 0.45 * u, 0.22 * u, pal.core, 0.8);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy - 0.45 * u, 0.08 * u); ctx.fill();
    eye(ctx, cx - 0.8 * u, cy + 0.52 * u, 0.055 * u, pal.accent);
    eye(ctx, cx + 0.8 * u, cy + 0.52 * u, 0.055 * u, pal.accent);
  },
};

// Boss painters, one drawn body per boss (world index order).
const BOSS_PAINTERS: Painter[] = [
  // 0 Cinder Colossus: hunched basalt giant with cracked magma plates,
  // shoulder vents and a furnace mouth.
  (ctx, cx, cy, u, pal) => {
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx - 0.95 * u, cy - 0.2 * u], [cx - 0.55 * u, cy - 0.75 * u], [cx + 0.55 * u, cy - 0.75 * u], [cx + 0.95 * u, cy - 0.2 * u], [cx + 0.7 * u, cy + 0.85 * u], [cx - 0.7 * u, cy + 0.85 * u]]); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.55 * u, cy - 0.8 * u], [cx + s * 0.98 * u, cy - 0.5 * u], [cx + s * 0.9 * u, cy - 0.1 * u], [cx + s * 0.5 * u, cy - 0.35 * u]]); ctx.fill();
      glow(ctx, cx + s * 0.78 * u, cy - 0.78 * u, 0.25 * u, pal.core, 0.8);
      ctx.fillStyle = css(pal.core); circ(ctx, cx + s * 0.78 * u, cy - 0.72 * u, 0.07 * u); ctx.fill();
    }
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.5 * u, cy - 0.6 * u], [cx + 0.5 * u, cy - 0.6 * u], [cx + 0.55 * u, cy + 0.6 * u], [cx - 0.55 * u, cy + 0.6 * u]]); ctx.fill();
    ctx.strokeStyle = css(pal.core, 0.95); ctx.lineWidth = 0.045 * u;
    for (const [a, b, c2] of [[-0.45, -0.1, 0.4], [0.4, 0.05, 0.5], [-0.1, 0.3, 0.2]]) {
      ctx.beginPath(); ctx.moveTo(cx + a * u, cy - 0.55 * u); ctx.lineTo(cx + b * u, cy); ctx.lineTo(cx + c2 * u * Math.sign(a || 1), cy + 0.55 * u); ctx.stroke();
    }
    glow(ctx, cx, cy + 0.25 * u, 0.45 * u, pal.core, 0.9);
    ctx.fillStyle = css(pal.core); poly(ctx, [[cx - 0.22 * u, cy + 0.15 * u], [cx + 0.22 * u, cy + 0.15 * u], [cx + 0.14 * u, cy + 0.38 * u], [cx - 0.14 * u, cy + 0.38 * u]]); ctx.fill();
    eye(ctx, cx - 0.2 * u, cy - 0.32 * u, 0.065 * u, pal.accent);
    eye(ctx, cx + 0.2 * u, cy - 0.32 * u, 0.065 * u, pal.accent);
  },
  // 1 Umbral Matriarch: veiled spider queen, eight lance legs and a
  // crescent crown.
  (ctx, cx, cy, u, pal, frame) => {
    ctx.strokeStyle = css(pal.deep); ctx.lineWidth = 0.07 * u; ctx.lineCap = 'round';
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const a = -0.6 + i * 0.42 + (frame % 2) * 0.05 * s;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + s * 0.55 * u * Math.cos(a), cy + 0.55 * u * Math.sin(a) - 0.1 * u);
      ctx.lineTo(cx + s * 0.98 * u * Math.cos(a * 1.2), cy + 0.9 * u * Math.sin(a * 1.2) + 0.15 * u); ctx.stroke();
    }
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.25 * u, 0.42 * u, 0.5 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.3 * u, 0.3 * u, 0.32 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.06 * u;
    ctx.beginPath(); ctx.arc(cx, cy - 0.55 * u, 0.32 * u, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    glow(ctx, cx, cy + 0.25 * u, 0.32 * u, pal.core, 0.6);
    ctx.fillStyle = css(pal.core); poly(ctx, [[cx, cy + 0.05 * u], [cx + 0.1 * u, cy + 0.25 * u], [cx, cy + 0.45 * u], [cx - 0.1 * u, cy + 0.25 * u]]); ctx.fill();
    for (const [x, y] of [[-0.12, -0.34], [0.12, -0.34], [-0.06, -0.22], [0.06, -0.22]]) eye(ctx, cx + x * u, cy + y * u, 0.035 * u, pal.core);
  },
  // 2 Prism Sentinel: floating faceted octahedron with a lens eye and
  // orbiting prisms.
  (ctx, cx, cy, u, pal) => {
    const facets: Array<[Array<[number, number]>, Rgb]> = [
      [[[0, -1], [0.7, 0], [0, 0]], pal.accent], [[[0, -1], [-0.7, 0], [0, 0]], pal.body],
      [[[0, 1], [0.7, 0], [0, 0]], pal.body], [[[0, 1], [-0.7, 0], [0, 0]], pal.deep],
    ];
    for (const [pts, c] of facets) { ctx.fillStyle = css(c); poly(ctx, pts.map(([x, y]) => [cx + x * u, cy + y * 0.95 * u] as [number, number])); ctx.fill(); }
    ctx.strokeStyle = css(pal.core, 0.8); ctx.lineWidth = 0.03 * u;
    poly(ctx, [[cx, cy - 0.95 * u], [cx + 0.7 * u, cy], [cx, cy + 0.95 * u], [cx - 0.7 * u, cy]]); ctx.stroke();
    for (const [x, y] of [[-0.9, -0.6], [0.9, -0.6], [-0.85, 0.65], [0.85, 0.65]]) {
      ctx.fillStyle = css(pal.accent, 0.9); poly(ctx, [[cx + x * u, cy + (y - 0.15) * u], [cx + (x + 0.08) * u, cy + y * u], [cx + x * u, cy + (y + 0.15) * u], [cx + (x - 0.08) * u, cy + y * u]]); ctx.fill();
    }
    glow(ctx, cx, cy, 0.4 * u, pal.core, 0.9);
    ctx.fillStyle = css(pal.core); circ(ctx, cx, cy, 0.14 * u); ctx.fill();
    ctx.fillStyle = css(pal.deep); circ(ctx, cx, cy, 0.06 * u); ctx.fill();
  },
  // 3 Tempest Roc: storm bird with wide jagged wings and lightning
  // crest.
  (ctx, cx, cy, u, pal, frame) => {
    const f = frame % 2 ? 0.12 : 0;
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.15 * u, cy - 0.15 * u], [cx + s * 1.0 * u, cy - (0.7 - f) * u], [cx + s * 0.85 * u, cy - 0.35 * u], [cx + s * 0.98 * u, cy - 0.2 * u], [cx + s * 0.7 * u, cy + 0.0 * u], [cx + s * 0.8 * u, cy + 0.2 * u], [cx + s * 0.2 * u, cy + 0.25 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.1 * u, 0.25 * u, 0.55 * u, 0, 0, Math.PI * 2); ctx.fill();
    poly(ctx, [[cx - 0.18 * u, cy + 0.55 * u], [cx, cy + 0.98 * u], [cx + 0.18 * u, cy + 0.55 * u]]); ctx.fill();
    ctx.strokeStyle = css(pal.core); ctx.lineWidth = 0.05 * u;
    ctx.beginPath(); ctx.moveTo(cx, cy - 0.95 * u); ctx.lineTo(cx + 0.12 * u, cy - 0.7 * u); ctx.lineTo(cx - 0.06 * u, cy - 0.62 * u); ctx.lineTo(cx + 0.05 * u, cy - 0.4 * u); ctx.stroke();
    ctx.fillStyle = css(pal.accent); poly(ctx, [[cx - 0.07 * u, cy - 0.3 * u], [cx + 0.07 * u, cy - 0.3 * u], [cx, cy - 0.12 * u]]); ctx.fill();
    eye(ctx, cx - 0.1 * u, cy - 0.38 * u, 0.045 * u, pal.core);
    eye(ctx, cx + 0.1 * u, cy - 0.38 * u, 0.045 * u, pal.core);
  },
  // 4 Grave Warden: armored lantern knight with a soul scythe.
  (ctx, cx, cy, u, pal) => {
    ctx.strokeStyle = css(pal.deep); ctx.lineWidth = 0.06 * u;
    ctx.beginPath(); ctx.moveTo(cx + 0.6 * u, cy + 0.95 * u); ctx.lineTo(cx + 0.6 * u, cy - 0.8 * u); ctx.stroke();
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.08 * u;
    ctx.beginPath(); ctx.arc(cx + 0.15 * u, cy - 0.8 * u, 0.45 * u, -0.15, 0.9); ctx.stroke();
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx - 0.45 * u, cy - 0.4 * u], [cx + 0.45 * u, cy - 0.4 * u], [cx + 0.6 * u, cy + 0.95 * u], [cx - 0.6 * u, cy + 0.95 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.3 * u, cy - 0.9 * u], [cx + 0.3 * u, cy - 0.9 * u], [cx + 0.35 * u, cy - 0.35 * u], [cx, cy - 0.2 * u], [cx - 0.35 * u, cy - 0.35 * u]]); ctx.fill();
    ctx.fillStyle = css([0.02, 0.01, 0.04]); poly(ctx, [[cx - 0.22 * u, cy - 0.65 * u], [cx + 0.22 * u, cy - 0.65 * u], [cx + 0.18 * u, cy - 0.5 * u], [cx - 0.18 * u, cy - 0.5 * u]]); ctx.fill();
    eye(ctx, cx - 0.09 * u, cy - 0.58 * u, 0.04 * u, pal.core);
    eye(ctx, cx + 0.09 * u, cy - 0.58 * u, 0.04 * u, pal.core);
    ctx.strokeStyle = css(pal.accent, 0.8); ctx.lineWidth = 0.03 * u;
    ctx.beginPath(); ctx.moveTo(cx - 0.35 * u, cy + 0.05 * u); ctx.lineTo(cx - 0.35 * u, cy + 0.3 * u); ctx.stroke();
    glow(ctx, cx - 0.35 * u, cy + 0.45 * u, 0.3 * u, pal.core, 0.9);
    ctx.fillStyle = css(pal.core); circ(ctx, cx - 0.35 * u, cy + 0.45 * u, 0.1 * u); ctx.fill();
  },
  // 5 Solar Monarch: radiant crowned bird-king with a sun disc halo.
  (ctx, cx, cy, u, pal) => {
    glow(ctx, cx, cy - 0.2 * u, 0.95 * u, pal.core, 0.45);
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.05 * u;
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 0.6 * u, cy - 0.2 * u + Math.sin(a) * 0.6 * u); ctx.lineTo(cx + Math.cos(a) * 0.85 * u, cy - 0.2 * u + Math.sin(a) * 0.85 * u); ctx.stroke(); }
    for (const s of [-1, 1]) { ctx.fillStyle = css(pal.body); poly(ctx, [[cx + s * 0.2 * u, cy], [cx + s * 0.95 * u, cy + 0.1 * u], [cx + s * 0.7 * u, cy + 0.4 * u], [cx + s * 0.25 * u, cy + 0.45 * u]]); ctx.fill(); }
    ctx.fillStyle = css(pal.deep); ctx.beginPath(); ctx.ellipse(cx, cy + 0.25 * u, 0.3 * u, 0.6 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body); circ(ctx, cx, cy - 0.3 * u, 0.25 * u); ctx.fill();
    ctx.fillStyle = css(pal.accent); poly(ctx, [[cx - 0.25 * u, cy - 0.5 * u], [cx - 0.2 * u, cy - 0.85 * u], [cx - 0.08 * u, cy - 0.6 * u], [cx, cy - 0.95 * u], [cx + 0.08 * u, cy - 0.6 * u], [cx + 0.2 * u, cy - 0.85 * u], [cx + 0.25 * u, cy - 0.5 * u]]); ctx.fill();
    eye(ctx, cx - 0.09 * u, cy - 0.3 * u, 0.045 * u, pal.core);
    eye(ctx, cx + 0.09 * u, cy - 0.3 * u, 0.045 * u, pal.core);
  },
  // 6 Glacial Oracle: tall ice seer, robe of shards, floating rune ring.
  (ctx, cx, cy, u, pal) => {
    ctx.strokeStyle = css(pal.accent, 0.8); ctx.lineWidth = 0.035 * u;
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.15 * u, 0.85 * u, 0.3 * u, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx, cy - 0.55 * u], [cx + 0.45 * u, cy + 0.1 * u], [cx + 0.55 * u, cy + 0.95 * u], [cx + 0.2 * u, cy + 0.75 * u], [cx, cy + 0.98 * u], [cx - 0.2 * u, cy + 0.75 * u], [cx - 0.55 * u, cy + 0.95 * u], [cx - 0.45 * u, cy + 0.1 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.deep); poly(ctx, [[cx, cy - 0.3 * u], [cx + 0.15 * u, cy + 0.6 * u], [cx - 0.15 * u, cy + 0.6 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent);
    for (const [x, h] of [[-0.2, 0.35], [0, 0.5], [0.2, 0.35]]) { poly(ctx, [[cx + (x - 0.06) * u, cy - 0.6 * u], [cx + x * u, cy - (0.6 + h) * u], [cx + (x + 0.06) * u, cy - 0.6 * u]]); ctx.fill(); }
    ctx.fillStyle = css(pal.body); circ(ctx, cx, cy - 0.5 * u, 0.18 * u); ctx.fill();
    glow(ctx, cx, cy - 0.5 * u, 0.3 * u, pal.core, 0.8);
    eye(ctx, cx, cy - 0.5 * u, 0.06 * u, pal.core);
  },
  // 7 Wyrm Sovereign: coiled long-necked dragon with twin horns and
  // ember throat.
  (ctx, cx, cy, u, pal, frame) => {
    ctx.strokeStyle = css(pal.deep); ctx.lineWidth = 0.32 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy + 0.35 * u, 0.45 * u, 0.2, Math.PI * 1.75); ctx.stroke();
    ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.2 * u;
    ctx.beginPath(); ctx.arc(cx, cy + 0.35 * u, 0.45 * u, 0.2, Math.PI * 1.75); ctx.stroke();
    for (const s of [-1, 1]) { ctx.fillStyle = css(pal.deep, 0.9); poly(ctx, [[cx + s * 0.3 * u, cy - 0.1 * u], [cx + s * 1.0 * u, cy - (0.6 + (frame % 2) * 0.1) * u], [cx + s * 0.9 * u, cy + 0.1 * u], [cx + s * 0.45 * u, cy + 0.2 * u]]); ctx.fill(); }
    ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.18 * u;
    ctx.beginPath(); ctx.moveTo(cx + 0.3 * u, cy + 0.05 * u); ctx.quadraticCurveTo(cx + 0.35 * u, cy - 0.5 * u, cx, cy - 0.6 * u); ctx.stroke();
    ctx.fillStyle = css(pal.body); ctx.beginPath(); ctx.ellipse(cx - 0.05 * u, cy - 0.65 * u, 0.24 * u, 0.17 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.accent);
    for (const s of [-1, 1]) { poly(ctx, [[cx + s * 0.1 * u - 0.05 * u, cy - 0.75 * u], [cx + s * 0.3 * u - 0.05 * u, cy - 1.0 * u], [cx + s * 0.18 * u - 0.05 * u, cy - 0.7 * u]]); ctx.fill(); }
    glow(ctx, cx + 0.3 * u, cy - 0.25 * u, 0.22 * u, pal.core, 0.8);
    eye(ctx, cx - 0.13 * u, cy - 0.68 * u, 0.04 * u, pal.core);
    eye(ctx, cx + 0.03 * u, cy - 0.68 * u, 0.04 * u, pal.core);
  },
  // 8 Entropy Engine: a clockwork core of broken gear plates around
  // an unstable singular eye.
  (ctx, cx, cy, u, pal) => {
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; const r = (i % 2 ? 0.78 : 0.92) * u; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(pal.body);
    for (let q = 0; q < 4; q++) {
      const a0 = q * Math.PI / 2 + 0.12, a1 = a0 + Math.PI / 2 - 0.24;
      ctx.beginPath(); ctx.arc(cx, cy, 0.7 * u, a0, a1); ctx.arc(cx, cy, 0.38 * u, a1, a0, true); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = css(pal.accent, 0.9); ctx.lineWidth = 0.035 * u;
    for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 0.4 * u, cy + Math.sin(a) * 0.4 * u); ctx.lineTo(cx + Math.cos(a) * 0.68 * u, cy + Math.sin(a) * 0.68 * u); ctx.stroke(); }
    glow(ctx, cx, cy, 0.45 * u, pal.core, 0.95);
    ctx.fillStyle = css([0.02, 0.0, 0.04]); circ(ctx, cx, cy, 0.2 * u); ctx.fill();
    ctx.strokeStyle = css(pal.core); ctx.lineWidth = 0.04 * u; circ(ctx, cx, cy, 0.24 * u); ctx.stroke();
    eye(ctx, cx, cy, 0.06 * u, pal.accent);
  },
  // 9 Phoenix Ascendant: a radiant six-winged phoenix with a
  // flame-feather tail and a halo.
  (ctx, cx, cy, u, pal, frame) => {
    glow(ctx, cx, cy, 1.0 * u, pal.core, 0.4);
    const lift = frame % 2 ? 0.08 : 0;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      ctx.fillStyle = css(k === 1 ? pal.accent : pal.body, 0.95 - k * 0.15);
      const y0 = -0.35 + k * 0.32;
      poly(ctx, [[cx + s * 0.15 * u, cy + y0 * u], [cx + s * (1.0 - k * 0.12) * u, cy + (y0 - 0.45 + lift) * u], [cx + s * (0.75 - k * 0.1) * u, cy + (y0 + 0.05) * u], [cx + s * 0.2 * u, cy + (y0 + 0.2) * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    for (const dx of [-0.15, 0, 0.15]) { poly(ctx, [[cx + dx * u - 0.06 * u, cy + 0.4 * u], [cx + dx * 1.8 * u, cy + 0.98 * u], [cx + dx * u + 0.06 * u, cy + 0.4 * u]]); ctx.fill(); }
    ctx.fillStyle = css(pal.body); ctx.beginPath(); ctx.ellipse(cx, cy + 0.05 * u, 0.2 * u, 0.45 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.04 * u; ctx.beginPath(); ctx.ellipse(cx, cy - 0.72 * u, 0.25 * u, 0.08 * u, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = css(pal.core); circ(ctx, cx, cy - 0.45 * u, 0.13 * u); ctx.fill();
    eye(ctx, cx, cy - 0.47 * u, 0.04 * u, pal.accent);
    glow(ctx, cx, cy + 0.05 * u, 0.3 * u, pal.core, 0.9);
  },
];

// ------------------------------------------------------------------
// Sprite sets: textures plus a death-burst point cloud sampled
// from the drawn canvas, so a mob still dies in a scatter of its
// own shape (the burst system in entity-sync consumes points).
// ------------------------------------------------------------------
export interface MobSpriteSet {
  maps: THREE.CanvasTexture[]; // 1 frame, or 2 for flap types
  burstPositions: Float32Array;
  burstColors: Float32Array;
}
const FLAP_TYPES = new Set(['bat', 'mite', 'pyre_moth']);
const cache = new Map<string, MobSpriteSet>();

function painterFor(type: string, worldIndex: number): Painter {
  if (type === 'boss') return BOSS_PAINTERS[worldIndex] ?? BOSS_PAINTERS[0];
  if (type === 'boss_shadow') return BOSS_PAINTERS[1];
  return PAINTERS[type] ?? PAINTERS['slime'];
}

export function getMobSpriteSet(type: string, worldIndex: number, extentX: number, extentY: number, form = 0): MobSpriteSet {
  const key = `${type}|${worldIndex}|${form}|${Math.round(extentX * 10)}x${Math.round(extentY * 10)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = mobPalette(type, worldIndex, form);
  const painter = painterFor(type, worldIndex);
  const W = 256;
  const H = Math.max(96, Math.min(384, Math.round(256 * (extentY / Math.max(0.2, extentX)))));
  const frames = FLAP_TYPES.has(type) ? [0, 1] : [0];
  const maps: THREE.CanvasTexture[] = [];
  let burstPositions = new Float32Array(0);
  let burstColors = new Float32Array(0);
  for (const frame of frames) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const u = Math.min(W, H) / 2 * 0.94;
    painter(ctx, W / 2, H / 2, u, pal, frame);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    maps.push(tex);
    if (frame === 0) {
      // Sample the drawing into a burst cloud (glyph units, y up).
      const img = ctx.getImageData(0, 0, W, H).data;
      const pts: number[] = [];
      const cols: number[] = [];
      const step = 6;
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          const a = img[(y * W + x) * 4 + 3];
          if (a < 110) continue;
          pts.push((x / W - 0.5) * extentX * 2, (0.5 - y / H) * extentY * 2, 0);
          cols.push(img[(y * W + x) * 4] / 255, img[(y * W + x) * 4 + 1] / 255, img[(y * W + x) * 4 + 2] / 255);
          if (pts.length >= 200 * 3) break;
        }
        if (pts.length >= 200 * 3) break;
      }
      burstPositions = new Float32Array(pts);
      burstColors = new Float32Array(cols);
    }
  }
  const set: MobSpriteSet = { maps, burstPositions, burstColors };
  cache.set(key, set);
  return set;
}

// Boss sprite sets: one drawn body per realm boss.
export function getBossFormSets(worldIndex: number, extentX: number, extentY: number): MobSpriteSet[] {
  return [getMobSpriteSet('boss', worldIndex, extentX, extentY, 0)];
}

// ------------------------------------------------------------------
// Player flame bolts (Fix Round 2, A6): the player's basic shots
// are elongated flame bolts, drawn pointing up and rotated to
// their travel direction by entity-sync, so they can never be
// confused with the enemies' round orbs. Two color families match
// the shipped ownership colors: amber for the player's fire, and
// the violet family for the watched bird's fire in ai_vs_ai. The
// player's own fire is NOT luminance capped (it is the player's).
// ------------------------------------------------------------------
const BOLT_PALETTES: Record<string, MobPalette> = {
  amber: { core: [1.0, 0.97, 0.85], body: [1.0, 0.55, 0.1], accent: [1.0, 0.8, 0.3], deep: [0.85, 0.25, 0.02] },
  violet: { core: [1.0, 0.95, 1.0], body: [0.85, 0.28, 0.94], accent: [0.95, 0.6, 1.0], deep: [0.45, 0.1, 0.6] },
};
const boltCache = new Map<string, MobSpriteSet>();
export function getBoltSpriteSet(variant: 'amber' | 'violet'): MobSpriteSet {
  const hit = boltCache.get(variant);
  if (hit) return hit;
  const pal = BOLT_PALETTES[variant];
  const W = 128, H = 288;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const cx = W / 2, cy = H / 2, u = W / 2 * 0.94;
  // Flame body: fat bright head at the top, tapering tail below.
  const grad = ctx.createLinearGradient(0, cy - 1.35 * u, 0, cy + 1.45 * u);
  grad.addColorStop(0, css(pal.core));
  grad.addColorStop(0.35, css(pal.accent));
  grad.addColorStop(0.7, css(pal.body));
  grad.addColorStop(1, css(pal.deep, 0.9));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 1.42 * u);
  ctx.bezierCurveTo(cx + 0.52 * u, cy - 0.7 * u, cx + 0.42 * u, cy + 0.1 * u, cx + 0.16 * u, cy + 0.75 * u);
  ctx.bezierCurveTo(cx + 0.08 * u, cy + 1.1 * u, cx + 0.05 * u, cy + 1.3 * u, cx, cy + 1.45 * u);
  ctx.bezierCurveTo(cx - 0.05 * u, cy + 1.3 * u, cx - 0.08 * u, cy + 1.1 * u, cx - 0.16 * u, cy + 0.75 * u);
  ctx.bezierCurveTo(cx - 0.42 * u, cy + 0.1 * u, cx - 0.52 * u, cy - 0.7 * u, cx, cy - 1.42 * u);
  ctx.fill();
  // Side flickers at the tail.
  for (const s of [-1, 1]) {
    ctx.fillStyle = css(pal.body, 0.85);
    poly(ctx, [[cx + s * 0.2 * u, cy + 0.55 * u], [cx + s * 0.55 * u, cy + 1.05 * u], [cx + s * 0.12 * u, cy + 0.95 * u]]); ctx.fill();
  }
  // White-hot core at the head.
  glow(ctx, cx, cy - 0.72 * u, 0.42 * u, pal.core, 0.95);
  ctx.fillStyle = css(pal.core);
  ctx.beginPath(); ctx.ellipse(cx, cy - 0.72 * u, 0.17 * u, 0.3 * u, 0, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const set: MobSpriteSet = { maps: [tex], burstPositions: new Float32Array(0), burstColors: new Float32Array(0) };
  boltCache.set(variant, set);
  return set;
}

// ------------------------------------------------------------------
// Ability sprites (Fix Round 2, A10): every ability gets its own
// drawn look, keyed by body type + moveId (the executor already
// stamps moveId on its projectiles; the direct fire spawns were
// tagged for this). Shapes are drawn facing up and rotated to
// travel by entity-sync, like the A6 bolts. Enemy casts of the
// same moves take a hostile-shifted palette (and the watched
// bird's casts in ai_vs_ai a violet shift), following the shipped
// ownership color rule, so a friendly effect never reads hostile.
// Mechanics are untouched: only the rendering of the same bodies
// changes.
// ------------------------------------------------------------------
export type AbilityVariant = 'player' | 'hostile' | 'violet';
export interface AbilitySpriteDef { sx: number; sy: number; pal: MobPalette; paint: Painter; }

function flameBoltPaint(tips: number, wide: number): Painter {
  return (ctx, cx, cy, u, pal) => {
    const grad = ctx.createLinearGradient(0, cy - 1.3 * u, 0, cy + 1.4 * u);
    grad.addColorStop(0, css(pal.core));
    grad.addColorStop(0.4, css(pal.accent));
    grad.addColorStop(1, css(pal.deep, 0.9));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 1.35 * u);
    ctx.bezierCurveTo(cx + wide * u, cy - 0.5 * u, cx + wide * 0.8 * u, cy + 0.3 * u, cx + wide * 0.3 * u, cy + 0.85 * u);
    ctx.bezierCurveTo(cx + wide * 0.12 * u, cy + 1.15 * u, cx + wide * 0.06 * u, cy + 1.28 * u, cx, cy + 1.42 * u);
    ctx.bezierCurveTo(cx - wide * 0.06 * u, cy + 1.28 * u, cx - wide * 0.12 * u, cy + 1.15 * u, cx - wide * 0.3 * u, cy + 0.85 * u);
    ctx.bezierCurveTo(cx - wide * 0.8 * u, cy + 0.3 * u, cx - wide * u, cy - 0.5 * u, cx, cy - 1.35 * u);
    ctx.fill();
    if (tips > 1) {
      for (const s of [-1, 1]) {
        ctx.fillStyle = css(pal.body, 0.9);
        poly(ctx, [[cx + s * wide * 0.55 * u, cy - 0.55 * u], [cx + s * wide * 1.05 * u, cy - 1.15 * u], [cx + s * wide * 0.95 * u, cy - 0.3 * u]]); ctx.fill();
      }
    }
    glow(ctx, cx, cy - 0.6 * u, 0.4 * u, pal.core, 0.9);
    ctx.fillStyle = css(pal.core);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.62 * u, 0.16 * u, 0.27 * u, 0, 0, Math.PI * 2); ctx.fill();
  };
}

const ABILITY_DEFS: Record<string, AbilitySpriteDef> = {
  // Burst: a chunky three-tip flame bolt.
  burst: { sx: 1.25, sy: 2.0, pal: { core: [1.0, 0.97, 0.85], body: [1.0, 0.55, 0.1], accent: [1.0, 0.8, 0.3], deep: [0.85, 0.25, 0.02] }, paint: flameBoltPaint(3, 0.62) },
  // Inferno Wave: a radiant halo bolt.
  inferno_wave: {
    sx: 1.5, sy: 2.3, pal: { core: [1.0, 0.98, 0.9], body: [1.0, 0.62, 0.12], accent: [1.0, 0.85, 0.4], deep: [0.9, 0.3, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      ctx.strokeStyle = css(pal.accent, 0.85); ctx.lineWidth = 0.09 * u;
      circ(ctx, cx, cy - 0.55 * u, 0.52 * u); ctx.stroke();
      flameBoltPaint(1, 0.5)(ctx, cx, cy, u, pal, 0);
    },
  },
  // Phoenix Talon: three golden claw arcs in a fan.
  phoenix_talon: {
    sx: 1.7, sy: 1.9, pal: { core: [1.0, 0.95, 0.7], body: [1.0, 0.75, 0.25], accent: [1.0, 0.88, 0.45], deep: [0.8, 0.45, 0.05] },
    paint: (ctx, cx, cy, u, pal) => {
      for (const s of [-0.62, 0, 0.62]) {
        ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.17 * u; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + s * u, cy + 0.75 * u);
        ctx.quadraticCurveTo(cx + s * 1.25 * u, cy - 0.1 * u, cx + s * 0.55 * u, cy - 0.85 * u);
        ctx.stroke();
        ctx.strokeStyle = css(pal.core); ctx.lineWidth = 0.07 * u;
        ctx.beginPath();
        ctx.moveTo(cx + s * u, cy + 0.7 * u);
        ctx.quadraticCurveTo(cx + s * 1.22 * u, cy - 0.1 * u, cx + s * 0.55 * u, cy - 0.82 * u);
        ctx.stroke();
      }
      glow(ctx, cx, cy + 0.5 * u, 0.5 * u, pal.accent, 0.5);
    },
  },
  // Fire Dart: a slim ember spearhead.
  fire_dart: {
    sx: 0.85, sy: 2.0, pal: { core: [1.0, 0.98, 0.92], body: [0.95, 0.3, 0.05], accent: [1.0, 0.6, 0.15], deep: [0.6, 0.12, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx, cy - 1.3 * u], [cx + 0.3 * u, cy - 0.1 * u], [cx + 0.16 * u, cy + 0.75 * u], [cx, cy + 0.45 * u], [cx - 0.16 * u, cy + 0.75 * u], [cx - 0.3 * u, cy - 0.1 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.accent);
      poly(ctx, [[cx + 0.16 * u, cy + 0.75 * u], [cx + 0.42 * u, cy + 1.25 * u], [cx + 0.05 * u, cy + 1.05 * u]]); ctx.fill();
      poly(ctx, [[cx - 0.16 * u, cy + 0.75 * u], [cx - 0.42 * u, cy + 1.25 * u], [cx - 0.05 * u, cy + 1.05 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.core);
      poly(ctx, [[cx, cy - 1.3 * u], [cx + 0.11 * u, cy - 0.35 * u], [cx, cy - 0.05 * u], [cx - 0.11 * u, cy - 0.35 * u]]); ctx.fill();
    },
  },
  // Spark Storm: a crackling spark orb.
  spark_storm: {
    sx: 1.5, sy: 1.5, pal: { core: [1.0, 1.0, 1.0], body: [0.45, 0.85, 1.0], accent: [0.75, 0.95, 1.0], deep: [0.15, 0.5, 0.85] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const x1 = cx + Math.cos(a) * 0.42 * u, y1 = cy + Math.sin(a) * 0.42 * u;
        const x2 = cx + Math.cos(a) * 0.95 * u, y2 = cy + Math.sin(a) * 0.95 * u;
        const mx = cx + Math.cos(a + 0.35) * 0.68 * u, my = cy + Math.sin(a + 0.35) * 0.68 * u;
        ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.09 * u;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx, my); ctx.lineTo(x2, y2); ctx.stroke();
      }
      glow(ctx, cx, cy, 0.55 * u, pal.body, 0.8);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy, 0.4 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.2 * u); ctx.fill();
    },
  },
  // Fire Lance: a long white-gold lance.
  fire_lance: {
    sx: 0.75, sy: 2.6, pal: { core: [1.0, 1.0, 0.98], body: [1.0, 0.85, 0.4], accent: [1.0, 0.92, 0.6], deep: [0.85, 0.55, 0.1] },
    paint: (ctx, cx, cy, u, pal) => {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx - 0.09 * u, cy + 1.3 * u], [cx + 0.09 * u, cy + 1.3 * u], [cx + 0.09 * u, cy - 0.55 * u], [cx - 0.09 * u, cy - 0.55 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.accent);
      poly(ctx, [[cx, cy - 1.35 * u], [cx + 0.2 * u, cy - 0.5 * u], [cx, cy - 0.3 * u], [cx - 0.2 * u, cy - 0.5 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.core);
      poly(ctx, [[cx, cy - 1.35 * u], [cx + 0.08 * u, cy - 0.6 * u], [cx, cy - 0.42 * u], [cx - 0.08 * u, cy - 0.6 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.deep);
      ctx.fillRect(cx - 0.3 * u, cy + 0.55 * u, 0.6 * u, 0.1 * u);
      glow(ctx, cx, cy - 0.7 * u, 0.35 * u, pal.core, 0.7);
    },
  },
  // Phoenix Nova: a radiant sun orb.
  phoenix_nova: {
    sx: 1.8, sy: 1.8, pal: { core: [1.0, 0.98, 0.88], body: [1.0, 0.65, 0.15], accent: [1.0, 0.85, 0.4], deep: [0.9, 0.35, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const bx = cx + Math.cos(a) * 0.55 * u, by = cy + Math.sin(a) * 0.55 * u;
        const tx = cx + Math.cos(a) * 0.98 * u, ty = cy + Math.sin(a) * 0.98 * u;
        const px = Math.cos(a + Math.PI / 2) * 0.13 * u, py = Math.sin(a + Math.PI / 2) * 0.13 * u;
        ctx.fillStyle = css(pal.body);
        poly(ctx, [[bx + px, by + py], [tx, ty], [bx - px, by - py]]); ctx.fill();
      }
      glow(ctx, cx, cy, 0.62 * u, pal.body, 0.85);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy, 0.52 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.28 * u); ctx.fill();
    },
  },
  // Fire Breath: a layered flame tongue.
  fire_breath: {
    sx: 1.4, sy: 1.4, pal: { core: [1.0, 0.95, 0.75], body: [0.95, 0.4, 0.05], accent: [1.0, 0.7, 0.2], deep: [0.8, 0.2, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      const tongue = (w: number, h: number, c: Rgb, a: number) => {
        ctx.fillStyle = css(c, a);
        ctx.beginPath();
        ctx.moveTo(cx, cy - h * u);
        ctx.bezierCurveTo(cx + w * u, cy - h * 0.3 * u, cx + w * 0.8 * u, cy + h * 0.5 * u, cx, cy + h * 0.72 * u);
        ctx.bezierCurveTo(cx - w * 0.8 * u, cy + h * 0.5 * u, cx - w * u, cy - h * 0.3 * u, cx, cy - h * u);
        ctx.fill();
      };
      tongue(0.95, 1.0, pal.deep, 0.95);
      tongue(0.72, 0.82, pal.body, 0.95);
      tongue(0.45, 0.6, pal.accent, 0.95);
      tongue(0.22, 0.38, pal.core, 1);
    },
  },
  // Phoenix Turret shots: a round ember pellet with a stub tail.
  turret_shot: {
    sx: 1.1, sy: 1.6, pal: { core: [1.0, 0.96, 0.8], body: [1.0, 0.5, 0.08], accent: [1.0, 0.75, 0.3], deep: [0.85, 0.28, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      ctx.fillStyle = css(pal.body, 0.9);
      poly(ctx, [[cx - 0.2 * u, cy + 0.3 * u], [cx + 0.2 * u, cy + 0.3 * u], [cx, cy + 1.1 * u]]); ctx.fill();
      glow(ctx, cx, cy - 0.1 * u, 0.55 * u, pal.body, 0.8);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy - 0.1 * u, 0.48 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy - 0.15 * u, 0.22 * u); ctx.fill();
    },
  },
  // Turret return blast: an eight-spike starburst.
  turret_blast: {
    sx: 1.9, sy: 1.9, pal: { core: [1.0, 0.98, 0.9], body: [1.0, 0.6, 0.1], accent: [1.0, 0.82, 0.35], deep: [0.88, 0.32, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const long = i % 2 === 0 ? 0.98 : 0.7;
        const bx = cx + Math.cos(a) * 0.3 * u, by = cy + Math.sin(a) * 0.3 * u;
        const tx = cx + Math.cos(a) * long * u, ty = cy + Math.sin(a) * long * u;
        const px = Math.cos(a + Math.PI / 2) * 0.11 * u, py = Math.sin(a + Math.PI / 2) * 0.11 * u;
        ctx.fillStyle = css(pal.accent);
        poly(ctx, [[bx + px, by + py], [tx, ty], [bx - px, by - py]]); ctx.fill();
      }
      glow(ctx, cx, cy, 0.5 * u, pal.body, 0.9);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy, 0.34 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.17 * u); ctx.fill();
    },
  },
  // Solar Bomb fuse sparks: a small orb in a big soft halo.
  solar_fuse: {
    sx: 1.6, sy: 1.6, pal: { core: [1.0, 0.98, 0.9], body: [1.0, 0.78, 0.3], accent: [1.0, 0.9, 0.55], deep: [0.9, 0.55, 0.08] },
    paint: (ctx, cx, cy, u, pal) => {
      glow(ctx, cx, cy, 0.98 * u, pal.body, 0.65);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy, 0.3 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.15 * u); ctx.fill();
      ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.06 * u;
      for (const [dx, dy] of [[0, -0.85], [0, 0.85], [-0.85, 0], [0.85, 0]] as Array<[number, number]>) {
        ctx.beginPath(); ctx.moveTo(cx + dx * 0.55 * u, cy + dy * 0.55 * u); ctx.lineTo(cx + dx * u, cy + dy * u); ctx.stroke();
      }
    },
  },
  // Phoenix Inferno beam segments: a long bright streak.
  inferno_beam: {
    sx: 0.85, sy: 2.8, pal: { core: [1.0, 1.0, 0.95], body: [1.0, 0.55, 0.08], accent: [1.0, 0.8, 0.35], deep: [0.88, 0.3, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      const grad = ctx.createLinearGradient(0, cy - 1.4 * u, 0, cy + 1.4 * u);
      grad.addColorStop(0, css(pal.body, 0.25));
      grad.addColorStop(0.5, css(pal.body, 0.95));
      grad.addColorStop(1, css(pal.body, 0.25));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(cx, cy, 0.42 * u, 1.38 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(pal.accent, 0.9);
      ctx.beginPath(); ctx.ellipse(cx, cy, 0.22 * u, 1.3 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(pal.core);
      ctx.beginPath(); ctx.ellipse(cx, cy, 0.09 * u, 1.22 * u, 0, 0, Math.PI * 2); ctx.fill();
    },
  },
  // Supernova telegraph embers: a mote with an upward flicker.
  supernova_ember: {
    sx: 1.4, sy: 1.7, pal: { core: [1.0, 0.97, 0.85], body: [1.0, 0.55, 0.1], accent: [1.0, 0.78, 0.3], deep: [0.88, 0.3, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      ctx.fillStyle = css(pal.body, 0.9);
      poly(ctx, [[cx - 0.14 * u, cy - 0.1 * u], [cx + 0.14 * u, cy - 0.1 * u], [cx, cy - 0.95 * u]]); ctx.fill();
      glow(ctx, cx, cy + 0.15 * u, 0.6 * u, pal.body, 0.8);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy + 0.15 * u, 0.42 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy + 0.12 * u, 0.2 * u); ctx.fill();
    },
  },
  // Divine Wrath columns: a tall gold-white pillar shard.
  wrath_column: {
    sx: 1.0, sy: 2.5, pal: { core: [1.0, 1.0, 0.96], body: [1.0, 0.82, 0.35], accent: [1.0, 0.92, 0.6], deep: [0.9, 0.6, 0.1] },
    paint: (ctx, cx, cy, u, pal) => {
      glow(ctx, cx, cy, 0.9 * u, pal.body, 0.5);
      ctx.fillStyle = css(pal.body, 0.92);
      poly(ctx, [[cx, cy - 1.4 * u], [cx + 0.3 * u, cy - 0.5 * u], [cx + 0.22 * u, cy + 0.8 * u], [cx, cy + 1.4 * u], [cx - 0.22 * u, cy + 0.8 * u], [cx - 0.3 * u, cy - 0.5 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.core);
      poly(ctx, [[cx, cy - 1.25 * u], [cx + 0.11 * u, cy - 0.4 * u], [cx + 0.08 * u, cy + 0.8 * u], [cx, cy + 1.25 * u], [cx - 0.08 * u, cy + 0.8 * u], [cx - 0.11 * u, cy - 0.4 * u]]); ctx.fill();
    },
  },
  // Phoenix Singularity swirl: a violet orb with spiral arms.
  singularity_swirl: {
    sx: 1.6, sy: 1.6, pal: { core: [0.95, 0.9, 1.0], body: [0.55, 0.3, 0.9], accent: [0.8, 0.6, 1.0], deep: [0.25, 0.1, 0.5] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let k = 0; k < 3; k++) {
        const a0 = (k / 3) * Math.PI * 2;
        ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.16 * u; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a0) * 0.3 * u, cy + Math.sin(a0) * 0.3 * u, 0.55 * u, a0, a0 + 2.2);
        ctx.stroke();
      }
      glow(ctx, cx, cy, 0.45 * u, pal.accent, 0.8);
      ctx.fillStyle = css(pal.deep);
      circ(ctx, cx, cy, 0.3 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.11 * u); ctx.fill();
    },
  },
  // Rebirth volcanic fire: a ragged deep ember.
  rebirth_fire: {
    sx: 1.5, sy: 1.5, pal: { core: [1.0, 0.9, 0.6], body: [0.9, 0.3, 0.04], accent: [1.0, 0.55, 0.12], deep: [0.55, 0.1, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        const tx = cx + Math.cos(a) * 0.92 * u, ty = cy + Math.sin(a) * 0.92 * u;
        const bx = cx + Math.cos(a + 0.45) * 0.45 * u, by = cy + Math.sin(a + 0.45) * 0.45 * u;
        const b2x = cx + Math.cos(a - 0.45) * 0.45 * u, b2y = cy + Math.sin(a - 0.45) * 0.45 * u;
        ctx.fillStyle = css(pal.body);
        poly(ctx, [[bx, by], [tx, ty], [b2x, b2y]]); ctx.fill();
      }
      glow(ctx, cx, cy, 0.55 * u, pal.accent, 0.85);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy, 0.48 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.22 * u); ctx.fill();
    },
  },
  // Flame Tornado: a painted flame spiral (the mesh spins it).
  flame_tornado: {
    sx: 1.05, sy: 1.05, pal: { core: [1.0, 0.9, 0.55], body: [0.95, 0.45, 0.08], accent: [1.0, 0.75, 0.25], deep: [0.85, 0.3, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let arm = 0; arm < 3; arm++) {
        ctx.strokeStyle = css(arm === 0 ? pal.accent : pal.body); ctx.lineWidth = 0.2 * u; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const f = i / 24;
          const a = arm * (Math.PI * 2 / 3) + f * 4.6;
          const r = 0.12 + f * 0.82;
          const x = cx + Math.cos(a) * r * u, y = cy + Math.sin(a) * r * u;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      glow(ctx, cx, cy, 0.35 * u, pal.core, 0.8);
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.13 * u); ctx.fill();
    },
  },
  // Solar Bomb: a corona orb.
  solar_bomb: {
    sx: 1.7, sy: 1.7, pal: { core: [1.0, 0.98, 0.92], body: [1.0, 0.75, 0.15], accent: [1.0, 0.88, 0.45], deep: [0.9, 0.45, 0.02] },
    paint: (ctx, cx, cy, u, pal) => {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const long = i % 2 === 0 ? 0.99 : 0.82;
        const bx = cx + Math.cos(a) * 0.62 * u, by = cy + Math.sin(a) * 0.62 * u;
        const tx = cx + Math.cos(a) * long * u, ty = cy + Math.sin(a) * long * u;
        const px = Math.cos(a + Math.PI / 2) * 0.07 * u, py = Math.sin(a + Math.PI / 2) * 0.07 * u;
        ctx.fillStyle = css(pal.accent);
        poly(ctx, [[bx + px, by + py], [tx, ty], [bx - px, by - py]]); ctx.fill();
      }
      glow(ctx, cx, cy, 0.75 * u, pal.body, 0.85);
      ctx.fillStyle = css(pal.body);
      circ(ctx, cx, cy, 0.6 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      circ(ctx, cx, cy, 0.32 * u); ctx.fill();
    },
  },
  // Aura: a flame-ticked ring (cyan for the player family).
  aura: {
    sx: 1.05, sy: 1.05, pal: { core: [0.85, 0.98, 1.0], body: [0.024, 0.714, 0.831], accent: [0.5, 0.9, 0.98], deep: [0.02, 0.4, 0.55] },
    paint: (ctx, cx, cy, u, pal) => {
      ctx.strokeStyle = css(pal.body); ctx.lineWidth = 0.16 * u;
      circ(ctx, cx, cy, 0.78 * u); ctx.stroke();
      ctx.strokeStyle = css(pal.accent, 0.8); ctx.lineWidth = 0.06 * u;
      circ(ctx, cx, cy, 0.78 * u); ctx.stroke();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const bx = cx + Math.cos(a) * 0.86 * u, by = cy + Math.sin(a) * 0.86 * u;
        const tx = cx + Math.cos(a) * 1.0 * u, ty = cy + Math.sin(a) * 1.0 * u;
        const px = Math.cos(a + Math.PI / 2) * 0.06 * u, py = Math.sin(a + Math.PI / 2) * 0.06 * u;
        ctx.fillStyle = css(pal.body);
        poly(ctx, [[bx + px, by + py], [tx, ty], [bx - px, by - py]]); ctx.fill();
      }
      glow(ctx, cx, cy, 0.5 * u, pal.body, 0.3);
    },
  },
  // Phoenix Turret egg: a cracked phoenix egg.
  egg: {
    sx: 1.15, sy: 1.3, pal: { core: [1.0, 0.8, 0.4], body: [0.96, 0.87, 0.7], accent: [1.0, 0.6, 0.15], deep: [0.7, 0.55, 0.35] },
    paint: (ctx, cx, cy, u, pal) => {
      glow(ctx, cx, cy, 0.85 * u, pal.accent, 0.45);
      ctx.fillStyle = css(pal.body);
      ctx.beginPath(); ctx.ellipse(cx, cy, 0.68 * u, 0.85 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css(pal.deep, 0.5);
      ctx.beginPath(); ctx.ellipse(cx, cy + 0.45 * u, 0.62 * u, 0.38 * u, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.07 * u;
      ctx.beginPath(); ctx.moveTo(cx - 0.3 * u, cy - 0.5 * u); ctx.lineTo(cx - 0.05 * u, cy - 0.2 * u); ctx.lineTo(cx - 0.25 * u, cy + 0.05 * u); ctx.lineTo(cx + 0.02 * u, cy + 0.35 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 0.35 * u, cy - 0.35 * u); ctx.lineTo(cx + 0.15 * u, cy - 0.05 * u); ctx.lineTo(cx + 0.3 * u, cy + 0.25 * u); ctx.stroke();
      glow(ctx, cx, cy, 0.3 * u, pal.core, 0.5);
    },
  },
  // Phoenix Turret: a mini phoenix on a perch.
  turret: {
    sx: 1.2, sy: 1.2, pal: { core: [1.0, 0.95, 0.75], body: [1.0, 0.6, 0.15], accent: [1.0, 0.8, 0.35], deep: [0.35, 0.25, 0.3] },
    paint: (ctx, cx, cy, u, pal) => {
      // Perch base.
      ctx.fillStyle = css(pal.deep);
      poly(ctx, [[cx - 0.7 * u, cy + 0.95 * u], [cx + 0.7 * u, cy + 0.95 * u], [cx + 0.45 * u, cy + 0.55 * u], [cx - 0.45 * u, cy + 0.55 * u]]); ctx.fill();
      // Wings.
      for (const s of [-1, 1]) {
        ctx.fillStyle = css(pal.body);
        poly(ctx, [[cx + s * 0.1 * u, cy - 0.1 * u], [cx + s * 0.85 * u, cy - 0.55 * u], [cx + s * 0.7 * u, cy + 0.15 * u], [cx + s * 0.2 * u, cy + 0.2 * u]]); ctx.fill();
      }
      // Body and head.
      ctx.fillStyle = css(pal.body);
      ctx.beginPath(); ctx.ellipse(cx, cy + 0.1 * u, 0.3 * u, 0.48 * u, 0, 0, Math.PI * 2); ctx.fill();
      glow(ctx, cx, cy - 0.05 * u, 0.35 * u, pal.core, 0.65);
      ctx.fillStyle = css(pal.accent);
      circ(ctx, cx, cy - 0.52 * u, 0.19 * u); ctx.fill();
      ctx.fillStyle = css(pal.core);
      poly(ctx, [[cx - 0.04 * u, cy - 0.68 * u], [cx, cy - 0.95 * u], [cx + 0.04 * u, cy - 0.68 * u]]); ctx.fill();
      poly(ctx, [[cx + 0.15 * u, cy - 0.5 * u], [cx + 0.38 * u, cy - 0.42 * u], [cx + 0.14 * u, cy - 0.38 * u]]); ctx.fill();
      eye(ctx, cx - 0.07 * u, cy - 0.55 * u, 0.035 * u, pal.deep);
      eye(ctx, cx + 0.07 * u, cy - 0.55 * u, 0.035 * u, pal.deep);
    },
  },
};

const abilityCache = new Map<string, MobSpriteSet>();
function shiftPal(pal: MobPalette, target: Rgb, amt: number): MobPalette {
  return { core: mix(pal.core, target, amt), body: mix(pal.body, target, amt), accent: mix(pal.accent, target, amt), deep: mix(pal.deep, target, amt) };
}
export function getAbilitySpriteSet(key: string, variant: AbilityVariant): { set: MobSpriteSet; sx: number; sy: number } | null {
  const def = ABILITY_DEFS[key];
  if (!def) return null;
  const cacheKey = `${key}|${variant}`;
  const hit = abilityCache.get(cacheKey);
  if (hit) return { set: hit, sx: def.sx, sy: def.sy };
  let pal = def.pal;
  if (variant === 'hostile') pal = shiftPal(pal, [1.0, 0.22, 0.38], 0.55);
  else if (variant === 'violet') pal = shiftPal(pal, [0.85, 0.28, 0.94], 0.45);
  const W = 192, H = 192;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  def.paint(ctx, W / 2, H / 2, W / 2 * 0.94, pal, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const set: MobSpriteSet = { maps: [tex], burstPositions: new Float32Array(0), burstColors: new Float32Array(0) };
  abilityCache.set(cacheKey, set);
  return { set, sx: def.sx, sy: def.sy };
}

// Which drawn look a body gets, from its type and casting move.
// Returns null for bodies that keep the points rendering.
export function abilitySpriteKey(type: string, moveId?: string): string | null {
  if (type === 'dart') return 'fire_dart';
  if (type === 'spark') return 'spark_storm';
  if (type === 'lance') return 'fire_lance';
  if (type === 'nova') return 'phoenix_nova';
  if (type === 'flame_tornado') return 'flame_tornado';
  if (type === 'solar_bomb') return 'solar_bomb';
  if (type === 'aura') return 'aura';
  if (type === 'egg') return 'egg';
  if (type === 'turret') return 'turret';
  if (type === 'projectile_player') {
    if (moveId === 'burst') return 'burst';
    if (moveId === 'phoenix_talon') return 'phoenix_talon';
    if (moveId === 'inferno_wave') return 'inferno_wave';
    return null; // plain auto-fire: the A6 bolt
  }
  if (type === 'fire') {
    if (moveId === 'fire_breath') return 'fire_breath';
    if (moveId === 'turret_shot') return 'turret_shot';
    if (moveId === 'turret_blast') return 'turret_blast';
    if (moveId === 'solar_fuse') return 'solar_fuse';
    if (moveId === 'inferno_beam') return 'inferno_beam';
    if (moveId === 'supernova_ember') return 'supernova_ember';
    if (moveId === 'wrath_column') return 'wrath_column';
    if (moveId === 'singularity_swirl') return 'singularity_swirl';
    if (moveId === 'rebirth_fire') return 'rebirth_fire';
    return null;
  }
  return null;
}

// ------------------------------------------------------------------
// Pickup sprites (Fix Round 2, A12): every dropped item gets a
// drawn body in the same style, in its shipped identity color, so
// it reads instantly for what it is: gold coin, pink heart, violet
// gem crystal, sky XP orb, cyan spark cell, violet-white
// overcharge orb, wooden crate. Values and drop logic unchanged.
// ------------------------------------------------------------------
const PICKUP_PAINTERS: Record<string, Painter> = {
  coin(ctx, cx, cy, u, pal) {
    ctx.fillStyle = css(pal.deep);
    circ(ctx, cx, cy, 0.92 * u); ctx.fill();
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy, 0.82 * u); ctx.fill();
    ctx.strokeStyle = css(pal.deep); ctx.lineWidth = 0.07 * u;
    circ(ctx, cx, cy, 0.58 * u); ctx.stroke();
    ctx.fillStyle = css(pal.accent);
    poly(ctx, [[cx, cy - 0.34 * u], [cx + 0.1 * u, cy - 0.1 * u], [cx + 0.34 * u, cy - 0.08 * u], [cx + 0.16 * u, cy + 0.06 * u], [cx + 0.22 * u, cy + 0.32 * u], [cx, cy + 0.18 * u], [cx - 0.22 * u, cy + 0.32 * u], [cx - 0.16 * u, cy + 0.06 * u], [cx - 0.34 * u, cy - 0.08 * u], [cx - 0.1 * u, cy - 0.1 * u]]); ctx.fill();
  },
  heart(ctx, cx, cy, u, pal) {
    ctx.fillStyle = css(pal.body);
    ctx.beginPath();
    ctx.moveTo(cx, cy + 0.85 * u);
    ctx.bezierCurveTo(cx - 1.05 * u, cy + 0.1 * u, cx - 0.72 * u, cy - 0.85 * u, cx - 0.28 * u, cy - 0.85 * u);
    ctx.bezierCurveTo(cx - 0.08 * u, cy - 0.85 * u, cx, cy - 0.62 * u, cx, cy - 0.45 * u);
    ctx.bezierCurveTo(cx, cy - 0.62 * u, cx + 0.08 * u, cy - 0.85 * u, cx + 0.28 * u, cy - 0.85 * u);
    ctx.bezierCurveTo(cx + 0.72 * u, cy - 0.85 * u, cx + 1.05 * u, cy + 0.1 * u, cx, cy + 0.85 * u);
    ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.75);
    ctx.beginPath(); ctx.ellipse(cx - 0.32 * u, cy - 0.42 * u, 0.2 * u, 0.13 * u, -0.6, 0, Math.PI * 2); ctx.fill();
  },
  gem(ctx, cx, cy, u, pal) {
    ctx.fillStyle = css(pal.deep);
    poly(ctx, [[cx - 0.55 * u, cy - 0.55 * u], [cx + 0.55 * u, cy - 0.55 * u], [cx + 0.85 * u, cy - 0.05 * u], [cx, cy + 0.95 * u], [cx - 0.85 * u, cy - 0.05 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.body);
    poly(ctx, [[cx - 0.48 * u, cy - 0.5 * u], [cx + 0.48 * u, cy - 0.5 * u], [cx + 0.72 * u, cy - 0.05 * u], [cx, cy + 0.8 * u], [cx - 0.72 * u, cy - 0.05 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.85);
    poly(ctx, [[cx - 0.48 * u, cy - 0.5 * u], [cx + 0.48 * u, cy - 0.5 * u], [cx + 0.3 * u, cy - 0.05 * u], [cx - 0.3 * u, cy - 0.05 * u]]); ctx.fill();
    ctx.strokeStyle = css(pal.core, 0.8); ctx.lineWidth = 0.045 * u;
    ctx.beginPath(); ctx.moveTo(cx - 0.3 * u, cy - 0.05 * u); ctx.lineTo(cx, cy + 0.8 * u); ctx.moveTo(cx + 0.3 * u, cy - 0.05 * u); ctx.lineTo(cx, cy + 0.8 * u); ctx.stroke();
    glow(ctx, cx, cy - 0.1 * u, 0.4 * u, pal.core, 0.5);
  },
  xp_orb(ctx, cx, cy, u, pal) {
    glow(ctx, cx, cy, 0.95 * u, pal.body, 0.55);
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy, 0.72 * u); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.8);
    circ(ctx, cx, cy, 0.5 * u); ctx.fill();
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy, 0.26 * u); ctx.fill();
    ctx.strokeStyle = css(pal.core, 0.9); ctx.lineWidth = 0.06 * u;
    ctx.beginPath(); ctx.moveTo(cx, cy - 0.95 * u); ctx.lineTo(cx, cy - 0.68 * u); ctx.moveTo(cx, cy + 0.68 * u); ctx.lineTo(cx, cy + 0.95 * u); ctx.moveTo(cx - 0.95 * u, cy); ctx.lineTo(cx - 0.68 * u, cy); ctx.moveTo(cx + 0.68 * u, cy); ctx.lineTo(cx + 0.95 * u, cy); ctx.stroke();
  },
  spark_cell(ctx, cx, cy, u, pal) {
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); (ctx as any).roundRect(cx - 0.55 * u, cy - 0.7 * u, 1.1 * u, 1.55 * u, 0.18 * u); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); (ctx as any).roundRect(cx - 0.45 * u, cy - 0.6 * u, 0.9 * u, 1.35 * u, 0.14 * u); ctx.fill();
    ctx.fillStyle = css(pal.deep);
    ctx.fillRect(cx - 0.22 * u, cy - 0.92 * u, 0.44 * u, 0.24 * u);
    // Lightning bolt charge mark.
    ctx.fillStyle = css(pal.core);
    poly(ctx, [[cx + 0.14 * u, cy - 0.42 * u], [cx - 0.24 * u, cy + 0.22 * u], [cx - 0.02 * u, cy + 0.22 * u], [cx - 0.14 * u, cy + 0.62 * u], [cx + 0.26 * u, cy - 0.05 * u], [cx + 0.03 * u, cy - 0.05 * u]]); ctx.fill();
  },
  overcharge(ctx, cx, cy, u, pal) {
    glow(ctx, cx, cy, 0.95 * u, pal.body, 0.5);
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy, 0.78 * u); ctx.fill();
    ctx.fillStyle = css(pal.deep, 0.65);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.3 * u, 0.72 * u, 0.45 * u, 0, 0, Math.PI); ctx.fill();
    // Bright equatorial band (the shipped identity mark).
    ctx.fillStyle = css(pal.core);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.78 * u, 0.17 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.7);
    circ(ctx, cx - 0.25 * u, cy - 0.35 * u, 0.12 * u); ctx.fill();
  },
  crate(ctx, cx, cy, u, pal) {
    ctx.fillStyle = css(pal.deep);
    ctx.fillRect(cx - 0.88 * u, cy - 0.88 * u, 1.76 * u, 1.76 * u);
    ctx.fillStyle = css(pal.body);
    ctx.fillRect(cx - 0.78 * u, cy - 0.78 * u, 1.56 * u, 1.56 * u);
    ctx.strokeStyle = css(pal.deep); ctx.lineWidth = 0.09 * u;
    ctx.strokeRect(cx - 0.78 * u, cy - 0.78 * u, 1.56 * u, 1.56 * u);
    ctx.beginPath(); ctx.moveTo(cx - 0.78 * u, cy - 0.78 * u); ctx.lineTo(cx + 0.78 * u, cy + 0.78 * u); ctx.moveTo(cx + 0.78 * u, cy - 0.78 * u); ctx.lineTo(cx - 0.78 * u, cy + 0.78 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.78 * u, cy); ctx.lineTo(cx + 0.78 * u, cy); ctx.stroke();
    ctx.fillStyle = css(pal.accent);
    for (const [dx, dy] of [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]] as Array<[number, number]>) {
      circ(ctx, cx + dx * u, cy + dy * u, 0.07 * u); ctx.fill();
    }
  },
};
const PICKUP_PALETTES: Record<string, MobPalette> = {
  coin: { core: [1.0, 0.95, 0.6], body: [0.98, 0.8, 0.082], accent: [1.0, 0.88, 0.35], deep: [0.72, 0.53, 0.04] },
  heart: { core: [1.0, 0.85, 0.92], body: [0.925, 0.282, 0.6], accent: [1.0, 0.65, 0.82], deep: [0.62, 0.15, 0.38] },
  gem: { core: [0.95, 0.88, 1.0], body: [0.753, 0.518, 0.988], accent: [0.85, 0.68, 1.0], deep: [0.45, 0.25, 0.72] },
  xp_orb: { core: [0.95, 1.0, 1.0], body: [0.22, 0.741, 0.973], accent: [0.55, 0.88, 1.0], deep: [0.1, 0.45, 0.7] },
  spark_cell: { core: [0.95, 1.0, 1.0], body: [0.30, 0.90, 1.0], accent: [0.65, 0.97, 1.0], deep: [0.08, 0.5, 0.65] },
  overcharge: { core: [0.98, 0.95, 1.0], body: [0.62, 0.38, 0.98], accent: [0.85, 0.68, 1.0], deep: [0.36, 0.2, 0.62] },
  crate: { core: [0.9, 0.75, 0.5], body: [0.55, 0.36, 0.18], accent: [0.75, 0.6, 0.35], deep: [0.32, 0.19, 0.08] },
};
const pickupCache = new Map<string, MobSpriteSet>();
export function getPickupSpriteSet(type: string): MobSpriteSet {
  const hit = pickupCache.get(type);
  if (hit) return hit;
  const pal = PICKUP_PALETTES[type] ?? PICKUP_PALETTES['coin'];
  const painter = PICKUP_PAINTERS[type] ?? PICKUP_PAINTERS['coin'];
  const W = 160, H = 160;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  painter(ctx, W / 2, H / 2, W / 2 * 0.92, pal, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const set: MobSpriteSet = { maps: [tex], burstPositions: new Float32Array(0), burstColors: new Float32Array(0) };
  pickupCache.set(type, set);
  return set;
}
export const PICKUP_SPRITE_TYPES = new Set(['coin', 'heart', 'gem', 'xp_orb', 'spark_cell', 'overcharge', 'crate']);

export const MOB_SPRITE_TYPES = new Set([
  'slime', 'bat', 'golem', 'imp', 'wisp', 'pod', 'mite', 'sentry_shard',
  'seedmother', 'rift_mine', 'shieldback', 'pyre_moth', 'phantom', 'wraith',
  'chanter', 'serpent', 'serpent_segment', 'darter', 'boss', 'boss_shadow',
]);
