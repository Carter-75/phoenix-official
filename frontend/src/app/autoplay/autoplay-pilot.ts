// Threat-aware flight brain for the AI Autoplay tester. Pure: it
// scores candidate positions against predicted projectile paths,
// enemy bodies, walls, pickups, and a preferred fighting distance,
// then names the best spot and any emergency verb (dash, roll).
export interface Pt { x: number; y: number; }
export interface Threat extends Pt { vx: number; vy: number; r: number; dmg: number; }
export interface Foe extends Pt { r: number; boss: boolean; hp: number; }
export interface Snapshot {
  p: Pt; v: Pt; w: number; h: number; birdR: number;
  threats: Threat[]; foes: Foe[]; pickups: Pt[];
  stamina: number; dashCost: number; rollCost: number;
  telegraph: boolean; hpFrac: number;
}
export interface Decision {
  target: Pt; danger: number; dash: Pt | null; roll: boolean; brake: boolean;
  aim: Foe | null; safeForHold: boolean; timeToHit: number;
}

const HORIZON_S = 0.9;

/** Earliest time (s) inside the horizon a threat passes within (r + birdR + margin) of point q. */
export function timeToHit(q: Pt, th: Threat, birdR: number, margin = 10): number {
  const rx = th.x - q.x, ry = th.y - q.y;
  const rr = th.r + birdR + margin;
  const a = th.vx * th.vx + th.vy * th.vy;
  if (rx * rx + ry * ry <= rr * rr) return 0;
  if (a < 1e-6) return Infinity;
  const b = 2 * (rx * th.vx + ry * th.vy);
  const c = rx * rx + ry * ry - rr * rr;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= HORIZON_S ? t : Infinity;
}

export function dangerAt(q: Pt, s: Snapshot): number {
  let d = 0;
  for (const th of s.threats) {
    const t = timeToHit(q, th, s.birdR);
    if (t !== Infinity) d += (1.5 - t) * 10 * Math.max(0.5, th.dmg / 10);
    else {
      const dist = Math.hypot(th.x - q.x, th.y - q.y);
      if (dist < 140) d += (140 - dist) / 140;
    }
  }
  for (const f of s.foes) {
    const dist = Math.hypot(f.x - q.x, f.y - q.y) - f.r - s.birdR;
    const keep = f.boss ? 90 : 40;
    if (dist < keep) d += (keep - dist) / keep * (f.boss ? 14 : 6);
  }
  const m = 0.07 * Math.min(s.w, s.h);
  const edge = Math.min(q.x, s.w - q.x, q.y, s.h - q.y);
  if (edge < m) d += (m - edge) / m * 4;
  return d;
}

export function decide(s: Snapshot, rng: () => number = Math.random): Decision {
  // Current danger and the soonest impact on the bird.
  let tth = Infinity;
  for (const th of s.threats) tth = Math.min(tth, timeToHit(s.p, th, s.birdR, 4));

  // Preferred fighting spot: below the boss, mid-range from the nearest foe.
  const boss = s.foes.find(f => f.boss) || null;
  let aim: Foe | null = boss;
  if (!aim && s.foes.length) {
    aim = s.foes.reduce((a, b) => Math.hypot(a.x - s.p.x, a.y - s.p.y) <= Math.hypot(b.x - s.p.x, b.y - s.p.y) ? a : b);
  }
  const ideal: Pt = boss
    ? { x: boss.x, y: Math.min(s.h * 0.82, boss.y + Math.max(220, s.h * 0.38)) }
    : aim ? { x: aim.x, y: Math.min(s.h * 0.85, aim.y + s.h * 0.28) } : { x: s.w / 2, y: s.h * 0.66 };

  const cands: Pt[] = [s.p];
  const radii = [50, 110, 190, 300];
  for (const r of radii) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    cands.push({ x: Math.max(4, Math.min(s.w - 4, s.p.x + Math.cos(a) * r)), y: Math.max(4, Math.min(s.h - 4, s.p.y + Math.sin(a) * r)) });
  }
  let best = s.p, bestScore = Infinity, bestDanger = 0;
  for (const c of cands) {
    const danger = dangerAt(c, s);
    const travel = Math.hypot(c.x - s.p.x, c.y - s.p.y) / Math.max(s.w, s.h);
    const toIdeal = Math.hypot(c.x - ideal.x, c.y - ideal.y) / Math.max(s.w, s.h);
    let pick = 0;
    for (const p of s.pickups) {
      const dd = Math.hypot(c.x - p.x, c.y - p.y);
      if (dd < 220) pick += (220 - dd) / 220;
    }
    const score = danger * (s.telegraph ? 1.6 : 1) + travel * 0.6 + toIdeal * 1.4 - Math.min(2, pick) * 0.5 + rng() * 0.05;
    if (score < bestScore) { bestScore = score; best = c; bestDanger = danger; }
  }

  let dash: Pt | null = null, roll = false;
  if (tth < 0.3) {
    if (s.stamina >= s.dashCost && Math.hypot(best.x - s.p.x, best.y - s.p.y) > 30) {
      dash = { x: best.x - s.p.x, y: best.y - s.p.y };
    } else if (s.stamina >= s.rollCost && tth < 0.18) {
      roll = true;
    }
  }
  const speed = Math.hypot(s.v.x, s.v.y);
  const brake = !dash && speed > 900 && Math.hypot(best.x - s.p.x, best.y - s.p.y) < 40;
  const safeForHold = tth === Infinity && dangerAt(s.p, s) < 0.4 && !s.telegraph;
  return { target: best, danger: bestDanger, dash, roll, brake, aim, safeForHold, timeToHit: tth };
}
