import { Component, Output, EventEmitter, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AudioService } from '../../services/audio.service';
import { MlAiService } from '../../services/ml-ai.service';
import { GameStateService } from '../../services/game-state.service';
import { AuthService } from '../../services/auth.service';
import { AutoplayService } from '../../autoplay/autoplay.service';
import { clientLooksLikeOwner } from '../../autoplay/autoplay-gate';
import { AUTOPLAY_DURATIONS } from '../../autoplay/autoplay-intent';
import { OUTPUT_CAP_CHARS } from '../../autoplay/autoplay-output';
import { copyText } from '../../services/clipboard';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="settings-modal backdrop-in" (click)="onBackdropClick($event)">
        <div class="settings-content window-panel panel-in">
            <h2 class="title text-3xl sm:text-4xl mb-4 sm:mb-6">SETTINGS</h2>
            
            <div class="sliders-container flex flex-col gap-4 overflow-y-auto min-h-0 flex-1 pr-2 pb-2 custom-scrollbar">
                <div class="slider-group">
                    <div class="flex justify-between">
                        <div class="flex items-center gap-2">
                            <button (click)="audio.toggleMute('masterVolume')" [attr.aria-label]="'Mute or unmute'" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
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
                            <button (click)="audio.toggleMute('menuVolume')" [attr.aria-label]="'Mute or unmute'" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.menuVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Music Volume</label>
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
                            <button (click)="audio.toggleMute('attackVolume')" [attr.aria-label]="'Mute or unmute'" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.attackVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Combat Sounds</label>
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
                            <button (click)="audio.toggleMute('sfxVolume')" [attr.aria-label]="'Mute or unmute'" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.sfxVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Menu / UI Sounds</label>
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
                            <button (click)="audio.toggleMute('dropVolume')" [attr.aria-label]="'Mute or unmute'" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.dropVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Pickup Sounds</label>
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
                            <button (click)="audio.toggleMute('intenseVolume')" [attr.aria-label]="'Mute or unmute'" class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 transition-colors">
                                {{ audio.intenseVolume() > 0 ? '🔊' : '🔇' }}
                            </button>
                            <label>Low HP Music</label>
                        </div>
                        <span class="text-white/80" [class.text-red-500]="audio.intenseVolume() === 0">{{(audio.intenseVolume() * 100).toFixed(0)}}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" 
                           [value]="audio.intenseVolume()" 
                           (input)="updateVolume('intenseVolume', $event)" 
                           class="w-full intense-slider">
                </div>

                <!-- Gameplay feel and information layers (systems S1).
                     All three are local preferences, stored on this
                     device only, never in the synced save. -->
                <div class="separator"></div>
                <div class="slider-group">
                    <div class="flex justify-between items-center">
                        <label>Touch Offset</label>
                        <button (click)="gameState.setTouchOffsetEnabled(!gameState.touchOffsetEnabled())"
                                class="press px-3 py-1 rounded bg-white/10 border border-white/20 text-white/90 font-bold text-sm hover:bg-white/20 transition">
                            {{ gameState.touchOffsetEnabled() ? 'On' : 'Off' }}
                        </button>
                    </div>
                    <p class="text-white/40 text-xs mt-1">Steering target sits above your fingertip on touch screens so the phoenix is not hidden under your thumb.</p>
                </div>

                <div class="slider-group">
                    <div class="flex justify-between items-center">
                        <label>Screen Shake</label>
                        <button (click)="cycleShake()"
                                class="press px-3 py-1 rounded bg-white/10 border border-white/20 text-white/90 font-bold text-sm hover:bg-white/20 transition">
                            {{ gameState.screenShakeSetting() === 'on' ? 'On' : gameState.screenShakeSetting() === 'reduced' ? 'Reduced' : 'Off' }}
                        </button>
                    </div>
                    <p class="text-white/40 text-xs mt-1">A short shake on boss deaths, ultimate casts, and boss contact hits. Nothing else shakes.</p>
                </div>

                <div class="slider-group">
                    <div class="flex justify-between items-center">
                        <label>Damage Numbers</label>
                        <button (click)="gameState.setDamageNumbersEnabled(!gameState.damageNumbersEnabled())"
                                class="press px-3 py-1 rounded bg-white/10 border border-white/20 text-white/90 font-bold text-sm hover:bg-white/20 transition">
                            {{ gameState.damageNumbersEnabled() ? 'On' : 'Off' }}
                        </button>
                    </div>
                    <p class="text-white/40 text-xs mt-1">Floating numbers for the damage you deal. Enemy damage is never numbered.</p>
                </div>

                <!-- Replay the interactive tutorial (menu only, so a live run is never abandoned). -->
                @if (gameState.activeScreen() === 'menu') {
                    <div class="separator"></div>
                    <button class="press w-full py-2.5 rounded-xl font-bold text-orange-200 bg-orange-500/10 border border-orange-400/30 hover:bg-orange-500/20 transition"
                            (click)="replayTutorial()">🎓 Replay Tutorial</button>
                }

                @if (ap.allowed()) {
                <div class="separator"></div>
                <div data-ui class="ap-panel">
                    <div class="ap-head">
                        <h3 class="ap-title">AI Autoplay <span class="ap-sub">(owner tester)</span></h3>
                        <div class="ap-status" [class.ap-live]="ap.running()">
                            @if (ap.running()) { <span class="ap-dot" aria-hidden="true"></span> }
                            <span>{{ ap.running() ? 'Running' : '' }}{{ ap.running() ? ' | step ' + ap.steps() : ap.status() }}</span>
                            <span class="ap-model">{{ ap.flags()?.ai ? 'AI: ' + ap.flags()?.model : 'AI: not configured' }}</span>
                        </div>
                    </div>
                    <textarea #apBox [value]="apPrompt()" (input)="onPromptInput(apBox)" rows="4" maxlength="2000"
                              [disabled]="ap.running()" aria-label="Autoplay prompt"
                              placeholder="What should the AI do? e.g. buy one upgrade with coins, or finish all realms in one run in normal mode and report bugs"
                              class="ap-input"></textarea>
                    <div class="ap-time">
                        <div class="flex justify-between items-baseline">
                            <label for="apTime">Time limit</label>
                            <span class="ap-time-val">{{ apDurations[apDurIdx()].label }}</span>
                        </div>
                        <input id="apTime" type="range" min="0" [max]="apDurations.length - 1" step="1" [value]="apDurIdx()"
                               [disabled]="ap.running()" (input)="apDurIdx.set(+$any($event.target).value)" class="w-full">
                        <div class="flex justify-between text-[10px] text-white/40"><span>{{ apDurations[0].label }}</span><span>{{ apDurations[apDurations.length - 1].label }}</span></div>
                    </div>
                    <div class="flex gap-2 mt-3">
                        <button class="ap-btn ap-send press" [disabled]="ap.running() || !apPrompt().trim()" (click)="sendAutoplay()">Send</button>
                        <button class="ap-btn ap-stop press" [disabled]="!ap.running()" (click)="ap.stop()">Stop</button>
                    </div>
                    <div class="flex justify-between items-center mt-3 mb-1 text-xs text-white/60">
                        <span>Output ({{ ap.output().length.toLocaleString() }} / {{ outputCap.toLocaleString() }} chars)</span>
                        <span class="flex gap-3">
                            <button class="underline disabled:opacity-40" [disabled]="!ap.output()" (click)="copyAutoplay()">{{ apCopied() || 'Copy' }}</button>
                            <button class="underline disabled:opacity-40" [disabled]="ap.running() || !ap.output()" (click)="ap.clearOutput()">Clear</button>
                        </span>
                    </div>
                    <pre class="ap-out custom-scrollbar">{{ ap.output() || 'No output yet. Write a prompt and press Send.' }}</pre>
                </div>
                }

                <!-- Reset AI Brain (hold 3s) -->
                <div class="separator"></div>
                <div class="slider-group">
                    <label class="text-xs text-white/40 uppercase tracking-wider mb-1 block">Danger Zone</label>
                    <p class="text-white/40 text-xs mb-2">Wipes what the learning AI phoenix has learned from your runs and starts it fresh.</p>
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
            

            <button class="btn btn-primary btn-sheen press mt-4 w-full shrink-0" (click)="close.emit()">DONE</button>
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
        width: 92%; max-width: 420px;
        max-height: 92dvh;
        display: flex; flex-direction: column;
        box-shadow: 0 0 30px rgba(255, 170, 0, 0.2);
    }
    @media (max-width: 380px) { .settings-content { padding: 1.1rem; } }
    .slider-group > .flex > .flex { min-width: 0; }
    .slider-group label { overflow-wrap: anywhere; }
    .ap-panel { padding: 0.75rem; border-radius: 1rem; border: 1px solid rgba(251,146,60,0.4); background: rgba(0,0,0,0.4); text-align: left; }
    .ap-head { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.6rem; }
    .ap-title { font-weight: 900; color: #fed7aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 1rem; }
    .ap-sub { font-weight: 600; color: rgba(255,255,255,0.45); font-size: 0.75rem; }
    .ap-status { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.6rem; font-size: 0.75rem; color: rgba(255,255,255,0.65); overflow-wrap: anywhere; }
    .ap-status.ap-live { color: #86efac; }
    .ap-model { color: rgba(255,255,255,0.45); }
    .ap-dot { width: 8px; height: 8px; border-radius: 9999px; background: #22c55e; box-shadow: 0 0 8px #22c55e; animation: apPulse 1s ease-in-out infinite; }
    @keyframes apPulse { 50% { opacity: 0.3; } }
    .ap-input { display: block; width: 100%; min-height: 6.5rem; max-height: 14rem; resize: none; overflow-y: auto; padding: 0.6rem; border-radius: 0.6rem; background: #18181b; color: white; font-size: 0.875rem; line-height: 1.35; border: 1px solid rgba(255,255,255,0.15); }
    .ap-input:focus { outline: none; border-color: #ffaa00; }
    .ap-input:disabled { opacity: 0.6; }
    .ap-input::placeholder { color: rgba(255,255,255,0.4); white-space: pre-wrap; }
    .ap-time { margin-top: 0.6rem; font-size: 0.875rem; color: rgba(255,255,255,0.8); }
    .ap-time label { font-weight: bold; color: #ccc; }
    .ap-time-val { font-weight: 900; color: #ffaa00; }
    .ap-btn { flex: 1; padding: 0.6rem; border-radius: 0.6rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; transition: opacity 0.2s; }
    .ap-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .ap-send { background: linear-gradient(90deg, #ff8800, #ffaa00); color: white; }
    .ap-stop { background: #b91c1c; color: white; }
    .ap-out { width: 100%; height: 14rem; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.4; padding: 0.6rem; border-radius: 0.6rem; background: #09090b; color: rgba(255,255,255,0.88); border: 1px solid rgba(255,255,255,0.1); user-select: text; -webkit-user-select: text; }
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
  public gameState = inject(GameStateService);
  private mlAi = inject(MlAiService);
  @Output() close = new EventEmitter<void>();
  public ap = inject(AutoplayService);
  public apPrompt = signal('');
  public apDurIdx = signal(7);
  public apCopied = signal('');
  public readonly outputCap = OUTPUT_CAP_CHARS;
  public readonly apDurations = AUTOPLAY_DURATIONS;

  constructor() { if (clientLooksLikeOwner(inject(AuthService).currentUser() as any)) void this.ap.refreshFlags(); }

  sendAutoplay() {
    const d = this.apDurations[this.apDurIdx()];
    this.close.emit();
    void this.ap.start(this.apPrompt(), d.ms);
  }

  /** Auto-grow the prompt box between its CSS min and max height. */
  onPromptInput(el: HTMLTextAreaElement) {
    this.apPrompt.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }

  async copyAutoplay() {
    const ok = await copyText(this.ap.output());
    this.apCopied.set(ok ? 'Copied' : 'Copy failed');
    setTimeout(() => this.apCopied.set(''), 1500);
  }

  replayTutorial(): void {
    this.close.emit();
    this.gameState.activeScreen.set('tutorial');
  }

  cycleShake() {
      const cur = this.gameState.screenShakeSetting();
      this.gameState.setScreenShakeSetting(cur === 'on' ? 'reduced' : cur === 'reduced' ? 'off' : 'on');
  }

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
