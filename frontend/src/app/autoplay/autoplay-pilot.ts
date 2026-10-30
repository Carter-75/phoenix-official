// Threat-aware flight brain for the AI Autoplay tester. Pure: it
// scores candidate positions against predicted projectile paths,
// enemy bodies, walls, pickups, and a preferred fighting distance,
// then names the best spot and any emergency verb (dash, roll).
export interface Pt { x: number; y: number; }
export interface Threat extends Pt { vx: number; vy: number; r: number; dmg: number; }
export interface Foe extends Pt { r: number; boss: boolean; hp: number; }
export type PickupKind = 'coin' | 'xp_orb' | 'heart' | 'gem' | 'spark_cell' | 'overcharge' | string;
export interface Pickup extends Pt { kind?: PickupKind; }

/**
 * How much the pilot wants a pickup. Passive stamina regen is slow, so
 * Spark Cells are the main refill: they matter most when stamina is
 * low. Hearts matter most when hurt. Overcharge is always worth a
 * detour (it refunds the next cooldown).
 */
export function pickupWeight(kind: PickupKind | undefined, staminaFrac: number, hpFrac: number): number {
  switch (kind) {
    case 'spark_cell': return 1 + 3 * (1 - Math.max(0, Math.min(1, staminaFrac)));
    case 'heart': return hpFrac >= 0.98 ? 0.2 : 1 + 3 * (1 - Math.max(0, Math.min(1, hpFrac)));
    case 'overcharge': return 2;
    case 'gem': return 1.5;
    default: return 1;
  }
}

export interface Snapshot {
  p: Pt; v: Pt; w: number; h: number; birdR: number;
  threats: Threat[]; foes: Foe[]; pickups: Pickup[];
  stamina: number; staminaMax?: number; dashCost: number; rollCost: number;
  telegraph: boolean; hpFrac: number;
  /** Set by the service: low movement while taking damage over the last 2 s. */
  stuck?: boolean;
  /** Auto-fire reach in px (attackRange x speedScale); fire needs the target in a 45 degree cone of the heading. */
  fireRange?: number;
  /** Boss telegraphed hazards and dash lanes: danger (0 safe) at q, including ones not live yet. */
  hazard?: (q: Pt) => number;
}
export interface Decision {
  target: Pt; danger: number; dash: Pt | null; roll: boolean; brake: boolean;
  aim: Foe | null; safeForHold: boolean; timeToHit: number;
  /** Why an escape verb fired: 'boxed', 'stuck', 'corner', or null. */
  escape: 'boxed' | 'stuck' | 'corner' | null;
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
    const keep = f.boss ? 150 : 40;
    if (dist < keep) d += (keep - dist) / keep * (f.boss ? 14 : 6);
  }
  if (s.hazard) d += s.hazard(q) * 6;
  d += wallPenalty(q, s) + densityAt(q, s);
  return d;
}

/** Walls and corners: a band along each edge, much worse where two bands meet. */
export function wallPenalty(q: Pt, s: Snapshot): number {
  const m = 0.12 * Math.min(s.w, s.h);
  const ex = Math.min(q.x, s.w - q.x), ey = Math.min(q.y, s.h - q.y);
  const px = ex < m ? (m - ex) / m : 0, py = ey < m ? (m - ey) / m : 0;
  return (px + py) * 5 + px * py * 12;
}

/** Threat density: how crowded the 170 px around q is with foes and shots. */
export function densityAt(q: Pt, s: Snapshot): number {
  let n = 0;
  for (const f of s.foes) { const dd = Math.hypot(f.x - q.x, f.y - q.y); if (dd < 170) n += (170 - dd) / 170 * (f.boss ? 1.5 : 1); }
  for (const th of s.threats) { const dd = Math.hypot(th.x - q.x, th.y - q.y); if (dd < 170) n += (170 - dd) / 170 * 0.5; }
  return n > 1 ? (n - 1) * 1.2 : 0;
}

/** Danger along the straight path from a to b (sampled), so routes through a cluster lose. */
export function pathDanger(a: Pt, b: Pt, s: Snapshot): number {
  let d = 0;
  for (const t of [0.33, 0.66]) {
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (const f of s.foes) { const dd = Math.hypot(f.x - q.x, f.y - q.y) - f.r - s.birdR; if (dd < 30) d += (30 - dd) / 30 * 3; }
    for (const th of s.threats) { const dd = Math.hypot(th.x - q.x, th.y - q.y) - th.r - s.birdR; if (dd < 20) d += (20 - dd) / 20; }
  }
  return d;
}

/** Boxed in: most short-range escape spots around p are dangerous. */
export function boxedIn(s: Snapshot): boolean {
  let bad = 0; const N = 12;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const q = { x: s.p.x + Math.cos(a) * 110, y: s.p.y + Math.sin(a) * 110 };
    if (q.x < 4 || q.y < 4 || q.x > s.w - 4 || q.y > s.h - 4 || dangerAt(q, s) > 3) bad++;
  }
  return bad >= N * 0.7;
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
  // Boss: sit straight below it inside auto-fire reach (a parked bird faces up, so it fires at the boss).
  const reach = s.fireRange ?? 400;
  const ideal: Pt = boss
    ? { x: boss.x, y: Math.min(s.h * 0.86, boss.y + Math.max(boss.r + 160, reach * 0.7)) }
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
    const stamFrac = s.stamina / Math.max(1, s.staminaMax ?? 100);
    for (const p of s.pickups) {
      const dd = Math.hypot(c.x - p.x, c.y - p.y);
      if (dd < 220) pick += ((220 - dd) / 220) * pickupWeight(p.kind, stamFrac, s.hpFrac);
    }
    // Against a boss, closing on the ideal spot matters more than travel cost.
    const idealW = 1.4;
    const score = danger * (s.telegraph ? 1.6 : 1) + pathDanger(s.p, c, s) + travel * 0.6 + toIdeal * idealW - Math.min(4, pick) * 0.5 + rng() * 0.05;
    if (score < bestScore) { bestScore = score; best = c; bestDanger = danger; }
  }

  let dash: Pt | null = null, roll = false;
  let escape: Decision['escape'] = null;
  const boxed = boxedIn(s);
  const corner = wallPenalty(s.p, s) > 6;
  if ((boxed || s.stuck || corner) && tth >= 0.3) {
    escape = s.stuck ? 'stuck' : boxed ? 'boxed' : 'corner';
    // Break out toward the far, open side: the best far candidate.
    let far = best, fs = Infinity;
    for (const c of cands) {
      if (Math.hypot(c.x - s.p.x, c.y - s.p.y) < 180) continue;
      const sc = dangerAt(c, s) + pathDanger(s.p, c, s) * 0.5;
      if (sc < fs) { fs = sc; far = c; }
    }
    best = far;
    if (s.stamina >= s.dashCost) dash = { x: far.x - s.p.x, y: far.y - s.p.y };
    else if (s.stamina >= s.rollCost && !corner) roll = true;
  }
  if (!dash && !roll && tth < 0.3) {
    if (s.stamina >= s.dashCost && Math.hypot(best.x - s.p.x, best.y - s.p.y) > 30) {
      dash = { x: best.x - s.p.x, y: best.y - s.p.y };
    } else if (s.stamina >= s.rollCost && tth < 0.18) {
      roll = true;
    }
  }
  const speed = Math.hypot(s.v.x, s.v.y);
  const brake = !dash && speed > 900 && Math.hypot(best.x - s.p.x, best.y - s.p.y) < 40;
  const safeForHold = tth === Infinity && dangerAt(s.p, s) < 0.4 && !s.telegraph;
  return { target: best, danger: bestDanger, dash, roll, brake, aim, safeForHold, timeToHit: tth, escape };
}
