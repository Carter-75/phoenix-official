// Boss fight execution: the campaign boss's signature
// attacks, enrage and shield rig ticking, minion summons, and the
// state the renderer publishes each frame. The rig's data and rules
// live in data/boss-rig.ts; this class is the executor that runs
// them against the game component's state, reached through the host
// interface. Moved out of game.component.ts in the code organization
// pass (Oct 27, 2026); logic unchanged.
import { WritableSignal } from '@angular/core';
import * as Matter from 'matter-js';
import { GameStateService } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import { BattleAiService } from '../../services/battle-ai.service';
import { EntitySpawnerService } from '../../services/entity-spawner.service';
import { PhysicsEntity, WorldStats } from '../../models/game.models';
import {
  bossDefFor, BossFightState, BOSS_ENRAGE_WARNING_SEC, BOSS_PROJECTILE_CAP,
  SHIELD_HEAL_PHASE_CAP_FRAC, SHIELD_HEAL_FIGHT_CAP_FRAC, SHIELD_MIN_HP_FRAC,
  SHIELD_MIN_SPACING_SEC, SHIELD_PHASE_MAX_SEC, SHIELD_REGEN_FRAC_PER_SEC,
  SHIELD_TELEGRAPH_SEC, SHIELD_HP_FRACTIONS,
  SIGNATURE_INTERVAL_SEC, SIGNATURE_INTERVAL_ENRAGED_SEC, bossEvent
} from '../../data/boss-rig';
import { EnemyData } from './game.types';
import { buildPattern, hazardContains, hazardAngle, PatternData, HIT_GAP_SEC } from './boss-patterns';

export interface BossFightHost {
  annihilationInterval: any;
  annihilationModeActive: WritableSignal<boolean>;
  audioService: AudioService;
  battleAi: BattleAiService;
  battleDropGrace: WritableSignal<boolean>;
  battleDropReady: WritableSignal<boolean>;
  bossEnraged: WritableSignal<boolean>;
  bossHealth: WritableSignal<number>;
  bossShieldHealth: WritableSignal<number>;
  bossShieldMaxHealth: WritableSignal<number>;
  enemies: Matter.Body[];
  engine: Matter.Engine;
  gameEnded: WritableSignal<boolean>;
  gameState: GameStateService;
  getSpawnerContext(): any;
  inBossDefeatSequence: WritableSignal<boolean>;
  isDead: WritableSignal<boolean>;
  logicalUnit: number;
  playerBody: Matter.Body;
  bossPhaseDriven(): boolean;
  scaledSpeed(pxPerStepAtRef: number): number;
  spawner: EntitySpawnerService;
  speedScale: number;
  spliceOut<T>(arr: T[], keep: (item: T) => boolean): void;
  spliceRemove<T>(arr: T[], item: T): void;
  takeDamage(amount: number, source?: 'boss_contact'): void;
  triggerImpactEffect(x: number, y: number, isBoss: boolean): void;
}

export class BossFight {
  constructor(private host: BossFightHost) {}

calculateBossGemDrop(realmIndex: number): number {
      // Boss drop should be roughly the equivalent of $5 worth of gems (approx 50 gems)
      // but with a random range, and scaling slightly per realm.
      let min = 40;
      let max = 60;
      
      if (realmIndex > 0) {
          min += realmIndex * 20;
          max += realmIndex * 30;
      }
      return Math.floor(Math.random() * (max - min + 1)) + min;
  }



  // -----------------------------------------------------------------
  // Stage 9 boss rig (data in data/boss-rig.ts): one state machine
  // for every campaign boss. Enrage (rolled per fight inside the
  // world's window, with a 5 s charge-up warning), shield and regen
  // phases (hard caps from Carter's addendum), the signature attack
  // schedule, and the hazard ticks. All timing runs on the fight
  // clock (accumulated physics steps), never on wall time, so
  // pauses and frame rate cannot move a telegraph or an enrage.
  // -----------------------------------------------------------------

bossProjectileCount(): number {
      let n = 0;
      for (const b of Matter.Composite.allBodies(this.host.engine.world)) {
          if (b.label === 'projectile' && (b.plugin['data'] as EnemyData)?.bossPattern) n++;
      }
      return n;
  }

  // One boss-pattern projectile, aimed from (x, y) along angle.
  // The density cap is a fairness invariant (addendum rule 3): when
  // the cap is reached the shot simply does not spawn, so a dodge
  // line always exists.
fireBossProjectile(x: number, y: number, angle: number, speedPerStep: number, damage: number = 10, radius: number = 8): boolean {
      // A7: no off-screen attacks. Boss patterns originate at the
      // boss (or its in-arena copies); a source outside the arena
      // plus a small entry margin does not fire.
      if (x < -60 || x > window.innerWidth + 60 || y < -60 || y > window.innerHeight + 60) return false;
      if (this.bossProjectileCount() >= BOSS_PROJECTILE_CAP) return false;
      const proj = Matter.Bodies.circle(x, y, radius, {
          label: 'projectile', isSensor: true,
          plugin: { data: { id: Math.random().toString(), type: 'projectile_enemy', health: 1, maxHealth: 1, owner: 'enemy', burstDamage: damage, bossPattern: true } as EnemyData }
      });
      Matter.Body.setVelocity(proj, { x: Math.cos(angle) * this.host.scaledSpeed(speedPerStep), y: Math.sin(angle) * this.host.scaledSpeed(speedPerStep) });
      Matter.Composite.add(this.host.engine.world, proj);
      setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj); }, 2600);
      return true;
  }

fireBossFan(x: number, y: number, bolts: number, speedPerStep: number, radius: number = 8) {
      const base = Math.atan2(this.host.playerBody.position.y - y, this.host.playerBody.position.x - x);
      const spread = 0.32;
      for (let i = 0; i < bolts; i++) {
          const a = bolts === 1 ? base : base + (i / (bolts - 1) - 0.5) * spread * (bolts - 1);
          this.fireBossProjectile(x, y, a, speedPerStep, 10, radius);
      }
  }

  // Is a boss telegraph showing right now? Drives the screen shake
  // suppression (systems spec Section 4.3, deferred to the boss
  // stages by S1): while a telegraph is up, the field stays still
  // so the dodge read is never blurred.
bossTelegraphShowing(): boolean {
      const boss = this.host.enemies.find(e => e.plugin['data']?.type === 'boss');
      const st = (boss?.plugin['data'] as EnemyData)?.bossState;
      if (!st) return false;
      if (st.shieldTelegraphStartSec >= 0) return true;
      return !!st.sig && st.sig.phase === 'telegraph';
  }

tickBossRig(boss: Matter.Body, data: EnemyData, st: BossFightState, deltaSec: number) {
      if (this.host.gameEnded() || this.host.isDead() || this.host.inBossDefeatSequence()) return;
      const def = bossDefFor(st.worldIndex);
      st.fightSec += deltaSec;
      const t = st.fightSec;

      // Enrage: warning first (glow and cracks build over the final
      // seconds, with a rising audio cue), then the trigger.
      if (!this.host.bossPhaseDriven() && !st.enraged && !st.enrageWarned && t >= st.enrageAtSec - BOSS_ENRAGE_WARNING_SEC) {
          st.enrageWarned = true;
          bossEvent(st, 'enrage_warning', `enrage at ${st.enrageAtSec.toFixed(1)}s`);
          this.host.audioService.playSFX('boss');
      }
      if (!this.host.bossPhaseDriven() && !st.enraged && t >= st.enrageAtSec) {
          st.enraged = true;
          this.host.bossEnraged.set(true);
          bossEvent(st, 'enraged');
          this.host.audioService.playSFX('boss');
      }

      // Shield telegraph completing: the shield snaps on.
      if (st.shieldTelegraphStartSec >= 0 && t >= st.shieldTelegraphStartSec + SHIELD_TELEGRAPH_SEC) {
          st.shieldTelegraphStartSec = -1;
          st.shieldUp = true;
          st.shieldHp = st.shieldMaxHp;
          st.shieldUpAtSec = t;
          st.healedThisPhase = 0;
          st.phasesUsed++;
          this.host.bossShieldHealth.set(st.shieldHp);
          this.host.bossShieldMaxHealth.set(st.shieldMaxHp);
          bossEvent(st, 'shield_up', `shield hp ${st.shieldMaxHp}`);
      }

      // Shield offers at the scripted HP thresholds. The offer is
      // consumed even when a guard refuses it (final-sliver
      // lockout, spacing, heal cap), so thresholds never queue.
      if (!st.shieldUp && st.shieldTelegraphStartSec < 0 && st.nextThresholdIdx < SHIELD_HP_FRACTIONS.length) {
          const hpFrac = data.health / Math.max(1, data.maxHealth);
          if (hpFrac <= SHIELD_HP_FRACTIONS[st.nextThresholdIdx]) {
              st.nextThresholdIdx++;
              const fightCap = SHIELD_HEAL_FIGHT_CAP_FRAC * data.maxHealth;
              if (hpFrac > SHIELD_MIN_HP_FRAC
                  && st.healedThisFight < fightCap - 0.001
                  && t - st.lastShieldStartSec >= SHIELD_MIN_SPACING_SEC) {
                  st.shieldTelegraphStartSec = t;
                  st.lastShieldStartSec = t;
                  bossEvent(st, 'shield_telegraph', `at ${(hpFrac * 100).toFixed(1)} percent hp`);
              } else {
                  bossEvent(st, 'shield_refused', `hp ${(hpFrac * 100).toFixed(1)} percent, healed ${st.healedThisFight.toFixed(0)}, spacing ${(t - st.lastShieldStartSec).toFixed(1)}s`);
              }
          }
      }

      // Regen behind the shield, clamped by both heal caps.
      if (st.shieldUp) {
          const phaseCap = SHIELD_HEAL_PHASE_CAP_FRAC * data.maxHealth;
          const fightCap = SHIELD_HEAL_FIGHT_CAP_FRAC * data.maxHealth;
          const room = Math.min(phaseCap - st.healedThisPhase, fightCap - st.healedThisFight, data.maxHealth - data.health);
          if (room > 0) {
              const heal = Math.min(room, SHIELD_REGEN_FRAC_PER_SEC * data.maxHealth * deltaSec);
              data.health += heal;
              st.healedThisPhase += heal;
              st.healedThisFight += heal;
              this.host.bossHealth.set(Math.max(0, Math.ceil(data.health)));
          }
          if (t - st.shieldUpAtSec >= SHIELD_PHASE_MAX_SEC) {
              st.shieldUp = false;
              st.shieldHp = 0;
              this.host.bossShieldHealth.set(0);
              bossEvent(st, 'shield_down', 'phase timeout');
          }
      }



      // Signature schedule.
      if (!st.sig && !this.host.annihilationModeActive() && t >= st.nextSignatureAtSec && !this.bossAshen(st)) {
          this.startSignature(boss, data, st);
      }
      if (st.sig) this.tickSignature(boss, data, st);
      void def;
  }

  // The Phoenix King's ash window (Stage 10): while it runs, the
  // boss cannot act and cannot be hit.
bossAshen(st: BossFightState): boolean {
      return st.ashUntilSec !== undefined && st.fightSec < st.ashUntilSec;
  }

  // The Crystal Titan's old shard ring is gone with the redesign;
  // no current boss blocks player fire. Kept as a hook so the
  // damage path's call stays valid.
bossShardRingUp(st: BossFightState): boolean {
      void st;
      return false;
  }

  // Health phase for the pattern builders: 1 above 66 percent HP,
  // 2 above 33 percent, 3 below.
bossPhase(data: EnemyData): 1 | 2 | 3 {
      const f = data.health / Math.max(1, data.maxHealth);
      return f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  }

startSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) {
      const def = bossDefFor(st.worldIndex);
      const pp = this.host.playerBody.position;
      const phase = this.bossPhase(data);
      if (phase !== (st.lastPhase || 1)) {
          bossEvent(st, 'phase', `phase ${phase}`);
          st.lastPhase = phase;
      }
      st.castCount = (st.castCount || 0) + 1;
      const pd: PatternData = buildPattern(st.worldIndex, {
          t: st.fightSec, bx: boss.position.x, by: boss.position.y, px: pp.x, py: pp.y,
          LU: this.host.logicalUnit, W: window.innerWidth, H: window.innerHeight,
          phase, enraged: st.enraged, cast: st.castCount
      });
      let first = pd.endAt;
      for (const h of pd.hazards) first = Math.min(first, h.liveAt);
      for (const v of pd.volleys) first = Math.min(first, v.at);
      for (const d of pd.dashes) first = Math.min(first, d.at);
      const telegraphSec = Math.max(0.5, first - st.fightSec);
      st.sig = { id: def.signature, phase: 'telegraph', startSec: st.fightSec, telegraphSec, fireSec: st.fightSec + telegraphSec, data: pd };
      bossEvent(st, 'signature_telegraph', def.signature);
      this.host.audioService.playSFX('boss');
  }

endSignature(st: BossFightState) {
      bossEvent(st, 'signature_end', st.sig?.id);
      st.sig = null;
      // Cadence tightens with phase: the fight escalates as it goes.
      const phaseMul = st.lastPhase === 3 ? 0.75 : st.lastPhase === 2 ? 0.88 : 1;
      const interval = ((st.enraged ? SIGNATURE_INTERVAL_ENRAGED_SEC : SIGNATURE_INTERVAL_SEC) + Math.random() * 2) * phaseMul;
      st.nextSignatureAtSec = st.fightSec + interval;
  }

tickSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) {
      void data;
      const sig = st.sig!;
      const t = st.fightSec;
      const d = sig.data as PatternData;
      const pp = this.host.playerBody.position;
      const bp = boss.position;
      if (sig.phase === 'telegraph' && t >= sig.fireSec) {
          sig.phase = 'active';
          bossEvent(st, 'signature_fire', sig.id);
      }
      // Hazards: anchors that ride the boss follow it; live hazards
      // hurt at most once per HIT_GAP_SEC.
      for (const h of d.hazards) {
          if (h.followBoss) { h.x = bp.x; h.y = bp.y; }
          if (t < h.liveAt || t > h.until) continue;
          if (t - h.lastHit < HIT_GAP_SEC) continue;
          if (hazardContains(h, t, pp.x, pp.y)) {
              h.lastHit = t;
              bossEvent(st, 'hazard_hit', h.kind);
              this.host.takeDamage(10);
          }
      }
      // Volleys from the boss.
      for (const v of d.volleys) {
          if (v.done || t < v.at) continue;
          v.done = true;
          if (v.kind === 'aimed') {
              const base = Math.atan2(pp.y - bp.y, pp.x - bp.x);
              for (let i = 0; i < v.n; i++) {
                  const a = v.n === 1 ? base : base + (i / (v.n - 1) - 0.5) * v.spread * (v.n - 1);
                  this.fireBossProjectile(bp.x, bp.y, a, v.speed, 10, v.radius);
              }
          } else {
              const gapC = v.aimAtPlayer ? Math.atan2(pp.y - bp.y, pp.x - bp.x) : (v.gapAng ?? 0);
              for (let k = 0; k < v.n; k++) {
                  const a = v.offset + (k / v.n) * Math.PI * 2;
                  if (v.gapHalf > 0) {
                      let ga = a - gapC;
                      while (ga > Math.PI) ga -= Math.PI * 2;
                      while (ga < -Math.PI) ga += Math.PI * 2;
                      if (Math.abs(ga) < v.gapHalf) continue;
                  }
                  this.fireBossProjectile(bp.x, bp.y, a, v.speed, 10, v.radius);
              }
          }
      }
      // Locked dashes (the movement hook reads dashState).
      d.dashState = 'idle';
      for (const ds of d.dashes) {
          if (t >= ds.at && t <= ds.until) {
              const dist = Math.hypot(bp.x - ds.tx, bp.y - ds.ty);
              if (dist < 0.08 * this.host.logicalUnit) { ds.until = t; continue; }
              if (!ds.started) { ds.started = true; bossEvent(st, 'signature_dash', sig.id); }
              d.dashState = 'dash';
              d.dashTx = ds.tx; d.dashTy = ds.ty;
          }
      }
      d.hold = t < d.holdUntil && d.dashState !== 'dash';
      if (t >= d.endAt) this.endSignature(st);
  }

  // Renderer entities for the live signature: every hazard from its
  // telegraph start, brightening to full while it can hurt, and the
  // locked line of each upcoming dash. Unique ids per hazard, since
  // the renderer bakes each telegraph mesh at its published size.
publishSignatureEntities(id: string, st: BossFightState, entities: any[]) {
      const sig = st.sig;
      if (!sig) return;
      const d = sig.data as PatternData;
      const t = st.fightSec;
      const scale = this.host.speedScale;
      void scale;
      d.hazards.forEach((h, i) => {
          if (t < h.teleAt || t > h.until) return;
          const charge = t >= h.liveAt ? 1 : Math.min(1, Math.max(0, (t - h.teleAt) / Math.max(0.01, h.liveAt - h.teleAt)));
          const ang = hazardAngle(h, t);
          const key = id + ':hz' + st.castCount + '_' + i;
          if (h.kind === 'circle') {
              entities.push({ id: key, x: h.x, y: h.y, type: 'boss_ring', size: h.r, attackCharge: charge });
              if (charge >= 1) entities.push({ id: key + 'p', x: h.x, y: h.y, type: 'boss_pillar', size: h.r * 0.7, attackCharge: 1 });
          } else if (h.kind === 'band') {
              entities.push({ id: key, x: h.x, y: h.y, type: 'boss_ring', size: h.r, attackCharge: charge });
          } else if (h.kind === 'column') {
              entities.push({ id: key, x: h.x, y: window.innerHeight / 2, type: 'boss_column', size: window.innerHeight / 2, attackCharge: charge });
          } else if (h.kind === 'line') {
              const half = h.r / 2;
              entities.push({ id: key, x: h.x + Math.cos(ang) * half, y: h.y + Math.sin(ang) * half, type: 'boss_line', size: Math.max(1, half), attackCharge: charge, facing: ang });
          } else if (h.kind === 'cone') {
              entities.push({ id: key, x: h.x, y: h.y, type: 'boss_cone', size: h.r, attackCharge: charge, facing: ang });
          } else if (h.kind === 'arc') {
              entities.push({ id: key, x: h.x, y: h.y, type: 'boss_arc', size: h.r, attackCharge: charge, facing: ang });
          }
      });
      const boss = this.host.enemies.find(e => e.plugin['data']?.type === 'boss');
      d.dashes.forEach((ds, i) => {
          if (!boss || t < ds.teleAt || t >= ds.at) return;
          const dx = ds.tx - boss.position.x, dy = ds.ty - boss.position.y;
          const charge = Math.min(1, (t - ds.teleAt) / Math.max(0.01, ds.at - ds.teleAt));
          entities.push({
              id: id + ':dash' + st.castCount + '_' + i, x: boss.position.x + dx / 2, y: boss.position.y + dy / 2,
              type: 'boss_line', size: Math.max(1, Math.hypot(dx, dy) / 2), attackCharge: 0.4 + 0.6 * charge, facing: Math.atan2(dy, dx)
          });
      });
  }

  // Boss minion summons (visual spec Section 4 sheets): each world
  // calls its own variant type. Bats use the legacy boss-minion law;
  // roster types spawn through the production factory at world HP,
  // with the sheet's alive caps for the heavy types.
summonBossMinions(boss: Matter.Body) {
      const worldIndex = this.host.gameState.selectedWorldIndex();
      const def = bossDefFor(worldIndex);
      const ctx = this.host.getSpawnerContext();
      const bossData = boss.plugin['data'] as EnemyData;
      // The King's ash window holds the arena: no summons (Stage 10).
      if (bossData?.bossState && this.bossAshen(bossData.bossState)) return;
      // World 10 finale rage (Stage 10): below 25 percent HP the
      // Eternal Phoenix stops summoning entirely.
      if (bossData?.bossState?.finaleRage) return;
      // World 10 (Stage 10 sheet): summons alternate between
      // Gloomwing variants and a Mite pack.
      if (worldIndex === 9 && bossData) {
          if (bossData.summonAlt) {
              bossData.summonAlt = false;
              for (let i = 0; i < 3; i++) {
                  const a = Math.random() * Math.PI * 2;
                  this.host.spawner.spawnEnemyOfType(ctx, 'mite',
                      boss.position.x + Math.cos(a) * 120 * this.host.speedScale,
                      boss.position.y + Math.sin(a) * 120 * this.host.speedScale, worldIndex);
              }
              return;
          }
          bossData.summonAlt = true;
      }
      if (def.minionType === 'bat') {
          const bats = this.host.enemies.filter(e => e.plugin['data']?.type === 'bat').length;
          for (let i = 0; i < def.minionsPerSummon; i++) {
              if (def.minionCap > 0 && bats + i >= def.minionCap) break;
              this.host.spawner.spawnMinion(boss.position.x, boss.position.y, ctx);
          }
          return;
      }
      const alive = this.host.enemies.filter(e => e.plugin['data']?.type === def.minionType).length;
      if (def.minionCap > 0 && alive >= def.minionCap) return;
      for (let i = 0; i < def.minionsPerSummon; i++) {
          if (def.minionCap > 0 && alive + i >= def.minionCap) break;
          const a = Math.random() * Math.PI * 2;
          this.host.spawner.spawnEnemyOfType(ctx, def.minionType,
              boss.position.x + Math.cos(a) * 120 * this.host.speedScale,
              boss.position.y + Math.sin(a) * 120 * this.host.speedScale, worldIndex);
      }
  }

  // Renderer charge for the boss (visual spec addendum: enrage
  // visuals): one 0 to 1 value the particle background reads as
  // telegraph progress, enrage warning build, shield gather, or
  // the enraged core pulse, whichever is live.
bossPublishCharge(data: EnemyData): number {
      const st = data.bossState;
      if (!st) return 0;
      if (st.sig && st.sig.phase === 'telegraph') {
          return Math.min(1, Math.max(0, (st.fightSec - st.sig.startSec) / st.sig.telegraphSec));
      }
      if (st.shieldTelegraphStartSec >= 0) {
          return Math.min(1, Math.max(0, (st.fightSec - st.shieldTelegraphStartSec) / SHIELD_TELEGRAPH_SEC));
      }
      if (st.enrageWarned && !st.enraged) {
          return Math.min(1, Math.max(0, (st.fightSec - (st.enrageAtSec - BOSS_ENRAGE_WARNING_SEC)) / BOSS_ENRAGE_WARNING_SEC));
      }
      if (st.enraged) return 0.65 + 0.25 * Math.sin(st.fightSec * 6);
      return 0;
  }

bossPublishState(data: EnemyData): string | undefined {
      const st = data.bossState;
      if (!st) return undefined;
      if (this.bossAshen(st)) return 'ashen';
      if (st.sig && st.sig.data?.kind === 'singularity' && st.sig.phase === 'telegraph') return 'singularity';
      if (st.enraged) return 'enraged';
      if (st.shieldUp) return 'shielded';
      if (st.sig && st.sig.phase === 'telegraph') return 'telegraph';
      return undefined;
  }

  // Stage 10: how far the Chaos Demon's current form has flowed
  // in (0 at the switch, 1 a second later). A form that began
  // before the fight clock started reads as fully settled.
bossFormFlow(st: BossFightState): number {
      if (st.formStartSec === undefined || st.formStartSec < 0) return 1;
      return Math.min(1, Math.max(0, st.fightSec - st.formStartSec));
  }

  // Stage 10: the Chaos Roulette announcement wash. The pattern is
  // announced by color a full second ahead (red rings, violet
  // spirals, white fans); the renderer washes the Demon's body in
  // this color for the whole telegraph, and it never fires an
  // unannounced pattern.
bossWash(data: EnemyData): [number, number, number] | undefined {
      const st = data.bossState;
      if (!st?.sig || st.sig.phase !== 'telegraph') return undefined;
      return (st.sig.data as PatternData).wash;
  }

fireBossWaveAttack(pos: Matter.Vector, count: number = 12, angleOffset: number = 0) {
      if (pos.x < -60 || pos.x > window.innerWidth + 60 || pos.y < -60 || pos.y > window.innerHeight + 60) return; // A7
      this.host.audioService.playSFX('shoot');
      for (let i = 0; i < count; i++) {
          if (this.bossProjectileCount() >= BOSS_PROJECTILE_CAP) break;
          const angle = angleOffset + (i / count) * Math.PI * 2;
          const dir = { x: Math.cos(angle), y: Math.sin(angle) };
          const proj = Matter.Bodies.circle(pos.x, pos.y, 15, {
              label: 'projectile', isSensor: true,
              plugin: { data: { id: Math.random().toString(), type: 'projectile_enemy', health: 1, maxHealth: 1, owner: 'enemy', burstDamage: 10, bossPattern: true } as EnemyData }
          });
          Matter.Body.setVelocity(proj, Matter.Vector.mult(dir, this.host.scaledSpeed(4)));
          Matter.Composite.add(this.host.engine.world, proj);

          setTimeout(() => {
              if (proj.parent) {
                  Matter.Body.setVelocity(proj, { x: 0, y: 0 }); // Pause
                  setTimeout(() => {
                      if (proj.parent) {
                          const boss = this.host.enemies.find(e => e.plugin['data']?.type === 'boss');
                          if (boss) {
                              const returnDir = Matter.Vector.normalise(Matter.Vector.sub(boss.position, proj.position));
                              Matter.Body.setVelocity(proj, Matter.Vector.mult(returnDir, this.host.scaledSpeed(6)));
                              setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj); }, 2000);
                          } else {
                              Matter.Composite.remove(this.host.engine.world, proj);
                          }
                      }
                  }, 500);
              }
          }, 1500);
      }
  }
}
