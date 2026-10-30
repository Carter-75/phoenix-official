import * as Matter from 'matter-js';
import { RIVAL_PATTERNS, PatternData, HIT_GAP_SEC, hazardContains, hazardAngle } from './boss-patterns';

// Battle mode mini boss rig: the realm's rival casts its telegraphed
// signature (RIVAL_PATTERNS) on its own clock. Cadence tightens with
// the realm (9 s in Realm 1 down to 5.4 s in Realm 10) and once more
// below 40 percent rival health. Hazards hurt the player at most once
// per HIT_GAP_SEC; volleys go through the shared capped boss
// projectile path, so the density cap still guarantees a dodge lane.
export interface RivalSigHost {
  enemies: Matter.Body[];
  playerBody: Matter.Body;
  logicalUnit: number;
  takeDamage(amount: number): void;
  fireBossProjectile(x: number, y: number, angle: number, speedPerStep: number, damage?: number, radius?: number): boolean;
}

export class RivalSignature {
  private t = 0;
  private nextAt = 6;
  private cast = 0;
  private data: PatternData | null = null;

  constructor(private host: RivalSigHost) {}

  reset() { this.t = 0; this.nextAt = 6; this.cast = 0; this.data = null; }

  tick(rival: Matter.Body, worldIndex: number, deltaSec: number) {
    this.t += deltaSec;
    const t = this.t;
    const rd = rival.plugin?.['data'];
    const hpFrac = rd?.maxHealth ? rd.health / rd.maxHealth : 1;
    const pp = this.host.playerBody.position, bp = rival.position;
    if (!this.data && t >= this.nextAt) {
      const w = Math.max(0, Math.min(9, worldIndex | 0));
      this.data = (RIVAL_PATTERNS[w] || RIVAL_PATTERNS[0])({
        t, bx: bp.x, by: bp.y, px: pp.x, py: pp.y, LU: this.host.logicalUnit,
        W: window.innerWidth, H: window.innerHeight,
        phase: hpFrac < 0.4 ? 2 : 1, enraged: hpFrac < 0.4, cast: this.cast++,
      });
      for (const v of this.data.volleys) this.data.endAt = Math.max(this.data.endAt, v.at + 0.1);
    }
    const d = this.data;
    if (!d) return;
    for (const h of d.hazards) {
      if (h.followBoss) { h.x = bp.x; h.y = bp.y; }
      if (t < h.liveAt || t > h.until || t - h.lastHit < HIT_GAP_SEC) continue;
      if (hazardContains(h, t, pp.x, pp.y)) { h.lastHit = t; this.host.takeDamage(8); }
    }
    for (const v of d.volleys) {
      if (v.done || t < v.at) continue;
      v.done = true;
      const aim = Math.atan2(pp.y - bp.y, pp.x - bp.x);
      if (v.kind === 'aimed') {
        for (let i = 0; i < v.n; i++) this.host.fireBossProjectile(bp.x, bp.y, v.n === 1 ? aim : aim + (i / (v.n - 1) - 0.5) * v.spread * (v.n - 1), v.speed, 8, v.radius);
      } else {
        for (let k = 0; k < v.n; k++) {
          const a = v.offset + (k / v.n) * Math.PI * 2;
          let ga = a - aim; while (ga > Math.PI) ga -= Math.PI * 2; while (ga < -Math.PI) ga += Math.PI * 2;
          if (v.gapHalf > 0 && Math.abs(ga) < v.gapHalf) continue;
          this.host.fireBossProjectile(bp.x, bp.y, a, v.speed, 8, v.radius);
        }
      }
    }
    if (t >= d.endAt) {
      this.data = null;
      const w = Math.max(0, Math.min(9, worldIndex | 0));
      this.nextAt = t + (9 - 0.4 * w) * (hpFrac < 0.4 ? 0.8 : 1);
    }
  }

  // Telegraph and live-hazard visuals through the boss hazard renderer types.
  publish(rivalId: string, entities: any[]) {
    const d = this.data;
    if (!d) return;
    const t = this.t;
    d.hazards.forEach((h, i) => {
      if (t < h.teleAt || t > h.until) return;
      const charge = t >= h.liveAt ? 1 : Math.min(1, Math.max(0, (t - h.teleAt) / Math.max(0.01, h.liveAt - h.teleAt)));
      const ang = hazardAngle(h, t);
      const key = rivalId + ':rsig' + this.cast + '_' + i;
      if (h.kind === 'circle' || h.kind === 'band') entities.push({ id: key, x: h.x, y: h.y, type: 'boss_ring', size: h.r, attackCharge: charge });
      else if (h.kind === 'column') entities.push({ id: key, x: h.x, y: window.innerHeight / 2, type: 'boss_column', size: window.innerHeight / 2, attackCharge: charge });
      else if (h.kind === 'line') { const half = h.r / 2; entities.push({ id: key, x: h.x + Math.cos(ang) * half, y: h.y + Math.sin(ang) * half, type: 'boss_line', size: Math.max(1, half), attackCharge: charge, facing: ang }); }
      else if (h.kind === 'cone') entities.push({ id: key, x: h.x, y: h.y, type: 'boss_cone', size: h.r, attackCharge: charge, facing: ang });
      else if (h.kind === 'arc') entities.push({ id: key, x: h.x, y: h.y, type: 'boss_arc', size: h.r, attackCharge: charge, facing: ang });
    });
  }
}
