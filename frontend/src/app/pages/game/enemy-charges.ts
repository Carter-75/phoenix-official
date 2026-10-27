// Published enemy telegraph charges and contact damage: pure
// functions of the enemy's data record (and, for the Rift Mine, the
// player position). The renderer swells, whitens, and strobes enemy
// bodies off these 0 to 1 values; the collision handler reads the
// contact damage table. Moved out of game.component.ts in the code
// organization pass (Oct 27, 2026); formulas unchanged.
import * as Matter from 'matter-js';
import { EnemyData } from './game.types';

export function contactDamageFor(data: EnemyData): number {
    if (data.type === 'boss' || data.type === 'enemy_phoenix') return 50;
    if (data.type === 'mite') return 5;
    if (data.type === 'imp' && data.behaviorState === 'dash') return 15;
    return 10;
  }

  // The Imp's published telegraph charge: 0 to 1 across the 0.5 s
  // flare, held at 1 through the dash, 0 otherwise. The renderer
  // swells the body and whitens the core off this value.
export function impTelegraphCharge(data: EnemyData, now: number): number {
    if (data.behaviorState === 'telegraph') {
      return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 500));
    }
    if (data.behaviorState === 'dash') return 1;
    return 0;
  }

  // The Sentry Shard's published charge: 0 to 1 across the 0.4 s
  // core-glow window at the end of its 2.5 s fire cycle, driven by
  // the same lastAttackTime the hook fires from.
export function shardCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'anchored') return 0;
    return Math.min(1, Math.max(0, (now - (data.lastAttackTime || 0) - 2100) / 400));
  }

  // The Rift Mine's published armed flag: 1 while the player is
  // inside the trigger radius (the renderer doubles the core blink),
  // 0 otherwise. The detonation itself runs in the steering hook.
export function mineArmedCharge(body: Matter.Body, playerBody: Matter.Body, logicalUnit: number): number {
    const d = Math.hypot(playerBody.position.x - body.position.x, playerBody.position.y - body.position.y);
    return d < 0.12 * logicalUnit ? 1 : 0;
  }

  // The Pyre Moth's published fuse charge: 0 to 1 across its 0.6 s
  // fuse, 0 while chasing. The renderer strobes off this value.
export function mothFuseCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'fusing') return 0;
    return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 600));
  }

  // Stage 5 published charges, each 0 to 1 across its telegraph
  // window and 0 outside it: the Phantom's reappear shimmer (0.7 s),
  // the Wraith's lock (0.7 s), the Serpent's coil (0.5 s), and the
  // Darter's line-up (0.5 s).
export function phantomReappearCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'reappear') return 0;
    return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 700));
  }

export function wraithLockCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'lock') return 0;
    return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 700));
  }

export function serpentCoilCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'coil') return 0;
    return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 500));
  }

export function darterLineupCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'lineup') return 0;
    return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 500));
  }
