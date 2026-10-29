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
  // Gloomwing: dark crimson mass, purple-edged wings, red eyes.
  bat: { core: [1.0, 0.16, 0.1], body: [0.36, 0.07, 0.14], accent: [0.55, 0.2, 0.72] },
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
// Inferno Guardian, Shadow Lord, Crystal Titan, Storm Wyvern,
// Void Reaper, Phoenix King, Ice Empress, Dragon Emperor, Chaos
// Demon, Eternal Phoenix).
const BOSS_BASE: Array<{ core: Rgb; body: Rgb; accent: Rgb }> = [
  { core: [1.0, 0.55, 0.15], body: [0.45, 0.16, 0.08], accent: [1.0, 0.8, 0.35] },
  { core: [0.7, 0.4, 1.0], body: [0.16, 0.1, 0.28], accent: [0.85, 0.6, 1.0] },
  { core: [0.85, 0.9, 1.0], body: [0.35, 0.22, 0.6], accent: [0.7, 0.5, 1.0] },
  { core: [0.95, 0.9, 0.4], body: [0.2, 0.3, 0.5], accent: [0.6, 0.85, 1.0] },
  { core: [0.75, 0.3, 0.95], body: [0.1, 0.06, 0.18], accent: [0.9, 0.5, 1.0] },
  { core: [1.0, 0.65, 0.2], body: [0.5, 0.14, 0.1], accent: [1.0, 0.85, 0.4] },
  { core: [0.85, 0.95, 1.0], body: [0.4, 0.55, 0.75], accent: [0.95, 1.0, 1.0] },
  { core: [1.0, 0.6, 0.2], body: [0.42, 0.12, 0.1], accent: [0.95, 0.75, 0.35] },
  { core: [1.0, 0.3, 0.35], body: [0.3, 0.08, 0.25], accent: [0.65, 0.3, 1.0] },
  { core: [1.0, 0.9, 0.55], body: [0.85, 0.5, 0.15], accent: [1.0, 0.95, 0.7] },
];
// Chaos Demon forms (World 9): the rig flows between three forms;
// each gets its own tint of the same drawn body.
const CHAOS_FORMS: Array<{ core: Rgb; body: Rgb; accent: Rgb }> = [
  BOSS_BASE[8],
  { core: [0.65, 0.35, 1.0], body: [0.2, 0.1, 0.4], accent: [1.0, 0.4, 0.4] },
  { core: [0.5, 0.95, 0.8], body: [0.08, 0.25, 0.22], accent: [1.0, 0.9, 0.5] },
];

export function mobPalette(type: string, worldIndex: number, form = 0): MobPalette {
  let base = BASE[type];
  if (type === 'boss') base = worldIndex === 8 ? CHAOS_FORMS[form] ?? BOSS_BASE[8] : BOSS_BASE[worldIndex] ?? BOSS_BASE[0];
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
      ctx.fillStyle = css(pal.body);
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
  // 0 Inferno Guardian: horned magma guardian.
  (ctx, cx, cy, u, pal) => {
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.3 * u, cy - 0.6 * u], [cx + s * 0.95 * u, cy - 1.0 * u], [cx + s * 0.75 * u, cy - 0.35 * u], [cx + s * 0.42 * u, cy - 0.3 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.deep);
      poly(ctx, [[cx + s * 0.55 * u, cy + 0.1 * u], [cx + s * 1.0 * u, cy + 0.5 * u], [cx + s * 0.6 * u, cy + 0.75 * u], [cx + s * 0.35 * u, cy + 0.4 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.62 * u, 0.75 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.5 * u, 0.62 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css(pal.core, 0.9); ctx.lineWidth = 0.05 * u;
    ctx.beginPath(); ctx.moveTo(cx - 0.3 * u, cy - 0.5 * u); ctx.lineTo(cx - 0.05 * u, cy - 0.1 * u); ctx.lineTo(cx - 0.25 * u, cy + 0.35 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 0.32 * u, cy - 0.4 * u); ctx.lineTo(cx + 0.1 * u, cy + 0.05 * u); ctx.lineTo(cx + 0.28 * u, cy + 0.45 * u); ctx.stroke();
    glow(ctx, cx, cy + 0.05 * u, 0.42 * u, pal.core, 0.85);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy + 0.05 * u, 0.18 * u); ctx.fill();
    eye(ctx, cx - 0.22 * u, cy - 0.35 * u, 0.06 * u, pal.accent);
    eye(ctx, cx + 0.22 * u, cy - 0.35 * u, 0.06 * u, pal.accent);
  },
  // 1 Shadow Lord: hooded wraith with a scythe arc.
  (ctx, cx, cy, u, pal) => {
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.09 * u;
    ctx.beginPath(); ctx.arc(cx + 0.25 * u, cy - 0.35 * u, 0.72 * u, -0.4, 1.9); ctx.stroke();
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 0.95 * u);
    ctx.bezierCurveTo(cx + 0.6 * u, cy - 0.85 * u, cx + 0.66 * u, cy - 0.1 * u, cx + 0.5 * u, cy + 0.5 * u);
    ctx.lineTo(cx + 0.62 * u, cy + 0.95 * u); ctx.lineTo(cx + 0.2 * u, cy + 0.6 * u); ctx.lineTo(cx, cy + 1.0 * u);
    ctx.lineTo(cx - 0.2 * u, cy + 0.6 * u); ctx.lineTo(cx - 0.62 * u, cy + 0.95 * u); ctx.lineTo(cx - 0.5 * u, cy + 0.5 * u);
    ctx.bezierCurveTo(cx - 0.66 * u, cy - 0.1 * u, cx - 0.6 * u, cy - 0.85 * u, cx, cy - 0.95 * u);
    ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.35 * u, 0.36 * u, 0.42 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css([0.02, 0.01, 0.05]);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.32 * u, 0.24 * u, 0.3 * u, 0, 0, Math.PI * 2); ctx.fill();
    eye(ctx, cx - 0.1 * u, cy - 0.35 * u, 0.05 * u, pal.core);
    eye(ctx, cx + 0.1 * u, cy - 0.35 * u, 0.05 * u, pal.core);
    glow(ctx, cx, cy + 0.35 * u, 0.3 * u, pal.core, 0.5);
  },
  // 2 Crystal Titan: shard-cluster golem.
  (ctx, cx, cy, u, pal) => {
    const shard = (x: number, y: number, w: number, h: number, c: Rgb) => {
      ctx.fillStyle = css(c);
      poly(ctx, [[x, y - h], [x + w, y], [x, y + h * 0.6], [x - w, y]]); ctx.fill();
    };
    shard(cx - 0.62 * u, cy - 0.45 * u, 0.26 * u, 0.55 * u, pal.body);
    shard(cx + 0.62 * u, cy - 0.45 * u, 0.26 * u, 0.55 * u, pal.body);
    shard(cx - 0.5 * u, cy + 0.45 * u, 0.22 * u, 0.4 * u, pal.deep);
    shard(cx + 0.5 * u, cy + 0.45 * u, 0.22 * u, 0.4 * u, pal.deep);
    shard(cx, cy - 0.1 * u, 0.45 * u, 0.85 * u, pal.body);
    shard(cx, cy + 0.35 * u, 0.34 * u, 0.5 * u, pal.deep);
    ctx.fillStyle = css(pal.accent, 0.55);
    poly(ctx, [[cx, cy - 0.95 * u], [cx + 0.16 * u, cy - 0.3 * u], [cx, cy + 0.05 * u], [cx - 0.16 * u, cy - 0.3 * u]]); ctx.fill();
    eye(ctx, cx, cy - 0.28 * u, 0.09 * u, pal.core);
  },
  // 3 Storm Wyvern: horned dragon with wings.
  (ctx, cx, cy, u, pal) => {
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.2 * u, cy - 0.3 * u], [cx + s * 1.0 * u, cy - 0.75 * u], [cx + s * 0.88 * u, cy - 0.15 * u], [cx + s * 0.6 * u, cy - 0.3 * u], [cx + s * 0.55 * u, cy + 0.15 * u], [cx + s * 0.25 * u, cy + 0.1 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.accent);
      poly(ctx, [[cx + s * 0.25 * u, cy - 0.62 * u], [cx + s * 0.5 * u, cy - 0.98 * u], [cx + s * 0.42 * u, cy - 0.5 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.05 * u, 0.42 * u, 0.68 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.35 * u, 0.3 * u, 0.38 * u, 0, 0, Math.PI * 2); ctx.fill();
    poly(ctx, [[cx - 0.12 * u, cy - 0.62 * u], [cx + 0.12 * u, cy - 0.62 * u], [cx + 0.2 * u, cy - 0.42 * u], [cx - 0.2 * u, cy - 0.42 * u]]); ctx.fill();
    eye(ctx, cx - 0.13 * u, cy - 0.42 * u, 0.05 * u, pal.core);
    eye(ctx, cx + 0.13 * u, cy - 0.42 * u, 0.05 * u, pal.core);
    ctx.strokeStyle = css(pal.core, 0.9); ctx.lineWidth = 0.04 * u;
    ctx.beginPath(); ctx.moveTo(cx + 0.55 * u, cy + 0.5 * u); ctx.lineTo(cx + 0.4 * u, cy + 0.68 * u); ctx.lineTo(cx + 0.58 * u, cy + 0.8 * u); ctx.stroke();
  },
  // 4 Void Reaper: hood, scythe, void chest.
  (ctx, cx, cy, u, pal) => {
    ctx.strokeStyle = css(pal.accent); ctx.lineWidth = 0.08 * u;
    ctx.beginPath(); ctx.moveTo(cx + 0.55 * u, cy + 0.9 * u); ctx.lineTo(cx + 0.55 * u, cy - 0.7 * u); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 0.1 * u, cy - 0.55 * u, 0.5 * u, -0.3, 1.6); ctx.stroke();
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 0.9 * u);
    ctx.bezierCurveTo(cx + 0.55 * u, cy - 0.8 * u, cx + 0.6 * u, cy, cx + 0.45 * u, cy + 0.55 * u);
    ctx.lineTo(cx + 0.55 * u, cy + 0.98 * u); ctx.lineTo(cx, cy + 0.7 * u); ctx.lineTo(cx - 0.55 * u, cy + 0.98 * u); ctx.lineTo(cx - 0.45 * u, cy + 0.55 * u);
    ctx.bezierCurveTo(cx - 0.6 * u, cy, cx - 0.55 * u, cy - 0.8 * u, cx, cy - 0.9 * u);
    ctx.fill();
    ctx.fillStyle = css([0.01, 0.0, 0.03]);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.4 * u, 0.26 * u, 0.32 * u, 0, 0, Math.PI * 2); ctx.fill();
    eye(ctx, cx - 0.1 * u, cy - 0.42 * u, 0.05 * u, pal.core);
    eye(ctx, cx + 0.1 * u, cy - 0.42 * u, 0.05 * u, pal.core);
    glow(ctx, cx, cy + 0.3 * u, 0.34 * u, pal.core, 0.75);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy + 0.3 * u, 0.11 * u); ctx.fill();
  },
  // 5 Phoenix King: crowned regal phoenix (dark against the
  // player's bright bird).
  (ctx, cx, cy, u, pal) => {
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.1 * u, cy - 0.2 * u], [cx + s * 0.98 * u, cy - 0.7 * u], [cx + s * 0.85 * u, cy - 0.1 * u], [cx + s * 0.6 * u, cy - 0.05 * u], [cx + s * 0.62 * u, cy + 0.35 * u], [cx + s * 0.2 * u, cy + 0.3 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.deep);
      poly(ctx, [[cx + s * 0.12 * u, cy + 0.35 * u], [cx + s * 0.45 * u, cy + 0.95 * u], [cx + s * 0.18 * u, cy + 0.9 * u], [cx + s * 0.05 * u, cy + 0.5 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.05 * u, 0.3 * u, 0.52 * u, 0, 0, Math.PI * 2); ctx.fill();
    glow(ctx, cx, cy, 0.36 * u, pal.core, 0.7);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy - 0.05 * u, 0.13 * u); ctx.fill();
    // Crown crest.
    ctx.fillStyle = css(pal.accent);
    poly(ctx, [[cx - 0.2 * u, cy - 0.62 * u], [cx - 0.14 * u, cy - 0.85 * u], [cx - 0.05 * u, cy - 0.68 * u], [cx, cy - 0.92 * u], [cx + 0.05 * u, cy - 0.68 * u], [cx + 0.14 * u, cy - 0.85 * u], [cx + 0.2 * u, cy - 0.62 * u]]); ctx.fill();
    eye(ctx, cx - 0.1 * u, cy - 0.45 * u, 0.04 * u, pal.accent);
    eye(ctx, cx + 0.1 * u, cy - 0.45 * u, 0.04 * u, pal.accent);
  },
  // 6 Ice Empress: shard crown over an ice gown.
  (ctx, cx, cy, u, pal) => {
    ctx.fillStyle = css(pal.body, 0.95);
    poly(ctx, [[cx - 0.16 * u, cy - 0.5 * u], [cx + 0.16 * u, cy - 0.5 * u], [cx + 0.42 * u, cy + 0.4 * u], [cx + 0.72 * u, cy + 0.95 * u], [cx + 0.3 * u, cy + 0.8 * u], [cx, cy + 1.0 * u], [cx - 0.3 * u, cy + 0.8 * u], [cx - 0.72 * u, cy + 0.95 * u], [cx - 0.42 * u, cy + 0.4 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent, 0.5);
    poly(ctx, [[cx - 0.08 * u, cy - 0.45 * u], [cx + 0.08 * u, cy - 0.45 * u], [cx + 0.2 * u, cy + 0.4 * u], [cx, cy + 0.75 * u], [cx - 0.2 * u, cy + 0.4 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent);
    for (const dx of [-0.22, 0, 0.22]) {
      const h = dx === 0 ? 0.5 : 0.34;
      poly(ctx, [[cx + dx * u - 0.07 * u, cy - 0.62 * u], [cx + dx * u, cy - (0.62 + h) * u], [cx + dx * u + 0.07 * u, cy - 0.62 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.body);
    circ(ctx, cx, cy - 0.48 * u, 0.2 * u); ctx.fill();
    eye(ctx, cx - 0.08 * u, cy - 0.5 * u, 0.04 * u, pal.core);
    eye(ctx, cx + 0.08 * u, cy - 0.5 * u, 0.04 * u, pal.core);
    glow(ctx, cx, cy + 0.1 * u, 0.3 * u, pal.core, 0.45);
  },
  // 7 Dragon Emperor: horned dragon head with a mane.
  (ctx, cx, cy, u, pal) => {
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.accent);
      poly(ctx, [[cx + s * 0.28 * u, cy - 0.55 * u], [cx + s * 0.72 * u, cy - 1.0 * u], [cx + s * 0.55 * u, cy - 0.4 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.deep);
      poly(ctx, [[cx + s * 0.3 * u, cy - 0.1 * u], [cx + s * 0.85 * u, cy + 0.35 * u], [cx + s * 0.45 * u, cy + 0.42 * u], [cx + s * 0.28 * u, cy + 0.2 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.1 * u, 0.55 * u, 0.72 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.05 * u, 0.44 * u, 0.58 * u, 0, 0, Math.PI * 2); ctx.fill();
    poly(ctx, [[cx - 0.2 * u, cy - 0.35 * u], [cx + 0.2 * u, cy - 0.35 * u], [cx + 0.3 * u, cy + 0.05 * u], [cx - 0.3 * u, cy + 0.05 * u]]); ctx.fill();
    ctx.fillStyle = css(pal.accent);
    poly(ctx, [[cx - 0.07 * u, cy + 0.02 * u], [cx, cy - 0.14 * u], [cx + 0.07 * u, cy + 0.02 * u], [cx, cy + 0.1 * u]]); ctx.fill();
    eye(ctx, cx - 0.2 * u, cy - 0.28 * u, 0.055 * u, pal.core);
    eye(ctx, cx + 0.2 * u, cy - 0.28 * u, 0.055 * u, pal.core);
    ctx.fillStyle = css(pal.core, 0.85);
    circ(ctx, cx - 0.12 * u, cy + 0.28 * u, 0.035 * u); ctx.fill();
    circ(ctx, cx + 0.12 * u, cy + 0.28 * u, 0.035 * u); ctx.fill();
  },
  // 8 Chaos Demon: bat wings, horns, jagged maw (form tints come
  // from the palette; the silhouette is shared).
  (ctx, cx, cy, u, pal) => {
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.deep);
      poly(ctx, [[cx + s * 0.2 * u, cy - 0.3 * u], [cx + s * 1.0 * u, cy - 0.85 * u], [cx + s * 0.92 * u, cy - 0.3 * u], [cx + s * 0.7 * u, cy - 0.42 * u], [cx + s * 0.68 * u, cy - 0.05 * u], [cx + s * 0.45 * u, cy - 0.18 * u], [cx + s * 0.3 * u, cy + 0.15 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.26 * u, cy - 0.6 * u], [cx + s * 0.62 * u, cy - 1.02 * u], [cx + s * 0.5 * u, cy - 0.42 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.deep);
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.05 * u, 0.5 * u, 0.66 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.4 * u, 0.54 * u, 0, 0, Math.PI * 2); ctx.fill();
    glow(ctx, cx, cy + 0.28 * u, 0.3 * u, pal.core, 0.8);
    ctx.fillStyle = css(pal.core);
    poly(ctx, [[cx - 0.2 * u, cy + 0.18 * u], [cx - 0.1 * u, cy + 0.34 * u], [cx, cy + 0.2 * u], [cx + 0.1 * u, cy + 0.36 * u], [cx + 0.2 * u, cy + 0.18 * u], [cx + 0.14 * u, cy + 0.42 * u], [cx - 0.14 * u, cy + 0.42 * u]]); ctx.fill();
    eye(ctx, cx - 0.18 * u, cy - 0.3 * u, 0.055 * u, pal.accent);
    eye(ctx, cx + 0.18 * u, cy - 0.3 * u, 0.055 * u, pal.accent);
  },
  // 9 Eternal Phoenix: radiant phoenix with a halo ring.
  (ctx, cx, cy, u, pal) => {
    ctx.strokeStyle = css(pal.accent, 0.85); ctx.lineWidth = 0.06 * u;
    circ(ctx, cx, cy - 0.15 * u, 0.82 * u); ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.fillStyle = css(pal.body);
      poly(ctx, [[cx + s * 0.08 * u, cy - 0.25 * u], [cx + s * 0.95 * u, cy - 0.8 * u], [cx + s * 0.8 * u, cy - 0.15 * u], [cx + s * 0.5 * u, cy - 0.05 * u], [cx + s * 0.55 * u, cy + 0.3 * u], [cx + s * 0.15 * u, cy + 0.25 * u]]); ctx.fill();
      ctx.fillStyle = css(pal.accent, 0.8);
      poly(ctx, [[cx + s * 0.1 * u, cy + 0.3 * u], [cx + s * 0.4 * u, cy + 0.95 * u], [cx + s * 0.16 * u, cy + 0.85 * u], [cx + s * 0.04 * u, cy + 0.45 * u]]); ctx.fill();
    }
    ctx.fillStyle = css(pal.body);
    ctx.beginPath(); ctx.ellipse(cx, cy, 0.26 * u, 0.46 * u, 0, 0, Math.PI * 2); ctx.fill();
    glow(ctx, cx, cy - 0.1 * u, 0.34 * u, pal.core, 0.85);
    ctx.fillStyle = css(pal.core);
    circ(ctx, cx, cy - 0.12 * u, 0.12 * u); ctx.fill();
    ctx.fillStyle = css(pal.accent);
    poly(ctx, [[cx - 0.05 * u, cy - 0.62 * u], [cx, cy - 0.88 * u], [cx + 0.05 * u, cy - 0.62 * u]]); ctx.fill();
    eye(ctx, cx - 0.09 * u, cy - 0.42 * u, 0.04 * u, pal.deep);
    eye(ctx, cx + 0.09 * u, cy - 0.42 * u, 0.04 * u, pal.deep);
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

// Chaos Demon form sets (World 9 boss): one set per form.
export function getBossFormSets(worldIndex: number, extentX: number, extentY: number): MobSpriteSet[] {
  if (worldIndex !== 8) return [getMobSpriteSet('boss', worldIndex, extentX, extentY, 0)];
  return [0, 1, 2].map(f => getMobSpriteSet('boss', worldIndex, extentX, extentY, f));
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

export const MOB_SPRITE_TYPES = new Set([
  'slime', 'bat', 'golem', 'imp', 'wisp', 'pod', 'mite', 'sentry_shard',
  'seedmother', 'rift_mine', 'shieldback', 'pyre_moth', 'phantom', 'wraith',
  'chanter', 'serpent', 'serpent_segment', 'darter', 'boss', 'boss_shadow',
]);
