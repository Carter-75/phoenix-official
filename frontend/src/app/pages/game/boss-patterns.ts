// Boss signature patterns (Oct 29, 2026 boss redesign). Every
// campaign boss's signature is now data: a short timeline of
// telegraphed hazards (zones, lines, columns, cones, arcs, ring
// bands), projectile volleys from the boss, and optional locked
// dashes. One shared executor ticks the timeline, applies damage,
// and publishes the renderer's telegraph entities, so the rules
// hold for every boss the same way:
// - every hazard shows its telegraph at least 0.5 s before it can
//   hurt (MIN_TELEGRAPH_SEC is enforced in the builder);
// - a hazard hits the player at most once per HIT_GAP_SEC;
// - volleys go through the capped boss projectile path, so a dodge
//   line always exists.
// Phases: each pattern reads `phase` (1 above 66 percent HP, 2 above
// 33 percent, 3 below) and `enraged`, so fights escalate as they go.

export type HazardKind = 'circle' | 'line' | 'column' | 'cone' | 'arc' | 'band';

export interface Hazard {
  kind: HazardKind;
  x: number; y: number;      // anchor (circle center, line start, cone apex)
  r: number;                 // radius, band radius, cone or line length, arc radius
  w: number;                 // half width (line, column) or band half thickness
  ang: number;               // facing for line, cone, arc
  spin: number;              // radians per second while live (sweeps)
  followBoss: boolean;       // anchor rides the boss
  teleAt: number; liveAt: number; until: number;
  lastHit: number;
}

export interface Volley {
  at: number; done: boolean;
  kind: 'aimed' | 'ring';
  n: number; speed: number; radius: number;
  spread: number;            // aimed: radians between bolts
  offset: number;            // ring: angle offset
  gapAng: number | null;     // ring: center of the safe gap (null = aim the gap at nobody)
  gapHalf: number;
  aimAtPlayer: boolean;      // ring: put the gap center on the player angle + gapAng
}

export interface Dash { teleAt: number; at: number; until: number; tx: number; ty: number; started: boolean; }

export interface PatternData {
  hazards: Hazard[];
  volleys: Volley[];
  dashes: Dash[];
  holdUntil: number;
  endAt: number;
  dashState?: 'dash' | 'idle';
  dashTx?: number; dashTy?: number;
  hold?: boolean;
  wash?: [number, number, number];
}

export const MIN_TELEGRAPH_SEC = 0.5;
export const HIT_GAP_SEC = 0.6;

export interface PatternCtx {
  t: number;                 // fight clock now
  bx: number; by: number;    // boss
  px: number; py: number;    // player
  LU: number;
  W: number; H: number;
  phase: 1 | 2 | 3;
  enraged: boolean;
  cast: number;              // how many signatures this fight has cast
}

class Builder {
  d: PatternData = { hazards: [], volleys: [], dashes: [], holdUntil: 0, endAt: 0 };
  constructor(private c: PatternCtx) {}
  private push(h: Partial<Hazard> & { kind: HazardKind; tele: number; live: number; dur: number }) {
    const teleAt = this.c.t + h.tele;
    const liveAt = Math.max(this.c.t + h.live, teleAt + MIN_TELEGRAPH_SEC);
    const hz: Hazard = {
      kind: h.kind, x: h.x ?? this.c.bx, y: h.y ?? this.c.by, r: h.r ?? 40, w: h.w ?? 20,
      ang: h.ang ?? 0, spin: h.spin ?? 0, followBoss: !!h.followBoss,
      teleAt, liveAt, until: liveAt + h.dur, lastHit: -99
    };
    this.d.hazards.push(hz);
    this.d.endAt = Math.max(this.d.endAt, hz.until);
  }
  circle(x: number, y: number, r: number, tele: number, live: number, dur = 0.5) { this.push({ kind: 'circle', x, y, r, tele, live, dur }); }
  line(x: number, y: number, ang: number, len: number, w: number, tele: number, live: number, dur = 0.35, spin = 0, followBoss = false) {
    this.push({ kind: 'line', x, y, ang, r: len, w, tele, live, dur, spin, followBoss });
  }
  column(x: number, w: number, tele: number, live: number, dur = 0.3) { this.push({ kind: 'column', x, r: this.c.H / 2, w, tele, live, dur }); }
  cone(ang: number, len: number, tele: number, live: number, dur: number, spin = 0) { this.push({ kind: 'cone', ang, r: len, tele, live, dur, spin, followBoss: true }); }
  arc(ang: number, r: number, tele: number, live: number, dur = 0.4, followBoss = false) { this.push({ kind: 'arc', ang, r, tele, live, dur, followBoss }); }
  band(x: number, y: number, r: number, w: number, tele: number, live: number, dur = 0.6) { this.push({ kind: 'band', x, y, r, w, tele, live, dur }); }
  aimed(at: number, n: number, speed: number, spread = 0.3, radius = 9) {
    this.d.volleys.push({ at: this.c.t + at, done: false, kind: 'aimed', n, speed, radius, spread, offset: 0, gapAng: null, gapHalf: 0, aimAtPlayer: true });
    this.d.endAt = Math.max(this.d.endAt, this.c.t + at + 0.2);
  }
  ring(at: number, n: number, speed: number, offset = 0, gapHalf = 0, aimGap = false, radius = 9) {
    this.d.volleys.push({ at: this.c.t + at, done: false, kind: 'ring', n, speed, radius, spread: 0, offset, gapAng: gapHalf > 0 ? 0 : null, gapHalf, aimAtPlayer: aimGap });
    this.d.endAt = Math.max(this.d.endAt, this.c.t + at + 0.2);
  }
  dash(tele: number, tx: number, ty: number, dur = 1.0) {
    const teleAt = this.c.t + tele;
    const at = teleAt + Math.max(0.7, MIN_TELEGRAPH_SEC);
    this.d.dashes.push({ teleAt, at, until: at + dur, tx, ty, started: false });
    this.d.endAt = Math.max(this.d.endAt, at + dur);
  }
  hold(sec: number) { this.d.holdUntil = Math.max(this.d.holdUntil, this.c.t + sec); }
}

const clampX = (c: PatternCtx, x: number) => Math.max(30, Math.min(c.W - 30, x));
const clampY = (c: PatternCtx, y: number) => Math.max(30, Math.min(c.H - 30, y));

// One builder per world. Difficulty climbs with the world index
// (more hazards, shorter gaps), with phase, and with enrage, while
// each pattern keeps a readable safe lane.
export const BOSS_PATTERNS: Record<number, (c: PatternCtx) => PatternData> = {
  // W1 Cinder Colossus: Magma Geysers. Three (then four, then five)
  // geysers bloom under and around the player, then a slow ember
  // ring with a wide gap rolls out of the Colossus.
  0: c => {
    const b = new Builder(c);
    const n = 2 + c.phase + (c.enraged ? 1 : 0);
    const r = 0.11 * c.LU;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + c.cast;
      const off = i === 0 ? 0 : 0.22 * c.LU;
      b.circle(clampX(c, c.px + Math.cos(a) * off), clampY(c, c.py + Math.sin(a) * off), r, i * 0.25, 1.0 + i * 0.25, 0.6);
    }
    b.ring(1.4 + n * 0.25, 10, 3.6, Math.random() * 6, 0.55, true, 11);
    return b.d;
  },
  // W2 Umbral Matriarch: Eclipse Lances. Shadow lances cross the
  // player's position in an X; later phases add a third lance and a
  // web fan from the Matriarch.
  1: c => {
    const b = new Builder(c);
    const L = Math.hypot(c.W, c.H);
    const base = Math.random() * Math.PI;
    const count = c.phase >= 2 || c.enraged ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * Math.PI;
      b.line(c.px - Math.cos(a) * L / 2, c.py - Math.sin(a) * L / 2, a, L, 0.035 * c.LU, i * 0.2, 0.9 + i * 0.2, 0.35);
    }
    b.aimed(1.6, c.phase >= 3 ? 5 : 3, 5.5, 0.3);
    return b.d;
  },
  // W3 Prism Sentinel: Refraction Beams. Three beams lock on the
  // Sentinel, telegraph, then sweep slowly; stand in the wedge
  // between beams and walk with it. Phase 3 adds a fourth beam.
  2: c => {
    const b = new Builder(c);
    const beams = c.phase >= 3 || c.enraged ? 4 : 3;
    const a0 = Math.atan2(c.py - c.by, c.px - c.bx) + Math.PI / beams;
    const spin = (c.cast % 2 === 0 ? 1 : -1) * (0.45 + 0.1 * c.phase);
    for (let i = 0; i < beams; i++) {
      b.line(c.bx, c.by, a0 + (i / beams) * Math.PI * 2, 0.75 * c.LU, 0.03 * c.LU, 0, 0.9, 2.0, spin, true);
    }
    b.hold(3.0);
    b.aimed(3.0, 5, 6, 0.28, 8);
    return b.d;
  },
  // W4 Tempest Roc: Thunder March. Lightning columns march across
  // the field in a wave with one safe gap that moves each cast.
  3: c => {
    const b = new Builder(c);
    const cols = 6;
    const gap = Math.floor(Math.random() * cols);
    const step = c.enraged ? 0.18 : 0.25;
    for (let i = 0; i < cols; i++) {
      if (i === gap) continue;
      const x = (i + 0.5) * (c.W / cols);
      b.column(x, c.W / cols * 0.32, i * step, 0.8 + i * step, 0.3);
    }
    if (c.phase >= 2) b.aimed(0.8 + cols * step, 3, 6);
    return b.d;
  },
  // W5 Grave Warden: Soul Scythe. Two scythe sweeps, one on each side
  // of the player, then (phase 2+) a ring of slow souls with a gap.
  4: c => {
    const b = new Builder(c);
    const a = Math.atan2(c.py - c.by, c.px - c.bx);
    const R = 0.52 * c.LU;
    b.arc(a - 0.55, R, 0, 0.8, 0.4, true);
    b.arc(a + 0.55, R, 0.7, 1.5, 0.4, true);
    if (c.phase >= 3 || c.enraged) b.arc(a, R, 1.4, 2.2, 0.4, true);
    if (c.phase >= 2) b.ring(2.4, 12, 3.2, 0, 0.5, true);
    b.hold(2.4);
    return b.d;
  },
  // W6 Solar Monarch: Coronation. A crown of sun pillars encircles
  // the player with one open gate, then the Monarch dashes through
  // the player's spot along a locked line.
  5: c => {
    const b = new Builder(c);
    const n = 7 + c.phase;
    const R = 0.24 * c.LU;
    const gate = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = gate + ((i + 1) / (n + 1)) * Math.PI * 2;
      b.circle(clampX(c, c.px + Math.cos(a) * R), clampY(c, c.py + Math.sin(a) * R), 0.07 * c.LU, 0, 0.9, 0.7);
    }
    const dx = c.px - c.bx, dy = c.py - c.by, dl = Math.hypot(dx, dy) || 1;
    b.dash(1.7, clampX(c, c.px + dx / dl * 0.15 * c.LU), clampY(c, c.py + dy / dl * 0.15 * c.LU), 1.0);
    if (c.phase >= 2) b.aimed(1.7, 7, 4.5, 0.25, 12);
    return b.d;
  },
  // W7 Glacial Oracle: Shatter Rings. Concentric frost bands snap
  // solid in alternating sets around the Oracle: stand in the band
  // that is dark, then move when the other set telegraphs.
  6: c => {
    const b = new Builder(c);
    const radii = [0.16, 0.30, 0.44, 0.58].map(f => f * c.LU);
    const w = 0.055 * c.LU;
    const gapStep = c.enraged ? 0.9 : 1.15;
    radii.forEach((r, i) => { if (i % 2 === 0) b.band(c.bx, c.by, r, w, 0, 0.9, 0.7); });
    radii.forEach((r, i) => { if (i % 2 === 1) b.band(c.bx, c.by, r, w, gapStep, gapStep + 0.9, 0.7); });
    if (c.phase >= 3) radii.forEach((r, i) => { if (i % 2 === 0) b.band(c.bx, c.by, r, w, gapStep * 2, gapStep * 2 + 0.9, 0.7); });
    b.hold(gapStep * 2 + 1.6);
    if (c.phase >= 2) b.aimed(gapStep * 2 + 1.0, 3, 5);
    return b.d;
  },
  // W8 Wyrm Sovereign: Twin Breath. The Sovereign holds and breathes
  // a cone that sweeps toward the player, while ember columns drop
  // on the far side so the player has to pick the lane.
  7: c => {
    const b = new Builder(c);
    const a = Math.atan2(c.py - c.by, c.px - c.bx);
    const sweepDir = Math.random() < 0.5 ? 1 : -1;
    b.cone(a - sweepDir * 0.6, 0.62 * c.LU, 0, 0.8, c.enraged ? 2.0 : 1.6, sweepDir * 0.5);
    b.hold(2.6);
    const embers = 1 + c.phase;
    for (let i = 0; i < embers; i++) {
      const x = clampX(c, c.px + (i - (embers - 1) / 2) * 0.28 * c.LU + 0.14 * c.LU * sweepDir);
      b.column(x, 0.035 * c.LU, 0.6 + i * 0.2, 1.4 + i * 0.2, 0.3);
    }
    b.aimed(2.6, 5, 6);
    return b.d;
  },
  // W9 Entropy Engine: Fractured Grid. A checkerboard of collapse
  // tiles around the player, then the inverse board, then a spiral
  // of shards. The board's color wash announces each half.
  8: c => {
    const b = new Builder(c);
    const cell = 0.17 * c.LU;
    const span = c.phase >= 2 ? 2 : 1;
    const flip = c.enraged ? 0.95 : 1.2;
    for (let gx = -span; gx <= span; gx++) for (let gy = -span; gy <= span; gy++) {
      const x = c.px + gx * cell, y = c.py + gy * cell;
      if (x < 20 || x > c.W - 20 || y < 20 || y > c.H - 20) continue;
      const even = (gx + gy + 100) % 2 === 0;
      b.circle(x, y, cell * 0.45, even ? 0 : flip, even ? 0.9 : flip + 0.9, 0.45);
    }
    const spiralAt = flip + 1.6;
    for (let k = 0; k < (c.phase >= 3 ? 4 : 3); k++) b.ring(spiralAt + k * 0.35, 8, 4.8, k * 0.35);
    b.d.wash = [0.95, 0.3, 0.45];
    return b.d;
  },
  // W10 Phoenix Ascendant: Ascension. A rotating finale that pulls
  // from every realm: crossing lances, then a gated nova ring, then
  // (phase 2+) a locked dive, (phase 3) a frost band around the
  // landing point. The tightest boss, but every piece is a pattern
  // the player has already learned.
  9: c => {
    const b = new Builder(c);
    const L = Math.hypot(c.W, c.H);
    const base = Math.random() * Math.PI;
    for (let i = 0; i < 2; i++) {
      const a = base + i * Math.PI / 2;
      b.line(c.px - Math.cos(a) * L / 2, c.py - Math.sin(a) * L / 2, a, L, 0.03 * c.LU, 0, 0.85, 0.3);
    }
    b.ring(1.3, 16, 5, Math.random() * 6, 0.45, true, 10);
    if (c.phase >= 2 || c.enraged) {
      const dx = c.px - c.bx, dy = c.py - c.by, dl = Math.hypot(dx, dy) || 1;
      const tx = clampX(c, c.px + dx / dl * 0.12 * c.LU), ty = clampY(c, c.py + dy / dl * 0.12 * c.LU);
      b.dash(1.6, tx, ty, 0.9);
      if (c.phase >= 3) b.band(tx, ty, 0.2 * c.LU, 0.05 * c.LU, 2.4, 3.3, 0.6);
    }
    return b.d;
  },
};

export function buildPattern(worldIndex: number, c: PatternCtx): PatternData {
  return (BOSS_PATTERNS[worldIndex] || BOSS_PATTERNS[0])(c);
}

function wrap(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

// Is (px, py) inside the hazard's live shape?
export function hazardContains(h: Hazard, t: number, px: number, py: number): boolean {
  const ang = h.ang + h.spin * Math.max(0, t - h.liveAt);
  const dx = px - h.x, dy = py - h.y;
  const dist = Math.hypot(dx, dy);
  switch (h.kind) {
    case 'circle': return dist <= h.r;
    case 'band': return Math.abs(dist - h.r) <= h.w;
    case 'column': return Math.abs(dx) <= h.w;
    case 'line': {
      const along = dx * Math.cos(ang) + dy * Math.sin(ang);
      const perp = Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang));
      return along >= 0 && along <= h.r && perp <= h.w;
    }
    case 'cone': return dist <= h.r && Math.abs(wrap(Math.atan2(dy, dx) - ang)) <= 0.61;
    case 'arc': return dist <= h.r * 1.05 && dist >= h.r * 0.3 && Math.abs(wrap(Math.atan2(dy, dx) - ang)) <= 0.95;
  }
}

export function hazardAngle(h: Hazard, t: number): number {
  return h.ang + h.spin * Math.max(0, t - h.liveAt);
}
