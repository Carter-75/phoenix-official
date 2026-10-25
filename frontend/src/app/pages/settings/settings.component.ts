import { Component, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../services/audio.service';
import { MlAiService } from '../../services/ml-ai.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="settings-modal" (click)="onBackdropClick($event)">
        <div class="settings-content window-panel">
            <h2 class="title text-4xl mb-6">SETTINGS</h2>
            
            <div class="sliders-container flex flex-col gap-4 overflow-y-auto max-h-[60vh] pr-2 pb-2 custom-scrollbar">
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('masterVolume')" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.masterVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Master Volume</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.masterVolume() === 0">{{(audio.masterVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.masterVolume()" 
                           (input)="updateVolume('masterVolume', $event)" 
                           class="w-full">
                </div>
                
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('menuVolume')" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.menuVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Menu / BGM Volume</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.menuVolume() === 0">{{(audio.menuVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.menuVolume()" 
                           (input)="updateVolume('menuVolume', $event)" 
                           class="w-full">
                </div>
                
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('attackVolume')" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.attackVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Attack / SFX Volume</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.attackVolume() === 0">{{(audio.attackVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.attackVolume()" 
                           (input)="updateVolume('attackVolume', $event)" 
                           class="w-full">
                </div>
                
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('sfxVolume')" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.sfxVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>SFX / Clicks Volume</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.sfxVolume() === 0">{{(audio.sfxVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.sfxVolume()" 
                           (input)="updateVolume('sfxVolume', $event)" 
                           class="w-full">
                </div>
                
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('dropVolume')" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.dropVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Item Drop / Coin Volume</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.dropVolume() === 0">{{(audio.dropVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.dropVolume()" 
                           (input)="updateVolume('dropVolume', $event)" 
                           class="w-full">
                </div>
                
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('intenseVolume')" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.intenseVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Intense (Low HP) Volume</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.intenseVolume() === 0">{{(audio.intenseVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.intenseVolume()" 
                           (input)="updateVolume('intenseVolume', $event)" 
                           class="w-full intense-slider">
                </div>

                <!-- Reset AI Brain (hold 3s) -->
                <div class="separator"></div>
                <div class="slider-group">
                    <label class="text-xs text-white/40 uppercase tracking-wider mb-1 block">Danger Zone</label>
                    <button class="reset-ai-btn"
                            [class.holding]="resetHoldProgress() > 0"
                            [class.done]="resetComplete()"
                            (mousedown)="onResetHoldStart()"
                            (mouseup)="onResetHoldEnd()"
                            (mouseleave)="onResetHoldEnd()"
                            (touchstart)="onResetHoldStart()"
                            (touchend)="onResetHoldEnd()"
                            (touchcancel)="onResetHoldEnd()">
                        <div class="reset-fill" [style.width.%]="resetHoldProgress()"></div>
                        <span class="reset-label">
                            @if (resetComplete()) {
                                ✅ AI Brain Reset!
                            } @else if (resetHoldProgress() > 0) {
                                🧠 Hold... {{ (3 - resetHoldProgress() / 100 * 3).toFixed(1) }}s
                            } @else {
                                🧠 Reset AI Brain (Hold 3s)
                            }
                        </span>
                    </button>
                </div>
            </div>
            
            <button class="btn btn-primary mt-8 w-full" (click)="close.emit()">DONE</button>
        </div>
    </div>
  `,
  styles: [`
    .settings-modal {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex; justify-content: center; align-items: center;
        z-index: 1000;
        backdrop-filter: blur(5px);
        pointer-events: auto;
    }
    .settings-content {
        background: linear-gradient(145deg, #1a1a24, #0d0d14);
        padding: 2rem;
        border-radius: 1rem;
        border: 2px solid #ffaa00;
        width: 90%; max-width: 400px;
        box-shadow: 0 0 30px rgba(255, 170, 0, 0.2);
    }
    .title {
        color: #ffaa00;
        text-align: center;
        font-weight: 800;
        text-shadow: 0 0 10px rgba(255,170,0,0.5);
    }
    .slider-group label {
        font-weight: bold;
        color: #ccc;
    }
    .slider-group span {
        font-weight: bold;
    }
    input[type=range] {
        -webkit-appearance: none;
        background: #333;
        height: 8px;
        border-radius: 4px;
        outline: none;
        margin-top: 0.5rem;
    }
    input[type=range]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 20px; height: 20px;
        background: #ffaa00;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 10px #ffaa00;
    }
    .intense-slider::-webkit-slider-thumb {
        background: #ff4444;
        box-shadow: 0 0 10px #ff4444;
    }
    .separator {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,68,68,0.3), transparent);
        margin: 0.5rem 0;
    }
    .reset-ai-btn {
        position: relative;
        width: 100%;
        padding: 0.75rem 1rem;
        border-radius: 0.5rem;
        border: 1px solid rgba(255, 68, 68, 0.3);
        background: rgba(255, 68, 68, 0.05);
        color: #ff6666;
        font-weight: 600;
        font-size: 0.85rem;
        cursor: pointer;
        overflow: hidden;
        transition: border-color 0.3s, box-shadow 0.3s;
        user-select: none;
        -webkit-user-select: none;
    }
    .reset-ai-btn:hover {
        border-color: rgba(255, 68, 68, 0.6);
    }
    .reset-ai-btn.holding {
        border-color: #ff4444;
        box-shadow: 0 0 15px rgba(255, 68, 68, 0.3);
    }
    .reset-ai-btn.done {
        border-color: #44ff44;
        box-shadow: 0 0 20px rgba(68, 255, 68, 0.3);
        color: #44ff44;
    }
    .reset-fill {
        position: absolute;
        top: 0; left: 0; bottom: 0;
        background: linear-gradient(90deg, rgba(255,68,68,0.15), rgba(255,68,68,0.3));
        transition: width 0.05s linear;
        pointer-events: none;
    }
    .reset-label {
        position: relative;
        z-index: 1;
    }
    .btn {
        background: linear-gradient(90deg, #ff8800, #ffaa00);
        color: white; font-weight: bold;
        padding: 1rem; border-radius: 0.5rem;
        text-transform: uppercase; letter-spacing: 2px;
        border: none; cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
        transform: scale(1.05);
        box-shadow: 0 0 20px rgba(255,170,0,0.4);
    }
    .custom-scrollbar::-webkit-scrollbar {
        width: 8px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: #111;
        border-radius: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: #ffaa00;
        border-radius: 4px;
    }
  `]
})
export class SettingsComponent {
  public audio = inject(AudioService);
  private mlAi = inject(MlAiService);
  @Output() close = new EventEmitter<void>();

  // Reset AI hold state
  resetHoldProgress = signal(0);
  resetComplete = signal(false);
  private holdInterval: any = null;
  private holdStartTime = 0;
  private readonly HOLD_DURATION_MS = 3000;

  updateVolume(channel: 'masterVolume'|'menuVolume'|'attackVolume'|'intenseVolume'|'sfxVolume'|'dropVolume', event: any) {
      const val = parseFloat(event.target.value);
      this.audio.setVolume(channel, val);
  }

  onBackdropClick(event: MouseEvent) {
      if ((event.target as HTMLElement).classList.contains('settings-modal')) {
          this.close.emit();
      }
  }

  onResetHoldStart() {
      if (this.resetComplete()) return;
      this.holdStartTime = Date.now();
      this.resetHoldProgress.set(0);

      this.holdInterval = setInterval(() => {
          const elapsed = Date.now() - this.holdStartTime;
          const progress = Math.min(100, (elapsed / this.HOLD_DURATION_MS) * 100);
          this.resetHoldProgress.set(progress);

          if (progress >= 100) {
              clearInterval(this.holdInterval);
              this.holdInterval = null;
              this.executeReset();
          }
      }, 50);
  }

  onResetHoldEnd() {
      if (this.holdInterval) {
          clearInterval(this.holdInterval);
          this.holdInterval = null;
      }
      if (!this.resetComplete()) {
          this.resetHoldProgress.set(0);
      }
  }

  private async executeReset() {
      this.resetComplete.set(true);
      await this.mlAi.resetWeights();

      // Auto-clear the "done" state after 3s
      setTimeout(() => {
          this.resetComplete.set(false);
          this.resetHoldProgress.set(0);
      }, 3000);
  }
}
