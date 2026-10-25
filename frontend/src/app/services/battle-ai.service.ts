import { Injectable, inject } from '@angular/core';
import { GameStateService } from './game-state.service';
import { WorldStats } from '../models/game.models';
import { ABILITIES } from '../constants/game.constants';

export interface AiPersonality {
    aggression: number;    // [0.7, 1.3] — fire rate and damage weight bias
    caution: number;       // [0.7, 1.3] — health and speed weight bias
    creativity: number;    // [0.7, 1.3] — ML noise and ability usage variance
}

export interface AiState {
    coins: number;
    stats: WorldStats;
    upgradesWeights: Record<string, number>;
    abilities: string[];
    lastTapTime: number;
    lastHoldTime: number;
    tapCooldown: number;
    holdCooldown: number;
    upgradeTokensBox: number;
    abilityTokensBox: number;
    tapFatigue: number;
    holdFatigue: number;
    personality: AiPersonality;
}

export interface BattleContext {
    gameState: GameStateService;
    bossMaxHealth: any;
    bossHealth: any;
    maxHealth: any;
    currentHealth: any;
    enemies: any[];
}

@Injectable({
  providedIn: 'root'
})
export class BattleAiService {
    
    public ai1!: AiState;
    public ai2!: AiState;
    public coinGainRate = 2;

    // Tension / Director system
    public matchTension = 0; // [0, 1] range
    private recentDamageEvents = 0;
    private lastTensionCalcTime = 0;
    private lastWeightReversionTime = 0;
    private matchStartTime = Date.now();

    constructor(private gameState: GameStateService) {
        this.reset();
    }

    public reset() {
        this.ai1 = this.createDefaultAiState();
        this.ai2 = this.createDefaultAiState();
        this.matchStartTime = Date.now();
        this.matchTension = 0;
        this.recentDamageEvents = 0;
        this.coinGainRate = 2;
    }

    private createDefaultAiState(): AiState {
        return {
            coins: 0,
            stats: {} as WorldStats,
            upgradesWeights: {},
            abilities: [],
            lastTapTime: 0,
            lastHoldTime: 0,
            tapCooldown: 0,
            holdCooldown: 0,
            upgradeTokensBox: 0,
            abilityTokensBox: 0,
            tapFatigue: 0,
            holdFatigue: 0,
            personality: {
                aggression: 0.7 + Math.random() * 0.6,  // [0.7, 1.3]
                caution: 0.7 + Math.random() * 0.6,
                creativity: 0.7 + Math.random() * 0.6,
            }
        };
    }

    public tick(context: BattleContext) {
        // Diminishing coin returns: effectiveRate flattens as coinGainRate grows
        const dropsDiminish = 1 - Math.pow(0.92, Math.max(0, this.coinGainRate - 2));
        const effectiveRate = 2 + (Math.max(0, this.coinGainRate - 2)) * dropsDiminish;
        this.ai1.coins += effectiveRate;

        // Fatigue decay (~3% per tick)
        this.ai1.tapFatigue *= 0.97;
        this.ai1.holdFatigue *= 0.97;

        this.tryPurchaseAiUpgrade('ai1', context);

        if (this.gameState.currentGameMode() === 'ai_vs_ai') {
            this.ai2.coins += effectiveRate;
            this.ai2.tapFatigue *= 0.97;
            this.ai2.holdFatigue *= 0.97;
            this.tryPurchaseAiUpgrade('ai2', context);
        }

        // Periodic weight mean-reversion (every 30s): pull weights back toward 100
        const now = Date.now();
        if (now - this.lastWeightReversionTime > 30000) {
            this.lastWeightReversionTime = now;
            [this.ai1, this.ai2].forEach(state => {
                Object.keys(state.upgradesWeights).forEach(k => {
                    state.upgradesWeights[k] = state.upgradesWeights[k] * 0.85 + 100 * 0.15;
                });
            });
        }
    }

    public calculateTension(playerHpRatio: number, aiHpRatio: number): number {
        const now = Date.now();
        if (now - this.lastTensionCalcTime < 500) return this.matchTension;
        this.lastTensionCalcTime = now;

        const hpStress = 0.4 * (1 - playerHpRatio);
        const aiStress = 0.2 * (1 - aiHpRatio);
        const combatIntensity = 0.3 * Math.min(1, this.recentDamageEvents / 10);
        const elapsedSec = (now - (this.matchStartTime || now)) / 1000;
        const timeStress = 0.1 * Math.min(1, (elapsedSec % 60) / 60);

        this.matchTension = Math.min(1, hpStress + aiStress + combatIntensity + timeStress);
        this.recentDamageEvents = Math.max(0, this.recentDamageEvents - 0.5); // Natural decay
        return this.matchTension;
    }

    public registerDamageEvent() {
        this.recentDamageEvents++;
    }

    public spendTokens(upgradeTokens: number, abilityTokens: number, target: 'ai1' | 'ai2', context: BattleContext) {
        const statOptions = ['maxHealth', 'speed', 'magnetism', 'damage', 'attackSpeed', 'attackRange', 'auraRadius', 'homingLevel'];
        const state = target === 'ai1' ? this.ai1 : this.ai2;
        
        for(let i=0; i<upgradeTokens; i++) {
            let totalWeight = 0;
            statOptions.forEach(opt => {
                if (state.upgradesWeights[opt] === undefined) state.upgradesWeights[opt] = 100;
                totalWeight += state.upgradesWeights[opt];
            });
            
            let rand = Math.random() * totalWeight;
            let selectedOpt = statOptions[0];
            for (let opt of statOptions) {
                rand -= state.upgradesWeights[opt];
                if (rand <= 0) {
                    selectedOpt = opt;
                    break;
                }
            }
            this.applyAiUpgrade(selectedOpt, target, context);
        }
        
        for(let i=0; i<abilityTokens; i++) {
            let totalWeight = 0;
            state.abilities.forEach(ab => {
                const opt = `ability_${ab}`;
                if (state.upgradesWeights[opt] === undefined) state.upgradesWeights[opt] = 100;
                totalWeight += state.upgradesWeights[opt];
            });
            
            let rand = Math.random() * totalWeight;
            let selectedOpt = state.abilities[0];
            for (let ab of state.abilities) {
                const opt = `ability_${ab}`;
                rand -= state.upgradesWeights[opt];
                if (rand <= 0) {
                    selectedOpt = ab;
                    break;
                }
            }
            this.applyAiUpgrade(`ability_${selectedOpt}`, target, context);
        }
    }

    public tryPurchaseAiUpgrade(target: 'ai1' | 'ai2', context: BattleContext) {
        const upgradeOptions = [
           { id: 'maxHealth', cost: 100 }, { id: 'speed', cost: 150 }, { id: 'magnetism', cost: 200 },
           { id: 'damage', cost: 250 }, { id: 'attackSpeed', cost: 300 }, { id: 'attackRange', cost: 250 },
           { id: 'auraRadius', cost: 400 }, { id: 'homingLevel', cost: 300 },
        ];
        
        const state = target === 'ai1' ? this.ai1 : this.ai2;
        
        const getAiCost = (stat: string, baseCost: number, step: number, offset: number) => {
            let currentVal = (state.stats as any)[stat] as number;
            if (stat === 'maxHealth') {
               currentVal = currentVal / 10;
            }
            const level = Math.max(0, (currentVal - offset) / step);
            return Math.floor(baseCost * Math.pow(1.5, level));
        };

        const aiCosts: Record<string, number> = {
            'maxHealth': getAiCost('maxHealth', 100, 10, 100),
            'speed': getAiCost('speed', 150, 0.1, 1),
            'magnetism': getAiCost('magnetism', 200, 0.1, 1),
            'damage': getAiCost('damage', 250, 1, 10),
            'attackSpeed': getAiCost('attackSpeed', 300, 0.1, 1),
            'attackRange': getAiCost('attackRange', 250, 50, 400),
            'auraRadius': getAiCost('auraRadius', 400, 10, 250),
            'homingLevel': getAiCost('homingLevel', 300, 1, 0),
        };

        state.abilities.forEach(ab => {
            const level = state.stats.unlockedAbilities[ab]?.level || 1;
            const baseAbilityCost = ABILITIES[ab].upgradeCost;
            aiCosts[`ability_${ab}`] = Math.floor(baseAbilityCost * Math.pow(1.5, level - 1));
            upgradeOptions.push({ id: `ability_${ab}`, cost: baseAbilityCost });
        });

        const maxCost = Math.max(...Object.values(aiCosts));
        const fullPickOverride = state.coins >= maxCost * 1.5;

        let boughtSomething = true;
        let attempts = 0;
        
        while (boughtSomething && attempts < 1) { // Rate-limited: max 1 purchase per tick
            boughtSomething = false;
            attempts++;
            
            let totalWeight = 0;
            const validOptions = upgradeOptions.filter(opt => {
                if (state.upgradesWeights[opt.id] === undefined) state.upgradesWeights[opt.id] = 100;
                return state.upgradesWeights[opt.id] > 0;
            });
            
            if (validOptions.length === 0) break;
            
            validOptions.forEach(opt => totalWeight += fullPickOverride ? 100 : state.upgradesWeights[opt.id]);
            let rand = Math.random() * totalWeight;
            let selectedOpt = validOptions[0].id;
            
            for (let opt of validOptions) {
                rand -= (fullPickOverride ? 100 : state.upgradesWeights[opt.id]);
                if (rand <= 0) {
                    selectedOpt = opt.id;
                    break;
                }
            }
            
            const actualCost = aiCosts[selectedOpt];
            if (state.coins >= actualCost) {
                state.coins -= actualCost;
                boughtSomething = true;
                
                if (selectedOpt.startsWith('ability_')) {
                    state.abilityTokensBox++;
                } else {
                    state.upgradeTokensBox++;
                }
                this.applyAiUpgrade(selectedOpt, target, context);
            }
        }
    }

    private applyAiUpgrade(selectedOpt: string, target: 'ai1' | 'ai2', context: BattleContext) {
        const state = target === 'ai1' ? this.ai1 : this.ai2;

        if (selectedOpt.startsWith('ability_')) {
            const abId = selectedOpt.replace('ability_', '');
            if (!state.stats.unlockedAbilities[abId]) {
                state.stats.unlockedAbilities[abId] = { level: 1, modifiers: {} };
            }
            state.stats.unlockedAbilities[abId].level++;
            state.stats.unlockedAbilities[abId].modifiers = context.gameState.generateAbilityUpgrade(abId, state.stats.unlockedAbilities[abId].level, state.stats.unlockedAbilities[abId].modifiers);
        } else {
            let step = 0;
            if (selectedOpt === 'maxHealth') {
                step = 10;
                if (target === 'ai1') {
                    context.bossMaxHealth.set(state.stats.maxHealth + step);
                    context.bossHealth.update((h: number) => h + step);
                    
                    const aiBody = context.enemies.find((e: any) => e.label === 'enemy' && e.plugin['data']?.type === 'enemy_phoenix');
                    if (aiBody) {
                        aiBody.plugin['data'].maxHealth += step;
                        aiBody.plugin['data'].health += step;
                    }
                } else {
                    context.maxHealth.update((h: number) => h + step);
                    context.currentHealth.update((h: number) => h + step);
                }
            }
            if (selectedOpt === 'speed') step = 0.1;
            if (selectedOpt === 'magnetism') step = 0.1;
            if (selectedOpt === 'damage') step = 1;
            if (selectedOpt === 'attackSpeed') step = 0.1;
            if (selectedOpt === 'attackRange') step = 50;
            if (selectedOpt === 'auraRadius') step = 10;
            if (selectedOpt === 'homingLevel') step = 1;
            
            (state.stats as any)[selectedOpt] += step;
            
            if (selectedOpt === 'speed' && target === 'ai1') {
                context.gameState.aiPhoenixSpeed.set(state.stats.speed);
            }
            if (selectedOpt === 'speed' && target === 'ai2') {
                context.gameState.ai2PhoenixSpeed.set(state.stats.speed);
            }
        }
        
        // Multiplicative weight decay with floor — creates more diverse builds than linear
        state.upgradesWeights[selectedOpt] = Math.max(15, (state.upgradesWeights[selectedOpt] || 100) * 0.6);

        // Apply personality bias to relevant weights
        if (selectedOpt === 'damage' || selectedOpt === 'attackSpeed' || selectedOpt.startsWith('ability_')) {
            state.upgradesWeights[selectedOpt] *= state.personality.aggression;
        }
        if (selectedOpt === 'maxHealth' || selectedOpt === 'speed') {
            state.upgradesWeights[selectedOpt] *= state.personality.caution;
        }
    }
}
