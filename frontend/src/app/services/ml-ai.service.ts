import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import * as tf from '@tensorflow/tfjs';

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
    private http = inject(HttpClient);
    
    private replayBuffer: Experience[] = [];
    private maxBufferSize = 500;

    // Decaying exploration: starts high, converges to minimum
    private explorationRate = 0.15;
    private minExplorationRate = 0.02;
    private explorationDecay = 0.9995;
    
    // X, Y, useTap, useHold
    private readonly OUTPUT_UNITS = 4;

    constructor() {
        this.initModel();
        this.loadGlobalWeights();
    }

    private initModel() {
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [22] }));
        this.model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
        this.model.add(tf.layers.dense({ units: this.OUTPUT_UNITS, activation: 'sigmoid' }));
        this.model.compile({ optimizer: this.optimizer, loss: 'meanSquaredError' });
    }

    private loadGlobalWeights() {
        this.http.get<{weights: any, version: number}>(`${environment.apiUrl}/api/ai/weights`).subscribe({
            next: (res) => {
                if (res.weights && Array.isArray(res.weights) && res.weights.length > 0) {
                    try {
                        this.setWeightsFromArray(res.weights);
                        this.isTrained = true;
                        console.log('Loaded global TFJS weights v' + res.version);
                    } catch (e) {
                        console.warn('Global weights shape mismatch! Starting fresh for 4-output controller layout.');
                        this.isTrained = true;
                    }
                } else {
                    this.isTrained = true; 
                    console.log('No valid weights found, starting fresh with random TFJS weights');
                }
            },
            error: (err) => {
                console.log('No global weights found, starting fresh');
                this.isTrained = true;
            }
        });
    }

    public pushGlobalWeights() {
        if (!this.isTrained) return;
        const weightsArr = this.getWeightsAsArray();
        this.http.post(`${environment.apiUrl}/api/ai/weights`, { weights: weightsArr }).subscribe({
            next: () => console.log('Successfully pushed TFJS weights globally!'),
            error: (err) => console.error('Failed to push global weights', err)
        });
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
                sampleWeights.push(0.1); // Weak gradient — don't overpower positive learning
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
    }

    /**
     * Nuclear reset: destroy trained model, re-initialize with random weights,
     * clear replay buffer, reset exploration, and push fresh weights to server.
     */
    public resetWeights(): Promise<boolean> {
        return new Promise((resolve) => {
            // Dispose old model
            this.model.dispose();

            // Rebuild from scratch
            this.initModel();

            // Reset learning state
            this.replayBuffer = [];
            this.explorationRate = 0.15;
            this.isTrained = true;

            // Push fresh random weights to server (overwrite DB)
            const weightsArr = this.getWeightsAsArray();
            this.http.post(`${environment.apiUrl}/api/ai/weights`, { weights: weightsArr }).subscribe({
                next: () => {
                    console.log('AI weights reset and pushed to server!');
                    resolve(true);
                },
                error: (err) => {
                    console.error('Failed to push reset weights', err);
                    resolve(false);
                }
            });
        });
    }
}
