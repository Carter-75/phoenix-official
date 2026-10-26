import { Injectable, inject } from '@angular/core';
import { GameStateService } from './game-state.service';
import { AudioService } from './audio.service';
import { EnemyData } from '../models/game.models';
import { BOSS_BASE_HP, BOSS_HP_GROWTH } from '../data/balance.constants';
import { WAVE_TABLES, WorldWaveTable } from '../data/wave-tables';
import * as Matter from 'matter-js';
import { WritableSignal } from '@angular/core';

// Per-type spawn data (visual spec Section 3.3): body size in the
// createEnemyBody convention (the value the legacy gates pass for the
// shipped types: slime 20, bat 15, golem 60) and base health at world
// 0, before the existing 1.5-per-world scaling law is applied. The
// wave composer treats a type with no entry here as weight zero,
// which is how later-stage types sit inert in the Section 5 tables
// until their stage ships them.
export const SPAWN_DEFS: Record<string, { size: number; health: number }> = {
    slime: { size: 20, health: 20 }, // Standard (20), Section 3.3 sheet 1
    bat: { size: 15, health: 10 }, // Fragile (10), sheet 2
    golem: { size: 60, health: 200 }, // Armored (200), sheet 3
    imp: { size: 15, health: 10 }, // Cinder Imp: Fragile (10), 30 px teardrop
    wisp: { size: 15, health: 10 }, // Aether Wisp: Fragile (10), 30 px ring
    pod: { size: 25, health: 60 }, // Brood Pod: Sturdy (60), 50 px sphere
    mite: { size: 8, health: 5 }, // Mite: Fragile (5, half a bat), 16 px spark
};

export interface SpawnerContext {
    engine: Matter.Engine;
    enemies: Matter.Body[];
    items: Matter.Body[];
    gameState: GameStateService;
    audioService: AudioService;
    screenScale: number;
    progressPercent: () => number;
    gameEnded: () => boolean;
    isDead: () => boolean;
    bossSpawned: WritableSignal<boolean>;
    bossMaxHealth?: WritableSignal<number>;
    bossHealth?: WritableSignal<number>;
    clearEnemies: () => void;
    battleDropReady?: WritableSignal<boolean>;
    battleDropGrace?: WritableSignal<boolean>;
    battleAi?: any;
    inBossDefeatSequence?: () => boolean;
}

@Injectable({
  providedIn: 'root'
})
export class EntitySpawnerService {
    private spawnInterval: any;

    // Spawn distances scale with the logical playfield unit (the smaller
    // viewport dimension, 412 px on the reference phone) so enemies
    // enter from the same relative distance on every screen size
    // (playtest round 1, speed consistency).
    private get speedScale(): number {
        return Math.min(window.innerWidth, window.innerHeight) / 412;
    }

    public createEnemyBody(x: number, y: number, size: number, type: string, data: any): Matter.Body {
        const options = {
            label: type === 'boss' ? 'boss' : 'enemy',
            frictionAir: type === 'boss' ? 0.1 : 0.05,
            plugin: { data }
        };

        if (type === 'slime') {
            return Matter.Bodies.rectangle(x, y, size * 2, size * 1.5, { ...options, chamfer: { radius: [size*0.7, size*0.7, 0, 0] } as any });
        } else if (type === 'golem') {
            return Matter.Bodies.circle(x, y, size * 1.5, options);
        } else if (type === 'boss') {
            return Matter.Bodies.circle(x, y, size * 1.5, options);
        }

        return Matter.Bodies.circle(x, y, size, options);
    }

    public spawnBoss(ctx: SpawnerContext) {
        // Every world has a boss now (audit bug 3): HP scales with world index.
        // Growth base 1.42 per world is Carter's adopted decision (systems
        // spec decision log, Oct 25, 2026), read from the balance constants.
        ctx.bossSpawned.set(true);
        ctx.clearEnemies();

        const worldIndex = ctx.gameState.selectedWorldIndex();
        const hp = Math.floor(BOSS_BASE_HP * Math.pow(BOSS_HP_GROWTH, worldIndex));
        // Keep the HUD boss bar honest for every world: without this the
        // bar kept the 1000 HP defaults, so worlds 2 to 10 showed a full
        // (or over-100 percent) bar regardless of the real boss health.
        if (ctx.bossMaxHealth) ctx.bossMaxHealth.set(hp);
        if (ctx.bossHealth) ctx.bossHealth.set(hp);
        const data = { id: Math.random().toString(), type: 'boss', health: hp, maxHealth: hp } as EnemyData;
        const scale = ctx.screenScale;
        const boss = this.createEnemyBody(window.innerWidth / 2, -100 * this.speedScale, 100 * scale, 'boss', data);

        ctx.enemies.push(boss);
        Matter.Composite.add(ctx.engine.world, boss);
    }

    public scheduleNextSpawn(ctx: SpawnerContext) {
        if (this.spawnInterval) clearTimeout(this.spawnInterval);
        if (!ctx.gameEnded() && !ctx.isDead() && !ctx.bossSpawned() && !ctx.gameState.isPaused()) {
            const intensity = ctx.audioService.getAudioIntensity();
            if (intensity > 0.1 || Math.random() < 0.2) { 
                this.spawnEnemy(ctx);
            }
        }
        
        let progress = ctx.progressPercent();
        if (ctx.gameState.currentGameMode() === 'ai_vs_ai') {
            progress = Math.min(100, ctx.gameState.sessionPlayTime() * 2);
        }
        const intensity = ctx.audioService.getAudioIntensity(); 
        const baseDelay = Math.max(150, 1000 - (progress * 8.5));
        const intensityModifier = Math.max(0.1, 1.0 - (intensity * 2.5));
        const delay = baseDelay * intensityModifier;
        
        if (!ctx.gameEnded()) {
            this.spawnInterval = setTimeout(() => this.scheduleNextSpawn(ctx), delay);
        }
    }

    public spawnEnemy(ctx: SpawnerContext) {
        if (ctx.gameState.currentGameMode() === 'battle' || ctx.gameState.currentGameMode() === 'ai_vs_ai') return;
        // Regular enemies spawn in every world; their health already scales
        // by world index below. (Was hard-gated to world 0: audit bug 3.)

        let x, y;
        const padding = 100 * this.speedScale;
        if (Math.random() < 0.5) {
            x = Math.random() * window.innerWidth;
            y = Math.random() < 0.5 ? -padding : window.innerHeight + padding;
        } else {
            x = Math.random() < 0.5 ? -padding : window.innerWidth + padding;
            y = Math.random() * window.innerHeight;
        }

        // Wave composer v1 (visual spec Section 5.1): worlds with a
        // wave table compose their spawns from it. Worlds 4 to 10
        // have no table yet and fall through to the legacy chance
        // gates below, byte for byte.
        const worldIndex = ctx.gameState.selectedWorldIndex();
        const table = WAVE_TABLES[worldIndex];
        if (table) {
            this.spawnFromWaveTable(ctx, table, x, y, worldIndex);
            return;
        }

        let progress = ctx.progressPercent();
        let difficultyMultiplier = 1.0;

        if (ctx.gameState.currentGameMode() === 'ai_vs_ai') {
            const time = ctx.gameState.sessionPlayTime();
            progress = (time % 60) * (100 / 60);
            difficultyMultiplier = Math.pow(1.5, Math.floor(time / 60));
        }

        let type: 'bat' | 'slime' | 'golem' = 'slime';
        const scale = ctx.screenScale;
        let size = 20 * scale;
        let health = 20;

        const rand = Math.random();
        if (progress > 50 && rand < 0.1) {
          type = 'golem'; size = 60 * scale; health = 200;
        } else if (progress > 20 && rand < 0.4) {
          type = 'bat'; size = 15 * scale; health = 10;
        }

        health = Math.floor(health * Math.pow(1.5, worldIndex) * difficultyMultiplier);

        const data = { id: Math.random().toString(), type, health, maxHealth: health, lastAttackTime: Date.now() } as EnemyData;
        const enemy = this.createEnemyBody(x, y, size, type, data);

        ctx.enemies.push(enemy);
        Matter.Composite.add(ctx.engine.world, enemy);
    }

    // Survival-phase progress for the wave composer: 0 at realm
    // start, 1 when the boss arrives. Section 5.1 defines run
    // progress by the phase end (music end or the 300 s timer), so
    // the phase fraction comes from the world BGM position whenever
    // its duration is known, and from the run timer otherwise.
    public phaseProgress(ctx: SpawnerContext): number {
        const duration = ctx.audioService.getBgmDuration();
        if (duration > 0) {
            return Math.min(1, Math.max(0, ctx.audioService.getBgmCurrentTime() / duration));
        }
        return Math.min(1, Math.max(0, ctx.progressPercent() / 100));
    }

    // Seconds until the boss trigger, on the same clock as
    // phaseProgress. Used only for the wave-table lull window.
    private secondsToBoss(ctx: SpawnerContext): number {
        const duration = ctx.audioService.getBgmDuration();
        if (duration > 0) {
            return Math.max(0, duration - ctx.audioService.getBgmCurrentTime());
        }
        return Math.max(0, (100 - ctx.progressPercent()) / 100 * 300);
    }

    // Wave composer v1: decide what one spawn attempt produces in a
    // tabled world. The attempt cadence itself (scheduleNextSpawn's
    // timer and delay curve) is untouched; this only composes.
    private spawnFromWaveTable(ctx: SpawnerContext, table: WorldWaveTable, anchorX: number, anchorY: number, worldIndex: number) {
        const phase = this.phaseProgress(ctx);
        const band = table.bands.find(b => phase >= b.fromPhase && phase < b.toPhase)
            || table.bands[table.bands.length - 1];

        // The pre-boss lull is a table property: in the last band,
        // once the boss trigger is lullSeconds away, attempts produce
        // nothing and the field clears for the arrival.
        const isLastBand = band === table.bands[table.bands.length - 1];
        if (isLastBand && table.lullSeconds > 0 && this.secondsToBoss(ctx) <= table.lullSeconds) {
            return;
        }

        // Composition cap: a band never stacks bodies past its
        // maxAlive, however fast the attempt cadence fires.
        const alive = ctx.enemies.length;
        if (alive >= band.maxAlive) return;

        const entries = band.entries.filter(e => SPAWN_DEFS[e.type]);
        if (!entries.length) return;
        const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
        let roll = Math.random() * totalWeight;
        let picked = entries[entries.length - 1];
        for (const entry of entries) {
            roll -= entry.weight;
            if (roll <= 0) { picked = entry; break; }
        }

        const packMin = picked.pack ? picked.pack[0] : 1;
        const packMax = picked.pack ? picked.pack[1] : 1;
        let count = packMin + Math.floor(Math.random() * (packMax - packMin + 1));
        count = Math.min(count, band.maxAlive - alive);

        for (let i = 0; i < count; i++) {
            // Pack members arrive as a group around the off-screen
            // anchor, close enough to read as one wave, never so far
            // that a member pops in on screen.
            const jx = anchorX + (Math.random() - 0.5) * 90 * this.speedScale;
            const jy = anchorY + (Math.random() - 0.5) * 90 * this.speedScale;
            this.spawnEnemyOfType(ctx, picked.type, jx, jy, worldIndex);
        }
    }

    // Spawn one enemy of an explicit type at an explicit position.
    // Shared by the wave composer and by the Brood Pod's split (the
    // game component calls it with burst for the Mites). Health uses
    // the same law as the legacy gates: base HP times 1.5 per world.
    public spawnEnemyOfType(ctx: SpawnerContext, type: string, x: number, y: number, worldIndex: number, burst: boolean = false): Matter.Body | null {
        const def = SPAWN_DEFS[type];
        if (!def) return null;
        const health = Math.max(1, Math.floor(def.health * Math.pow(1.5, worldIndex)));
        const data = { id: Math.random().toString(), type, health, maxHealth: health, lastAttackTime: Date.now() } as EnemyData;
        if (type === 'imp') data.behaviorState = 'approach';
        if (type === 'wisp') {
            data.behaviorState = 'close';
            data.orbitDir = Math.random() < 0.5 ? -1 : 1;
        }
        const body = this.createEnemyBody(x, y, def.size * ctx.screenScale, type, data);
        if (burst) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (2.5 + Math.random() * 1.5) * this.speedScale;
            Matter.Body.setVelocity(body, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
        }
        ctx.enemies.push(body);
        Matter.Composite.add(ctx.engine.world, body);
        return body;
    }

    public spawnMinion(x: number, y: number, ctx: SpawnerContext) {
        const worldIndex = ctx.gameState.selectedWorldIndex();
        const hp = Math.floor(5 * Math.pow(1.5, worldIndex));
        const data = { id: Math.random().toString(), type: 'bat', health: hp, maxHealth: hp } as EnemyData;
        const minion = this.createEnemyBody(x, y, 10, 'bat', data);
        Matter.Body.setVelocity(minion, { x: (Math.random()-0.5)*5*this.speedScale, y: (Math.random()-0.5)*5*this.speedScale });
        ctx.enemies.push(minion);
        Matter.Composite.add(ctx.engine.world, minion);
    }

    public dropItem(x: number, y: number, type: 'coin' | 'gem' | 'heart' | 'crate' | 'xp_orb', value: number, ctx: SpawnerContext) {
        if (ctx.gameState.currentGameMode() === 'ai_vs_ai' && (type === 'coin' || type === 'gem' || type === 'crate')) {
            return;
        }
        const item = Matter.Bodies.circle(x, y, type === 'gem' ? 15 : (type === 'crate' ? 25 : 10), {
            isSensor: true,
            label: 'item',
            frictionAir: 0.1,
            plugin: {
                data: { id: Math.random().toString(), type: type, value: value } as any
            }
        });
        Matter.Body.setVelocity(item, { x: (Math.random() - 0.5) * 2.5 * this.speedScale, y: (Math.random() - 0.5) * 2.5 * this.speedScale });
        Matter.Composite.add(ctx.engine.world, item);
        ctx.items.push(item);
    }

    public triggerBattleDrop(x: number, y: number, isDeathDrop: boolean = false, ctx: SpawnerContext) {
        if (!isDeathDrop && ctx.battleDropReady && ctx.battleDropGrace) {
            ctx.battleDropReady.set(false);
            ctx.battleDropGrace.set(false);
        }
        
        const numGems = Math.floor(Math.random() * 5) + 3;
        const numCoins = Math.floor(Math.random() * 10) + 5;
        
        for(let i=0; i<numGems; i++) {
            this.dropItem(x + (Math.random()-0.5)*50, y + (Math.random()-0.5)*50, 'gem', 2, ctx);
        }
        for(let i=0; i<numCoins; i++) {
            this.dropItem(x + (Math.random()-0.5)*50, y + (Math.random()-0.5)*50, 'coin', 1, ctx);
        }
        this.dropItem(x, y, 'heart', 20, ctx);
        this.dropItem(x + 20, y - 20, 'xp_orb' as any, 1, ctx);
        
        if (!isDeathDrop && ctx.battleAi) {
            ctx.battleAi.coinGainRate += 1;
        }
    }

    public stopSpawning() {
        if (this.spawnInterval) clearTimeout(this.spawnInterval);
    }
}
