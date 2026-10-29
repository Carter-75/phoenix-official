// Battle mode setup and state: rival and second-AI phoenix setup,
// cooldown bookkeeping and the HUD icon and cooldown getters, the
// ML state vector the battle AI reads, and battle drop resolution.
// Runs against the game component's state through the host
// interface. Moved out of game.component.ts in the code organization
// pass (Oct 27, 2026); logic unchanged.
import { WritableSignal } from '@angular/core';
import * as Matter from 'matter-js';
import { GameStateService } from '../../services/game-state.service';
import { BattleAiService, BattleContext } from '../../services/battle-ai.service';
import { EntitySpawnerService } from '../../services/entity-spawner.service';
import { PhysicsEntity, WorldStats } from '../../models/game.models';
import { ABILITIES, BASE_STATS, REALM_ABILITIES } from '../../constants/game.constants';
import { rivalScalingFor, RivalWorldScaling } from '../../data/balance.constants';
import { EnemyData } from './game.types';

export interface BattleSetupHost {
  battleAi: BattleAiService;
  battleCoinsCollected: WritableSignal<number>;
  battleDropGrace: WritableSignal<boolean>;
  battleDropReady: WritableSignal<boolean>;
  battleStartCoins: number;
  battleStartXp: number;
  bossHealth: WritableSignal<number>;
  bossMaxHealth: WritableSignal<number>;
  doubleAbilityEndTime: number;
  doubleCooldown: WritableSignal<number>;
  enemies: Matter.Body[];
  engine: Matter.Engine;
  entranceActive: WritableSignal<boolean>;
  gameEnded: WritableSignal<boolean>;
  gameState: GameStateService;
  getBattleContext(): BattleContext;
  getSpawnerContext(): any;
  holdAbilityEndTime: number;
  holdCooldown: WritableSignal<number>;
  isDead: WritableSignal<boolean>;
  lastClickTime: number;
  nextDropIndex: number;
  playerBody: Matter.Body;
  screenScale: number;
  spawner: EntitySpawnerService;
  tapCooldown: WritableSignal<number>;
  triggerImpactEffect(x: number, y: number, isBoss: boolean): void;
  tripleAbilityEndTime: number;
  tripleCooldown: WritableSignal<number>;
}

export class BattleSetup {
  constructor(private host: BattleSetupHost) {}

initBattleMode() {
      if (this.host.gameState.currentGameMode() === 'ai_vs_ai') {
          this.host.gameState.ai1Wins.set(0);
          this.host.gameState.ai2Wins.set(0);
      }
      this.host.battleAi.reset();
      
      this.setupAiPhoenix(false);
      if (this.host.gameState.currentGameMode() === 'ai_vs_ai') {
          this.setupAi2Phoenix(false);
      }
      
      
      this.host.nextDropIndex = 0;
      this.host.battleDropReady.set(false);
      this.host.battleDropGrace.set(false);
      
      const maxHp = this.host.battleAi.ai1.stats.maxHealth;
      this.host.bossMaxHealth.set(maxHp);
      this.host.bossHealth.set(maxHp);
      
      this.host.battleStartCoins = this.host.gameState.coins();
      this.host.battleStartXp = this.host.gameState.xp();
      this.host.battleCoinsCollected.set(0);
      
      this.resetCooldowns();
      
      // Entrance is LIVE (not a hard pause): physics keeps running, but AI logic/attacks are
      // disabled and the player can't move or take damage until the intro finishes.
      this.host.entranceActive.set(true);
      // A3: the world scroll holds for the whole entrance so the
      // first controllable Battle frame matches the other modes.
      this.host.gameState.entranceScrollHold.set(true);
      this.host.gameState.isPaused.set(false);

      // Spawn AI Phoenix off-screen top
      const scale = this.host.screenScale;
      const aiCore = Matter.Bodies.rectangle(window.innerWidth / 2, -200, 10 * scale, 20 * scale, { label: 'enemy' });
      const aiLeftWing = Matter.Bodies.rectangle(window.innerWidth / 2 - (15 * scale), -200 - (5 * scale), 20 * scale, 8 * scale, { label: 'enemy' });
      const aiRightWing = Matter.Bodies.rectangle(window.innerWidth / 2 + (15 * scale), -200 - (5 * scale), 20 * scale, 8 * scale, { label: 'enemy' });

      const enemyPhoenix = Matter.Body.create({
          parts: [aiCore, aiLeftWing, aiRightWing],
          label: 'enemy',
          plugin: {
              data: {
                  id: 'ai_phoenix',
                  type: 'enemy_phoenix',
                  health: maxHp,
                  maxHealth: maxHp,
                  value: 0
              } as EnemyData
          }
      });
      
      Matter.Composite.add(this.host.engine.world, enemyPhoenix);
      this.host.enemies.push(enemyPhoenix);
      
      // Cinematic Entrance for AI.
      // Spread spawn positions further apart (AI top third, player bottom third) so the two
      // Phoenixes don't overlap on short viewports and trigger separation-force jitter.
      const aiStartY = -200;
      const aiEndY = Math.max(120, window.innerHeight * 0.22);
      const playerEndY = Math.min(window.innerHeight - 120, window.innerHeight * 0.78);
      
      const duration = 1500;
      const startTime = Date.now();
      
      const animateEntrance = () => {
          if (this.host.isDead() || this.host.gameEnded()) return;
          const now = Date.now();
          const progress = Math.min((now - startTime) / duration, 1);
          
          // Easing: easeOutQuad
          const easeProgress = progress * (2 - progress);
          
          const currentAiY = aiStartY + (aiEndY - aiStartY) * easeProgress;
          
          // Override AI physics position and lock mouse to top
          this.host.gameState.aiPhoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentAiY });
          this.host.gameState.aiMousePos.set({ x: window.innerWidth / 2, y: 50 });
          Matter.Body.setPosition(enemyPhoenix, { x: window.innerWidth / 2, y: currentAiY });
          Matter.Body.setVelocity(enemyPhoenix, { x: 0, y: 0 }); 
          
          // Animate Player from bottom to their start pos
          if (this.host.playerBody) {
              const playerStartY = window.innerHeight + 200;
              const currentPlayerY = playerStartY + (playerEndY - playerStartY) * easeProgress;
              this.host.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentPlayerY });
              Matter.Body.setPosition(this.host.playerBody, { x: window.innerWidth / 2, y: currentPlayerY });
              Matter.Body.setVelocity(this.host.playerBody, { x: 0, y: 0 });
          }
          
          if (progress < 1) {
              requestAnimationFrame(animateEntrance);
          } else {
              this.host.gameState.aiPhoenixOverridePosition.set(null);
        if ((this as any).aiEntranceAnimId) cancelAnimationFrame((this as any).aiEntranceAnimId);
              this.host.gameState.phoenixOverridePosition.set(null);
              // Sync the AI's post-entrance steering target to where it actually landed so it
              // doesn't snap up to y=50 the instant the override clears.
              this.host.gameState.aiMousePos.set({ x: window.innerWidth / 2, y: aiEndY });
              this.host.gameState.aiPhoenixScreenPos.set({ x: window.innerWidth / 2, y: aiEndY });
              this.host.triggerImpactEffect(window.innerWidth / 2, currentAiY, true); // AI flash effect on landing
              if (this.host.playerBody) {
                  this.host.triggerImpactEffect(window.innerWidth / 2, playerEndY, false);
              }
              // 1 second standoff, then hand control + AI back on (no unpause needed).
              setTimeout(() => {
                  if (!this.host.gameEnded() && !this.host.isDead()) {
                      this.host.entranceActive.set(false);
                      this.host.gameState.entranceScrollHold.set(false);
                      this.host.lastClickTime = Date.now();
                  }
              }, 1000);
          }
      };
      
      requestAnimationFrame(animateEntrance);
  }


setupAiPhoenix(isRespawn: boolean) {
      const playerStats = this.host.gameState.currentStats();
      this.host.battleAi.ai1.stats = JSON.parse(JSON.stringify(playerStats));
      this.host.battleAi.ai1.stats.maxHealth *= 10; // Scale base health x10 for Battle Mode boss pool

      const worldId = this.host.gameState.selectedWorldIndex();
      // Mode trio: the per-world rival tier (RIVAL_WORLD_SCALING in
      // balance.constants). Health and hit weight rise with the
      // world on top of the x10 duel pool; speed and attack speed
      // stay at the player's own values so dodge timing is never
      // re-learned per world. The applied record is published on
      // the AI state so the HUD, the harness, and any later audit
      // read the same numbers the duel used.
      const scaling = rivalScalingFor(worldId);
      this.host.battleAi.ai1.stats.maxHealth = Math.floor(this.host.battleAi.ai1.stats.maxHealth * scaling.hp);
      this.host.battleAi.ai1.stats.damage *= scaling.damage;
      this.host.battleAi.ai1.stats.burstDamage *= scaling.damage;
      (this.host.battleAi.ai1 as any).worldScaling = { worldIndex: worldId, ...scaling } as RivalWorldScaling & { worldIndex: number };

      const realmAbilities = REALM_ABILITIES[worldId] || ['burst', 'aura'];
      
      const tapAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'tap' && k !== 'rebirth');
      const holdAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'hold' && k !== 'rebirth');
      // S2 (spec Section 7.2): the rival learns each family in the
      // stage it ships, so it now also draws a double move.
      const doubleAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'double' && k !== 'rebirth');
      // S4: and an ultimate, drawn the same way from the triple pool.
      const tripleAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'triple' && k !== 'rebirth');

      let tap = tapAbilities.length > 0 ? tapAbilities[Math.floor(Math.random() * tapAbilities.length)] : 'burst';
      let hold = holdAbilities.length > 0 ? holdAbilities[Math.floor(Math.random() * holdAbilities.length)] : 'aura';
      let dbl = doubleAbilities.length > 0 ? doubleAbilities[Math.floor(Math.random() * doubleAbilities.length)] : null;
      let tri = tripleAbilities.length > 0 ? tripleAbilities[Math.floor(Math.random() * tripleAbilities.length)] : null;

      this.host.battleAi.ai1.abilities = [tap, hold, ...(dbl ? [dbl] : []), ...(tri ? [tri] : [])];

      const playerTapLevel = playerStats.activeTapAbility ? (playerStats.unlockedAbilities[playerStats.activeTapAbility]?.level || 1) : 1;
      const playerHoldLevel = playerStats.activeHoldAbility ? (playerStats.unlockedAbilities[playerStats.activeHoldAbility]?.level || 1) : 1;
      // The AI loadout rule (Section 7.2): AI ability levels are the
      // average of the player's EQUIPPED levels. The double slot joins
      // the average when the player has one equipped.
      const playerDoubleLevel = playerStats.activeDoubleAbility ? (playerStats.unlockedAbilities[playerStats.activeDoubleAbility]?.level || 1) : null;
      // S4: the triple slot joins the average the same way.
      const playerTripleLevel = playerStats.activeTripleAbility ? (playerStats.unlockedAbilities[playerStats.activeTripleAbility]?.level || 1) : null;
      const equippedLevels = [playerTapLevel, playerHoldLevel, ...(playerDoubleLevel !== null ? [playerDoubleLevel] : []), ...(playerTripleLevel !== null ? [playerTripleLevel] : [])];
      // Mode trio: the loadout tier rises with the world (the
      // scaling table's levelBonus on top of the shipped parity
      // average). ai2 below keeps the pure mirror: it stands in for
      // the player, so it takes no world tier.
      const avgPlayerLevel = Math.max(1, Math.floor(equippedLevels.reduce((a, b) => a + b, 0) / equippedLevels.length) + scaling.levelBonus);

      this.host.battleAi.ai1.abilities.forEach(id => {
          this.host.battleAi.ai1.stats.unlockedAbilities[id] = { level: avgPlayerLevel, modifiers: {} };
          this.host.battleAi.ai1.stats.unlockedAbilities[id].modifiers = this.host.gameState.generateAbilityUpgrade(id, avgPlayerLevel, {});
      });

      if (!isRespawn) {
          // Roll 1-5 tokens for each of the 8 stats
          const statCount = 8;
          let initialUpgradeTokens = 0;
          for(let i=0; i<statCount; i++) {
              initialUpgradeTokens += Math.floor(Math.random() * 5) + 1;
          }
          
          // Roll 1-5 tokens for each of the 2 abilities
          let initialAbilityTokens = 0;
          for(let i=0; i<2; i++) {
              initialAbilityTokens += Math.floor(Math.random() * 5) + 1;
          }
          
          // Spend tokens
          this.host.battleAi.spendTokens(this.host.battleAi.ai1.upgradeTokensBox, this.host.battleAi.ai1.abilityTokensBox, 'ai1', this.host.getBattleContext());
          this.host.battleAi.ai1.upgradesWeights = {}; // reset weights after init
      } else {
          // On respawn, spend accumulated tokens from boxes
          this.host.battleAi.spendTokens(this.host.battleAi.ai1.upgradeTokensBox, this.host.battleAi.ai1.abilityTokensBox, 'ai1', this.host.getBattleContext());
          // (Weights are preserved across respawns)
      }
      this.host.gameState.aiPhoenixSpeed.set(this.host.battleAi.ai1.stats.speed);
  }


setupAi2Phoenix(isRespawn: boolean) {
      const playerStats = this.host.gameState.currentStats();
      this.host.battleAi.ai2.stats = JSON.parse(JSON.stringify(playerStats));
      this.host.battleAi.ai2.stats.maxHealth *= 10; // AI2 gets x10 health as well
      
      let tap = playerStats.activeTapAbility || 'burst';
      let hold = playerStats.activeHoldAbility || 'aura';
      // S2: ai2 mirrors the player's double slot too (null when the
      // player has none equipped, exactly like its tap/hold mirror).
      let dbl = playerStats.activeDoubleAbility || null;
      // S4: and the triple slot, mirrored the same way.
      let tri = playerStats.activeTripleAbility || null;

      this.host.battleAi.ai2.abilities = [tap, hold, ...(dbl ? [dbl] : []), ...(tri ? [tri] : [])];

      const playerTapLevel = playerStats.activeTapAbility ? (playerStats.unlockedAbilities[playerStats.activeTapAbility]?.level || 1) : 1;
      const playerHoldLevel = playerStats.activeHoldAbility ? (playerStats.unlockedAbilities[playerStats.activeHoldAbility]?.level || 1) : 1;
      const playerDoubleLevel = playerStats.activeDoubleAbility ? (playerStats.unlockedAbilities[playerStats.activeDoubleAbility]?.level || 1) : null;
      const playerTripleLevel = playerStats.activeTripleAbility ? (playerStats.unlockedAbilities[playerStats.activeTripleAbility]?.level || 1) : null;
      const equippedLevels = [playerTapLevel, playerHoldLevel, ...(playerDoubleLevel !== null ? [playerDoubleLevel] : []), ...(playerTripleLevel !== null ? [playerTripleLevel] : [])];
      const avgPlayerLevel = Math.max(1, Math.floor(equippedLevels.reduce((a, b) => a + b, 0) / equippedLevels.length));
      
      this.host.battleAi.ai2.abilities.forEach(id => {
          this.host.battleAi.ai2.stats.unlockedAbilities[id] = { level: avgPlayerLevel, modifiers: {} };
          this.host.battleAi.ai2.stats.unlockedAbilities[id].modifiers = this.host.gameState.generateAbilityUpgrade(id, avgPlayerLevel, {});
      });

      if (!isRespawn) {
          const statCount = 8;
          let initialUpgradeTokens = 0;
          for(let i=0; i<statCount; i++) {
              initialUpgradeTokens += Math.floor(Math.random() * 5) + 1;
          }
          
          let initialAbilityTokens = 0;
          for(let i=0; i<2; i++) {
              initialAbilityTokens += Math.floor(Math.random() * 5) + 1;
          }
          
          this.host.battleAi.spendTokens(this.host.battleAi.ai2.upgradeTokensBox, this.host.battleAi.ai2.abilityTokensBox, 'ai2', this.host.getBattleContext());
          this.host.battleAi.ai2.upgradesWeights = {}; 
      }
  }


resetCooldowns() {
      this.host.battleAi.ai1.lastTapTime = 0;
      this.host.battleAi.ai1.lastHoldTime = 0;
      this.host.battleAi.ai1.lastDoubleTime = 0;
      this.host.battleAi.ai1.lastTripleTime = 0;
      this.host.battleAi.ai2.lastTapTime = 0;
      this.host.battleAi.ai2.lastHoldTime = 0;
      this.host.battleAi.ai2.lastDoubleTime = 0;
      this.host.battleAi.ai2.lastTripleTime = 0;
      this.host.lastClickTime = 0;
      this.host.holdAbilityEndTime = 0;
      this.host.doubleAbilityEndTime = 0;
      this.host.tripleAbilityEndTime = 0;
      this.host.tapCooldown.set(0);
      this.host.holdCooldown.set(0);
      this.host.doubleCooldown.set(0);
      this.host.tripleCooldown.set(0);
      this.host.battleAi.ai2.tapCooldown = 0;
      this.host.battleAi.ai2.holdCooldown = 0;
      this.host.battleAi.ai2.doubleCooldown = 0;
      this.host.battleAi.ai2.tripleCooldown = 0;
  }


getNextDropTime(index: number): number {
      if (index < 5) return (index + 1) * 60; // 1m, 2m, 3m, 4m, 5m
      if (index < 8) return 300 + (index - 4) * 90; // 6:30, 8:00, 9:30
      return 570 + (index - 7) * 120; // 11:30, 13:30, ...
  }


getTapIcon() { return ABILITIES[this.host.gameState.currentStats().activeTapAbility || 'burst']?.icon || '💥'; }

getHoldIcon() { return ABILITIES[this.host.gameState.currentStats().activeHoldAbility || 'aura']?.icon || '🌀'; }

getDoubleIcon() { const id = this.host.gameState.currentStats().activeDoubleAbility; return (id && ABILITIES[id]?.icon) || '⚡'; }

getTripleIcon() { const id = this.host.gameState.currentStats().activeTripleAbility; return (id && ABILITIES[id]?.icon) || '✨'; }

slotMaxCooldown(id: string | null): number {
      if (!id) return 1;
      const abilityData = this.host.gameState.worldUpgrades()[this.host.gameState.selectedWorldIndex()]?.unlockedAbilities[id];
      const mod = abilityData?.modifiers?.['cooldown'] || 1.0;
      return (ABILITIES[id]?.baseCooldown || 1) * mod;
  }

getDoubleMaxCooldown() { return this.slotMaxCooldown(this.host.gameState.currentStats().activeDoubleAbility); }

getTripleMaxCooldown() { return this.slotMaxCooldown(this.host.gameState.currentStats().activeTripleAbility); }


getTapMaxCooldown() {
      const id = this.host.gameState.currentStats().activeTapAbility || 'burst';
      const abilityData = this.host.gameState.worldUpgrades()[this.host.gameState.selectedWorldIndex()]?.unlockedAbilities[id];
      const mod = abilityData?.modifiers?.['cooldown'] || 1.0;
      if (id === 'drill_attack') return 3 * mod;
      if (id === 'fire_breath') return 8 * mod;
      // S2: burst (now 6 s) and the new tap moves read their real
      // base cooldown from ABILITIES; the old hardcoded 5 here was
      // burst's pre-S2 value.
      return (ABILITIES[id]?.baseCooldown || 5) * mod;
  }


getHoldMaxCooldown() {
      // Every hold move reads its real base cooldown from ABILITIES
      // times its cooldown modifier (the slotMaxCooldown convention).
      // The old hardcoded values (turret 10, rebirth 60, else 15)
      // disagreed with the cooldowns triggerAbility actually
      // returned, so the HUD ring lied; S3's charge payment also
      // moved the bases (turret 14, aura 17, rebirth 75).
      return this.slotMaxCooldown(this.host.gameState.currentStats().activeHoldAbility || 'aura');
  }


buildMLState(actor: Matter.Body, target: Matter.Body | undefined, hpRatio: number, targetHpRatio: number, threatType: string): any {
      const projectiles = Matter.Composite.allBodies(this.host.engine.world).filter(b => b.label === 'projectile' && b.plugin['data']?.type === threatType);
      
      const rays = 8;
      const radarDists = Array(rays).fill(0);
      const maxRange = 400;
      
      for (let i = 0; i < rays; i++) {
          const angle = (Math.PI * 2 / rays) * i;
          const endPoint = {
              x: actor.position.x + Math.cos(angle) * maxRange,
              y: actor.position.y + Math.sin(angle) * maxRange
          };
          
          const hits = Matter.Query.ray(projectiles, actor.position, endPoint);
          if (hits.length > 0) {
              let minDist = maxRange;
              for (let hit of hits) {
                  const dist = Matter.Vector.magnitude(Matter.Vector.sub(actor.position, (hit as any).body.position));
                  if (dist < minDist) minDist = dist;
              }
              radarDists[i] = 1.0 - (minDist / maxRange);
          }
      }

      let closestMobType = 0;
      let closestMobDist = 1.0;
      let closestMobVelX = 0;
      let closestMobVelY = 0;
      let nearestBody: Matter.Body | null = null;
      let minDistRaw = Infinity;

      const allBodies = Matter.Composite.allBodies(this.host.engine.world);
      for (let b of allBodies) {
           if (b === actor || b === target) continue;
           if (b.label === 'enemy' || b.label === 'boss' || b.label === 'projectile') {
                const dist = Matter.Vector.magnitude(Matter.Vector.sub(actor.position, b.position));
                if (dist < minDistRaw) {
                    minDistRaw = dist;
                    nearestBody = b;
                }
           }
      }

      if (nearestBody) {
           closestMobDist = Math.min(1.0, minDistRaw / maxRange);
           closestMobVelX = nearestBody.velocity.x;
           closestMobVelY = nearestBody.velocity.y;
           
           const data = nearestBody.plugin['data'];
           const typeStr = data ? data.type : nearestBody.label;
           
           // Deterministic string hash to [0, 1] so new mobs work automatically
           let hash = 0;
           if (typeStr) {
               for (let i = 0; i < typeStr.length; i++) {
                   hash = (hash * 31 + typeStr.charCodeAt(i)) % 1000;
               }
           }
           closestMobType = hash / 1000.0;
      }

      const isBottomAi = threatType === 'projectile_enemy'; // If it fires enemy projectiles, it's the Bottom AI acting as player
      const aiY = isBottomAi ? window.innerHeight - actor.position.y : actor.position.y;
      const aiVelY = isBottomAi ? -actor.velocity.y : actor.velocity.y;
      const pY = target?.position.y || (isBottomAi ? window.innerHeight - 100 : 100);
      const playerY = isBottomAi ? window.innerHeight - pY : pY;
      const playerVelY = isBottomAi ? -(target?.velocity.y || 0) : (target?.velocity.y || 0);
      const mobVelY = isBottomAi ? -closestMobVelY : closestMobVelY;

      return {
          aiX: actor.position.x, aiY: aiY,
          aiVelX: actor.velocity.x, aiVelY: aiVelY,
          playerX: target?.position.x || window.innerWidth / 2, playerY: playerY,
          playerVelX: target?.velocity.x || 0, playerVelY: playerVelY,
          hpRatio: hpRatio,
          playerHpRatio: targetHpRatio,
          radar0: radarDists[0], radar1: radarDists[1], radar2: radarDists[2], radar3: radarDists[3],
          radar4: radarDists[4], radar5: radarDists[5], radar6: radarDists[6], radar7: radarDists[7],
          closestMobType: closestMobType,
          closestMobDist: closestMobDist,
          closestMobVelX: closestMobVelX,
          closestMobVelY: mobVelY
      };
  }




resolveBattleDrop(playerWon: boolean, px: number, py: number) {
      this.host.battleDropReady.set(false);
      this.host.battleDropGrace.set(false);
      
      if (playerWon) {
          this.host.spawner.triggerBattleDrop(px, py, false, this.host.getSpawnerContext());
      } else {
          // AI Won -> Steal
          const aiEnemy = this.host.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
          if (aiEnemy) {
              const data = aiEnemy.plugin['data'] as EnemyData;
              // AI heals 15-25% max health
              const healPercent = 0.15 + (Math.random() * 0.10);
              data.health = Math.min(data.maxHealth, data.health + (data.maxHealth * healPercent));
              this.host.bossHealth.set(data.health);
              
              // 50% chance to steal coins
              if (Math.random() < 0.5) {
                 const playerCoins = this.host.gameState.coins();
                 const stealAmount = Math.floor(playerCoins * 0.10); // steal 10%
                 if (stealAmount > 0) {
                     this.host.gameState.coins.set(playerCoins - stealAmount);
                     this.host.battleAi.ai1.coins += stealAmount;
                 }
              }
              
              this.host.triggerImpactEffect(px, py, false); // Small red burst maybe
          }
          this.host.battleAi.coinGainRate += 1; // Increase income anyway
      }
  }
}
