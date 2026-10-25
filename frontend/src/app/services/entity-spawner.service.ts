import { Injectable, inject } from '@angular/core';
import { GameStateService } from './game-state.service';
import { AudioService } from './audio.service';
import { EnemyData } from '../models/game.models';
import * as Matter from 'matter-js';
import { WritableSignal } from '@angular/core';

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
        if (ctx.gameState.selectedWorldIndex() !== 0) return; // Only world 0 has a boss for now
        ctx.bossSpawned.set(true);
        ctx.clearEnemies();

        const worldIndex = ctx.gameState.selectedWorldIndex();
        const hp = Math.floor(1000 * Math.pow(1.5, worldIndex));
        const data = { id: Math.random().toString(), type: 'boss', health: hp, maxHealth: hp } as EnemyData;
        const scale = ctx.screenScale;
        const boss = this.createEnemyBody(window.innerWidth / 2, -100, 100 * scale, 'boss', data);

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
        if (ctx.gameState.selectedWorldIndex() !== 0) return;

        let x, y;
        const padding = 100;
        if (Math.random() < 0.5) {
            x = Math.random() * window.innerWidth;
            y = Math.random() < 0.5 ? -padding : window.innerHeight + padding;
        } else {
            x = Math.random() < 0.5 ? -padding : window.innerWidth + padding;
            y = Math.random() * window.innerHeight;
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

        const worldIndex = ctx.gameState.selectedWorldIndex();
        health = Math.floor(health * Math.pow(1.5, worldIndex) * difficultyMultiplier);

        const data = { id: Math.random().toString(), type, health, maxHealth: health, lastAttackTime: Date.now() } as EnemyData;
        const enemy = this.createEnemyBody(x, y, size, type, data);

        ctx.enemies.push(enemy);
        Matter.Composite.add(ctx.engine.world, enemy);
    }

    public spawnMinion(x: number, y: number, ctx: SpawnerContext) {
        const worldIndex = ctx.gameState.selectedWorldIndex();
        const hp = Math.floor(5 * Math.pow(1.5, worldIndex));
        const data = { id: Math.random().toString(), type: 'bat', health: hp, maxHealth: hp } as EnemyData;
        const minion = this.createEnemyBody(x, y, 10, 'bat', data);
        Matter.Body.setVelocity(minion, { x: (Math.random()-0.5)*10, y: (Math.random()-0.5)*10 });
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
        Matter.Body.setVelocity(item, { x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 5 });
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
