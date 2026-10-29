// Ability and projectile execution: the shared cast path for the
// player, the Battle rival, and the AI birds (tap, double, hold, and
// triple families plus the auto-fire and enemy projectile spawners).
// One cast path for every actor is a design rule from the overhaul:
// a move behaves identically no matter who casts it. Runs against
// the game component's state through the host interface. Moved out
// of game.component.ts in the code organization pass (Oct 27, 2026);
// logic unchanged.
import { WritableSignal } from '@angular/core';
import * as Matter from 'matter-js';
import { GameStateService } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import { BattleAiService } from '../../services/battle-ai.service';
import { PhysicsEntity, WorldStats } from '../../models/game.models';
import { ABILITIES, BASE_STATS, REALM_ABILITIES } from '../../constants/game.constants';
import { PI_RULES, DROP_RULES, levelHpBonusFor } from '../../data/balance.constants';
import { EnemyData } from './game.types';

export interface AbilityExecutorHost {
  audioService: AudioService;
  battleAi: BattleAiService;
  clampUltDamage(castId: string, targetKey: string, fallbackBase: number, damage: number): number;
  currentHealth: WritableSignal<number>;
  damageEnemy(enemy: Matter.Body, damage: number, sourcePos?: { x: number, y: number }, ultCastId?: string): void;
  enemies: Matter.Body[];
  engine: Matter.Engine;
  gameEnded: WritableSignal<boolean>;
  gameState: GameStateService;
  holdAbilityEndTime: number;
  isDead: WritableSignal<boolean>;
  logicalUnit: number;
  meteorRushDamageValue: number;
  meteorRushHitIds: Set<string>;
  meteorRushUntilMs: number;
  mouseX: number;
  mouseY: number;
  playerBody: Matter.Body;
  playerInfernoUntil: number;
  registerUltCast(casterOwnerId: string): string;
  scaledSpeed(pxPerStepAtRef: number): number;
  speedScale: number;
  takeDamage(amount: number, source?: 'boss_contact'): void;
  triggerImpactEffect(x: number, y: number, isBoss: boolean): void;
}

export class AbilityExecutor {
  constructor(private host: AbilityExecutorHost) {}

fireProjectile() {
    if (this.host.enemies.length === 0) return;

    // Facing cone (Carter's rule, Fix Round 2 A1, Oct 28, 2026):
    // auto-fire engages ONLY enemies inside a cone around the
    // direction the phoenix is facing, half-angle 45 degrees
    // (facing north means northwest through north to northeast).
    // Inside the cone the nearest enemy is the target; with no
    // enemy in the cone, auto-fire holds and no shot is fired.
    // The heading is the bird's live heading, published per frame
    // by the renderer (parked birds settle nose-up, so a parked
    // phoenix covers the sky above it, which is where bosses
    // hover). Abilities keep their own targeting; this gate is
    // only the basic auto-fire's.
    const heading = this.host.gameState.phoenixHeading;
    const COS_HALF_CONE = Math.SQRT1_2; // cos(45 degrees)
    let nearestIdx = -1;
    let minDist = Infinity;
    this.host.enemies.forEach((e, i) => {
      const dx = e.position.x - this.host.playerBody.position.x;
      const dy = e.position.y - this.host.playerBody.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        const cosAng = (dx * heading.x + dy * heading.y) / dist;
        if (cosAng < COS_HALF_CONE - 1e-9) return; // outside the cone
      }
      if (dist < minDist) { minDist = dist; nearestIdx = i; }
    });
    if (nearestIdx < 0) return; // nothing in the cone: hold fire
    const nearest = this.host.enemies[nearestIdx];

    // Range gate wired to the attackRange stat (spec Sections 3.1
    // and 5.1): the shop passive finally feeds the auto-fire it names.
    // It used to read a hardcoded 500 while the stat sat at base 400.
    if (minDist > this.host.gameState.currentStats().attackRange * this.host.speedScale) return;

    const dir = Matter.Vector.normalise(Matter.Vector.sub(nearest.position, this.host.playerBody.position));

    // Projectiles spawn EXACTLY at the player body (which is now exactly the Phoenix 3D visual position)
    const projectile = Matter.Bodies.circle(this.host.playerBody.position.x, this.host.playerBody.position.y, 8, {
      label: 'projectile',
      isSensor: true,
      plugin: {
          data: { id: Math.random().toString(), type: 'projectile_player', health: 1, maxHealth: 1, owner: 'player', burstDamage: this.host.gameState.currentStats().damage } as EnemyData
      }
    });

    Matter.Body.setVelocity(projectile, Matter.Vector.mult(dir, this.host.scaledSpeed(7.5)));
    Matter.Composite.add(this.host.engine.world, projectile);
    
    this.host.audioService.playSFX('shoot');
    setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.host.engine.world, projectile); }, 2000);
  }


// Fix Round 2 (A7, Carter's rule): an enemy may not fire until
// its body is inside the visible arena. Carter was shot by slow
// enemies still descending past the top edge. Every enemy shot
// in the game flows through the three functions below (plus the
// boss rig's own spawner in boss-fight.ts, gated there), so the
// check lives at those choke points: the source point must be
// inside the window, expanded by a small entry margin only.
private canFireFrom(x: number, y: number, margin = 30): boolean {
    return x >= -margin && x <= window.innerWidth + margin
        && y >= -margin && y <= window.innerHeight + margin;
}

fireEnemyProjectile(source: Matter.Vector, speedPerStep: number = 7.5, targetOverride?: { x: number, y: number }) {
    if (!this.canFireFrom(source.x, source.y)) return;
    // Use stale position for reaction delay (human-like ~150ms lag)
    const enemyPhoenix = this.host.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
    const eAny = enemyPhoenix as any;
    const targetPos = targetOverride || (eAny?.__stalePlayerPos) || this.host.playerBody.position;
    const dir = Matter.Vector.normalise(Matter.Vector.sub(targetPos, source));
    const damage = this.host.battleAi.ai1.stats?.damage || 10;

    // Aim spread: ±3° base, increasing with distance (human-like inaccuracy)
    const dist = Matter.Vector.magnitude(Matter.Vector.sub(this.host.playerBody.position, source));
    const maxSpread = 0.05 + (dist / 1000) * 0.08; // Radians
    const spreadAngle = (Math.random() - 0.5) * maxSpread * 2;
    const finalDir = Matter.Vector.rotate(dir, spreadAngle);

    const projectile = Matter.Bodies.circle(source.x, source.y, 8, {
      label: 'projectile',
      isSensor: true,
      plugin: {
          data: { id: Math.random().toString(), type: 'projectile_enemy', ownerId: 'ai1', health: 1, maxHealth: 1, burstDamage: damage } as EnemyData
      }
    });

    Matter.Body.setVelocity(projectile, Matter.Vector.mult(finalDir, this.host.scaledSpeed(speedPerStep)));
    Matter.Composite.add(this.host.engine.world, projectile);
    setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.host.engine.world, projectile); }, 2000);
  }


  // Lance Wraith bolt (Stage 5, design sheet 14): one fast piercing
  // bolt along the locked aim at Dart-class speed (13 per step, the
  // Fire Lance's class). No aim spread: the 0.7 s lock line is the
  // warning, and the dodge is to be off the line when it fires. It
  // passes through the player's fire (the projectile-clash branch
  // exempts it) and through the field until its life ends.
fireWraithBolt(source: Matter.Body) {
    if (!this.canFireFrom(source.position.x, source.position.y, 40)) return;
    const data = source.plugin['data'] as EnemyData;
    const dirX = data.aimDirX ?? 1;
    const dirY = data.aimDirY ?? 0;
    const proj = Matter.Bodies.circle(
      source.position.x + dirX * 30 * this.host.speedScale,
      source.position.y + dirY * 30 * this.host.speedScale, 5, {
      label: 'projectile',
      isSensor: true,
      frictionAir: 0,
      plugin: {
          data: { id: Math.random().toString(), type: 'projectile_enemy', owner: 'enemy', ownerId: 'enemy', health: 1, maxHealth: 1, burstDamage: 10, moveId: 'wraith_bolt', pierce: true, hitIds: [] } as EnemyData
      }
    });
    Matter.Body.setVelocity(proj, { x: dirX * this.host.scaledSpeed(13), y: dirY * this.host.scaledSpeed(13) });
    Matter.Composite.add(this.host.engine.world, proj);
    setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj); }, 1600);
  }

  // Storm Darter spread (Stage 5, design sheet 16): a 3-shot fan
  // across the pass direction, fired once at the pass midpoint at
  // standard enemy projectile speed and payload.
fireDarterSpread(source: Matter.Body) {
    if (!this.canFireFrom(source.position.x, source.position.y, 40)) return;
    const data = source.plugin['data'] as EnemyData;
    const base = Math.atan2(data.dashDirY ?? 0, data.dashDirX ?? 1);
    for (const off of [-0.18, 0, 0.18]) {
      const a = base + off;
      const proj = Matter.Bodies.circle(source.position.x, source.position.y, 5, {
        label: 'projectile',
        isSensor: true,
        frictionAir: 0,
        plugin: {
            data: { id: Math.random().toString(), type: 'projectile_enemy', owner: 'enemy', ownerId: 'enemy', health: 1, maxHealth: 1, burstDamage: 10, moveId: 'darter_spread' } as EnemyData
        }
      });
      Matter.Body.setVelocity(proj, { x: Math.cos(a) * this.host.scaledSpeed(7.5), y: Math.sin(a) * this.host.scaledSpeed(7.5) });
      Matter.Composite.add(this.host.engine.world, proj);
      setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj); }, 1400);
    }
  }

triggerAbility(ability: string, sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      if (ownerId === 'player' && this.host.gameState.isRebirthing()) return 0;
      
      if (ability === 'drill_attack') return this.triggerDrillAttack(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'burst') return this.triggerBurst(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_dart') return this.triggerFireDart(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'meteor_rush') return this.triggerMeteorRush(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_talon') return this.triggerPhoenixTalon(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'spark_storm') return this.triggerSparkStorm(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_lance') return this.triggerFireLance(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'flame_tornado') return this.triggerFlameTornado(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'solar_bomb') return this.triggerSolarBomb(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_breath') return this.triggerFireBreath(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_turret') return this.triggerPhoenixTurret(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_inferno') return this.triggerPhoenixInferno(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'inferno_wave') return this.triggerInfernoWave(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'aura') return this.triggerAura(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_nova') return this.triggerPhoenixNova(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'supernova') return this.triggerSupernova(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'divine_wrath') return this.triggerDivineWrath(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_singularity') return this.triggerPhoenixSingularity(sourceBody, targetX, targetY, stats, ownerId);
      return 0;
  }




triggerDrillAttack(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['drill_attack'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
      const duration = 600 * mods['duration'];
      const baseCooldown = ABILITIES['drill_attack']?.baseCooldown || 20;
      const cd = baseCooldown * mods['cooldown'];

      this.host.audioService.playSFX('shoot');
      
      if (ownerId === 'player') {
          this.host.gameState.isDrilling.set(true);
      }
      
      setTimeout(() => {
          if (ownerId === 'player') {
              this.host.gameState.isDrilling.set(false);
          }
      }, duration);
      return cd;
  }


triggerFireBreath(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['fire_breath'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0, ammo: 1.0 };
      const baseCooldown = ABILITIES['fire_breath']?.baseCooldown || 8;
      const cd = baseCooldown * mods['cooldown'];

      let nearest = null;
      let minDist = Infinity;
      const validTargets = ownerId === 'player' ? this.host.enemies : [this.host.playerBody];
      if (validTargets.length > 0) {
          nearest = validTargets[0];
          validTargets.forEach(e => {
              const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, sourceBody.position));
              if (dist < minDist) { minDist = dist; nearest = e; }
          });
      }
      if (minDist > 500 * this.host.speedScale || !nearest) return cd;

      const ammo = Math.floor(20 * (mods['ammo'] || 1.0));
      const fireIntervalMs = 50;
      const firingDurationSec = (ammo * fireIntervalMs) / 1000;
      
      const damage = stats.damage * 0.5 * mods['damage'];
      const range = this.host.scaledSpeed(6 * mods['range']);
      
      const incomingDamage = new Map<string, number>();

      for(let i=0; i<ammo; i++) {
          setTimeout(() => {
              if (!sourceBody.parent || (ownerId === 'player' && (this.host.isDead() || this.host.gameState.isRebirthing()))) return;
              
              let target: any = null;
              let bestDist = Infinity;
              
              if (validTargets.length > 0) {
                  validTargets.forEach(e => {
                      const data = e.plugin['data'] as EnemyData;
                      if (!data) return;
                      const currentIncoming = incomingDamage.get(data.id) || 0;
                      if (data.health - currentIncoming > 0 || data.type === 'boss') {
                          const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, sourceBody.position));
                          if (dist < bestDist) { bestDist = dist; target = e; }
                      }
                  });
                  
                  if (!target) {
                      validTargets.forEach(e => {
                          const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, sourceBody.position));
                          if (dist < bestDist) { bestDist = dist; target = e; }
                      });
                  }
              }
              
              let fireAngle = 0;
              if (target) {
                  const dirVec = Matter.Vector.sub(target.position, sourceBody.position);
                  fireAngle = Math.atan2(dirVec.y, dirVec.x);
                  
                  const data = target.plugin['data'] as EnemyData;
                  if (data) incomingDamage.set(data.id, (incomingDamage.get(data.id) || 0) + damage);
              }

              this.host.audioService.playSFX('shoot');
              
              const spreadAngle = (Math.random() - 0.5) * 0.5;
              const angle = fireAngle + spreadAngle;
              const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
              const proj = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, 15, {
                  isSensor: true, label: 'projectile', frictionAir: 0,
                  // S2 root fix: pellets now carry owner alongside
                  // ownerId (the aura convention). Without owner, the
                  // collision branches could not skip the caster, so a
                  // fire breath cast was eaten by the caster's own body
                  // at spawn and damaged the caster instead of the
                  // target (probe: STAGE-S2.md).
                  plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'fire_breath', health: 1, maxHealth: 1, burstDamage: damage, owner: ownerId, ownerId: ownerId } as EnemyData }
              });
              Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, range));
              Matter.Composite.add(this.host.engine.world, proj);
              // Range fix: pellets used to be removed by a 500 ms
              // wall-clock timeout, which capped their reach near
              // 180 px at speed 6 (about 30 steps of flight)
              // against the documented 500 px cast range above, so
              // most of the cone could never connect. A pellet now
              // lives until it has actually flown the documented
              // range from its spawn point, measured on engine
              // steps so the reach is the same at any frame rate;
              // frictionAir 0 (set on the body above) keeps the
              // pellet speed from decaying in flight, so the reach
              // per step is exact. The range modifier scales the
              // reach exactly as it scales the pellet speed, so
              // the flight time is unchanged at every build. The
              // long wall-clock timeout remains only as a leak
              // backstop for a stalled engine. Damage, pellet
              // count, spread, and cooldown are untouched, and a
              // point-blank cast is unchanged: every pellet still
              // connects on its first steps.
              const spawnX = proj.position.x;
              const spawnY = proj.position.y;
              const maxReach = 500 * this.host.speedScale * (mods['range'] || 1.0);
              const engine = this.host.engine;
              const expirePellet = () => {
                  if (!proj.parent) { Matter.Events.off(engine, 'afterUpdate', expirePellet); return; }
                  const dx = proj.position.x - spawnX;
                  const dy = proj.position.y - spawnY;
                  if (dx * dx + dy * dy >= maxReach * maxReach) {
                      Matter.Composite.remove(engine.world, proj);
                      Matter.Events.off(engine, 'afterUpdate', expirePellet);
                  }
              };
              Matter.Events.on(engine, 'afterUpdate', expirePellet);
              setTimeout(() => { Matter.Events.off(engine, 'afterUpdate', expirePellet); if (proj.parent) Matter.Composite.remove(engine.world, proj); }, 20000);
          }, i * fireIntervalMs);
      }
      return cd;
  }


triggerPhoenixTurret(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['phoenix_turret'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
      const baseCooldown = ABILITIES['phoenix_turret']?.baseCooldown || 14;
      const cd = baseCooldown * mods['cooldown'];
      
      const seekRange = 500 * (mods['range'] || 1.0);
      const tetherRange = 100 * (mods['range'] || 1.0);
      const duration = 6000 * mods['duration'];
      const baseDamage = stats.damage * mods['damage'];
      
      if (ownerId === 'player') {
          this.host.holdAbilityEndTime = Date.now() + duration + 2000; 
      } else {
          const eAny = sourceBody.plugin['data'] as any;
          if (eAny) eAny.holdAbilityEndTime = Date.now() + duration + 2000;
      }
      
      const egg = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, 20, {
          isStatic: true, isSensor: true, label: 'projectile',
          plugin: { data: { id: Math.random().toString(), type: 'egg', health: 1000, maxHealth: 1000, size: 20, aggroTarget: null, ownerId: ownerId } as any }
      });
      Matter.Composite.add(this.host.engine.world, egg);
      
      this.host.audioService.playSFX('drop');
      
      setTimeout(() => {
          if (!egg.parent) return;
          this.host.audioService.playSFX('shoot');
          
          const baby = Matter.Bodies.circle(egg.position.x, egg.position.y - 30, 15, {
              isSensor: true, label: 'projectile', frictionAir: 0.1,
              plugin: { data: { id: Math.random().toString(), type: 'turret', health: 500, maxHealth: 500, size: 15, ownerId: ownerId } as EnemyData }
          });
          Matter.Composite.add(this.host.engine.world, baby);
          
          let exploded = false;
          let fireInterval: any;
          let boidLogic: any;
          
          const explode = () => {
              if (exploded) return;
              exploded = true;
              if (boidLogic) Matter.Events.off(this.host.engine, 'beforeUpdate', boidLogic);
              if (fireInterval) clearInterval(fireInterval);
              
              this.host.audioService.playSFX('explosion');
              const radius = 200;
              
              for (let i = 0; i < 40; i++) {
                  const angle = Math.random() * Math.PI * 2;
                  const speed = this.host.scaledSpeed(Math.random() * 4 + 2);
                  const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
                  const proj = Matter.Bodies.circle(egg.position.x, egg.position.y, 15, {
                      isSensor: true, label: 'projectile',
                      plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'turret_blast', health: 1, maxHealth: 1, burstDamage: baseDamage * 5, owner: ownerId } as EnemyData }
                  });
                  Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, speed));
                  Matter.Composite.add(this.host.engine.world, proj);
                  setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj) }, 500 + Math.random() * 300);
              }
              
              const validTargets = ownerId === 'player' ? this.host.enemies : [this.host.playerBody];
              validTargets.forEach(e => {
                  const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, egg.position));
                  if (dist < radius) {
                      if (e === this.host.playerBody) this.host.takeDamage(baseDamage * 5);
                      else this.host.damageEnemy(e, baseDamage * 5, egg.position);
                  }
              });
              
              if (baby.parent) Matter.Composite.remove(this.host.engine.world, baby);
              if (egg.parent) Matter.Composite.remove(this.host.engine.world, egg);
          };

          let isReturning = false;
          boidLogic = () => {
              const eggData = egg.plugin['data'] as any;
              if (eggData && eggData.health <= 0 && !exploded) {
                  explode();
                  return;
              }
              
              if (!baby.parent || !egg.parent) {
                  if (!exploded) explode();
                  return;
              }
              
              const speed = (isReturning ? 2 : (eggData.aggroTarget ? 1.5 : 1)) * this.host.speedScale;
              const maxTurnForce = 0.5;
              let combinedForce = { x: 0, y: 0 };
              
              if (isReturning) {
                  const dir = Matter.Vector.normalise(Matter.Vector.sub(egg.position, baby.position));
                  combinedForce.x = dir.x * 5.0;
                  combinedForce.y = dir.y * 5.0;
              } else {
                  const t = Date.now() * 0.002;
                  const wanderForce = { x: Math.cos(t), y: Math.sin(t) };
                  combinedForce.x += wanderForce.x * 0.5;
                  combinedForce.y += wanderForce.y * 0.5;
                  
                  const validTargets = ownerId === 'player' ? this.host.enemies : [this.host.playerBody];
                  if (validTargets.length > 0) {
                      let nearest: Matter.Body;
                      if (eggData && eggData.aggroTarget && eggData.aggroTarget.parent) {
                          nearest = eggData.aggroTarget;
                      } else {
                          nearest = validTargets[0];
                          let minDist = Infinity;
                          validTargets.forEach(e => {
                              const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, baby.position));
                              if (dist < minDist) { minDist = dist; nearest = e; }
                          });
                      }
                      
                      const distToNearest = Matter.Vector.magnitude(Matter.Vector.sub(nearest.position, baby.position));
                      if (distToNearest < seekRange) {
                          const dir = Matter.Vector.normalise(Matter.Vector.sub(nearest.position, baby.position));
                          combinedForce.x += dir.x * 2.0;
                          combinedForce.y += dir.y * 2.0;
                      }
                  }
                  
                  const distToEgg = Matter.Vector.magnitude(Matter.Vector.sub(baby.position, egg.position));
                  if (distToEgg > tetherRange) {
                      const repel = Matter.Vector.normalise(Matter.Vector.sub(egg.position, baby.position));
                      const repelStrength = (distToEgg - tetherRange) * 0.1;
                      combinedForce.x += repel.x * repelStrength;
                      combinedForce.y += repel.y * repelStrength;
                  }
              }
              
              if (combinedForce.x === 0 && combinedForce.y === 0) combinedForce = { x: 1, y: 0 };
              const desiredVelocity = Matter.Vector.mult(Matter.Vector.normalise(combinedForce), speed);
              const steering = Matter.Vector.sub(desiredVelocity, baby.velocity);
              const steeringMag = Matter.Vector.magnitude(steering);
              
              if (steeringMag > maxTurnForce) {
                  const limitedSteering = Matter.Vector.mult(Matter.Vector.normalise(steering), maxTurnForce);
                  Matter.Body.applyForce(baby, baby.position, Matter.Vector.mult(limitedSteering, 0.005));
              } else {
                  Matter.Body.applyForce(baby, baby.position, Matter.Vector.mult(steering, 0.005));
              }
              
              const currentSpeed = Matter.Vector.magnitude(baby.velocity);
              if (currentSpeed > 0) {
                 Matter.Body.setVelocity(baby, Matter.Vector.mult(Matter.Vector.normalise(baby.velocity), speed));
              } else {
                 Matter.Body.setVelocity(baby, { x: speed, y: 0 });
              }
          };
          
          Matter.Events.on(this.host.engine, 'beforeUpdate', boidLogic);

          fireInterval = setInterval(() => {
              if (!baby.parent || this.host.gameEnded()) {
                  clearInterval(fireInterval);
                  return;
              }
              
              const validTargets = ownerId === 'player' ? this.host.enemies : [this.host.playerBody];
              if (validTargets.length > 0) {
                  const eggData = egg.plugin['data'] as any;
                  let nearest = null;
                  if (eggData && eggData.aggroTarget && eggData.aggroTarget.parent) {
                      nearest = eggData.aggroTarget;
                  } else {
                      nearest = validTargets[0];
                      let minDist = Infinity;
                      validTargets.forEach(e => {
                          const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, baby.position));
                          if (dist < minDist) { minDist = dist; nearest = e; }
                      });
                  }
                  
                  const distToNearest = Matter.Vector.magnitude(Matter.Vector.sub(nearest.position, baby.position));
                  if (distToNearest < seekRange) {
                      const dir = Matter.Vector.normalise(Matter.Vector.sub(nearest.position, baby.position));
                      for(let i=0; i<5; i++) {
                          setTimeout(() => {
                              if (!baby.parent) return;
                              const spreadAngle = (Math.random() - 0.5) * 0.5;
                              const angle = Math.atan2(dir.y, dir.x) + spreadAngle;
                              const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
                              const proj = Matter.Bodies.circle(baby.position.x, baby.position.y, 10, {
                                  isSensor: true, label: 'projectile',
                                  // S3 owner fix: the baby's shots now
                                  // carry owner alongside ownerId (the
                                  // S2 fire-breath fix pattern). Without
                                  // it, a player turret's own shots could
                                  // not be skipped by the player collision
                                  // branch and damaged the player who
                                  // deployed the turret.
                                  plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'turret_shot', health: 1, maxHealth: 1, burstDamage: baseDamage, owner: ownerId, ownerId: ownerId } as EnemyData }
                              });
                              Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, this.host.scaledSpeed(7.5)));
                              Matter.Composite.add(this.host.engine.world, proj);
                              setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj) }, 1000);
                          }, i * 50);
                      }
                  }
              }
          }, 500);

          setTimeout(() => {
              if (!baby.parent || !egg.parent || exploded) return;
              isReturning = true;
              
              const returnCheck = setInterval(() => {
                  if (!baby.parent || !egg.parent || exploded || this.host.gameEnded()) { clearInterval(returnCheck); return; }
                  const dist = Matter.Vector.magnitude(Matter.Vector.sub(baby.position, egg.position));
                  if (dist < 20) {
                      clearInterval(returnCheck);
                      explode();
                  }
              }, 50);
              
              setTimeout(() => {
                  clearInterval(returnCheck);
                  if (baby.parent && egg.parent && !exploded) explode();
              }, 2000);
          }, duration);
      }, 2000);
      return ownerId === 'player' ? cd : cd + (duration + 2000) / 1000;
  }


  // Aim direction from a body toward a target point, with a safe
  // fallback (straight up) when the point sits exactly on the body.
aimAngle(sourceBody: Matter.Body, targetX: number, targetY: number): number {
      const dx = targetX - sourceBody.position.x;
      const dy = targetY - sourceBody.position.y;
      if (dx === 0 && dy === 0) return -Math.PI / 2;
      return Math.atan2(dy, dx);
  }

  // S2 shared projectile construction. Every ability projectile
  // carries BOTH owner and ownerId (the convention the aura fix
  // established): the player collision branch skips owner 'player',
  // the enemy branch skips owner 'enemy', and the projectile clash
  // branch requires owner on both bodies. A projectile missing owner
  // collides with its own caster at spawn: that is the defect the S2
  // probes measured on fire breath and on the old burst fan
  // (STAGE-S2.md), and no S2 move may reintroduce it.
spawnAbilityProjectile(opts: {
      x: number, y: number, radius: number, type: EnemyData['type'], moveId: string,
      damage: number, ownerId: string, angle: number, speedPerStep: number, lifeMs: number,
      extra?: Partial<EnemyData>
  }): Matter.Body {
      const data = {
          id: Math.random().toString(), type: opts.type, health: 1, maxHealth: 1,
          burstDamage: opts.damage, owner: opts.ownerId, ownerId: opts.ownerId,
          moveId: opts.moveId, ...(opts.extra || {})
      } as EnemyData;
      const proj = Matter.Bodies.circle(opts.x, opts.y, opts.radius, {
          label: 'projectile', isSensor: true, plugin: { data }
      });
      Matter.Body.setVelocity(proj, { x: Math.cos(opts.angle) * opts.speedPerStep, y: Math.sin(opts.angle) * opts.speedPerStep });
      Matter.Composite.add(this.host.engine.world, proj);
      setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.host.engine.world, proj); }, opts.lifeMs);
      return proj;
  }

triggerBurst(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['burst'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0, count: 1.0 };
      const baseCooldown = ABILITIES['burst']?.baseCooldown || 6;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // S2 redesign (systems spec Section 3.3): Burst is a true radial
      // ring, 8 bolts of 0.8 SU each (6.4 SU total), cooldown 6 s.
      // PI 1.07 at its intended 2.5-target profile, 0.27 against a
      // single target: the ring is the crowd answer, not a duel tool.
      // The aimed fan it used to fire moved to Phoenix Talon with its
      // geometry unchanged. The ring count is the move's identity, not
      // an upgrade axis: Burst's upgrade targets stay cooldown, damage
      // and radius, and only cooldown and damage are read here (the
      // same convention the old fan used for 'count').
      const damage = (stats.damage || 10) * 0.8 * (mods['damage'] ?? 1.0);
      const type = ownerId === 'player' ? 'projectile_player' : 'projectile_enemy';
      for (let k = 0; k < 8; k++) {
          this.spawnAbilityProjectile({
              x: sourceBody.position.x, y: sourceBody.position.y, radius: 8,
              type, moveId: 'burst', damage, ownerId,
              angle: k * Math.PI / 4, speedPerStep: this.host.scaledSpeed(10), lifeMs: 1000
          });
      }
      this.host.audioService.playSFX('shoot');
      return cd;
  }

triggerPhoenixTalon(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['phoenix_talon'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['phoenix_talon']?.baseCooldown || 7;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: three slashes of 1.5 SU in a fan, the exact
      // geometry Burst fired before S2 (offsets (i-1) x 0.15 rad
      // around the aim direction, speed 10, 2 s life). PI 0.96.
      const damage = (stats.damage || 10) * 1.5 * (mods['damage'] ?? 1.0);
      const type = ownerId === 'player' ? 'projectile_player' : 'projectile_enemy';
      const baseAngle = this.aimAngle(sourceBody, targetX, targetY);
      for (let i = 0; i < 3; i++) {
          this.spawnAbilityProjectile({
              x: sourceBody.position.x, y: sourceBody.position.y, radius: 8,
              type, moveId: 'phoenix_talon', damage, ownerId,
              angle: baseAngle + (i - 1) * 0.15, speedPerStep: this.host.scaledSpeed(10), lifeMs: 2000
          });
      }
      this.host.audioService.playSFX('shoot');
      return cd;
  }

triggerFireDart(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['fire_dart'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['fire_dart']?.baseCooldown || 2;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: one 1.5 SU projectile, no homing, the shortest
      // cooldown in the game (2 s). PI 1.1: its trade is that a miss
      // is a total loss, with no spread and no seeking to save it.
      const damage = (stats.damage || 10) * 1.5 * (mods['damage'] ?? 1.0);
      this.spawnAbilityProjectile({
          x: sourceBody.position.x, y: sourceBody.position.y, radius: 6,
          type: 'dart', moveId: 'fire_dart', damage, ownerId,
          angle: this.aimAngle(sourceBody, targetX, targetY), speedPerStep: this.host.scaledSpeed(12), lifeMs: 2000
      });
      this.host.audioService.playSFX('shoot');
      return cd;
  }

triggerSparkStorm(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['spark_storm'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['spark_storm']?.baseCooldown || 9;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: 6 homing sparks of 0.8 SU that seek SEPARATE
      // targets when available (PI 0.8). Targets are assigned round
      // robin at cast time; the steering lives in the physics loop
      // (see the spark block in the beforeUpdate handler). An enemy
      // cast seeks the player bird via the '__player__' sentinel.
      const damage = (stats.damage || 10) * 0.8 * (mods['damage'] ?? 1.0);
      const aim = this.aimAngle(sourceBody, targetX, targetY);
      let targetIds: string[] = [];
      if (ownerId === 'player') {
          targetIds = this.host.enemies
              .map(e => (e.plugin['data'] as EnemyData)?.id)
              .filter((id): id is string => !!id);
      } else {
          targetIds = ['__player__'];
      }
      for (let i = 0; i < 6; i++) {
          const targetId = targetIds.length ? targetIds[i % targetIds.length] : undefined;
          this.spawnAbilityProjectile({
              x: sourceBody.position.x, y: sourceBody.position.y, radius: 5,
              type: 'spark', moveId: 'spark_storm', damage, ownerId,
              angle: aim + (i - 2.5) * 0.18, speedPerStep: this.host.scaledSpeed(8), lifeMs: 2500,
              extra: targetId ? { targetId } : undefined
          });
      }
      this.host.audioService.playSFX('shoot');
      return cd;
  }

triggerFireLance(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['fire_lance'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['fire_lance']?.baseCooldown || 8;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: one 3.5 SU piercing line, no tracking (PI 1.3 at
      // 2 targets in the line, 0.66 single). Piercing is implemented
      // in the enemy collision branch: the lance is not consumed on
      // hit and hitIds records what it has already damaged.
      const damage = (stats.damage || 10) * 3.5 * (mods['damage'] ?? 1.0);
      this.spawnAbilityProjectile({
          x: sourceBody.position.x, y: sourceBody.position.y, radius: 10,
          type: 'lance', moveId: 'fire_lance', damage, ownerId,
          angle: this.aimAngle(sourceBody, targetX, targetY), speedPerStep: this.host.scaledSpeed(13), lifeMs: 1600,
          extra: { pierce: true, hitIds: [] }
      });
      this.host.audioService.playSFX('shoot');
      return cd;
  }

triggerFlameTornado(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['flame_tornado'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['flame_tornado']?.baseCooldown || 12;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3 (catalog triple_3), final sweep: a stationary
      // zone at the aim point for 3 s, ticking 0.5 SU every 0.5 s to
      // every enemy inside (3 SU per enemy at full duration). Range
      // class Mid: the zone center is clamped to half the min
      // dimension from the caster. Area class Medium: radius
      // 0.30 x min dimension. Zero burst by design: the payment for
      // area denial is that enemies can walk out of it. Built like
      // Aura (a burstDamage 0 sensor body plus an explicit tick
      // clock, so the damage never depends on physics contact
      // timing), except the zone stands where it was cast instead
      // of following the caster. The vortex visual is the
      // 'flame_tornado' builder type, spun by the renderer.
      const radius = 0.30 * this.host.logicalUnit;
      const maxRange = 0.5 * this.host.logicalUnit;
      let cx = targetX, cy = targetY;
      const dx = cx - sourceBody.position.x, dy = cy - sourceBody.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRange) {
          cx = sourceBody.position.x + dx / dist * maxRange;
          cy = sourceBody.position.y + dy / dist * maxRange;
      }
      const tickDamage = (stats.damage || 10) * 0.5 * (mods['damage'] ?? 1.0);
      const duration = 3000;
      const zone = Matter.Bodies.circle(cx, cy, radius, {
          isSensor: true,
          label: 'projectile',
          plugin: { data: { id: Math.random().toString(), type: 'flame_tornado', owner: ownerId, ownerId: ownerId, burstDamage: 0, health: 1, maxHealth: 1 } as EnemyData }
      });
      Matter.Composite.add(this.host.engine.world, zone);
      this.host.audioService.playSFX('shoot');

      const tickInterval = setInterval(() => {
          if (!zone.parent || this.host.gameEnded()) {
              clearInterval(tickInterval);
              return;
          }
          if (ownerId === 'player') {
              // Snapshot the list: damageEnemy can remove bodies
              // and spawn splits while the loop runs (Aura's rule).
              for (const e of [...this.host.enemies]) {
                  if (e === sourceBody) continue;
                  const d = Math.hypot(e.position.x - cx, e.position.y - cy);
                  if (d < radius) this.host.damageEnemy(e, tickDamage, { x: cx, y: cy });
              }
          } else {
              const d = Math.hypot(this.host.playerBody.position.x - cx, this.host.playerBody.position.y - cy);
              if (d < radius && !this.host.isDead()) this.host.takeDamage(tickDamage);
          }
      }, 500);

      setTimeout(() => {
          clearInterval(tickInterval);
          if (zone.parent) Matter.Composite.remove(this.host.engine.world, zone);
      }, duration);

      return cd;
  }

triggerSolarBomb(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['solar_bomb'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['solar_bomb']?.baseCooldown || 9;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3 (catalog triple_5), final sweep: the roster's
      // biggest non-ultimate single hit, 5 SU, paid for with a
      // 0.4 s fuse after the orb lands (dodgeable by fast enemies,
      // and by players in Battle). The orb travels slowly (3.5 per
      // step, Dart-class is 12 to 13) from the caster to the aim
      // point, swells through the fuse as growing fire blobs (the
      // Supernova telegraph construction), then bursts over
      // Medium radius (0.30 x min dimension) with the shared impact
      // effect (Section 4.2 Medium tier: burst plus one ring).
      // The orb body carries burstDamage 0, so no collision branch
      // interacts with it; the detonation is an explicit area
      // packet, applied once, like Supernova's.
      const damage = (stats.damage || 10) * 5 * (mods['damage'] ?? 1.0);
      const radius = 0.30 * this.host.logicalUnit;
      const orb = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, 14 * this.host.speedScale, {
          isSensor: true,
          label: 'projectile',
          plugin: { data: { id: Math.random().toString(), type: 'solar_bomb', owner: ownerId, ownerId: ownerId, burstDamage: 0, health: 1, maxHealth: 1 } as EnemyData }
      });
      Matter.Composite.add(this.host.engine.world, orb);
      this.host.audioService.playSFX('shoot');

      const speedPerSec = this.host.scaledSpeed(3.5) * 60;
      let fused = false;
      const detonate = () => {
          if (!orb.parent) return;
          Matter.Composite.remove(this.host.engine.world, orb);
          if (this.host.gameEnded()) return;
          if (ownerId === 'player') {
              for (const e of [...this.host.enemies]) {
                  if (e === sourceBody) continue;
                  const d = e.plugin['data'] as EnemyData;
                  if (!d) continue;
                  if (Math.hypot(e.position.x - targetX, e.position.y - targetY) <= radius) {
                      this.host.damageEnemy(e, damage, { x: targetX, y: targetY });
                  }
              }
          } else if (!this.host.isDead() && Math.hypot(this.host.playerBody.position.x - targetX, this.host.playerBody.position.y - targetY) <= radius) {
              this.host.takeDamage(damage);
          }
          this.host.triggerImpactEffect(targetX, targetY, true);
          this.host.audioService.playSFX('explosion');
      };
      const travel = setInterval(() => {
          if (!orb.parent || this.host.gameEnded()) { clearInterval(travel); return; }
          const dx = targetX - orb.position.x, dy = targetY - orb.position.y;
          const d = Math.hypot(dx, dy);
          const step = speedPerSec * 0.04;
          if (d <= Math.max(step, 6)) {
              clearInterval(travel);
              if (fused) return;
              fused = true;
              Matter.Body.setPosition(orb, { x: targetX, y: targetY });
              // The 0.4 s fuse: two swelling fire blobs on a
              // stagger, the Supernova telegraph read at fuse scale.
              for (let i = 0; i < 2; i++) {
                  setTimeout(() => {
                      if (this.host.gameEnded()) return;
                      const blob = Matter.Bodies.circle(targetX, targetY, (12 + i * 10) * this.host.speedScale, {
                          label: 'projectile', isSensor: true,
                          plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'solar_fuse', health: 1, maxHealth: 1, burstDamage: 0, owner: ownerId === 'player' ? 'player' : 'enemy', ownerId } as EnemyData }
                      });
                      Matter.Composite.add(this.host.engine.world, blob);
                      setTimeout(() => { if (blob.parent) Matter.Composite.remove(this.host.engine.world, blob); }, 420 - i * 200);
                  }, i * 200);
              }
              setTimeout(detonate, 400);
          } else {
              Matter.Body.setPosition(orb, { x: orb.position.x + dx / d * step, y: orb.position.y + dy / d * step });
          }
      }, 40);
      // Hard lifetime guard: an orb whose target became unreachable
      // (caster died mid-flight in a mode that clears bodies) never
      // lingers past 6 s.
      setTimeout(() => { clearInterval(travel); if (orb.parent) Matter.Composite.remove(this.host.engine.world, orb); }, 6000);

      return cd;
  }

triggerMeteorRush(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['meteor_rush'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['meteor_rush']?.baseCooldown || 10;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: 3 SU to each enemy crossed during a 600 ms rush.
      // The named trade against Drill is exposure: the rush grants NO
      // damage reduction and does not skip the caster's own contact
      // damage; the collision branch applies the rush hit and the
      // normal contact rules independently. PI 0.9 at 2 crossed.
      const damage = (stats.damage || 10) * 3 * (mods['damage'] ?? 1.0);
      const duration = 600;
      this.host.audioService.playSFX('shoot');
      if (ownerId === 'player') {
          this.host.gameState.isMeteorRushing.set(true);
          this.host.meteorRushUntilMs = Date.now() + duration;
          this.host.meteorRushDamageValue = damage;
          this.host.meteorRushHitIds.clear();
          setTimeout(() => { this.host.gameState.isMeteorRushing.set(false); }, duration);
      } else {
          const d = sourceBody.plugin['data'] as EnemyData;
          if (d) {
              d.meteorRushUntil = Date.now() + duration;
              d.meteorRushDamage = damage;
              d.meteorRushHits = [];
          }
      }
      return cd;
  }


triggerAura(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['aura'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, duration: 1.0, radius: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['aura']?.baseCooldown || 17;
      // Aura's upgrade targets define damage and radius only, so its
      // cooldown and duration multipliers are absent from the record;
      // an absent multiplier reads as 1.0 (the same convention as
      // slotMaxCooldown). Reading them raw produced NaN: the cooldown
      // never engaged and the zone's removal timer fired immediately.
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);

      const duration = 5000 * (mods['duration'] ?? 1.0);
      // Radius wired to the auraRadius stat (spec Sections 3.1 and
      // 5.1): it used to be a hardcoded 150 while the shop passive of
      // the same name (base 250) fed a different path.
      const radius = stats.auraRadius * mods['radius'];

      // S3 tick math (spec Section 3.3): the zone deals 0.25 SU per
      // tick, 2 ticks per second, for 5 s (25 damage total at base
      // stats, PI about 0.5 with the zone's defensive credit). The
      // old implementation dealt damage through the collision
      // branch at 0.5 SU per contact event, which made the total
      // depend on physics contact timing instead of the spec's
      // clock. The visual body now carries burstDamage 0, so both
      // collision branches skip it, and an explicit interval applies
      // the ticks to everything inside the radius of the caster's
      // live position.
      const tickDamage = stats.damage * 0.25 * mods['damage'];
      const aura = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, radius, {
          isSensor: true,
          label: 'projectile',
          plugin: { data: { id: Math.random().toString(), type: 'aura', owner: ownerId, ownerId: ownerId, burstDamage: 0, health: 1, maxHealth: 1 } as EnemyData }
      });

      Matter.Composite.add(this.host.engine.world, aura);
      this.host.audioService.playSFX('heal');

      const updateAura = () => {
          if (!aura.parent || this.host.isDead() || this.host.gameEnded()) return;
          Matter.Body.setPosition(aura, sourceBody.position);
      };

      Matter.Events.on(this.host.engine, 'beforeUpdate', updateAura);

      const tickInterval = setInterval(() => {
          if (!aura.parent || !sourceBody.parent || this.host.gameEnded()) {
              clearInterval(tickInterval);
              return;
          }
          const cx = sourceBody.position.x;
          const cy = sourceBody.position.y;
          if (ownerId === 'player') {
              // Snapshot the list: damageEnemy can remove bodies and
              // spawn splits while the loop runs.
              for (const e of [...this.host.enemies]) {
                  const d = Math.hypot(e.position.x - cx, e.position.y - cy);
                  if (d < radius) this.host.damageEnemy(e, tickDamage, sourceBody.position);
              }
          } else {
              const d = Math.hypot(this.host.playerBody.position.x - cx, this.host.playerBody.position.y - cy);
              if (d < radius && !this.host.isDead()) this.host.takeDamage(tickDamage);
          }
      }, 500);

      setTimeout(() => {
          clearInterval(tickInterval);
          if (aura.parent) Matter.Composite.remove(this.host.engine.world, aura);
          Matter.Events.off(this.host.engine, 'beforeUpdate', updateAura);
      }, duration);

      return cd;
  }

triggerPhoenixInferno(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['phoenix_inferno'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['phoenix_inferno']?.baseCooldown || 14;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: a channeled beam, 1.2 SU per 0.25 s tick for up
      // to 3 s (14.4 SU for a full channel, PI 1.27 across the whole
      // cycle). The caster is held at Feather Brake speed for the
      // channel (the player's brake is forced in the physics loop;
      // the rival's channel end rides on its body data), and the
      // cooldown only starts when the beam stops, which the caller
      // sees as the returned cooldown plus the channel length for AI
      // and as holdAbilityEndTime for the player.
      const tickDamage = (stats.damage || 10) * 1.2 * (mods['damage'] ?? 1.0);
      const channelMs = 3000;
      const channelEnd = Date.now() + channelMs;
      if (ownerId === 'player') {
          this.host.playerInfernoUntil = channelEnd;
          this.host.holdAbilityEndTime = channelEnd;
      } else {
          const d = sourceBody.plugin['data'] as EnemyData;
          if (d) d.infernoUntil = channelEnd;
      }
      this.host.audioService.playSFX('shoot');

      const range = 0.5 * this.host.logicalUnit;
      const halfWidth = 30 * this.host.speedScale;
      let visualFlip = false;
      const tick = setInterval(() => {
          if (Date.now() >= channelEnd || !sourceBody.parent || this.host.gameEnded()
              || (ownerId === 'player' && (this.host.isDead() || this.host.gameState.isRebirthing()))) {
              clearInterval(tick);
              return;
          }
          // The beam follows the caster's current aim: for the
          // player that is the mouse, for the rival its steering
          // target (the player bird).
          let aimX: number, aimY: number;
          if (ownerId === 'player') {
              aimX = this.host.mouseX; aimY = this.host.mouseY;
          } else {
              aimX = this.host.playerBody.position.x; aimY = this.host.playerBody.position.y;
          }
          const sx = sourceBody.position.x;
          const sy = sourceBody.position.y;
          let ax = aimX - sx;
          let ay = aimY - sy;
          const alen = Math.hypot(ax, ay);
          if (alen < 1) { ax = 0; ay = -1; } else { ax /= alen; ay /= alen; }
          const targets = ownerId === 'player' ? [...this.host.enemies] : [this.host.playerBody];
          for (const t of targets) {
              const rx = t.position.x - sx;
              const ry = t.position.y - sy;
              const along = rx * ax + ry * ay;
              if (along < 0 || along > range) continue;
              const perp = Math.abs(rx * -ay + ry * ax);
              if (perp > halfWidth) continue;
              if (t === this.host.playerBody) this.host.takeDamage(tickDamage);
              else this.host.damageEnemy(t, tickDamage, sourceBody.position);
          }
          // Beam visual: short-lived fire blobs along the corridor,
          // alternating ticks. They carry burstDamage 0, so both
          // collision branches skip them; they are pure display.
          visualFlip = !visualFlip;
          if (visualFlip) {
              for (let s = 1; s <= 5; s++) {
                  const bx = sx + ax * range * (s / 6) + (Math.random() - 0.5) * 14 * this.host.speedScale;
                  const by = sy + ay * range * (s / 6) + (Math.random() - 0.5) * 14 * this.host.speedScale;
                  const blob = Matter.Bodies.circle(bx, by, 13, {
                      isSensor: true, label: 'projectile',
                      plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'inferno_beam', health: 1, maxHealth: 1, burstDamage: 0, owner: ownerId, ownerId: ownerId } as EnemyData }
                  });
                  Matter.Composite.add(this.host.engine.world, blob);
                  setTimeout(() => { if (blob.parent) Matter.Composite.remove(this.host.engine.world, blob); }, 260);
              }
          }
      }, 250);

      return ownerId === 'player' ? cd : cd + channelMs / 1000;
  }

triggerInfernoWave(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['inferno_wave'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['inferno_wave']?.baseCooldown || 16;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3: an expanding ring, 3 SU to every enemy it
      // crosses (a swarm clearer; single-target PI is low by
      // design). All 16 bolts share one hitIds array with pierce, so
      // the ring's two sides crossing the same enemy still hit it
      // exactly once per cast. The ring is the same construction as
      // Burst's, at hold-family damage and a longer life.
      const damage = (stats.damage || 10) * 3 * (mods['damage'] ?? 1.0);
      const type = ownerId === 'player' ? 'projectile_player' : 'projectile_enemy';
      const sharedHitIds: string[] = [];
      for (let k = 0; k < 16; k++) {
          this.spawnAbilityProjectile({
              x: sourceBody.position.x, y: sourceBody.position.y, radius: 8,
              type, moveId: 'inferno_wave', damage, ownerId,
              angle: k * Math.PI / 8, speedPerStep: this.host.scaledSpeed(6), lifeMs: 2500,
              extra: { pierce: true, hitIds: sharedHitIds }
          });
      }
      this.host.audioService.playSFX('shoot');
      return cd;
  }

  // S4 ultimates (systems spec Section 3.3, the triple-tap slot).
  // Shared conventions: modifiers read with the S1 fallbacks (an
  // absent key is 1.0), damage is SU times the damage stat times
  // the damage modifier, and every trigger registers its cast
  // first so every packet against a boss-class target (or the
  // player, for an enemy cast) passes the per-cast 25 percent cap.

triggerPhoenixNova(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['phoenix_nova'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['phoenix_nova']?.baseCooldown || 60;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3 (catalog hold_5): 25 SU to everything within
      // Large radius, clamped by the burst cap. Built as a ring of
      // 24 piercing bolts sharing one hit set (the Inferno Wave
      // construction at ultimate density), so each target takes
      // the packet once per cast. Speed and life are sized to the
      // Large radius (0.5 x min dimension): at 10 per step for
      // 900 ms a bolt covers about 0.55 x min dimension on the
      // reference phone.
      const damage = (stats.damage || 10) * 25 * (mods['damage'] ?? 1.0);
      const castId = this.host.registerUltCast(ownerId);
      const sharedHitIds: string[] = [];
      for (let k = 0; k < 24; k++) {
          this.spawnAbilityProjectile({
              x: sourceBody.position.x, y: sourceBody.position.y, radius: 10,
              type: 'nova', moveId: 'phoenix_nova', damage, ownerId,
              angle: k * Math.PI / 12, speedPerStep: this.host.scaledSpeed(10), lifeMs: 900,
              extra: { pierce: true, hitIds: sharedHitIds, ultCastId: castId, owner: ownerId === 'player' ? 'player' : 'enemy' }
          });
      }
      this.host.audioService.playSFX('explosion');
      return cd;
  }

triggerSupernova(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['supernova'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['supernova']?.baseCooldown || 75;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3 (catalog triple_8): a visible mass swells at
      // the target point for a 0.8 s fuse (the telegraph: three
      // harmless fire blobs growing on a 250 ms stagger), then
      // detonates for 18 SU to everything inside Medium radius
      // (0.30 x min dimension).
      const damage = (stats.damage || 10) * 18 * (mods['damage'] ?? 1.0);
      const castId = this.host.registerUltCast(ownerId);
      const radius = 0.30 * this.host.logicalUnit;
      for (let i = 0; i < 3; i++) {
          setTimeout(() => {
              if (this.host.gameEnded()) return;
              const blob = Matter.Bodies.circle(targetX, targetY, (10 + i * 10) * this.host.speedScale, {
                  label: 'projectile', isSensor: true,
                  plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'supernova_ember', health: 1, maxHealth: 1, burstDamage: 0, owner: ownerId === 'player' ? 'player' : 'enemy', ownerId } as EnemyData }
              });
              Matter.Composite.add(this.host.engine.world, blob);
              setTimeout(() => { if (blob.parent) Matter.Composite.remove(this.host.engine.world, blob); }, 850 - i * 250);
          }, i * 250);
      }
      setTimeout(() => {
          if (this.host.gameEnded() || this.host.isDead()) return;
          for (const e of [...this.host.enemies]) {
              if (e === sourceBody) continue;
              const d = e.plugin['data'] as EnemyData;
              if (!d) continue;
              if (Math.hypot(e.position.x - targetX, e.position.y - targetY) <= radius) {
                  this.host.damageEnemy(e, damage, { x: targetX, y: targetY }, castId);
              }
          }
          if (ownerId !== 'player' && Math.hypot(this.host.playerBody.position.x - targetX, this.host.playerBody.position.y - targetY) <= radius) {
              this.host.takeDamage(this.host.clampUltDamage(castId, '__player__', this.host.currentHealth(), damage));
          }
          this.host.triggerImpactEffect(targetX, targetY, true);
      }, 800);
      this.host.audioService.playSFX('shoot');
      return cd;
  }

triggerDivineWrath(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['divine_wrath'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['divine_wrath']?.baseCooldown || 70;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3 (catalog hold_8): 5 strikes of 3 SU over 2 s,
      // columns at the enemies nearest the target point inside a
      // Large area (0.5 x min dimension), cycling the living. The
      // player cast locks the caster for the first 0.5 s on the
      // same forced-brake field the Phoenix Inferno channel uses.
      const damage = (stats.damage || 10) * 3 * (mods['damage'] ?? 1.0);
      const castId = this.host.registerUltCast(ownerId);
      const areaR = 0.5 * this.host.logicalUnit;
      const targets = this.host.enemies
          .filter(e => e !== sourceBody && Math.hypot(e.position.x - targetX, e.position.y - targetY) <= areaR)
          .sort((a, b) => Math.hypot(a.position.x - targetX, a.position.y - targetY) - Math.hypot(b.position.x - targetX, b.position.y - targetY))
          .slice(0, 5);
      if (ownerId === 'player') {
          this.host.playerInfernoUntil = Math.max(this.host.playerInfernoUntil, Date.now() + 500);
      } else {
          // Final sweep (S4's later-AI-pass flag): an enemy caster
          // takes the same 0.5 s cast lock the player takes, as a
          // forced brake on its body data; the rival steering loop
          // honors wrathLockUntil exactly like the Inferno channel's
          // infernoUntil.
          const d = sourceBody.plugin['data'] as EnemyData;
          if (d) d.wrathLockUntil = Math.max(d.wrathLockUntil || 0, Date.now() + 500);
      }
      for (let s = 0; s < 5; s++) {
          setTimeout(() => {
              if (this.host.gameEnded()) return;
              if (ownerId === 'player') {
                  const live = targets.filter(t => t.parent && ((t.plugin['data'] as EnemyData)?.health || 0) > 0);
                  if (!live.length) return;
                  const t = live[s % live.length];
                  this.host.damageEnemy(t, damage, t.position, castId);
                  this.spawnWrathColumn(t.position.x, t.position.y);
              } else if (Math.hypot(this.host.playerBody.position.x - targetX, this.host.playerBody.position.y - targetY) <= areaR) {
                  this.host.takeDamage(this.host.clampUltDamage(castId, '__player__', this.host.currentHealth(), damage));
                  this.spawnWrathColumn(this.host.playerBody.position.x, this.host.playerBody.position.y);
              }
          }, s * 400);
      }
      this.host.audioService.playSFX('explosion');
      return cd;
  }

  // A Divine Wrath strike visual: a short-lived column of harmless
  // fire bodies (burstDamage 0, so every collision branch skips it).
spawnWrathColumn(x: number, y: number) {
      for (let i = 0; i < 4; i++) {
          const blob = Matter.Bodies.circle(x + (Math.random() - 0.5) * 20 * this.host.speedScale, y - i * 34 * this.host.speedScale, 12 * this.host.speedScale, {
              label: 'projectile', isSensor: true,
              plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'wrath_column', health: 1, maxHealth: 1, burstDamage: 0 } as EnemyData }
          });
          Matter.Composite.add(this.host.engine.world, blob);
          setTimeout(() => { if (blob.parent) Matter.Composite.remove(this.host.engine.world, blob); }, 220);
      }
  }

triggerPhoenixSingularity(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['phoenix_singularity'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['phoenix_singularity']?.baseCooldown || 90;
      const cd = baseCooldown * (mods['cooldown'] ?? 1.0);
      // Section 3.3 (catalog hold_24): a vortex at the target point
      // pulls everything inside Medium radius (0.30 x min
      // dimension) toward it for 2 s, then detonates for 15 SU
      // inside the same radius. The pull blends velocities toward
      // the point every 50 ms; the detonation is the packet the
      // cast clamp caps. The birds are position-steered by the
      // renderer, so the pull reaches them through the published
      // pull signal below, not through this blend.
      const damage = (stats.damage || 10) * 15 * (mods['damage'] ?? 1.0);
      const castId = this.host.registerUltCast(ownerId);
      const radius = 0.30 * this.host.logicalUnit;
      // Final sweep: the velocity blend below drags Matter enemies,
      // but the two birds are renderer-owned and position-steered,
      // so an enemy cast never pulled the player (S4's flag). The
      // pull is now also published on the game state, and
      // bird-physics blends the target bird's steering target
      // toward the vortex for the same 2 s. Symmetric by caster:
      // an enemy cast drags the player bird, a player cast drags
      // the rival bird.
      const pullSignal = ownerId === 'player' ? this.host.gameState.playerSingularityPull : this.host.gameState.enemySingularityPull;
      pullSignal.set({ x: targetX, y: targetY, radius, until: Date.now() + 2000 });
      const pullStart = Date.now();
      let tick = 0;
      const swirl = setInterval(() => {
          if (this.host.gameEnded()) { clearInterval(swirl); pullSignal.set(null); return; }
          tick++;
          for (const e of this.host.enemies) {
              if (e === sourceBody) continue;
              const dx = targetX - e.position.x, dy = targetY - e.position.y;
              const d = Math.hypot(dx, dy);
              if (d > radius || d < 1) continue;
              const v = Matter.Body.getVelocity(e);
              const pull = 0.9 * this.host.logicalUnit; // px per second toward the point
              Matter.Body.setVelocity(e, {
                  x: (v.x * 60 + ((dx / d) * pull - v.x * 60) * 0.25) / 60,
                  y: (v.y * 60 + ((dy / d) * pull - v.y * 60) * 0.25) / 60
              });
          }
          if (tick % 4 === 0) {
              const a = Math.random() * Math.PI * 2;
              const blob = Matter.Bodies.circle(targetX + Math.cos(a) * radius * 0.7, targetY + Math.sin(a) * radius * 0.7, 9 * this.host.speedScale, {
                  label: 'projectile', isSensor: true,
                  plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'singularity_swirl', health: 1, maxHealth: 1, burstDamage: 0, owner: ownerId === 'player' ? 'player' : 'enemy', ownerId } as EnemyData }
              });
              Matter.Composite.add(this.host.engine.world, blob);
              setTimeout(() => { if (blob.parent) Matter.Composite.remove(this.host.engine.world, blob); }, 200);
          }
          if (Date.now() - pullStart >= 2000) {
              clearInterval(swirl);
              pullSignal.set(null);
              if (this.host.isDead()) return;
              for (const e of [...this.host.enemies]) {
                  if (e === sourceBody) continue;
                  const d = e.plugin['data'] as EnemyData;
                  if (!d) continue;
                  if (Math.hypot(e.position.x - targetX, e.position.y - targetY) <= radius) {
                      this.host.damageEnemy(e, damage, { x: targetX, y: targetY }, castId);
                  }
              }
              if (ownerId !== 'player' && Math.hypot(this.host.playerBody.position.x - targetX, this.host.playerBody.position.y - targetY) <= radius) {
                  this.host.takeDamage(this.host.clampUltDamage(castId, '__player__', this.host.currentHealth(), damage));
              }
              this.host.triggerImpactEffect(targetX, targetY, true);
          }
      }, 50);
      this.host.audioService.playSFX('shoot');
      return cd;
  }
}
