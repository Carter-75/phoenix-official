import { Injectable, signal } from '@angular/core';
import * as tf from '@tensorflow/tfjs';

// Battle AI (local only). The global weights sync was cut for v1 (audit bugs
// 15 and 34): any client could read and overwrite the shared model through an
// unauthenticated endpoint. This model now trains and persists ONLY on the
// player's own device.

export interface MLState {
    aiX: number; aiY: number;
    aiVelX: number; aiVelY: number;
    playerX: number; playerY: number;
    playerVelX: number; playerVelY: number;
    hpRatio: number; playerHpRatio: number;
    radar0: number; radar1: number; radar2: number; radar3: number;
    radar4: number; radar5: number; radar6: number; radar7: number;
    closestMobType: number; closestMobDist: number;
    closestMobVelX: number; closestMobVelY: number;
}

export interface MLAction {
    targetX: number;
    targetY: number;
    useTap: number;
    useHold: number;
}

export interface Experience {
    state: MLState;
    action: MLAction;
    reward: number;
}

@Injectable({ providedIn: 'root' })
export class MlAiService {
    private model!: tf.Sequential;
    private optimizer = tf.train.adam(0.01);
    public isTrained = false;

    private replayBuffer: Experience[] = [];
    private maxBufferSize = 500;

    // Decaying exploration: starts high, converges to minimum
    private explorationRate = 0.15;
    private minExplorationRate = 0.02;
    private explorationDecay = 0.9995;
    
    // X, Y, useTap, useHold
    private readonly OUTPUT_UNITS = 4;

    private static readonly LOCAL_KEY = 'phoenix_local_ai_weights';

    constructor() {
        this.initModel();
        this.loadLocalWeights();
    }

    private initModel() {
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [22] }));
        this.model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: this.OUTPUT_UNITS, activation: 'sigmoid' }));
        this.model.compile({ optimizer: this.optimizer, loss: 'meanSquaredError' });
    }

    private loadLocalWeights() {
        try {
            const raw = localStorage.getItem(MlAiService.LOCAL_KEY);
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr) && arr.length > 0) {
                    this.setWeightsFromArray(arr);
                    console.log('Loaded on-device AI weights');
                }
            }
        } catch (e) {
            console.warn('Saved AI weights did not fit this model; starting fresh.');
        }
        this.isTrained = true;
    }

    private saveLocalWeights() {
        try {
            localStorage.setItem(MlAiService.LOCAL_KEY, JSON.stringify(this.getWeightsAsArray()));
        } catch (e) { /* storage full or unavailable: learning just will not persist */ }
    }

    private getWeightsAsArray(): number[] {
        const weights = this.model.getWeights();
        let arr: number[] = [];
        for (let w of weights) {
            const data = w.dataSync();
            arr.push(...Array.from(data));
        }
        return arr;
    }

    private setWeightsFromArray(arr: number[]) {
        const currentWeights = this.model.getWeights();
        let newWeights: tf.Tensor[] = [];
        let offset = 0;
        for (let w of currentWeights) {
            const size = w.size;
            const slice = arr.slice(offset, offset + size);
            if (slice.length !== size) throw new Error('Shape mismatch during array inflation');
            newWeights.push(tf.tensor(slice, w.shape, w.dtype));
            offset += size;
        }
        this.model.setWeights(newWeights);
    }

    public downloadWeights() {
        const arr = this.getWeightsAsArray();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(arr));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", "phoenix_tfjs_weights.json");
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        dlAnchorElem.remove();
    }
    
    private stateToArray(s: MLState): number[] {
        return [
            s.aiX, s.aiY, s.aiVelX, s.aiVelY,
            s.playerX, s.playerY, s.playerVelX, s.playerVelY,
            s.hpRatio, s.playerHpRatio,
            s.radar0, s.radar1, s.radar2, s.radar3,
            s.radar4, s.radar5, s.radar6, s.radar7,
            s.closestMobType, s.closestMobDist,
            s.closestMobVelX, s.closestMobVelY
        ];
    }
    
    public predictTarget(state: MLState): MLAction {
        if (!this.isTrained) {
            return {
                targetX: state.playerX * window.innerWidth,
                targetY: state.playerY * window.innerHeight,
                useTap: Math.random(),
                useHold: Math.random()
            };
        }
        
        return tf.tidy(() => {
            const input = tf.tensor2d([this.stateToArray(state)]);
            const output = this.model.predict(input) as tf.Tensor;
            const data = output.dataSync();
            
            const explore = Math.random() < this.explorationRate;
            this.explorationRate = Math.max(this.minExplorationRate,
                this.explorationRate * this.explorationDecay);
            
            return {
                targetX: (explore ? Math.random() : data[0]) * window.innerWidth,
                targetY: (explore ? Math.random() : data[1]) * window.innerHeight,
                useTap: explore ? Math.random() : data[2],
                useHold: explore ? Math.random() : data[3]
            };
        });
    }

    public addReward(r: number) {
        if (this.replayBuffer.length > 0) {
            this.replayBuffer[this.replayBuffer.length - 1].reward += r;
        }
    }

    public recordExperience(state: MLState, action: MLAction, reward: number) {
        this.replayBuffer.push({ state, action, reward });
        if (this.replayBuffer.length > this.maxBufferSize) {
            this.replayBuffer.shift(); 
        }
    }

    public async trainOnMemory() {
        if (this.replayBuffer.length < 16) return; // Min batch requirement

        // Separate positive and negative experiences
        const positiveExps = this.replayBuffer.filter(e => e.reward > 0);
        const negativeExps = this.replayBuffer.filter(e => e.reward <= 0);

        if (positiveExps.length === 0) {
            this.replayBuffer = [];
            return; // Nothing good to learn from yet
        }

        const inputs: number[][] = [];
        const outputs: number[][] = [];
        const sampleWeights: number[] = [];

        // Normalize rewards for weighting
        const maxReward = Math.max(1, ...positiveExps.map(e => e.reward));

        for (const exp of positiveExps) {
            inputs.push(this.stateToArray(exp.state));
            outputs.push([
                exp.action.targetX / window.innerWidth,
                exp.action.targetY / window.innerHeight,
                exp.action.useTap,
                exp.action.useHold
            ]);
            sampleWeights.push(exp.reward / maxReward); // Normalize [0, 1]
        }

        // For negative experiences: train toward the MEAN of all positive actions
        // This creates a "retreat to safe behavior" gradient instead of mirror oscillation
        if (negativeExps.length > 0 && positiveExps.length > 0) {
            const meanPositiveAction = [
                positiveExps.reduce((s, e) => s + e.action.targetX / window.innerWidth, 0) / positiveExps.length,
                positiveExps.reduce((s, e) => s + e.action.targetY / window.innerHeight, 0) / positiveExps.length,
                positiveExps.reduce((s, e) => s + e.action.useTap, 0) / positiveExps.length,
                positiveExps.reduce((s, e) => s + e.action.useHold, 0) / positiveExps.length,
            ];

            for (const exp of negativeExps.slice(0, positiveExps.length)) {
                inputs.push(this.stateToArray(exp.state));
                outputs.push(meanPositiveAction);
                sampleWeights.push(0.1); // Weak gradient, don't overpower positive learning
            }
        }

        const x = tf.tensor2d(inputs);
        const y = tf.tensor2d(outputs);
        const w = tf.tensor1d(sampleWeights);

        await this.model.fit(x, y, {
            epochs: 1,
            batchSize: Math.min(32, inputs.length),
            shuffle: true,
            sampleWeight: w
        });

        x.dispose();
        y.dispose();
        w.dispose();

        this.replayBuffer = [];
        this.saveLocalWeights();
    }

    /**
     * Nuclear reset: destroy the trained model, re-initialize with random
     * weights, clear the replay buffer and the on-device saved weights.
     */
    public resetWeights(): Promise<boolean> {
        return new Promise((resolve) => {
            this.model.dispose();
            this.initModel();
            this.replayBuffer = [];
            this.explorationRate = 0.15;
            this.isTrained = true;
            try { localStorage.removeItem(MlAiService.LOCAL_KEY); } catch (e) {}
            resolve(true);
        });
    }
}
