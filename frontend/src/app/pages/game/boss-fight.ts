// Boss fight execution: the campaign boss's kill screen, signature
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
  rageDeferred: boolean;
  scaledSpeed(pxPerStepAtRef: number): number;
  spawner: EntitySpawnerService;
  speedScale: number;
  spliceOut<T>(arr: T[], keep: (item: T) => boolean): void;
  spliceRemove<T>(arr: T[], item: T): void;
  takeDamage(amount: number, source?: 'boss_contact'): void;
  triggerImpactEffect(x: number, y: number, isBoss: boolean): void;
  triggerRageMode(): void;
}

export class BossFight {
  constructor(private host: BossFightHost) {}

executeKillScreen() {
      const boss = this.host.enemies.find(e => e.plugin['data']?.type === 'boss');
      if (!boss) return;
      
      this.host.annihilationModeActive.set(true);
      
      // Clear all enemies except boss
      this.host.enemies.forEach(e => {
          if (e.plugin['data']?.type !== 'boss') {
              Matter.Composite.remove(this.host.engine.world, e);
          }
      });
      this.host.spliceOut(this.host.enemies, e => e === boss);
      
      // Clear existing projectiles
      const currentBodies = Matter.Composite.allBodies(this.host.engine.world);
      currentBodies.forEach(b => {
          if (b.label === 'projectile') {
              Matter.Composite.remove(this.host.engine.world, b);
          }
      });

      // Start Annihilation Barrage (every 200ms)
      if (this.host.annihilationInterval) clearInterval(this.host.annihilationInterval);
      this.host.annihilationInterval = setInterval(() => {
          if (this.host.isDead() || this.host.gameEnded() || this.host.inBossDefeatSequence()) {
              clearInterval(this.host.annihilationInterval);
              return;
          }
          // A7: the barrage fires from the boss's body; while the
          // boss is outside the arena it holds.
          if (boss.position.x < -60 || boss.position.x > window.innerWidth + 60 || boss.position.y < -60 || boss.position.y > window.innerHeight + 60) return;

          const dir = Matter.Vector.normalise(Matter.Vector.sub(this.host.playerBody.position, boss.position));
          const angle = Math.atan2(dir.y, dir.x);
          const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
          const proj = Matter.Bodies.circle(boss.position.x, boss.position.y, 20, {
              label: 'projectile', isSensor: true,
              plugin: { data: { id: Math.random().toString(), type: 'annihilation_fire', health: 1, maxHealth: 1 } as EnemyData }
          });
          Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, this.host.scaledSpeed(7.5)));
          Matter.Composite.add(this.host.engine.world, proj);
          
      }, 200);
  }






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
      if (!st.enraged && !st.enrageWarned && t >= st.enrageAtSec - BOSS_ENRAGE_WARNING_SEC) {
          st.enrageWarned = true;
          bossEvent(st, 'enrage_warning', `enrage at ${st.enrageAtSec.toFixed(1)}s`);
          this.host.audioService.playSFX('boss');
      }
      if (!st.enraged && t >= st.enrageAtSec) {
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

      // World 6 False Rebirth (visual spec Section 4 sheet, Stage
      // 10): once per fight, crossing 50 percent HP collapses the
      // King into ash for 1.5 s. The arena holds (no attacks, no
      // summons, no signature, and the ash cannot be hit; the
      // damage gate is in damageEnemy), then it reignites at the
      // health it fell at (never above the 50 percent mark: this
      // is spectacle, not a second health bar) with faster decree
      // fans for the rest of the fight.
      if (st.worldIndex === 5 && !st.rebirthUsed && data.health / Math.max(1, data.maxHealth) <= 0.50) {
          st.rebirthUsed = true;
          st.ashUntilSec = t + 1.5;
          st.sig = null;
          st.nextSignatureAtSec = t + 3.5;
          bossEvent(st, 'false_rebirth', `ash until ${st.ashUntilSec.toFixed(1)}s fight time`);
          this.host.audioService.playSFX('boss');
      }
      if (st.rebirthUsed && !st.rebirthDone && st.ashUntilSec !== undefined && t >= st.ashUntilSec) {
          st.rebirthDone = true;
          bossEvent(st, 'rebirth_reignite', 'decree fans faster from here');
      }

      // World 9 form cycle (Stage 10): the Chaos Demon flows
      // between its three silhouettes every 6 s of fight time; the
      // renderer morphs the point cloud across the first second of
      // each form from the published form fields.
      if (st.worldIndex === 8) {
          if (st.formStartSec === undefined) { st.formIdx = 0; st.formStartSec = t; }
          else if (t - st.formStartSec >= 6) { // 6 s per form (sheet value)
              st.formIdx = ((st.formIdx || 0) + 1) % 3;
              st.formStartSec = t;
              bossEvent(st, 'chaos_form', `form ${st.formIdx}`);
          }
      }

      // World 10 (Stage 10): the finale rage below 25 percent HP
      // (summons stop, the kit rotation collapses to drill chained
      // into burst), and the Singularity casts at 66 and 33 percent
      // HP, which take the signature slot the moment they trigger.
      if (st.worldIndex === 9) {
          const hpFrac = data.health / Math.max(1, data.maxHealth);
          if (!st.finaleRage && hpFrac <= 0.25) {
              st.finaleRage = true;
              bossEvent(st, 'finale_rage', 'summons stop; drill chains into burst');
          }
          const singThresholds = [0.66, 0.33];
          const sIdx = st.singIdx || 0;
          if (sIdx < singThresholds.length && hpFrac <= singThresholds[sIdx] && !st.sig && !this.bossAshen(st)) {
              st.singIdx = sIdx + 1;
              this.startSingularity(boss, data, st);
          }
      }

      // Enrage and overtime (S6 item 4): if the kill screen's
      // countdown finished while this fight's enrage is still
      // pending, the rage was deferred (see triggerRageMode); it
      // starts 20 s after the enrage lands, so the player always
      // gets a real enraged fight before the overtime ends it.
      if (this.host.rageDeferred && st.enraged && t >= st.enrageAtSec + 20) {
          this.host.rageDeferred = false;
          this.host.triggerRageMode();
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

  // World 10 Singularity cast (Stage 10): the Eternal Phoenix
  // collapses into a point of light over a 1 s telegraph, then
  // detonates into three rings whose gaps rotate ring to ring.
  // Triggered by the HP thresholds in tickBossRig, not by the
  // rotation schedule.
startSingularity(boss: Matter.Body, data: EnemyData, st: BossFightState) {
      void boss; void data;
      st.sig = {
          id: 'singularity', phase: 'telegraph', startSec: st.fightSec, telegraphSec: 1.0,
          fireSec: st.fightSec + 1.0,
          data: { kind: 'singularity', gapBase: Math.random() * Math.PI * 2, ringsFired: 0, nextRingSec: 0, lastRingSec: 0 }
      };
      bossEvent(st, 'signature_telegraph', 'singularity');
      this.host.audioService.playSFX('boss');
  }

  // The Crystal Titan's signature ring blocks player fire while it
  // is up (its damage windows are the drops after each fan).
bossShardRingUp(st: BossFightState): boolean {
      return !!st.sig && st.sig.id === 'shard_fan' && st.sig.phase === 'active' && !!st.sig.data.ringUp;
  }

startSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) {
      const def = bossDefFor(st.worldIndex);
      const LU = this.host.logicalUnit;
      const bp = boss.position;
      const pp = this.host.playerBody.position;
      let telegraphSec = 0.6;
      let sigData: any = {};
      switch (def.signature) {
          case 'flame_ring': {
              telegraphSec = 0.6;
              const count = st.enraged ? 10 : 8;
              const ringR = 0.30 * LU;
              const offset = Math.random() * Math.PI * 2;
              const pillars = [];
              for (let i = 0; i < count; i++) {
                  const a = offset + (i / count) * Math.PI * 2;
                  pillars.push({ x: bp.x + Math.cos(a) * ringR, y: bp.y + Math.sin(a) * ringR, hit: false });
              }
              sigData = { cx: bp.x, cy: bp.y, ringR, pillars, litUntilSec: 0 };
              break;
          }
          case 'shadow_split': {
              telegraphSec = 0.6;
              const offs = [
                  { x: -0.34 * LU, y: 0.10 * LU },
                  { x: 0.34 * LU, y: 0.10 * LU }
              ];
              sigData = {
                  copies: offs.map(o => ({
                      x: Math.max(40, Math.min(window.innerWidth - 40, bp.x + o.x)),
                      y: Math.max(40, Math.min(window.innerHeight - 40, bp.y + o.y))
                  })),
                  volley2AtSec: 0
              };
              break;
          }
          case 'shard_fan': {
              telegraphSec = 0.6;
              sigData = { ringUp: false, fanIdx: 0, fanTimes: st.enraged ? [1.0, 4.2, 7.4] : [1.0, 4.6], dropUntilSec: 0, endAtSec: 0 };
              break;
          }
          case 'storm_call': {
              telegraphSec = 0.7;
              const cols = [pp.x, pp.x - 0.30 * LU, pp.x + 0.30 * LU];
              if (st.enraged) cols.push(pp.x - 0.15 * LU, pp.x + 0.15 * LU);
              sigData = {
                  columns: cols.map(x => ({ x: Math.max(20, Math.min(window.innerWidth - 20, x)), hit: false })),
                  strikeUntilSec: 0
              };
              break;
          }
          case 'harvest_arc': {
              telegraphSec = 0.7;
              const ang = Math.atan2(pp.y - bp.y, pp.x - bp.x);
              const arcs = [{ ang, startSec: 0, hit: false }];
              if (st.enraged) arcs.push({ ang: ang + Math.PI / 2, startSec: 0.5, hit: false });
              sigData = { cx: bp.x, cy: bp.y, radius: 0.52 * LU, span: 1.9, arcs, endAtSec: st.enraged ? 1.0 : 0.5 };
              break;
          }
          case 'royal_decree': {
              // World 6, Phoenix King (Stage 10): a fan of slow
              // golden feathers, then the King's own Drill-dash
              // across the field. The dash target locks when the fan
              // fires and is telegraphed by the published line for
              // the whole wind-up; the rear-back and crown flare are
              // the telegraph phase itself (charge plus state).
              telegraphSec = 0.7;
              const feathers = (st.enraged ? 9 : 7) + (st.rebirthDone ? 2 : 0);
              sigData = { feathers, dashState: 'pending', dashAtSec: 0, dashTx: 0, dashTy: 0, dashUntilSec: 0, secondDash: false };
              break;
          }
          case 'frozen_court': {
              // World 7, Ice Empress (Stage 10): three expanding
              // freeze rings in sequence around the locked court
              // center. Each ring draws for its telegraph, then
              // solidifies into a damaging wall for 1 s; the safe
              // ground is between the rings. Enraged, the court
              // runs tighter (draw 0.55 s, still above the 0.5 s
              // telegraph floor).
              telegraphSec = 0.6;
              const interval = st.enraged ? 1.3 : 1.6;
              const drawSec = st.enraged ? 0.55 : 0.6;
              sigData = {
                  cx: bp.x, cy: bp.y, interval, drawSec,
                  rings: [0.22, 0.40, 0.58].map(frac => ({ r: frac * LU, drawAtSec: 0, solidAtSec: 0, untilSec: 0, hit: false })),
                  fan1Done: false, fan2Done: false
              };
              break;
          }
          case 'emperors_breath': {
              // World 8, Dragon Emperor (Stage 10): the maw glows
              // for 0.8 s with the cone outline drawn on the field,
              // then a sustained flame cone sweeps slowly toward
              // the player's side for 1.5 s. The cone direction
              // locks at the player's side when the telegraph
              // starts; the sweep rate is capped in the tick.
              telegraphSec = 0.8;
              sigData = {
                  coneAng: Math.atan2(pp.y - bp.y, pp.x - bp.x),
                  coneHalf: 0.61, coneLen: 0.62 * LU,
                  burnUntilSec: 0, sparks2: false, lastHitSec: -9, lastTickSec: 0
              };
              break;
          }
          case 'chaos_roulette': {
              // World 9, Chaos Demon (Stage 10): the accent color
              // announces the pattern a full second ahead (red
              // rings, violet spirals, white fans), with a full-body
              // color wash the renderer reads off the published boss
              // entity. It never fires an unannounced pattern, and
              // never repeats the previous cast's pattern. Enraged,
              // a second pattern overlaps the first.
              telegraphSec = 1.0;
              const patterns = ['rings', 'spiral', 'fans'];
              let pattern = patterns[Math.floor(Math.random() * patterns.length)];
              if (pattern === st.lastChaosPattern) {
                  pattern = patterns[(patterns.indexOf(pattern) + 1) % patterns.length];
              }
              st.lastChaosPattern = pattern;
              const pattern2 = st.enraged
                  ? patterns[(patterns.indexOf(pattern) + 1 + Math.floor(Math.random() * 2)) % patterns.length]
                  : null;
              sigData = { pattern, pattern2, casts: [] as any[], endAtSec: 0 };
              break;
          }
          case 'singularity': {
              // World 10, Eternal Phoenix (Stage 10): the regular
              // signature slot rotates the player's own kit at boss
              // scale (feather fan, Burst ring, Drill dash, Aura
              // burn zone), each telegraphed in the player's visual
              // language rendered hostile. The Singularity proper
              // is threshold-triggered (startSingularity), not part
              // of this rotation. Below 25 percent HP the rotation
              // collapses to the drill chained into the burst.
              const kinds = ['fan', 'burst', 'drill', 'aura'];
              const kind = st.finaleRage
                  ? (((st.kitIdx || 0) % 2 === 0) ? 'drill' : 'burst')
                  : kinds[(st.kitIdx || 0) % kinds.length];
              st.kitIdx = (st.kitIdx || 0) + 1;
              telegraphSec = kind === 'drill' ? 0.7 : 0.6;
              sigData = { kind, shotsLeft: 0, nextShotSec: 0, auraUntilSec: 0, lastHitSec: -9, chained: false, dashState: 'pending', dashTx: 0, dashTy: 0, dashUntilSec: 0 };
              if (kind === 'drill') {
                  // The drill line locks at telegraph start, on the
                  // player's position then, with overshoot.
                  const dx = pp.x - bp.x, dy = pp.y - bp.y;
                  const dl = Math.hypot(dx, dy) || 1;
                  sigData.dashTx = pp.x + (dx / dl) * 0.15 * LU;
                  sigData.dashTy = pp.y + (dy / dl) * 0.15 * LU;
              }
              break;
          }
          default:
              st.nextSignatureAtSec = st.fightSec + SIGNATURE_INTERVAL_SEC;
              return;
      }
      st.sig = { id: def.signature, phase: 'telegraph', startSec: st.fightSec, telegraphSec, fireSec: st.fightSec + telegraphSec, data: sigData };
      bossEvent(st, 'signature_telegraph', def.signature);
  }

fireSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) {
      const sig = st.sig!;
      const t = st.fightSec;
      sig.phase = 'active';
      bossEvent(st, 'signature_fire', sig.id);
      switch (sig.id) {
          case 'flame_ring': {
              this.fireBossWaveAttack(boss.position);
              if (st.enraged) this.fireBossWaveAttack(boss.position, 12, Math.PI / 12);
              sig.data.litUntilSec = t + 1.0;
              break;
          }
          case 'shadow_split': {
              const bolts = st.enraged ? 5 : 3;
              this.fireBossFan(boss.position.x, boss.position.y, bolts, 6);
              for (const c of sig.data.copies) this.fireBossFan(c.x, c.y, bolts, 6);
              sig.data.volley2AtSec = t + 1.5;
              break;
          }
          case 'shard_fan': {
              sig.data.ringUp = true;
              sig.data.t0 = t;
              const lastFan = sig.data.fanTimes[sig.data.fanTimes.length - 1];
              sig.data.endAtSec = t + lastFan + 2.6;
              break;
          }
          case 'storm_call': {
              sig.data.strikeUntilSec = t + 0.25;
              this.host.audioService.playSFX('boss');
              break;
          }
          case 'harvest_arc': {
              for (const arc of sig.data.arcs) arc.startSec = t + arc.startSec;
              sig.data.endAtSec = t + sig.data.endAtSec;
              break;
          }
          case 'royal_decree': {
              // The feather fan: slow, large, individually
              // dodgeable golden bolts aimed at the player's side.
              this.fireBossFan(boss.position.x, boss.position.y, sig.data.feathers, 4.5, 13);
              // Then the dash: the target locks now (the player's
              // position plus overshoot) and the published line
              // telegraphs it for the full 0.9 s wind-up.
              const pp = this.host.playerBody.position;
              const dx = pp.x - boss.position.x, dy = pp.y - boss.position.y;
              const dl = Math.hypot(dx, dy) || 1;
              sig.data.dashTx = pp.x + (dx / dl) * 0.15 * this.host.logicalUnit;
              sig.data.dashTy = pp.y + (dy / dl) * 0.15 * this.host.logicalUnit;
              sig.data.dashState = 'windup';
              sig.data.dashAtSec = t + 0.9;
              break;
          }
          case 'frozen_court': {
              const d = sig.data;
              d.rings.forEach((r: any, k: number) => {
                  r.drawAtSec = t + k * d.interval;
                  r.solidAtSec = r.drawAtSec + d.drawSec;
                  r.untilSec = r.solidAtSec + 1.0;
              });
              break;
          }
          case 'emperors_breath': {
              // Scale sparks wave one rides the breath's start:
              // two waves of aimed shots bracket the burn.
              this.fireBossFan(boss.position.x, boss.position.y, 3, 6);
              sig.data.burnUntilSec = t + (st.enraged ? 1.8 : 1.5);
              sig.data.lastTickSec = t;
              break;
          }
          case 'chaos_roulette': {
              const d = sig.data;
              d.casts = [{ pattern: d.pattern, startSec: t, w1: false, w2: false, nextAt: t, ang0: Math.random() * Math.PI * 2, shots: 0 }];
              if (d.pattern2) {
                  d.casts.push({ pattern: d.pattern2, startSec: t + 0.3, w1: false, w2: false, nextAt: t + 0.3, ang0: Math.random() * Math.PI * 2, shots: 0 });
              }
              d.endAtSec = t + 2.9;
              break;
          }
          case 'singularity': {
              const d = sig.data;
              if (d.kind === 'fan') {
                  d.shotsLeft = 2;
                  d.nextShotSec = t;
              } else if (d.kind === 'burst') {
                  for (let k = 0; k < 12; k++) {
                      this.fireBossProjectile(boss.position.x, boss.position.y, (k / 12) * Math.PI * 2, 5.5);
                  }
              } else if (d.kind === 'drill') {
                  d.dashState = 'dash';
                  d.dashUntilSec = t + 1.0;
                  bossEvent(st, 'signature_dash', 'eternal drill');
              } else if (d.kind === 'aura') {
                  d.auraUntilSec = t + 4;
              } else if (d.kind === 'singularity') {
                  d.ringsFired = 0;
                  d.nextRingSec = t;
              }
              break;
          }
      }
  }

endSignature(st: BossFightState) {
      bossEvent(st, 'signature_end', st.sig?.id);
      st.sig = null;
      let interval = (st.enraged ? SIGNATURE_INTERVAL_ENRAGED_SEC : SIGNATURE_INTERVAL_SEC) + Math.random() * 2;
      // After the False Rebirth reignition the King's decree
      // cycle runs faster for the rest of the fight (Stage 10).
      if (st.rebirthDone) interval *= 0.75;
      st.nextSignatureAtSec = st.fightSec + interval;
  }

tickSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) {
      const sig = st.sig!;
      const t = st.fightSec;
      if (sig.phase === 'telegraph') {
          if (t >= sig.fireSec) this.fireSignature(boss, data, st);
          return;
      }
      const pp = this.host.playerBody.position;
      const LU = this.host.logicalUnit;
      switch (sig.id) {
          case 'flame_ring': {
              // Lit pillars hurt once each while they burn (1.0 s);
              // the ring positions were telegraphed for 0.6 s and
              // the wave itself passes the ring about 0.5 s after
              // firing, which is what the sheet's timing describes.
              if (t <= sig.data.litUntilSec) {
                  for (const p of sig.data.pillars) {
                      if (!p.hit && Math.hypot(pp.x - p.x, pp.y - p.y) < 0.085 * LU) {
                          p.hit = true;
                          bossEvent(st, 'hazard_hit', 'flame pillar');
                          this.host.takeDamage(10);
                      }
                  }
              } else this.endSignature(st);
              break;
          }
          case 'shadow_split': {
              if (sig.data.volley2AtSec && t >= sig.data.volley2AtSec) {
                  sig.data.volley2AtSec = 0;
                  const bolts = st.enraged ? 5 : 3;
                  this.fireBossFan(boss.position.x, boss.position.y, bolts, 6);
                  for (const c of sig.data.copies) this.fireBossFan(c.x, c.y, bolts, 6);
              }
              if (t >= sig.fireSec + 4) this.endSignature(st);
              break;
          }
          case 'shard_fan': {
              const d = sig.data;
              const rel = t - d.t0;
              if (d.fanIdx < d.fanTimes.length && rel >= d.fanTimes[d.fanIdx]) {
                  this.fireBossFan(boss.position.x, boss.position.y, st.enraged ? 4 : 3, 7.5);
                  d.fanIdx++;
                  d.ringUp = false;
                  d.dropUntilSec = t + 2.0; // the damage window after each fan
                  bossEvent(st, 'signature_fan', `fan ${d.fanIdx}`);
              }
              if (!d.ringUp && d.dropUntilSec && t >= d.dropUntilSec && rel < d.fanTimes[d.fanTimes.length - 1]) {
                  d.ringUp = true;
                  d.dropUntilSec = 0;
              }
              if (t >= d.endAtSec) this.endSignature(st);
              break;
          }
          case 'storm_call': {
              if (t <= sig.data.strikeUntilSec) {
                  for (const c of sig.data.columns) {
                      if (!c.hit && Math.abs(pp.x - c.x) <= 0.05 * LU + 10) {
                          c.hit = true;
                          bossEvent(st, 'hazard_hit', 'lightning column');
                          this.host.takeDamage(10);
                      }
                  }
              } else this.endSignature(st);
              break;
          }
          case 'harvest_arc': {
              for (const arc of sig.data.arcs) {
                  // Damaging for the sweep's first 0.35 s; the final
                  // 0.15 s is the fade the sheet lets the player
                  // pass through.
                  if (!arc.hit && t >= arc.startSec && t <= arc.startSec + 0.35) {
                      const dist = Math.hypot(pp.x - sig.data.cx, pp.y - sig.data.cy);
                      let da = Math.atan2(pp.y - sig.data.cy, pp.x - sig.data.cx) - arc.ang;
                      while (da > Math.PI) da -= Math.PI * 2;
                      while (da < -Math.PI) da += Math.PI * 2;
                      if (Math.abs(dist - sig.data.radius) <= 0.06 * LU && Math.abs(da) <= sig.data.span / 2) {
                          arc.hit = true;
                          bossEvent(st, 'hazard_hit', 'harvest arc');
                          this.host.takeDamage(10);
                      }
                  }
              }
              if (t >= sig.data.endAtSec) this.endSignature(st);
              break;
          }
          case 'royal_decree': {
              const d = sig.data;
              if (d.dashState === 'windup' && t >= d.dashAtSec) {
                  d.dashState = 'dash';
                  d.dashUntilSec = t + 1.0;
                  bossEvent(st, 'signature_dash', 'royal decree');
              } else if (d.dashState === 'dash') {
                  const dist = Math.hypot(boss.position.x - d.dashTx, boss.position.y - d.dashTy);
                  if (dist < 0.08 * LU || t >= d.dashUntilSec) {
                      if (st.enraged && !d.secondDash) {
                          // Enraged, the decree chains: a second
                          // wind-up and dash back across the field,
                          // locked on the player's position now.
                          d.secondDash = true;
                          const dx = pp.x - boss.position.x, dy = pp.y - boss.position.y;
                          const dl = Math.hypot(dx, dy) || 1;
                          d.dashTx = pp.x + (dx / dl) * 0.15 * LU;
                          d.dashTy = pp.y + (dy / dl) * 0.15 * LU;
                          d.dashState = 'windup';
                          d.dashAtSec = t + 0.7;
                      } else {
                          this.endSignature(st);
                      }
                  }
              }
              break;
          }
          case 'frozen_court': {
              const d = sig.data;
              // Icicle lance fans between the rings: Sentry-style
              // aimed shots in threes, fired from the Empress.
              if (!d.fan1Done && t >= sig.fireSec + 0.8) {
                  d.fan1Done = true;
                  this.fireBossFan(boss.position.x, boss.position.y, 3, 7.5);
              }
              if (!d.fan2Done && t >= sig.fireSec + 0.8 + d.interval) {
                  d.fan2Done = true;
                  this.fireBossFan(boss.position.x, boss.position.y, 3, 7.5);
              }
              // Solid rings hurt once each while they stand; the
              // player must be between rings (the bands are 0.045
              // LU half-width on 0.18 LU spacing, so the lanes
              // between them are real ground).
              for (const r of d.rings) {
                  if (!r.hit && t >= r.solidAtSec && t <= r.untilSec) {
                      const dist = Math.hypot(pp.x - d.cx, pp.y - d.cy);
                      if (Math.abs(dist - r.r) <= 0.045 * LU) {
                          r.hit = true;
                          bossEvent(st, 'hazard_hit', 'freeze ring');
                          this.host.takeDamage(10);
                      }
                  }
              }
              if (t >= d.rings[d.rings.length - 1].untilSec) this.endSignature(st);
              break;
          }
          case 'emperors_breath': {
              const d = sig.data;
              const dt = Math.max(0, t - (d.lastTickSec || t));
              d.lastTickSec = t;
              if (t <= d.burnUntilSec) {
                  // The cone sweeps slowly toward the player's side
                  // at a capped rate (escape is crossing behind the
                  // head or out-ranging the cone, and both stay
                  // open at this rate against cruise speed).
                  const want = Math.atan2(pp.y - boss.position.y, pp.x - boss.position.x);
                  let da = want - d.coneAng;
                  while (da > Math.PI) da -= Math.PI * 2;
                  while (da < -Math.PI) da += Math.PI * 2;
                  const maxStep = (st.enraged ? 0.8 : 0.5) * dt;
                  d.coneAng += Math.max(-maxStep, Math.min(maxStep, da));
                  // Standing in the cone hurts on the same 500 ms
                  // cadence takeDamage's i-frames enforce; the
                  // calls are paced to it so a hazard log reads as
                  // landed hits, not per-step noise.
                  const distP = Math.hypot(pp.x - boss.position.x, pp.y - boss.position.y);
                  let pa = Math.atan2(pp.y - boss.position.y, pp.x - boss.position.x) - d.coneAng;
                  while (pa > Math.PI) pa -= Math.PI * 2;
                  while (pa < -Math.PI) pa += Math.PI * 2;
                  if (distP <= d.coneLen && Math.abs(pa) <= d.coneHalf && t - d.lastHitSec >= 0.5) {
                      d.lastHitSec = t;
                      bossEvent(st, 'hazard_hit', 'emperors breath');
                      this.host.takeDamage(10);
                  }
              } else {
                  if (!d.sparks2 && t >= d.burnUntilSec + 0.4) {
                      d.sparks2 = true;
                      this.fireBossFan(boss.position.x, boss.position.y, 3, 6);
                  }
                  if (d.sparks2) this.endSignature(st);
              }
              break;
          }
          case 'chaos_roulette': {
              const d = sig.data;
              for (const cast of d.casts) {
                  const ct = t - cast.startSec;
                  if (ct < 0) continue;
                  if (cast.pattern === 'rings') {
                      if (!cast.w1) { cast.w1 = true; this.fireBossWaveAttack(boss.position, 14); }
                      if (!cast.w2 && ct >= 0.5) { cast.w2 = true; this.fireBossWaveAttack(boss.position, 14, Math.PI / 14); }
                  } else if (cast.pattern === 'spiral') {
                      // Two rotating spiral arms over 2.2 s.
                      if (ct <= 2.2 && t >= cast.nextAt) {
                          cast.nextAt = t + 0.11;
                          const a = cast.ang0 + ct * 2.4;
                          this.fireBossProjectile(boss.position.x, boss.position.y, a, 5);
                          this.fireBossProjectile(boss.position.x, boss.position.y, a + Math.PI, 5);
                      }
                  } else { // fans
                      if (cast.shots < 3 && ct >= cast.shots * 0.45) {
                          cast.shots++;
                          this.fireBossFan(boss.position.x, boss.position.y, 5, 6.5);
                      }
                  }
              }
              if (t >= d.endAtSec) this.endSignature(st);
              break;
          }
          case 'singularity': {
              const d = sig.data;
              if (d.kind === 'fan') {
                  if (d.shotsLeft > 0 && t >= d.nextShotSec) {
                      d.shotsLeft--;
                      d.nextShotSec = t + 0.5;
                      this.fireBossFan(boss.position.x, boss.position.y, 5, 7);
                  }
                  if (d.shotsLeft <= 0) this.endSignature(st);
              } else if (d.kind === 'burst') {
                  this.endSignature(st);
              } else if (d.kind === 'drill') {
                  const dist = Math.hypot(boss.position.x - d.dashTx, boss.position.y - d.dashTy);
                  if (dist < 0.08 * LU || t >= d.dashUntilSec) {
                      if (st.finaleRage && !d.chained) {
                          // Finale rage: the drill chains straight
                          // into the burst at the dash's end.
                          d.chained = true;
                          bossEvent(st, 'signature_chain', 'drill into burst');
                          for (let k = 0; k < 12; k++) {
                              this.fireBossProjectile(boss.position.x, boss.position.y, (k / 12) * Math.PI * 2, 5.5);
                          }
                      }
                      this.endSignature(st);
                  }
              } else if (d.kind === 'aura') {
                  // The burn zone it carries: standing inside the
                  // aura radius hurts on the 500 ms cadence. The
                  // zone is published as a ring at the boss's live
                  // position, so its edge is always readable.
                  if (t <= d.auraUntilSec) {
                      const distP = Math.hypot(pp.x - boss.position.x, pp.y - boss.position.y);
                      if (distP <= 0.34 * LU && t - d.lastHitSec >= 0.5) {
                          d.lastHitSec = t;
                          bossEvent(st, 'hazard_hit', 'eternal aura');
                          this.host.takeDamage(10);
                      }
                  } else this.endSignature(st);
              } else if (d.kind === 'singularity') {
                  // Three rings with rotating gaps: each ring
                  // leaves a 0.9 rad gap, and the gap center steps
                  // 0.7 rad ring to ring, so the dodge line moves
                  // and always exists.
                  if (d.ringsFired < 3 && t >= d.nextRingSec) {
                      const gapCenter = d.gapBase + d.ringsFired * 0.7;
                      for (let k = 0; k < 14; k++) {
                          const a = (k / 14) * Math.PI * 2;
                          let ga = a - gapCenter;
                          while (ga > Math.PI) ga -= Math.PI * 2;
                          while (ga < -Math.PI) ga += Math.PI * 2;
                          if (Math.abs(ga) < 0.45) continue;
                          this.fireBossProjectile(boss.position.x, boss.position.y, a, 5.5);
                      }
                      d.ringsFired++;
                      d.lastRingSec = t;
                      d.nextRingSec = t + 0.45;
                  }
                  if (d.ringsFired >= 3 && t >= d.lastRingSec + 0.3) this.endSignature(st);
              } else {
                  this.endSignature(st);
              }
              break;
          }
          default:
              this.endSignature(st);
      }
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
          for (let i = 0; i < def.minionsPerSummon; i++) {
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
      if (!st?.sig || st.sig.id !== 'chaos_roulette' || st.sig.phase !== 'telegraph') return undefined;
      if (st.sig.data.pattern === 'rings') return [1.0, 0.22, 0.28];
      if (st.sig.data.pattern === 'spiral') return [0.62, 0.3, 1.0];
      return [1.0, 1.0, 1.0];
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
