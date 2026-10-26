import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, NgZone, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService, STAMINA, createMovementState } from '../../services/game-state.service';
import { phoenixSkinForWorld } from '../../components/particle-bg/particle-bg.component';
import { PhysicsEntity, WorldStats } from '../../models/game.models';
import { ABILITIES, BASE_STATS, REALM_ABILITIES } from '../../constants/game.constants';
import { AudioService } from '../../services/audio.service';
import { SettingsComponent } from '../settings/settings.component';
import * as Matter from 'matter-js';
import anime from 'animejs';
import { MlAiService } from '../../services/ml-ai.service';
import { BattleAiService, BattleContext } from '../../services/battle-ai.service';
import { EntitySpawnerService, SPAWN_DEFS } from '../../services/entity-spawner.service';
import { AdsService } from '../../services/ads.service';

interface EnemyData {
  id: string;
  type: 'bat' | 'slime' | 'golem' | 'imp' | 'wisp' | 'pod' | 'mite' | 'sentry_shard' | 'seedmother' | 'rift_mine' | 'shieldback' | 'pyre_moth' | 'boss' | 'projectile_player' | 'projectile_enemy' | 'aura' | 'coin' | 'gem' | 'heart' | 'xp_orb' | 'drill' | 'fire' | 'turret' | 'egg' | 'crate' | 'annihilation_fire' | 'enemy_phoenix' | 'dart' | 'talon' | 'spark' | 'lance';
  health: number;
  maxHealth: number;
  lastAttackTime?: number;
  lastMinionTime?: number;
  burstDamage?: number; // Custom damage payload
  value?: number;
  aiAbilities?: { id: string; level: number }[]; // For Battle Mode
  owner?: 'player' | 'enemy';
  ownerId?: string;
  immortalUntil?: number;
  weaveValue?: number; // Gloomwing weave sine, published for the renderer's banking
  // S2 move payload fields (mirrors models/game.models.ts EnemyData).
  moveId?: string;
  pierce?: boolean;
  hitIds?: string[];
  targetId?: string;
  meteorRushUntil?: number;
  meteorRushDamage?: number;
  meteorRushHits?: string[];
  // Stage 3 behavior state machine fields (mirror models/game.models.ts).
  behaviorState?: string;
  stateUntil?: number;
  telegraphStart?: number;
  dashDirX?: number;
  dashDirY?: number;
  orbitDir?: number;
  aimDirX?: number;
  aimDirY?: number;
  nextAimAt?: number;
  // Stage 4 behavior fields (mirror models/game.models.ts).
  motherId?: string;
  sparkUntil?: number;
  infernoUntil?: number;
}

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, SettingsComponent],
  template: `
    <div class="fixed inset-0 z-10 w-full h-full pointer-events-none" [style.transform]="shakeTransform()">
      
      <!-- Progress Bar Overlay -->
      <div class="absolute top-8 left-1/2 -translate-x-1/2 w-[80%] max-w-2xl flex flex-col items-center gap-2 pointer-events-auto">
        @if (gameState.currentGameMode() === 'battle' || gameState.currentGameMode() === 'ai_vs_ai') {
           <span class="text-white font-bold tracking-widest uppercase drop-shadow-md text-xl">{{ gameState.currentGameMode() === 'ai_vs_ai' ? 'AI VS AI' : 'BATTLE MODE' }}</span>
           <span class="text-white/90 font-mono text-2xl font-bold">{{ formatTime(battleTimer()) }}</span>
           
           <span class="text-white font-bold tracking-widest uppercase drop-shadow-md mt-4">AI PHOENIX</span>
           <div class="w-full h-4 bg-black/50 border border-white/20 rounded-full overflow-hidden shadow-[0_0_15px_rgba(255,0,0,0.2)]">
              <div class="h-full bg-gradient-to-r from-cyan-600 to-blue-600 transition-all duration-300"
                   [style.width]="bossHealthPercent() + '%'"></div>
           </div>
        } @else {
           <span class="text-white font-bold tracking-widest uppercase drop-shadow-md">
              SURVIVE
           </span>
           <div class="w-full h-3 bg-black/50 border border-white/20 rounded-full overflow-hidden shadow-[0_0_15px_rgba(255,255,255,0.1)]">
              <div class="h-full bg-gradient-to-r transition-all duration-1000"
                   [ngClass]="currentWorld().textColorClass"
                   [style.width]="progressPercent() + '%'"></div>
           </div>
           <span class="text-white/80 font-mono text-sm">{{ formatTime(Math.max(0, timeRemaining())) }}</span>
           
           @if (bossSpawned()) {
               <span class="text-white font-bold tracking-widest uppercase drop-shadow-md mt-4">
                  BOSS HEALTH
               </span>
               <div class="w-full h-3 bg-black/50 border border-white/20 rounded-full overflow-hidden shadow-[0_0_15px_rgba(255,0,0,0.1)]">
                  <div class="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-1000"
                       [style.width]="bossHealthPercent() + '%'"></div>
               </div>
           }
        }
      </div>
      
      <!-- AI vs AI Scoreboard UI -->
      @if (gameState.currentGameMode() === 'ai_vs_ai') {
          <div class="absolute bottom-20 right-4 md:right-8 flex flex-col gap-1 pointer-events-auto z-10 p-4 bg-black/50 border border-white/10 rounded-2xl backdrop-blur-sm">
             <div class="text-white/80 font-bold text-xs tracking-widest uppercase mb-1 text-right">Wins</div>
             <div class="text-3xl font-black text-cyan-400 drop-shadow-md text-right">{{ gameState.ai1Wins() }}</div>
          </div>
          <div class="absolute bottom-20 left-4 md:left-8 flex flex-col gap-1 pointer-events-auto z-10 p-4 bg-black/50 border border-white/10 rounded-2xl backdrop-blur-sm">
             <div class="text-white/80 font-bold text-xs tracking-widest uppercase mb-1">Wins</div>
             <div class="text-3xl font-black text-fuchsia-400 drop-shadow-md">{{ gameState.ai2Wins() }}</div>
          </div>
      }

      <!-- Battle Score UI -->
      @if (gameState.currentGameMode() === 'battle') {
          <div class="absolute bottom-20 left-4 md:left-8 flex flex-col gap-1 pointer-events-auto z-10 p-4 bg-black/50 border border-white/10 rounded-2xl backdrop-blur-sm">
             <div class="text-white/80 font-bold text-xs tracking-widest uppercase mb-1">Battle Stats</div>
             <div class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-cyan-400 drop-shadow-md flex items-center gap-2">
                 <span>Score:</span> <span>{{ currentBattleScore() }}</span>
             </div>
             <div class="text-lg font-bold text-yellow-400 flex items-center gap-2 drop-shadow-md">
                 <img src="assets/coin_icon.png" class="w-5 h-5"/> <span>{{ gameState.coins() }}</span>
                 <span class="text-xs text-yellow-500 ml-1">(+{{ currentBattleCoinsGained() }})</span>
             </div>
          </div>
      }
      
      <!-- Health Bar -->
      <div class="absolute bottom-8 left-1/2 -translate-x-1/2 w-48 md:w-64 flex flex-col items-center gap-2 pointer-events-auto">
        @if (gameState.currentGameMode() === 'ai_vs_ai') {
            <span class="text-white font-bold tracking-widest uppercase drop-shadow-md mt-4 text-xs">AI PHOENIX</span>
        }
        <div class="w-full h-4 bg-black/50 border border-white/20 rounded-full overflow-hidden shadow-[0_0_15px_rgba(255,0,0,0.2)]">
           <div class="h-full bg-gradient-to-r from-red-600 to-fuchsia-600 transition-all duration-300"
                [style.width]="(currentHealth() / maxHealth()) * 100 + '%'"></div>
        </div>
        <span class="text-red-400 font-bold text-sm">{{ currentHealth() }} / {{ maxHealth() }}</span>
        <!-- Stamina arc (spec Section 2.5): a slim ring under the HP
             bar in the skin's mid color, emptying toward the hostile
             color as it drains. No numbers, no popups. It glows while
             gliding (Section 2.6). -->
        @if (gameState.currentGameMode() !== 'ai_vs_ai') {
          <div class="w-10 h-10 rounded-full flex items-center justify-center transition-shadow duration-300"
               [style.background]="staminaArcBackground()"
               [style.box-shadow]="gameState.playerMovement.gliding ? '0 0 14px rgba(255,255,255,0.55)' : '0 0 6px rgba(0,0,0,0.5)'"
               title="Stamina">
            <div class="w-7 h-7 rounded-full bg-black/70"></div>
          </div>
        }
      </div>

      <!-- Damage numbers layer (spec Section 4.4): player-dealt damage
           only, merged per enemy, pooled sprites, off means absent. -->
      @if (gameState.damageNumbersEnabled()) {
        @for (n of damageSprites(); track n.id) {
          <div class="fixed pointer-events-none z-30 font-black select-none"
               [style.left.px]="n.x" [style.top.px]="damageSpriteTop(n)"
               [style.opacity]="damageSpriteOpacity(n)"
               [style.font-size.px]="n.size"
               [style.color]="n.color"
               style="transform: translate(-50%, -100%); text-shadow: -1px -1px 0 rgba(0,0,0,0.85), 1px -1px 0 rgba(0,0,0,0.85), -1px 1px 0 rgba(0,0,0,0.85), 1px 1px 0 rgba(0,0,0,0.85);">
            {{ n.amount }}
          </div>
        }
      }

      <!-- Cooldown UI -->
      <div class="absolute bottom-8 right-4 md:right-8 flex gap-2 md:gap-4 pointer-events-auto">
        <!-- Tap Ability -->
        <div class="relative w-14 h-14 md:w-16 md:h-16 bg-black/50 border border-white/20 rounded-2xl overflow-hidden flex items-center justify-center backdrop-blur-sm shadow-[0_0_15px_rgba(255,100,200,0.2)]">
          <span class="text-3xl z-10" [class.opacity-50]="tapCooldown() > 0">{{ getTapIcon() }}</span>
          @if (tapCooldown() > 0) {
            <div class="absolute bottom-0 left-0 w-full bg-pink-600/50 transition-all" [style.height]="(tapCooldown() / getTapMaxCooldown()) * 100 + '%'"></div>
            <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ tapCooldown().toFixed(1) }}</span>
          }
        </div>
        <!-- Hold Ability -->
        <div class="relative w-14 h-14 md:w-16 md:h-16 bg-black/50 border border-white/20 rounded-2xl overflow-hidden flex items-center justify-center backdrop-blur-sm shadow-[0_0_15px_rgba(0,255,255,0.2)]"
             [class.ring-2]="holdChargeProgress() > 0" [class.ring-cyan-300]="holdChargeProgress() > 0">
          <span class="text-3xl z-10" [class.opacity-50]="holdCooldown() > 0">{{ getHoldIcon() }}</span>
          @if (holdCooldown() > 0) {
            <div class="absolute bottom-0 left-0 w-full bg-cyan-600/50 transition-all" [style.height]="(holdCooldown() / getHoldMaxCooldown()) * 100 + '%'"></div>
            <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ holdCooldown().toFixed(1) }}</span>
          }
          @if (holdChargeProgress() > 0 && holdCooldown() <= 0) {
            <div class="absolute bottom-0 left-0 w-full bg-cyan-400/40" [style.height]="holdChargeProgress() * 100 + '%'"></div>
          }
        </div>
        <!-- Double-tap slot (spec Section 3.2): parsed and equippable
             from S1; its move pool ships in S2, so an empty slot shows
             the family mark instead of an icon. -->
        <div class="relative w-14 h-14 md:w-16 md:h-16 bg-black/50 border border-white/20 rounded-2xl overflow-hidden flex items-center justify-center backdrop-blur-sm shadow-[0_0_15px_rgba(150,100,255,0.2)]">
          @if (gameState.currentStats().activeDoubleAbility) {
            <span class="text-3xl z-10" [class.opacity-50]="doubleCooldown() > 0">{{ getDoubleIcon() }}</span>
          } @else {
            <span class="text-lg font-black text-white/40 z-10">2x</span>
          }
          <span class="absolute bottom-1 right-1.5 z-20 text-[9px] font-bold text-white/50 uppercase tracking-wider">Dbl</span>
          @if (doubleCooldown() > 0) {
            <div class="absolute bottom-0 left-0 w-full bg-violet-600/50 transition-all" [style.height]="(doubleCooldown() / getDoubleMaxCooldown()) * 100 + '%'"></div>
            <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ doubleCooldown().toFixed(1) }}</span>
          }
        </div>
        <!-- Triple-tap slot (the ultimate slot, spec Section 3.2). -->
        <div class="relative w-14 h-14 md:w-16 md:h-16 bg-black/50 border border-white/20 rounded-2xl overflow-hidden flex items-center justify-center backdrop-blur-sm shadow-[0_0_15px_rgba(255,200,0,0.2)]">
          @if (gameState.currentStats().activeTripleAbility) {
            <span class="text-3xl z-10" [class.opacity-50]="tripleCooldown() > 0">{{ getTripleIcon() }}</span>
          } @else {
            <span class="text-lg font-black text-white/40 z-10">3x</span>
          }
          <span class="absolute bottom-1 right-1.5 z-20 text-[9px] font-bold text-white/50 uppercase tracking-wider">Ult</span>
          @if (tripleCooldown() > 0) {
            <div class="absolute bottom-0 left-0 w-full bg-amber-600/50 transition-all" [style.height]="(tripleCooldown() / getTripleMaxCooldown()) * 100 + '%'"></div>
            <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ tripleCooldown().toFixed(1) }}</span>
          }
        </div>
      </div>

      <!-- Hold-charge ring anchored to the finger (fills as you hold still; flashes when ready) -->
      @if (holdChargeProgress() > 0 && holdCooldown() <= 0) {
        <div class="fixed pointer-events-none z-40 -translate-x-1/2 -translate-y-1/2"
             [style.left.px]="holdChargePos().x" [style.top.px]="holdChargePos().y">
          <div class="w-24 h-24 rounded-full flex items-center justify-center"
               [class.animate-ping]="holdChargeProgress() >= 1"
               [style.background]="'conic-gradient(rgba(34,211,238,0.85) ' + (holdChargeProgress()*360) + 'deg, rgba(255,255,255,0.08) 0deg)'">
            <div class="w-20 h-20 rounded-full bg-black/40 border border-cyan-300/40 flex items-center justify-center">
              @if (holdChargeProgress() >= 1) {
                <span class="text-cyan-200 text-[10px] font-bold uppercase tracking-widest text-center leading-tight">Release<br/>to move</span>
              } @else {
                <span class="text-cyan-100/80 text-xs font-bold">{{ (holdChargeProgress()*100).toFixed(0) }}%</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Boss Warning & Rage Mode -->
      @if (bossSpawned() && !rageModeActive()) {
        <div class="absolute top-24 left-1/2 -translate-x-1/2 animate-pulse pointer-events-none z-20">
           <h2 class="text-4xl font-black text-red-600 drop-shadow-[0_0_20px_rgba(255,0,0,0.8)] tracking-widest uppercase">World Boss Approaching</h2>
        </div>
      }
      @if (rageModeActive() && !isDead() && !gameEnded()) {
        <div class="absolute top-24 left-1/2 -translate-x-1/2 pointer-events-none z-20 flex flex-col items-center">
           <h2 class="text-5xl font-black text-red-600 drop-shadow-[0_0_30px_rgba(255,0,0,1)] tracking-widest uppercase animate-ping">RAGE MODE</h2>
           <span class="text-2xl text-white font-mono mt-2 bg-black/50 px-4 py-1 rounded">Death in: {{ killScreenTimer() }}s</span>
        </div>
        <div class="absolute inset-0 bg-red-900/20 pointer-events-none z-10 animate-pulse"></div>
      }

      <!-- Pause Button -->
      <button (click)="togglePause()" class="absolute top-8 right-4 md:right-8 w-10 h-10 md:w-12 md:h-12 bg-black/50 border border-white/20 rounded-full flex items-center justify-center pointer-events-auto hover:bg-white/10 transition z-20">
        <span class="text-white font-bold text-xl">||</span>
      </button>

      <!-- Pause Screen -->
      @if (gameState.isPaused()) {
        <div class="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-40">
          <h2 (click)="onPauseTextClick()" 
              class="text-6xl font-black mb-8 tracking-widest cursor-pointer select-none transition-all duration-300"
              [class.text-red-500]="cheatPrepared()"
              [class.drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]]="cheatPrepared()"
              [class.text-white]="!cheatPrepared()"
              [class.drop-shadow-lg]="!cheatPrepared()">PAUSED</h2>
          
          <div class="flex flex-col gap-4 w-full max-w-xs">
            <button (click)="togglePause()" class="w-full py-4 bg-white/10 hover:bg-white/20 border border-white/30 rounded-2xl text-white font-bold text-xl transition">
              Resume
            </button>
            <button (click)="showSettings = true" class="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/20 rounded-2xl text-white font-bold text-lg transition">
              Settings
            </button>
            @if (gameState.currentGameMode() === 'ai_vs_ai') {
                <button (click)="mlAi.downloadWeights()" class="w-full py-4 bg-blue-900/50 hover:bg-blue-800/50 border border-blue-500/50 rounded-2xl text-white font-bold text-lg transition">
                  Download AI Weights
                </button>
            }
            <button (click)="quitFromPause()" class="w-full py-4 bg-transparent hover:bg-white/5 border border-transparent hover:border-white/10 rounded-2xl text-white/50 hover:text-white transition">
              Quit to Menu
            </button>
          </div>
        </div>
      }
      
      @if (showSettings) {
          <app-settings (close)="showSettings = false"></app-settings>
      }

      <!-- Drop Event Screen Flash -->
      <div class="absolute inset-0 bg-white transition-opacity duration-200 pointer-events-none z-40"
           [style.opacity]="screenFlash() ? 0.8 : 0"></div>

      <!-- Damage Overlay (Red Flash) -->
      <div class="absolute inset-0 bg-red-600 transition-opacity duration-300 pointer-events-none"
           [style.opacity]="damageFlash() ? 0.3 : 0"></div>

      <!-- Death / Tombstone Screen -->
      @if (isDead()) {
        <div class="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-50">
          <div class="w-32 h-40 bg-gray-800 border-4 border-gray-600 rounded-t-full flex flex-col items-center justify-center mb-8 shadow-[0_0_50px_rgba(0,0,0,1)]">
            <span class="text-5xl text-gray-400">✝</span>
            <span class="text-gray-500 mt-2 font-mono text-sm">R.I.P</span>
          </div>

          <h2 class="text-5xl font-black text-red-500 mb-2 drop-shadow-lg">YOU DIED</h2>
          @if (!annihilationModeActive() && gameState.currentGameMode() !== 'battle') {
              <p class="text-white text-xl font-bold mb-8">Revive in: <span class="text-orange-400 font-mono">{{ reviveCountdown() }}s</span></p>
              
              <div class="flex flex-col gap-4 w-full max-w-sm">
                <button (click)="reviveWithGems()" 
                        [disabled]="gameState.gems() < getReviveCost()"
                        [class.opacity-50]="gameState.gems() < getReviveCost()"
                        [class.cursor-not-allowed]="gameState.gems() < getReviveCost()"
                        class="w-full py-4 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:brightness-125 border border-fuchsia-400/50 rounded-2xl flex justify-center items-center gap-3 transition shadow-[0_0_20px_rgba(200,0,255,0.3)]">
                  <span class="text-white font-bold text-xl">Instant Revive</span>
                  <img src="assets/gem_icon.png" class="w-6 h-6"/>
                  <span class="text-white font-bold text-xl">{{ getReviveCost() }}</span>
                </button>
                @if (adRevivesUsed < maxAdRevivesPerRun) {
                <button (click)="reviveWithAd()" class="w-full mt-2 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:brightness-125 border border-cyan-400/50 rounded-2xl flex justify-center items-center gap-3 transition shadow-[0_0_20px_rgba(0,200,255,0.3)]">
                  <span class="text-white font-bold text-xl">Watch Ad to Revive</span>
                  <span class="text-2xl">📺</span>
                </button>
                }
                @if (gameState.reviveTokens() > 0) {
                <button (click)="reviveWithToken()" class="w-full mt-2 py-4 bg-gradient-to-r from-amber-600 to-orange-600 hover:brightness-125 border border-amber-400/50 rounded-2xl flex justify-center items-center gap-3 transition shadow-[0_0_20px_rgba(255,180,0,0.3)]">
                  <span class="text-white font-bold text-xl">Use Revive Token</span>
                  <span class="text-white font-bold text-xl">({{ gameState.reviveTokens() }})</span>
                  <span class="text-2xl">🪶</span>
                </button>
                }
                <button (click)="quitGame()" class="w-full mt-4 py-4 bg-transparent hover:bg-white/5 border border-transparent hover:border-white/10 rounded-2xl text-white/50 hover:text-white transition">
                  Give Up
                </button>
              </div>
          } @else if (gameState.currentGameMode() === 'battle') {
              <p class="text-red-500 text-xl font-bold mb-8 uppercase text-center max-w-md">The AI Phoenix emerges victorious.</p>
              <div class="flex flex-col gap-4 w-full max-w-sm">
                <button (click)="quitGame()" class="w-full mt-4 py-4 bg-red-900/50 hover:bg-red-800/50 border border-red-500/30 rounded-2xl text-white transition">
                  Accept Fate
                </button>
              </div>
          } @else {
              <p class="text-red-500 text-xl font-bold mb-8 uppercase text-center max-w-md">Your flames have been permanently extinguished.</p>
              <div class="flex flex-col gap-4 w-full max-w-sm">
                <button (click)="quitGame()" class="w-full mt-4 py-4 bg-red-900/50 hover:bg-red-800/50 border border-red-500/30 rounded-2xl text-white transition">
                  Accept Fate
                </button>
              </div>
          }
        </div>
      }

      <!-- End Game Screen -->
      @if (gameEnded() && !isDead()) {
        <div class="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-50">
          <h2 class="text-6xl font-black text-white mb-4 drop-shadow-lg" [ngClass]="gameWon() ? 'text-yellow-400' : 'text-red-500'">
            {{ gameWon() ? 'VICTORY' : 'DEFEAT' }}
          </h2>
          @if (gameWon()) {
            <div class="flex items-center gap-3 mb-8 bg-purple-900/50 px-6 py-3 rounded-full border border-purple-500/50">
              <span class="text-white font-bold">Reward:</span>
              <span class="text-purple-400 font-bold text-2xl">+1</span>
              <img src="assets/gem_icon.png" class="w-8 h-8"/>
            </div>
          }
          <button (click)="quitGame()" class="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/30 rounded-full text-white font-bold transition">
            Return to Menu
          </button>
        </div>
      }

      <!-- Invisible Physics Container (Hidden entirely, rendered via ParticleBg) -->
      <div #physicsContainer class="absolute inset-0 w-full h-full opacity-0 pointer-events-none"></div>
    </div>
  `
})
export class GameComponent implements OnInit, OnDestroy {

  @ViewChild('physicsContainer', { static: true }) physicsContainer!: ElementRef<HTMLDivElement>;


  public gameState = inject(GameStateService);

  private audioService = inject(AudioService);

  public mlAi = inject(MlAiService);
  private adsService = inject(AdsService);
  public battleAi = inject(BattleAiService);
  public spawner = inject(EntitySpawnerService);

  public Math = Math;

  public currentWorld = computed(() => this.gameState.worlds[this.gameState.selectedWorldIndex()]);

  
  get screenScale() {
      return Math.max(0.4, Math.min(1.0, window.innerWidth / 1000));
  }

  // Logical playfield unit for speeds (playtest round 1, speed
  // consistency): the smaller viewport dimension in px. Every gameplay
  // speed is defined against it, so play feels the same on a small
  // phone, a landscape phone, and a tablet. At the 412 px reference
  // phone the factor is exactly 1 and speeds equal the historical
  // pixel values the game was tuned with.
  private get logicalUnit(): number {
      return Math.min(window.innerWidth, window.innerHeight);
  }

  private get speedScale(): number {
      return this.logicalUnit / 412;
  }

  // Convert a speed tuned on the reference phone (px per 1/60 s step,
  // the unit Matter velocities use) into the current viewport's value.
  private scaledSpeed(pxPerStepAtRef: number): number {
      return pxPerStepAtRef * this.speedScale;
  }

  
  public maxHealth = signal<number>(100);

  public currentHealth = signal<number>(100);

  public damageFlash = signal<boolean>(false);

  public reviveCount = 0;
  // Rewarded-ad revives are capped per run (audit 6.3). Gem and token
  // revives stay available after the ad cap is reached.
  public readonly maxAdRevivesPerRun = 2;
  public adRevivesUsed = 0;

  public celestialShieldActive = signal<boolean>(true);

  
  public totalTimeSignal = signal<number>(300);

  public timeRemaining = signal<number>(300);

  public progressPercent = computed(() => {
      const tot = this.totalTimeSignal();
      if (tot <= 0) return 0;
      return ((tot - this.timeRemaining()) / tot) * 100;
  });

  
  public gameEnded = signal<boolean>(false);

  public gameWon = signal<boolean>(false);

  public isDead = signal<boolean>(false);

  public bossSpawned = signal<boolean>(false);

  public bossHealth = signal<number>(1000);

  public inBossDefeatSequence = signal<boolean>(false);

  private bossDefeatTimestamp = 0;

  private bossGemsDropped = 0;

  private bossGemsCollected = 0;

  public animatingAscension = signal<boolean>(false);

  public infiniteBurnActive = signal<boolean>(false);

  public rageModeActive = signal<boolean>(false);


  // --- Battle Mode AI State ---

 // AI passive coin income per sec
















  
  public battleTimer = signal<number>(0);

  // True while the cinematic battle entrance is playing. The world stays LIVE (physics running,
  // no hard pause) but: player movement is frozen (body slaved to entrance override), AI logic &
  // attacks are disabled, and damage is suppressed so nobody dies during the intro.
  public entranceActive = signal<boolean>(false);
  public battleDropReady = signal<boolean>(false);

  public battleDropGrace = signal<boolean>(false);

  public nextDropIndex = 0;

  public screenFlash = signal<boolean>(false);

  public battleStartCoins = 0;

  public battleStartXp = 0;

  public battleCoinsCollected = signal<number>(0);

  
  public currentBattleCoinsGained = computed(() => this.battleCoinsCollected());

  public currentBattleScore = computed(() => {
      const xpGained = Math.max(0, this.gameState.xp() - this.battleStartXp);
      return Math.floor(this.battleTimer() * 10) + (this.currentBattleCoinsGained() * 10) + Math.floor(xpGained * 5);
  });

  
  public bossMaxHealth = signal<number>(1000);

  public bossHealthPercent = computed(() => (this.bossHealth() / this.bossMaxHealth()) * 100);

  
  public showSettings = false;

  
  // Crate Logic
  public crateDroppedThisRun = false;

  public crateCollectedThisRun = false;


  // Revive UI
  public reviveCountdown = signal<number>(10);

  private reviveInterval: any;

  // True while a revive rewarded ad is on screen. The revive countdown
  // is paused for the whole flight of the ad (playtest round 1, Bug 4).
  private adReviveInFlight = false;


  // Abilities
  public tapCooldown = signal<number>(0);

  public holdCooldown = signal<number>(0);

  // Double and triple slot cooldowns (spec Section 3.2). The slots and
  // parser are live from S1; their move pools ship in S2 and S4.
  public doubleCooldown = signal<number>(0);

  public tripleCooldown = signal<number>(0);

  public hasRebirthed = false;

  private lastClickTime = 0;

  // Tap-chain parser state (spec Section 3.2): taps landing within
  // 300 ms of the previous tap extend the chain. Count 2 fires the tap
  // slot (exactly the pre-S1 behavior), 3 fires the double slot, 4
  // fires the triple slot and ends the chain.
  private tapChainCount = 0;
  private tapChainLastTime = 0;

  // Flick Dash gesture tracking (spec Section 2.2): press point and
  // time for the steering finger or mouse; a release within 120 ms
  // after at least 12 percent of min-dimension travel is a flick.
  private pressX = 0;
  private pressY = 0;
  private pressT = 0;

  // Second-finger state (spec Sections 2.3 and 2.4): while a second
  // finger is down the Feather Brake is held; a quick second-finger
  // tap (under 250 ms) is an Air Roll instead. rawBrakeHeld also
  // covers the mouse brake inputs (Space, right mouse button).
  private secondFingerStartT = 0;
  private rawBrakeHeld = false;

  // Damage numbers (spec Section 4.4): per-enemy merged totals waiting
  // out their 100 ms merge window, then a pooled sprite layer of at
  // most 20 live numbers.
  private dmgPending = new Map<string, { total: number, x: number, y: number, lastAdd: number, isBoss: boolean }>();
  public damageSprites = signal<Array<{ id: number, x: number, y: number, amount: number, born: number, size: number, color: string }>>([]);
  private dmgSpriteSeq = 0;
  // Effects clock: bumped every physics frame so the sprite layer and
  // the stamina arc re-render; also carries the shake transform.
  public fxNow = signal<number>(0);
  public shakeTransform = signal<string>('');
  // Every shake that actually fired, with its trigger. The allowed
  // list is SHAKE_ALLOWED_TRIGGERS; the harness asserts on this log.
  public shakeEvents: Array<{ trigger: string, at: number }> = [];
  private shakeStartPerf = 0;
  private shakeDurMs = 0;
  private shakeAmpPx = 0;
  private shakeDirX = 0;
  private shakeDirY = 0;
  // Per-frame impact-spark throttle (spec Section 4.6): spark spawns
  // beyond the per-frame allowance are dropped, oldest first, so a
  // 12-enemy death frame can never hitch the game.
  private sparkFrameStart = 0;
  private sparkFrameCount = 0;
  private static readonly SPARK_PER_FRAME_BUDGET = 90;

  private pauseClickCount = 0;

  public cheatPrepared = signal<boolean>(false);

  
  private tapAbilityEndTime = 0;

  private holdAbilityEndTime = 0;
  // S2: Meteor Rush state for the player-side cast (the rival keeps
  // its rush state on its body data; see EnemyData.meteorRushUntil).
  private meteorRushUntilMs = 0;
  private meteorRushDamageValue = 0;
  private meteorRushHitIds = new Set<string>();

  private doubleAbilityEndTime = 0;

  private tripleAbilityEndTime = 0;

  // S3: Phoenix Inferno channel end for the player (the rival keeps
  // its channel end on its body data, EnemyData.infernoUntil). While
  // the channel is live the player is braked (Feather Brake speed)
  // and the hold cooldown does not tick down.
  private playerInfernoUntil = 0;

  // S3 gadget state (spec Section 5.3): run-local, reset every run.
  // The Feather Charm fires at most once per run; the Aegis Charm's
  // one charge is armed at run start when the gadget is equipped.
  private featherUsedThisRun = false;
  public aegisShieldActive = signal<boolean>(false);

  
  // Input Tracking
  private mouseX = window.innerWidth / 2;

  private mouseY = window.innerHeight / 2;

  private isMouseHeld = false;
  // Hold-ability charge feedback (0..1) and the screen position of the charging finger.
  public holdChargeProgress = signal<number>(0);
  public holdChargePos = signal<{x: number, y: number}>({ x: 0, y: 0 });

  private holdTimer = 0;

  private holdStartX = 0;

  private holdStartY = 0;


  // Matter.js
  private engine!: Matter.Engine;

  // Fixed-step physics driver (playtest round 1, speed consistency). The
  // engine is advanced in exact 1/60 s steps accumulated from wall-clock
  // time, so physics runs at the same rate on 60, 90, and 120 Hz screens.
  // Matter.Runner cannot do this: it clamps its step delta to a minimum
  // of 16.7 ms, which makes the whole world run about 2x fast at 120 Hz.
  private readonly PHYSICS_STEP_MS = 1000 / 60;
  private physicsRafId: number | null = null;
  private physicsLastTime = 0;
  private physicsAccumulator = 0;

  private playerBody!: Matter.Body;

  
  private timerInterval: any;


  private attackInterval: any;

  private enemies: Matter.Body[] = [];

  private items: Matter.Body[] = [];


  // Listeners bound
  private boundKeyDown = this.onKeyDown.bind(this);

  private boundKeyUp = this.onKeyUp.bind(this);

  private boundContextMenu = (event: Event) => event.preventDefault();

  private boundVisibility = this.onVisibilityChange.bind(this);

  private boundMouseMove = this.onMouseMove.bind(this);

  private boundMouseDown = this.onMouseDown.bind(this);

  private boundMouseUp = this.onMouseUp.bind(this);

  private boundTouchStart = this.onTouchStart.bind(this);

  private boundTouchMove = this.onTouchMove.bind(this);

  private boundTouchEnd = this.onTouchEnd.bind(this);


  public annihilationModeActive = signal<boolean>(false);

  private annihilationInterval: any = null;

  private infiniteBurnInterval: any = null;

  public killScreenTimer = signal<number>(10);


  constructor(private ngZone: NgZone) {
      // Remove old health-based intense BGM effect because intense BGM is now for the boss
      effect(() => {
          if (this.audioService.onWorldBgmEnded() && !this.bossSpawned() && !this.gameEnded()) {
              // Untracked to avoid infinite loops, but using setTimeout is safer in Angular
              setTimeout(() => {
                  this.spawner.spawnBoss(this.getSpawnerContext());
                  this.audioService.playIntenseBgm(this.gameState.selectedWorldIndex());
              }, 0);
          }
      });

      effect(() => {
          if (this.audioService.onIntenseBgmEnded() && this.bossSpawned() && !this.inBossDefeatSequence() && !this.isDead()) {
              setTimeout(() => {
                  if (!this.rageModeActive()) {
                      this.triggerRageMode();
                  }
              }, 0);
          }
      });
  }


  ngOnInit() {
    this.isDead.set(false);
    this.gameEnded.set(false);
    this.reviveCount = 0;
    this.adRevivesUsed = 0;
    this.runCountedForAds = false;
    this.bossSpawned.set(false);
    this.inBossDefeatSequence.set(false);
    this.gameState.isDeadMenuOpen.set(false);
    
    let hp = this.gameState.currentStats().maxHealth;
    if (this.gameState.currentGameMode() === 'ai_vs_ai') hp *= 10;
    this.maxHealth.set(hp);
    this.currentHealth.set(hp);
    this.gameState.sessionPlayTime.set(0);
    this.gameState.sessionKills.set({});
    this.gameState.heartsCollected.set(0);
    this.gameState.isRebirthing.set(false);
    this.gameState.phoenixOverridePosition.set(null);
    this.gameState.isPaused.set(false);
    this.killScreenTimer.set(10);
    this.rageModeActive.set(false);
    this.annihilationModeActive.set(false);
    this.infiniteBurnActive.set(false);
    this.entranceActive.set(false);
    // S3 gadget run state: the Feather Charm is unused and the Aegis
    // Charm's single charge is armed when it is the equipped gadget.
    this.featherUsedThisRun = false;
    this.playerInfernoUntil = 0;
    this.aegisShieldActive.set(this.gameState.currentStats().activeGadget === 'aegis_charm');
    
    this.initPhysics();
    this.startGameLoop();
    
    if (this.gameState.currentGameMode() === 'battle' || this.gameState.currentGameMode() === 'ai_vs_ai') {
        this.initBattleMode();
    }
    
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    window.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    window.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    window.addEventListener('touchend', this.boundTouchEnd);
    
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('contextmenu', this.boundContextMenu);
    document.addEventListener('visibilitychange', this.boundVisibility);

    // Fresh stamina pools for the new run (spec Section 2.5: stamina
    // is run-local).
    this.gameState.playerMovement = createMovementState();
    this.gameState.aiMovement = createMovementState();
    this.gameState.ai2Movement = createMovementState();
    this.rawBrakeHeld = false;
    this.tapChainCount = 0;
    this.tapChainLastTime = 0;

    // Test hooks for the playtest harness. Attached only when the
    // harness sets the localStorage flag before load; absent in
    // normal play, and nothing in the game reads them.
    try {
        if (window.localStorage.getItem('phoenix_debug_hooks') === '1') {
            (window as any).__phoenixS1 = {
                gameState: this.gameState,
                game: this,
                spawnEnemyProjectile: (x: number, y: number, vxPerStep: number, vyPerStep: number, damage: number = 10) => {
                    const proj = Matter.Bodies.circle(x, y, 8, {
                        label: 'projectile', isSensor: true,
                        plugin: { data: { id: 'debug_' + Math.random().toString(36).slice(2), type: 'projectile_enemy', health: 1, maxHealth: 1, owner: 'enemy', burstDamage: damage } as EnemyData }
                    });
                    Matter.Body.setVelocity(proj, { x: vxPerStep, y: vyPerStep });
                    Matter.Composite.add(this.engine.world, proj);
                    setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj); }, 2500);
                    return proj;
                },
                // S2: place a stationary training target with exact HP
                // at an exact position, built by the spawner's own
                // body factory so its shape matches a live enemy of
                // the same type (slime by default; golem gives the
                // Armored class body, radius 90 x screenScale).
                spawnPlacedTarget: (x: number, y: number, hp: number, type: string = 'slime') => {
                    const data = { id: 'placed_' + Math.random().toString(36).slice(2), type, health: hp, maxHealth: hp, lastAttackTime: Date.now() } as EnemyData;
                    const size = (SPAWN_DEFS[type]?.size ?? 20) * this.screenScale;
                    const body = this.spawner.createEnemyBody(x, y, size, type, data);
                    Matter.Body.setStatic(body, true);
                    this.enemies.push(body);
                    Matter.Composite.add(this.engine.world, body);
                    return body;
                },
                // Stage 4: spawn a live enemy of any roster type at an
                // exact position through the spawner's production
                // factory (behavior state initialized, world HP law
                // applied), so portraits and behavior probes run the
                // shipped code, not a harness imitation.
                spawnOfType: (type: string, x: number, y: number) => {
                    return this.spawner.spawnEnemyOfType(this.getSpawnerContext(), type, x, y, this.gameState.selectedWorldIndex());
                },
                // Stage 4: the production pre-placed mine pattern
                // (wave-table data path), callable for verification
                // until the Worlds 4, 8, and 10 tables land in Stage 6.
                spawnMinePattern: (cx: number, cy: number, count: number) => {
                    return this.spawner.spawnMinePattern(this.getSpawnerContext(), cx, cy, count, this.gameState.selectedWorldIndex());
                }
            };
        }
    } catch (e) { /* storage unavailable: no hooks, no harm */ }
  }




  private getBattleContext(): BattleContext {
    return {
      gameState: this.gameState,
      bossMaxHealth: this.bossMaxHealth,
      bossHealth: this.bossHealth,
      maxHealth: this.maxHealth,
      currentHealth: this.currentHealth,
      enemies: this.enemies
    };
  }

  private getSpawnerContext() {

      return {
          engine: this.engine,
          enemies: this.enemies,
          items: this.items,
          gameState: this.gameState,
          audioService: this.audioService,
          screenScale: this.screenScale,
          progressPercent: () => this.progressPercent(),
          gameEnded: () => this.gameEnded(),
          isDead: () => this.isDead(),
          bossSpawned: this.bossSpawned,
          bossMaxHealth: this.bossMaxHealth,
          bossHealth: this.bossHealth,
          clearEnemies: () => this.clearEnemies(),
          battleDropReady: this.battleDropReady,
          battleDropGrace: this.battleDropGrace,
          battleAi: this.battleAi,
          inBossDefeatSequence: () => this.inBossDefeatSequence()
      };
  }

  private startGameLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.spawner.stopSpawning();
    if (this.attackInterval) clearInterval(this.attackInterval);
    if ((this as any).aiAbilityInterval) clearInterval((this as any).aiAbilityInterval);
    
    this.timerInterval = setInterval(() => {
      if (this.gameEnded() || this.isDead() || this.gameState.isPaused()) return;
      
      this.gameState.sessionPlayTime.update(t => t + 1);
      
      if (this.gameState.currentGameMode() === 'battle' || this.gameState.currentGameMode() === 'ai_vs_ai') {
          // Hold combat economy/drops/training during the cinematic entrance.
          if (this.entranceActive()) return;
          this.battleTimer.set(this.gameState.sessionPlayTime());
          
          if (this.battleTimer() > 0 && this.battleTimer() % 10 === 0) {
              this.mlAi.trainOnMemory();
          }
          
          // Global ML weights sync was cut for v1 (audit bugs 15/34): the
          // shared model endpoint was unauthenticated. Training stays local.

          // AI Economy TICK
          this.battleAi.tick({
              gameState: this.gameState,
              bossMaxHealth: this.bossMaxHealth,
              bossHealth: this.bossHealth,
              maxHealth: this.maxHealth,
              currentHealth: this.currentHealth,
              enemies: this.enemies
          });
          
          // Drop Event TICK
          const nextDropTime = this.getNextDropTime(this.nextDropIndex);
          if (this.battleTimer() >= nextDropTime && !this.battleDropReady()) {
              this.battleDropReady.set(true);
              this.battleDropGrace.set(true);
              this.screenFlash.set(true);
              setTimeout(() => this.screenFlash.set(false), 200);
              setTimeout(() => this.battleDropGrace.set(false), 500);
              this.nextDropIndex++;
          }
          
      } else {
          this.timeRemaining.update(t => Math.max(0, Math.floor(t - 1)));
          if (this.timeRemaining() === 0 && this.bossSpawned() && !this.inBossDefeatSequence() && !this.isDead() && !this.rageModeActive()) {
              this.triggerRageMode();
          }
          if (this.timeRemaining() === 0 && !this.bossSpawned() && this.progressPercent() >= 100) {
              this.spawner.spawnBoss(this.getSpawnerContext());
          }
      }  
      
      if (this.gameState.sessionPlayTime() >= 60) this.gameState.awardTrophy("Survivor");
      
      if (this.gameState.hasCosmicTrail()) {
          this.gameState.xp.update(x => x + 5 * this.gameState.xpMultiplier());
      }
    }, 1000);

    this.spawner.scheduleNextSpawn(this.getSpawnerContext());

    const attackSpeed = this.gameState.currentStats().attackSpeed;
    this.attackInterval = setInterval(() => {
      if (this.gameEnded() || this.isDead() || this.gameState.isPaused() || this.entranceActive()) return;
      this.fireProjectile();
    }, 1000 / attackSpeed);
    
  }


  // Start the fixed-step physics driver. No-op if already running.
  private startPhysics() {
    if (this.physicsRafId !== null || !this.engine) return;
    this.physicsLastTime = performance.now();
    this.physicsAccumulator = 0;
    const tick = (now: number) => {
      this.physicsRafId = requestAnimationFrame(tick);
      let frameMs = now - this.physicsLastTime;
      this.physicsLastTime = now;
      if (frameMs > 250) frameMs = 250; // tab was hidden: do not fast-forward
      if (frameMs < 0) frameMs = 0;
      this.physicsAccumulator += frameMs;
      let steps = 0;
      while (this.physicsAccumulator >= this.PHYSICS_STEP_MS && steps < 3) {
        Matter.Engine.update(this.engine, this.PHYSICS_STEP_MS);
        this.physicsAccumulator -= this.PHYSICS_STEP_MS;
        steps++;
      }
      // Under heavy lag, drop the backlog instead of spiralling.
      if (steps === 3) this.physicsAccumulator = 0;
      this.updateFx(now);
    };
    this.physicsRafId = requestAnimationFrame(tick);
  }

  // --- Effects systems (spec Section 4): damage numbers and shake ---

  private static readonly SHAKE_ALLOWED_TRIGGERS = ['boss_death', 'ultimate_cast', 'boss_contact', 'false_rebirth', 'singularity_detonation'];

  // Fire a screen shake. The trigger list in Section 4.3 is
  // exhaustive: boss death, an ultimate cast, the player taking a
  // boss-contact hit, and the two boss-stage set pieces (Phoenix King
  // False Rebirth and Eternal Phoenix Singularity, which land with
  // the boss stages and call this same method). Amplitude caps at 6
  // reference px, duration at 250 ms, linear decay, no rotation.
  // Reduced applies at the setting and automatically while the
  // Feather Brake is held.
  public triggerShake(trigger: string) {
    if (!GameComponent.SHAKE_ALLOWED_TRIGGERS.includes(trigger)) return;
    const setting = this.gameState.screenShakeSetting();
    if (setting === 'off') return;
    let amp = 6 * this.speedScale;
    if (setting === 'reduced') amp *= 0.4;
    if (this.gameState.playerMovement.braking) amp *= 0.4;
    this.shakeAmpPx = amp;
    this.shakeDurMs = 250;
    this.shakeStartPerf = performance.now();
    const a = Math.random() * Math.PI * 2;
    this.shakeDirX = Math.cos(a);
    this.shakeDirY = Math.sin(a);
    this.shakeEvents.push({ trigger, at: Date.now() });
    if (this.shakeEvents.length > 200) this.shakeEvents.splice(0, this.shakeEvents.length - 200);
  }

  // Per-frame effects update, driven from the physics rAF: advances
  // the damage number merge window and sprite lifetimes, and the
  // shake decay.
  private updateFx(nowPerf: number) {
    this.fxNow.set(nowPerf);
    // Damage numbers: entries whose merge window (100 ms since the
    // last hit on that enemy) has closed become sprites.
    if (this.gameState.damageNumbersEnabled() && this.dmgPending.size > 0) {
      const now = Date.now();
      const sprites = [...this.damageSprites()];
      this.dmgPending.forEach((entry, key) => {
        if (now - entry.lastAdd < 100) return;
        this.dmgPending.delete(key);
        const amount = Math.max(1, Math.round(entry.total));
        // Pool cap 20: when full, the smallest pending number is
        // dropped, never the largest (spec Section 4.4).
        if (sprites.length >= 20) {
          let smallestIdx = -1;
          let smallestVal = amount;
          sprites.forEach((s, i) => { if (s.amount < smallestVal) { smallestVal = s.amount; smallestIdx = i; } });
          if (smallestIdx === -1) return; // the new number is the smallest: drop it
          sprites.splice(smallestIdx, 1);
        }
        const skin = phoenixSkinForWorld(this.gameState.selectedWorldIndex());
        const bright = skin.bright;
        const size = Math.round(Math.max(10, Math.min(18, 13 * this.speedScale)) * (entry.isBoss ? 1.3 : 1));
        sprites.push({
          id: ++this.dmgSpriteSeq, x: entry.x, y: entry.y, amount,
          born: nowPerf, size,
          color: `rgb(${Math.round(bright[0] * 255)}, ${Math.round(bright[1] * 255)}, ${Math.round(bright[2] * 255)})`
        });
      });
      this.damageSprites.set(sprites);
    } else if (this.dmgPending.size > 0) {
      this.dmgPending.clear();
    }
    // Sprite lifetimes: rise and fade over 0.6 s (positions computed
    // in the template helpers from the sprite's birth time).
    const live = this.damageSprites();
    if (live.length > 0 && nowPerf - live[0].born > 650) {
      this.damageSprites.set(live.filter(s => nowPerf - s.born <= 650));
    }
    // Shake decay.
    if (this.shakeDurMs > 0) {
      const p = (nowPerf - this.shakeStartPerf) / this.shakeDurMs;
      if (p >= 1) {
        this.shakeDurMs = 0;
        if (this.shakeTransform() !== '') this.shakeTransform.set('');
      } else {
        const mag = this.shakeAmpPx * (1 - p);
        this.shakeTransform.set(`translate(${ (this.shakeDirX * mag).toFixed(1) }px, ${ (this.shakeDirY * mag).toFixed(1) }px)`);
      }
    }
  }

  public damageSpriteTop(n: { y: number, born: number }): number {
    const age = Math.min(600, Math.max(0, this.fxNow() - n.born));
    return n.y - (age / 600) * 42 * this.speedScale;
  }

  public damageSpriteOpacity(n: { born: number }): number {
    const age = Math.min(600, Math.max(0, this.fxNow() - n.born));
    return 1 - (age / 600);
  }

  // Stamina arc background: a conic ring filled to the pool fraction
  // in the skin's mid color, shifting to the hostile color as the
  // pool drains (spec Section 2.5).
  public staminaArcBackground(): string {
    void this.fxNow();
    const frac = Math.max(0, Math.min(1, this.gameState.playerMovement.stamina / STAMINA.max));
    const skin = phoenixSkinForWorld(this.gameState.selectedWorldIndex());
    const mid = skin.mid;
    const midCss = `rgb(${Math.round(mid[0] * 255)}, ${Math.round(mid[1] * 255)}, ${Math.round(mid[2] * 255)})`;
    const color = frac > 0.35 ? midCss : 'rgb(255, 46, 107)';
    return `conic-gradient(${color} ${frac * 360}deg, rgba(255,255,255,0.12) 0deg)`;
  }

  // Record player-dealt damage for the number layer: totals merge per
  // enemy inside a 100 ms window (spec Section 4.4), which keeps Aura,
  // beams, and breath readable.
  private recordDamageNumber(enemyId: string, x: number, y: number, amount: number, isBoss: boolean) {
    if (!this.gameState.damageNumbersEnabled() || amount <= 0) return;
    // Spec Section 4.4 numbers the damage the PLAYER deals. In AI vs
    // AI there is no player at the controls, and the hits landing there
    // are the second AI's, so the layer stays silent in that mode.
    if (this.gameState.currentGameMode() === 'ai_vs_ai') return;
    const existing = this.dmgPending.get(enemyId);
    if (existing && Date.now() - existing.lastAdd < 100) {
      existing.total += amount;
      existing.x = x;
      existing.y = y;
      existing.lastAdd = Date.now();
    } else {
      this.dmgPending.set(enemyId, { total: amount, x, y, lastAdd: Date.now(), isBoss });
    }
  }

  // Stop the fixed-step physics driver (pause, death, teardown).
  private stopPhysics() {
    if (this.physicsRafId !== null) {
      cancelAnimationFrame(this.physicsRafId);
      this.physicsRafId = null;
    }
  }

  private initPhysics() {
    const Engine = Matter.Engine,
          Bodies = Matter.Bodies,
          Composite = Matter.Composite;

    this.engine = Engine.create({ gravity: { x: 0, y: 0 } });

    // No platform-specific time scaling (playtest round 1): the old code
    // set engine.timing.timeScale = 1.35 on native Android, so the
    // shipped app played about 35 percent faster than the web build at
    // identical settings. There was no design reason for the divergence
    // beyond the comment "speed up if native"; one game, one speed.

    // Invisible player hitbox (Compound Body for Bird Shape)
    const scale = this.screenScale;
    const birdCore = Bodies.rectangle(window.innerWidth / 2, window.innerHeight / 2, 10 * scale, 20 * scale, { label: 'player' });
    const birdLeftWing = Bodies.rectangle(window.innerWidth / 2 - (15 * scale), window.innerHeight / 2 - (5 * scale), 20 * scale, 8 * scale, { label: 'player' });
    const birdRightWing = Bodies.rectangle(window.innerWidth / 2 + (15 * scale), window.innerHeight / 2 - (5 * scale), 20 * scale, 8 * scale, { label: 'player' });
    
    const playerCategory = 0x0002;
    const playerCollisionFilter = { category: playerCategory, mask: 0xFFFF };
    birdCore.collisionFilter = playerCollisionFilter;
    birdLeftWing.collisionFilter = playerCollisionFilter;
    birdRightWing.collisionFilter = playerCollisionFilter;

    this.playerBody = Matter.Body.create({
      parts: [birdCore, birdLeftWing, birdRightWing],
      isSensor: false,
      label: 'player',
      collisionFilter: playerCollisionFilter
    });

    Composite.add(this.engine.world, [this.playerBody]);

    // Handle collisions
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      if (this.isDead() || this.gameEnded() || this.gameState.isPaused() || this.entranceActive()) return;

      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA.parent;
        const bodyB = pairs[i].bodyB.parent;
        
        // Player taking damage
        if (bodyA.label === 'player' || bodyB.label === 'player') {
          const otherBody = bodyA.label === 'player' ? bodyB : bodyA;
          const data = otherBody.plugin['data'] as EnemyData;
          if (!data) continue;
          if (otherBody.label === 'projectile' && data.burstDamage !== undefined && data.burstDamage <= 0) continue;

          if (otherBody.label === 'enemy' || otherBody.label === 'boss') {
            if (data.type === 'enemy_phoenix' && this.battleDropReady() && !this.battleDropGrace()) {
                 // Player bumped AI Phoenix
                 if (this.gameState.isDrilling()) {
                     this.resolveBattleDrop(true, otherBody.position.x, otherBody.position.y);
                 } else {
                     this.resolveBattleDrop(false, this.playerBody.position.x, this.playerBody.position.y);
                 }
            }

            // Stage 4: a Rift Mine the player touches detonates on
            // its proximity rule (design sheet 10) instead of dealing
            // contact damage. Shooting it clear is the safe play;
            // walking into it is the detonation.
            if (data.type === 'rift_mine') {
                this.explodeMine(otherBody);
                continue;
            }

            if (this.gameState.isDrilling()) {
                this.damageEnemy(otherBody, this.gameState.currentStats().burstDamage * 3, this.playerBody.position);
                this.triggerImpactEffect(otherBody.position.x, otherBody.position.y, false);
                continue; // Skip player taking damage while drilling
            }
            // S2 Meteor Rush: crossing an enemy during the player's
            // rush deals the rush damage to it, once per cast. The
            // named trade is exposure, so unlike Drill above the rush
            // does NOT skip the player's own contact damage: control
            // falls through to the normal takeDamage below.
            if (this.gameState.isMeteorRushing() && Date.now() <= this.meteorRushUntilMs && data.id && !this.meteorRushHitIds.has(data.id)) {
                this.meteorRushHitIds.add(data.id);
                this.damageEnemy(otherBody, this.meteorRushDamageValue, this.playerBody.position);
                this.triggerImpactEffect(otherBody.position.x, otherBody.position.y, false);
            }
            // A rushing rival deals its rush damage to the player once
            // per cast, in place of the standard phoenix contact hit
            // for this contact event.
            let rushContactDamage = 0;
            if (data.type === 'enemy_phoenix' && data.meteorRushUntil && Date.now() <= data.meteorRushUntil && data.id) {
                const hits = data.meteorRushHits || (data.meteorRushHits = []);
                const key = data.id + ':player';
                if (!hits.includes(key)) {
                    hits.push(key);
                    rushContactDamage = data.meteorRushDamage || 0;
                }
            }
            this.takeDamage(rushContactDamage > 0 ? rushContactDamage : this.contactDamageFor(data),
                data.type === 'boss' || data.type === 'enemy_phoenix' ? 'boss_contact' : undefined);
            
            // Knockback logic: an explicit velocity kick instead of a
            // force impulse, so the knockback is the same on every
            // screen size (a force impulse varies with body mass, which
            // scales with the viewport). Per-type values preserve the
            // old reference-phone feel: light enemies get launched,
            // golems barely budge. The kick is in px per 1/60 s step at
            // the reference size and decays through the steering blend.
            const force = Matter.Vector.sub(this.playerBody.position, otherBody.position);
            const normalized = Matter.Vector.normalise(force);
            if (data.type !== 'boss') {
                const kick = (data.type === 'golem' ? 1.5 : data.type === 'pod' ? 5 : data.type === 'bat' ? 50 : data.type === 'mite' ? 40 : data.type === 'slime' || data.type === 'imp' ? 30 : 20) * this.speedScale;
                const kv = Matter.Body.getVelocity(otherBody);
                Matter.Body.setVelocity(otherBody, { x: kv.x - normalized.x * kick, y: kv.y - normalized.y * kick });
            }
          } else if (otherBody.label === 'projectile' && (data.type === 'projectile_enemy' || data.type === 'projectile_player' || data.type === 'annihilation_fire' || data.type === 'fire' || data.type === 'aura' || data.type === 'dart' || data.type === 'talon' || data.type === 'spark' || data.type === 'lance')) {
            if (data.owner === 'player') continue;
            
            if (data.type === 'projectile_enemy' && this.gameState.currentGameMode() === 'battle') {
                if (this.battleDropReady() && !this.battleDropGrace()) {
                    this.resolveBattleDrop(false, this.playerBody.position.x, this.playerBody.position.y);
                }
            }
            if (data.type === 'annihilation_fire') {
                if (!this.infiniteBurnActive()) {
                    this.infiniteBurnActive.set(true);
                    this.infiniteBurnInterval = setInterval(() => {
                        if (!this.isDead() && !this.gameEnded()) {
                            this.takeDamage(this.maxHealth() / 10);
                        } else if (this.gameEnded()) {
                            clearInterval(this.infiniteBurnInterval);
                        }
                    }, 500);
                }
            } else {
                // S2: every non-annihilation projectile deals its own
                // burstDamage payload. projectile_enemy used to deal a
                // flat 10 here regardless of payload; every shipped
                // source of projectile_enemy carries exactly 10 at base
                // stats (golem shots, boss minion fire, rival basic
                // shots), so base behavior is unchanged, and upgraded
                // rival casts (burst ring, talon) now land their real
                // numbers instead of a silent 10.
                // S3: a piercing cast (Inferno Wave's shared ring)
                // hits the player once per cast, the same rule its
                // hitIds enforce against enemies; the 500 ms post-hit
                // i-frames alone cannot promise that across a ring
                // that takes seconds to cross the field.
                if (data.pierce && data.hitIds) {
                    if (!data.hitIds.includes('__player__')) {
                        data.hitIds.push('__player__');
                        this.takeDamage(data.burstDamage || 10);
                    }
                } else {
                    this.takeDamage(data.burstDamage || 10);
                }
            }
            
            if (data.type !== 'aura') {
                Matter.Composite.remove(this.engine.world, otherBody);
            }
          } else if (otherBody.label === 'item') {
            if (data.type === 'coin') {
                let val = data.value || 0;
                if (this.gameState.hasGoldenAura() && Math.random() < 0.1) val *= 5;
                const scale = 3 * Math.max(0.2, 1 - (this.progressPercent() / 100));
                const totalGained = Math.floor(val * scale * this.gameState.coinMultiplier() * 3);
                
                if (this.gameState.currentGameMode() === 'battle') {
                    this.battleCoinsCollected.update(c => c + totalGained);
                } else {
                    this.gameState.coins.update(c => c + totalGained);
                }
            }
            if (data.type === 'gem') {
                const scale = 3 * Math.max(0.2, 1 - (this.progressPercent() / 100));
                this.gameState.gems.update(g => g + ((data.value || 0) * scale));
                if (this.inBossDefeatSequence()) {
                    this.bossGemsCollected++;
                    if (this.bossGemsCollected >= this.bossGemsDropped && !this.animatingAscension()) {
                        this.triggerAscension();
                    }
                }
            }
            if (data.type === 'crate') {
                this.audioService.playSFX('heal'); 
                this.crateCollectedThisRun = true;
                // Instantly remove pending state so they can't get it again this month
                this.gameState.pendingCratesCount.set(Math.max(0, this.gameState.pendingCratesCount() - 1));
            }
            if (data.type === 'heart') {
                this.audioService.playSFX('heal');
                const scale = 3 * Math.max(0.2, 1 - (this.progressPercent() / 100));
                
                const healAmt = Math.floor((data.value || 0) * scale);
                
                this.currentHealth.update(h => Math.floor(Math.min(this.maxHealth(), h + healAmt)));
                
                this.gameState.heartsCollected.update(v => v + 1);
                if (this.gameState.heartsCollected() >= 5) this.gameState.awardTrophy("Healer");
                
                // Green flash for heart
                const el = document.createElement('div');
                const colorClass = 'bg-green-500/20';
                el.className = `fixed inset-0 ${colorClass} z-50 pointer-events-none transition-opacity duration-300`;
                document.body.appendChild(el);
                setTimeout(() => el.style.opacity = '0', 50);
                setTimeout(() => el.remove(), 350);
            }
            if (data.type === 'xp_orb') {
                this.audioService.playSFX('drop'); // Replace with specific XP sound if available
                const timeAlive = this.gameState.sessionPlayTime();
                const xpAmount = Math.max(20, Math.floor(timeAlive * 0.5)); // Balances out over time
                this.gameState.addXp(xpAmount);
            }
            if (data.type === 'coin' || data.type === 'gem') {
                this.audioService.playSFX('drop');
            }
            if (this.gameState.currentGameMode() === 'ai_vs_ai') {
                this.mlAi.addReward(1);
            }
            Matter.Composite.remove(this.engine.world, otherBody);
            this.spliceRemove(this.items, otherBody);
          }
        }

        // AI consuming items (Magnetism asymmetry fix)
        if (this.gameState.currentGameMode() === 'ai_vs_ai') {
            const aiBody = bodyA.plugin?.['data']?.type === 'enemy_phoenix' ? bodyA : (bodyB.plugin?.['data']?.type === 'enemy_phoenix' ? bodyB : null);
            const itemBody = bodyA.label === 'item' ? bodyA : (bodyB.label === 'item' ? bodyB : null);
            if (aiBody && itemBody) {
                const data = itemBody.plugin['data'] as EnemyData;
                if (data.type === 'heart') {
                    this.audioService.playSFX('heal');
                    const scale = 3 * Math.max(0.2, 1 - (this.progressPercent() / 100));
                    const healAmt = Math.floor((data.value || 0) * scale);
                    const maxHp = aiBody.plugin['data'].maxHealth || 100;
                    aiBody.plugin['data'].health = Math.min(maxHp, aiBody.plugin['data'].health + healAmt);
                    this.bossHealth.set(aiBody.plugin['data'].health);
                    
                    const el = document.createElement('div');
                    el.className = `fixed inset-0 bg-red-500/20 z-50 pointer-events-none transition-opacity duration-300`;
                    document.body.appendChild(el);
                    setTimeout(() => el.style.opacity = '0', 50);
                    setTimeout(() => el.remove(), 350);
                } else if (data.type === 'xp_orb') {
                    this.audioService.playSFX('drop');
                    this.mlAi.addReward(5);
                }
                Matter.Composite.remove(this.engine.world, itemBody);
                this.spliceRemove(this.items, itemBody);
                continue;
            }
        }
        
        // Projectile hits enemy
        if (bodyA.label === 'projectile' || bodyB.label === 'projectile') {
          const projectile = bodyA.label === 'projectile' ? bodyA : bodyB;
          const other = bodyA.label === 'projectile' ? bodyB : bodyA;
          
          if (other.label === 'enemy' || other.label === 'boss') {
            const projData = projectile.plugin['data'] as EnemyData;
            if (!projData || projData.type === 'projectile_enemy' || projData.owner === 'enemy') continue;
            if (projData.burstDamage !== undefined && projData.burstDamage <= 0) continue;

            if (projData.type === 'egg' || projData.type === 'turret') {
                projData.health -= (other.label === 'boss' ? 50 : 10);
                if (projData.type === 'egg' && other.parent) {
                    (projData as any).aggroTarget = other;
                }
                if (projData.health <= 0 && projData.type === 'turret') {
                    Matter.Composite.remove(this.engine.world, projectile);
                }
                this.triggerImpactEffect(projectile.position.x, projectile.position.y, false);
                continue;
            }

            // S2 Fire Lance piercing: a piercing projectile is not
            // consumed on hit. It records each enemy it has damaged
            // in hitIds and never damages the same enemy twice.
            if (projData.pierce) {
                const pierceTarget = other.plugin['data'] as EnemyData;
                const pierceId = pierceTarget?.id;
                if (pierceId) {
                    if (!projData.hitIds) projData.hitIds = [];
                    if (projData.hitIds.includes(pierceId)) continue;
                    projData.hitIds.push(pierceId);
                }
            } else if (projData.type !== 'aura') {
                Matter.Composite.remove(this.engine.world, projectile);
            }
            
            this.triggerImpactEffect(other.position.x, other.position.y, other.label === 'boss');
            const damage = projData.type === 'aura' ? this.gameState.currentStats().damage * 0.5 : (projData.burstDamage || this.gameState.currentStats().damage);
            
            if (other.label === 'boss' || other.label === 'enemy') {
                const otherData = other.plugin['data'] as EnemyData;
                if (otherData && otherData.type === 'enemy_phoenix' && this.gameState.currentGameMode() === 'battle') {
                    // Penalty! AI got hit by player projectile
                    const topAiHpRatio = (otherData.health || 1) / (otherData.maxHealth || 1);
                    const playerHpRatio = this.currentHealth() / this.maxHealth();
                    const state = this.buildMLState(other, this.playerBody, topAiHpRatio, playerHpRatio, 'projectile_player');
                    this.mlAi.recordExperience(state, { targetX: this.gameState.aiMousePos().x, targetY: this.gameState.aiMousePos().y, useTap: 0, useHold: 0 }, -2.0);
                    this.battleAi.registerDamageEvent();

                    if (this.battleDropReady() && !this.battleDropGrace()) {
                        this.resolveBattleDrop(true, other.position.x, other.position.y);
                    }
                }
            }
            this.damageEnemy(other, damage, projectile.position);
          } else if (other.label === 'projectile') {
              const pData = projectile.plugin['data'] as EnemyData;
              const oData = other.plugin['data'] as EnemyData;
              
              if (pData && oData && pData.owner && oData.owner && pData.owner !== oData.owner) {
                  const destructible = ['fire', 'projectile_player', 'projectile_enemy', 'dart', 'talon', 'spark', 'lance'];
                  if (destructible.includes(pData.type) && destructible.includes(oData.type)) {
                      const pDamage = pData.burstDamage || this.gameState.currentStats().damage;
                      const oDamage = oData.burstDamage || (oData.type === 'fire' ? 10 : this.gameState.currentStats().damage);
                      
                      if (pDamage > 0 && oDamage > 0) {
                          pData.burstDamage = pDamage - oDamage;
                          oData.burstDamage = oDamage - pDamage;

                          if (pData.burstDamage <= 0) {
                              Matter.Composite.remove(this.engine.world, projectile);
                              this.triggerImpactEffect(projectile.position.x, projectile.position.y, false);
                          }
                          if (oData.burstDamage <= 0) {
                              Matter.Composite.remove(this.engine.world, other);
                              this.triggerImpactEffect(other.position.x, other.position.y, false);
                          }
                      }
                  }
              }
          }
        }
      }
    });

    // Update Loop
    Matter.Events.on(this.engine, 'beforeUpdate', (event: any) => {
      // Hard pause (pause menu / tab hidden): freeze everything.
      if (this.gameState.isPaused()) return;
      const now = Date.now();
      // Fixed-step driver: event.delta is the step size in ms (always
      // 1000/60), identical on every device and refresh rate.
      const delta = Math.min(0.1, (event?.delta ?? 1000 / 60) / 1000);
      
      // Cooldowns
      if (now > this.tapAbilityEndTime) {
          this.tapCooldown.update(c => Math.max(0, c - delta));
      }
      if (now > this.holdAbilityEndTime) {
          this.holdCooldown.update(c => Math.max(0, c - delta));
      }
      if (now > this.doubleAbilityEndTime) {
          this.doubleCooldown.update(c => Math.max(0, c - delta));
      }
      if (now > this.tripleAbilityEndTime) {
          this.tripleCooldown.update(c => Math.max(0, c - delta));
      }

      // Feather Brake state (spec Section 2.4): the raw brake input
      // (second finger, Space, right mouse) drives the renderer state,
      // except while a hold charge is in progress: charge takes
      // precedence once started, and the two are mutually exclusive.
      // S3: an active Phoenix Inferno channel also forces the brake
      // (the beam is cast at Feather Brake speed, spec Section 3.3).
      this.gameState.playerMovement.braking = (this.rawBrakeHeld && this.holdTimer <= 0 && !this.isDead())
          || now < this.playerInfernoUntil;

      // 1. Sync hitbox to EXACT visual 3D position of Phoenix.
      // During the battle entrance the player body is driven by the entrance override instead,
      // so skip the mouse-slave here (freezes player movement without a hard pause).
      if (!this.isDead() && !this.entranceActive()) {
         const pxPos = this.gameState.phoenixScreenPos();
         Matter.Body.setPosition(this.playerBody, pxPos);
      }
      
      // 1.5 AI vs AI Bot Logic for Player
      if (this.gameState.currentGameMode() === 'ai_vs_ai' && !this.isDead() && !this.entranceActive()) {
          const ai2SpeedMult = this.gameState.currentStats().speed || 1;
          const mouseSpeed = 1.5 * ai2SpeedMult * this.speedScale;
          const currentMouse = this.gameState.ai2MousePos();
          
          let threatX = 0, threatY = 0;
          let minDist = Infinity;
          let threatBody: Matter.Body | null = null;
          const allBodies = Matter.Composite.allBodies(this.engine.world);
          for (let b of allBodies) {
              if (b.label === 'projectile' && b.plugin['data']?.type === 'projectile_enemy') {
                  const distToProj = Matter.Vector.magnitude(Matter.Vector.sub(this.playerBody.position, b.position));
                  if (distToProj < minDist) {
                      minDist = distToProj;
                      threatX = b.position.x;
                      threatY = b.position.y;
                      threatBody = b;
                  }
              }
          }

          // Movement verbs for the second AI (spec Sections 2 and
          // 7.2): the same stamina pool and costs as the player. It
          // brakes while its threat ray is live, dashes on a stamina
          // spend when a ray predicts a hit, and rolls only in the
          // annihilation phase.
          const ai2Move = this.gameState.ai2Movement;
          ai2Move.braking = minDist < 320 * this.speedScale;
          if (threatBody && minDist < 260 * this.speedScale) {
              const tv = Matter.Body.getVelocity(threatBody);
              const toBird = Matter.Vector.sub(this.playerBody.position, threatBody.position);
              const distT = Math.max(1, Matter.Vector.magnitude(toBird));
              const closing = (tv.x * toBird.x + tv.y * toBird.y) / distT;
              if (closing > 1) {
                  if (this.annihilationModeActive()) {
                      this.gameState.requestRoll(ai2Move);
                  } else {
                      let px = -tv.y, py = tv.x;
                      const pl = Math.hypot(px, py) || 1;
                      px /= pl; py /= pl;
                      if (px * toBird.x + py * toBird.y < 0) { px = -px; py = -py; }
                      this.gameState.requestDash(ai2Move, px, py);
                  }
              }
          }

          const enemyTarget = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
          const enemyData = enemyTarget?.plugin['data'] as EnemyData;
          const topAiHpRatio = enemyTarget ? (enemyData.health || 1) / (enemyData.maxHealth || 1) : 1;
          const playerHpRatio = this.currentHealth() / this.maxHealth();

          const state = this.buildMLState(this.playerBody, enemyTarget, playerHpRatio, topAiHpRatio, 'projectile_enemy');
          
          let mlAction = this.mlAi.predictTarget(state);
          // Deterministic tick-based reward recording (every 10 frames)
          const ai2FrameCount = ((this as any).__ai2FrameCount || 0) + 1;
          (this as any).__ai2FrameCount = ai2FrameCount;
          if (ai2FrameCount % 10 === 0) this.mlAi.recordExperience(state, mlAction, 0.5);
          
          // Apply personality-scaled noise for variety
          const ai2Noise = this.battleAi.ai2.personality?.creativity || 1.0;
          const ai2NoiseScale = 0.05 * ai2Noise;
          mlAction.targetX += (Math.random() - 0.5) * window.innerWidth * ai2NoiseScale;
          mlAction.targetY += (Math.random() - 0.5) * window.innerHeight * ai2NoiseScale;

          let targetPosition = { x: mlAction.targetX, y: mlAction.targetY };
          if (mlAction.useHold > 0.5) {
              targetPosition.x = this.playerBody.position.x;
              targetPosition.y = this.playerBody.position.y;
          }

          // Soft boundary repulsion
          const ai2Margin = 150;
          const ai2Repulsion = 200;
          if (targetPosition.x < ai2Margin) {
              const prox = (ai2Margin - targetPosition.x) / ai2Margin;
              targetPosition.x += prox * prox * ai2Repulsion;
          }
          if (targetPosition.x > window.innerWidth - ai2Margin) {
              const prox = (targetPosition.x - (window.innerWidth - ai2Margin)) / ai2Margin;
              targetPosition.x -= prox * prox * ai2Repulsion;
          }
          if (targetPosition.y < ai2Margin) {
              const prox = (ai2Margin - targetPosition.y) / ai2Margin;
              targetPosition.y += prox * prox * ai2Repulsion;
          }
          if (targetPosition.y > window.innerHeight - ai2Margin) {
              const prox = (targetPosition.y - (window.innerHeight - ai2Margin)) / ai2Margin;
              targetPosition.y -= prox * prox * ai2Repulsion;
          }

          // Multi-agent separation force
          const ai2SepRadius = 250;
          const ai2SepForce = 150;
          const ai1Body = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
          if (ai1Body) {
              const sepVec = Matter.Vector.sub(this.playerBody.position, ai1Body.position);
              const sepDist = Matter.Vector.magnitude(sepVec);
              if (sepDist < ai2SepRadius && sepDist > 0) {
                  const repulse = Matter.Vector.mult(
                      Matter.Vector.normalise(sepVec),
                      ai2SepForce * (1 - sepDist / ai2SepRadius)
                  );
                  targetPosition.x += repulse.x;
                  targetPosition.y += repulse.y;
              }
          }

          targetPosition.x = Math.max(50, Math.min(window.innerWidth - 50, targetPosition.x));
          targetPosition.y = Math.max(50, Math.min(window.innerHeight - 50, targetPosition.y));
          
          const mouseForce = Matter.Vector.sub(targetPosition, currentMouse);
          const nowTime = Date.now();
          if (this.battleAi.ai2.lastHoldTime && this.holdAbilityEndTime && nowTime < this.holdAbilityEndTime) {
              this.gameState.ai2MousePos.set({ x: targetPosition.x, y: targetPosition.y });
          } else {
              // EMA smoothing — no snap teleport
              const smoothFactor = 0.08;
              const lerpX = currentMouse.x + (targetPosition.x - currentMouse.x) * smoothFactor * delta * 60;
              const lerpY = currentMouse.y + (targetPosition.y - currentMouse.y) * smoothFactor * delta * 60;
              const maxStep = mouseSpeed * delta * 60;
              const emaDx = lerpX - currentMouse.x;
              const emaDy = lerpY - currentMouse.y;
              const emaDist = Math.sqrt(emaDx * emaDx + emaDy * emaDy);
              if (emaDist > maxStep) {
                  const emaScale = maxStep / emaDist;
                  this.gameState.ai2MousePos.set({
                      x: currentMouse.x + emaDx * emaScale,
                      y: currentMouse.y + emaDy * emaScale
                  });
              } else {
                  this.gameState.ai2MousePos.set({ x: lerpX, y: lerpY });
              }
          }

          // Use ML abilities for Bottom AI
          if (enemyTarget) {
              const now = Date.now();
              if (mlAction.useTap > 0.5) {
                  const ability = this.battleAi.ai2.abilities.find(ab => ABILITIES[ab]?.type === 'tap') || 'burst';
                  const tapFatigueMult = 1 + (this.battleAi.ai2.tapFatigue || 0);
                  if (!this.battleAi.ai2.lastTapTime || now - this.battleAi.ai2.lastTapTime > (this.battleAi.ai2.tapCooldown || 0) * 1000 * tapFatigueMult) {
                      const cd = this.triggerAbility(ability, this.playerBody, mlAction.targetX, mlAction.targetY, this.battleAi.ai2.stats, 'player');
                      this.battleAi.ai2.lastTapTime = now;
                      this.battleAi.ai2.tapCooldown = cd;
                      this.battleAi.ai2.tapFatigue = (this.battleAi.ai2.tapFatigue || 0) + 0.3;
                  }
              }
              if (mlAction.useHold > 0.5) {
                  const ability = this.battleAi.ai2.abilities.find(ab => ABILITIES[ab]?.type === 'hold') || 'aura';
                  const ai2HoldFatigueMult = 1 + (this.battleAi.ai2.holdFatigue || 0);
                  if (!this.battleAi.ai2.lastHoldTime || now - this.battleAi.ai2.lastHoldTime > (this.battleAi.ai2.holdCooldown || 0) * 1000 * ai2HoldFatigueMult) {
                      const cd = this.triggerAbility(ability, this.playerBody, mlAction.targetX, mlAction.targetY, this.battleAi.ai2.stats, 'player');
                      this.battleAi.ai2.lastHoldTime = now;
                      this.battleAi.ai2.holdCooldown = cd;
                      this.battleAi.ai2.holdFatigue = (this.battleAi.ai2.holdFatigue || 0) + 0.3;
                  }
              }
              // S2: ai2's double slot chains on its tap decision, the
              // same relationship the player's parser gives the double
              // slot (it fires as part of a tap sequence), gated by
              // the double slot's own cooldown clock and fatigue.
              {
                  const dblAbility = this.battleAi.ai2.abilities.find(ab => ABILITIES[ab]?.type === 'double');
                  if (dblAbility && mlAction.useTap > 0.5) {
                      const dblFatigueMult = 1 + (this.battleAi.ai2.doubleFatigue || 0);
                      if (!this.battleAi.ai2.lastDoubleTime || now - this.battleAi.ai2.lastDoubleTime > (this.battleAi.ai2.doubleCooldown || 0) * 1000 * dblFatigueMult) {
                          const cd = this.triggerAbility(dblAbility, this.playerBody, mlAction.targetX, mlAction.targetY, this.battleAi.ai2.stats, 'player');
                          this.battleAi.ai2.lastDoubleTime = now;
                          this.battleAi.ai2.doubleCooldown = cd;
                          this.battleAi.ai2.doubleFatigue = (this.battleAi.ai2.doubleFatigue || 0) + 0.3;
                      }
                  }
              }
          }

          // Auto-fire (Normal projectiles)
          if ((!this.holdAbilityEndTime || now >= this.holdAbilityEndTime) && now - this.lastClickTime > (1500 / (this.gameState.currentStats().attackSpeed || 1))) {
              this.lastClickTime = now;
              this.fireProjectile();
          }
      }

      // 2. Track Hold-Still for the hold ability (S3 charge redesign,
      // spec Section 3.2). Player presses and holds; a charge ring
      // fills over 1.5 s; at full charge the ability fires. The old
      // rule reset the charge on any movement past 10 px, which made
      // hold moves unusable under bot steering and twitchy on touch.
      // Now the charge has a fixed origin (where the press began):
      // drifting beyond 25 percent of the min screen dimension from
      // that origin PAUSES accumulation with progress kept, and
      // returning inside resumes it. The charge in exchange for the
      // shorter, forgiving charge is the family's higher cooldowns
      // (turret 14, aura 17, rebirth 75). The Focus Charm gadget
      // multiplies the charge time by 0.75. Releasing the press, or
      // having no ready hold move, still ends the session.
      const chargeMs = 1500 * (this.gameState.currentStats().activeGadget === 'focus_charm' ? 0.75 : 1);
      const driftLimit = 0.25 * Math.min(window.innerWidth, window.innerHeight);
      if (this.isMouseHeld && !this.isDead() && !this.gameState.isPaused() && !this.gameState.isRebirthing()) {
        const holdAbility = this.gameState.currentStats().activeHoldAbility;
        // Brake and charge are mutually exclusive (spec Section 2.4):
        // holding the brake before a charge starts blocks the charge;
        // a charge already in progress takes precedence.
        if (!holdAbility || this.holdCooldown() > 0 || (this.rawBrakeHeld && this.holdTimer <= 0)) {
            this.holdTimer = 0;
            if (this.holdChargeProgress() !== 0) this.holdChargeProgress.set(0);
        } else {
            if (this.holdTimer <= 0 && this.holdChargeProgress() === 0) {
                // New charge session: fix the origin at the press point.
                this.holdStartX = this.mouseX;
                this.holdStartY = this.mouseY;
            }
            const dist = Math.hypot(this.mouseX - this.holdStartX, this.mouseY - this.holdStartY);
            if (dist <= driftLimit) {
                this.holdTimer += delta * 1000;
            }
            // Outside the drift radius the timer simply does not
            // advance: progress is frozen, not lost.
            this.holdChargeProgress.set(Math.min(1, this.holdTimer / chargeMs));
            this.holdChargePos.set({ x: this.mouseX, y: this.mouseY });
            if (this.holdTimer >= chargeMs) {
                const cd = this.triggerAbility(holdAbility, this.playerBody, this.mouseX, this.mouseY, this.gameState.currentStats(), 'player');
                if (cd > 0) this.holdCooldown.set(cd);
                this.holdTimer = 0;
                this.holdChargeProgress.set(0);
            }
        }
      } else {
        this.holdTimer = 0;
        if (this.holdChargeProgress() !== 0) this.holdChargeProgress.set(0);
      }

      // 3. Update enemies
      this.enemies.forEach(enemy => {
        const force = Matter.Vector.sub(this.playerBody.position, enemy.position);
        const normalized = Matter.Vector.normalise(force);
        
        const data = enemy.plugin['data'] as EnemyData;
        if (!data) return;

        // Chase speed cap in logical units per second (see the steering
        // block at the end of this loop). Values descend from the old
        // force model's terminal velocities on the 412 px reference
        // phone, converted from Matter's integration (v = F/mass *
        // step^2 / frictionAir). The Oct 25, 2026 speed retune halved
        // every cap with the bird's cruise (relative geometry kept):
        // slime about 98 px/s, bat about 694 px/s, golem about 2 px/s
        // (a near-stationary ranged turret), boss about 1.4 px/s creep.
        let chaseSpeed = 0.5;
        if (data.type === 'bat') chaseSpeed = 1.685;
        if (data.type === 'slime') chaseSpeed = 0.24;
        // Stage 3 types (Section 3.3 speeds, translated through the
        // speed retune halving like every other cap): Brood Pod Slow
        // (0.4 on the sheet), Aether Wisp Swift (2.0), Mite Swift
        // (2.2). The Cinder Imp approaches at the Cruise default
        // (1.0) and its dash is a behavior hook below, not a cap.
        if (data.type === 'pod') chaseSpeed = 0.2;
        if (data.type === 'wisp') chaseSpeed = 1.0;
        if (data.type === 'mite') chaseSpeed = 1.1;
        // Stage 4 types (Section 3.3 speeds through the same halving):
        // Sentry Shard Immobile after drift-in (its hook owns the
        // velocity), Seedmother Creep (0.15 sheet), Rift Mine
        // Immobile, Shieldback Slow (0.5 sheet), Pyre Moth Swift
        // (2.4 sheet).
        if (data.type === 'sentry_shard') chaseSpeed = 0.3;
        if (data.type === 'seedmother') chaseSpeed = 0.075;
        if (data.type === 'rift_mine') chaseSpeed = 0;
        if (data.type === 'shieldback') chaseSpeed = 0.25;
        if (data.type === 'pyre_moth') chaseSpeed = 1.2;
        if (data.type === 'golem') {
            chaseSpeed = 0.005;
            // Golem Ranged Attack
            if (now - (data.lastAttackTime || 0) > 3000) {
                data.lastAttackTime = now;
                this.fireEnemyProjectile(enemy.position);
            }
        }
        if (data.type === 'boss') {
            chaseSpeed = this.rageModeActive() ? 0.0085 : 0.0035; // Much faster in rage
            
            const intensity = this.audioService.getAudioIntensity();
            
            // Audio reactive boss attacks
            // Threshold varies if rage mode is active
            const attackThreshold = this.rageModeActive() ? 0.25 : 0.35;
            
            if (!this.annihilationModeActive()) {
                if (intensity > attackThreshold && now - (data.lastAttackTime || 0) > (this.rageModeActive() ? 3000 : 6000)) {
                    data.lastAttackTime = now;
                    this.fireBossWaveAttack(enemy.position);
                }
                
                if (intensity > attackThreshold - 0.1 && now - (data.lastMinionTime || 0) > (this.rageModeActive() ? 2000 : 4000)) {
                    data.lastMinionTime = now;
                    for(let i=0; i<3; i++) {
                       this.spawner.spawnMinion(enemy.position.x, enemy.position.y, this.getSpawnerContext());
                    }
                }
            }
            
            // If the song is quiet, slowly creep. If loud, move faster
            chaseSpeed *= (1 + intensity);

            // Strict Bounds Checking for Boss (margin scales with the
            // logical unit so it is the same screen fraction everywhere)
            const bossMargin = 100 * this.speedScale;
            if (enemy.position.x < bossMargin) Matter.Body.setPosition(enemy, { x: bossMargin, y: enemy.position.y });
            if (enemy.position.x > window.innerWidth - bossMargin) Matter.Body.setPosition(enemy, { x: window.innerWidth - bossMargin, y: enemy.position.y });
            if (enemy.position.y < bossMargin) Matter.Body.setPosition(enemy, { x: enemy.position.x, y: bossMargin });
            if (enemy.position.y > window.innerHeight - bossMargin) Matter.Body.setPosition(enemy, { x: enemy.position.x, y: window.innerHeight - bossMargin });
        }
        if (data.type === 'enemy_phoenix') {
            // During the entrance the AI is flown in by the entrance RAF override; skip its
            // combat brain (no targeting, no firing, no movement forces) until intro ends.
            if (this.entranceActive()) return;
            const aiSpeedMult = this.battleAi.ai1.stats?.speed || 1;
            const mouseSpeed = 1.5 * aiSpeedMult * this.speedScale;
            const currentMouse = this.gameState.aiMousePos();
            
            let threatX = 0, threatY = 0;
            let minDist = Infinity;
            let inDanger = false;
            let threatBody: Matter.Body | null = null;
            const allBodies = Matter.Composite.allBodies(this.engine.world);
            for (let b of allBodies) {
                if (b.label === 'projectile' && b.plugin['data']?.type === 'projectile_player') {
                    const distToProj = Matter.Vector.magnitude(Matter.Vector.sub(enemy.position, b.position));
                    if (distToProj < minDist) {
                        minDist = distToProj;
                        threatX = b.position.x;
                        threatY = b.position.y;
                        threatBody = b;
                    }
                    if (distToProj < 120) {
                        inDanger = true;
                    }
                }
            }

            // Movement verbs for the rival (spec Sections 2 and 7.2):
            // the same stamina pool and verb costs as the player. It
            // brakes under its threat-ray dodge, dashes on a stamina
            // spend when a ray predicts a hit, and rolls only in the
            // annihilation phase.
            const aiMove = this.gameState.aiMovement;
            aiMove.braking = minDist < 320 * this.speedScale;
            if (threatBody && minDist < 260 * this.speedScale) {
                const tv = Matter.Body.getVelocity(threatBody);
                const toBird = Matter.Vector.sub(enemy.position, threatBody.position);
                const distT = Math.max(1, Matter.Vector.magnitude(toBird));
                const closing = (tv.x * toBird.x + tv.y * toBird.y) / distT;
                if (closing > 1) {
                    if (this.annihilationModeActive()) {
                        this.gameState.requestRoll(aiMove);
                    } else {
                        let px = -tv.y, py = tv.x;
                        const pl = Math.hypot(px, py) || 1;
                        px /= pl; py /= pl;
                        if (px * toBird.x + py * toBird.y < 0) { px = -px; py = -py; }
                        this.gameState.requestDash(aiMove, px, py);
                    }
                }
            }

            if (this.gameState.currentGameMode() === 'ai_vs_ai') {
                const eAny = enemy as any;
                if (eAny.lastDangerState && !inDanger) {
                    this.mlAi.addReward(2); // Dodged!
                }
                eAny.lastDangerState = inDanger;
            }

            const eAny = enemy as any;
            const topAiHpRatio = (data.health || 1) / (data.maxHealth || 1);
            const playerHpRatio = this.currentHealth() / this.maxHealth();

            const state = this.buildMLState(enemy, this.playerBody, topAiHpRatio, playerHpRatio, 'projectile_player');
            
            // Machine Learning Prediction!
            let mlAction = this.mlAi.predictTarget(state);

            // Deterministic tick-based reward recording (every 10 frames)
            const ai1FrameCount = ((eAny).__ai1FrameCount || 0) + 1;
            eAny.__ai1FrameCount = ai1FrameCount;
            if (ai1FrameCount % 10 === 0) this.mlAi.recordExperience(state, mlAction, 0.5);

            // Apply personality-scaled noise for variety
            const ai1Noise = this.battleAi.ai1.personality?.creativity || 1.0;
            const ai1NoiseScale = 0.05 * ai1Noise;
            mlAction.targetX += (Math.random() - 0.5) * window.innerWidth * ai1NoiseScale;
            mlAction.targetY += (Math.random() - 0.5) * window.innerHeight * ai1NoiseScale;

            let targetPosition = { x: mlAction.targetX, y: mlAction.targetY };
            if (mlAction.useHold > 0.5) {
                targetPosition.x = enemy.position.x;
                targetPosition.y = enemy.position.y;
            }
            
            // Process ML Abilities for Top AI (with fatigue)
            if (this.gameState.currentGameMode() === 'ai_vs_ai' || this.gameState.currentGameMode() === 'battle') {
                const now = Date.now();
                const tapAb = this.battleAi.ai1.abilities.find(ab => ABILITIES[ab]?.type === 'tap');
                const holdAb = this.battleAi.ai1.abilities.find(ab => ABILITIES[ab]?.type === 'hold');
                
                const tapFatigueMult = 1 + (this.battleAi.ai1.tapFatigue || 0);
                if (mlAction.useTap > 0.5 && tapAb && (!eAny.lastTapAbilityTime || now >= eAny.lastTapAbilityTime + (eAny.tapCooldown || 0) * tapFatigueMult)) {
                    const cd = this.triggerAbility(tapAb, enemy, mlAction.targetX, mlAction.targetY, this.battleAi.ai1.stats, 'enemy');
                    eAny.lastTapAbilityTime = now;
                    eAny.tapCooldown = cd;
                    this.battleAi.ai1.tapFatigue += 0.3;
                }
                
                const holdFatigueMult = 1 + (this.battleAi.ai1.holdFatigue || 0);
                if (mlAction.useHold > 0.5 && holdAb && (!eAny.lastHoldAbilityTime || now >= eAny.lastHoldAbilityTime + (eAny.holdCooldown || 0) * holdFatigueMult)) {
                    const cd = this.triggerAbility(holdAb, enemy, mlAction.targetX, mlAction.targetY, this.battleAi.ai1.stats, 'enemy');
                    eAny.lastHoldAbilityTime = now;
                    eAny.holdCooldown = cd;
                    this.battleAi.ai1.holdFatigue += 0.3;
                }

                // S2: the rival's double slot chains on its tap
                // decision (the parser relationship), tracked on the
                // body exactly like its tap slot, through the same
                // triggerAbility path and the same constants.
                const dblAb = this.battleAi.ai1.abilities.find(ab => ABILITIES[ab]?.type === 'double');
                const dblFatigueMult = 1 + (this.battleAi.ai1.doubleFatigue || 0);
                if (mlAction.useTap > 0.5 && dblAb && (!eAny.lastDoubleAbilityTime || now >= eAny.lastDoubleAbilityTime + (eAny.doubleCooldown || 0) * dblFatigueMult)) {
                    const cd = this.triggerAbility(dblAb, enemy, mlAction.targetX, mlAction.targetY, this.battleAi.ai1.stats, 'enemy');
                    eAny.lastDoubleAbilityTime = now;
                    eAny.doubleCooldown = cd;
                    this.battleAi.ai1.doubleFatigue += 0.3;
                }
            }

            // Soft boundary repulsion
            const ai1Margin = 150;
            const ai1Repulsion = 200;
            if (targetPosition.x < ai1Margin) {
                const prox = (ai1Margin - targetPosition.x) / ai1Margin;
                targetPosition.x += prox * prox * ai1Repulsion;
            }
            if (targetPosition.x > window.innerWidth - ai1Margin) {
                const prox = (targetPosition.x - (window.innerWidth - ai1Margin)) / ai1Margin;
                targetPosition.x -= prox * prox * ai1Repulsion;
            }
            if (targetPosition.y < ai1Margin) {
                const prox = (ai1Margin - targetPosition.y) / ai1Margin;
                targetPosition.y += prox * prox * ai1Repulsion;
            }
            if (targetPosition.y > window.innerHeight - ai1Margin) {
                const prox = (targetPosition.y - (window.innerHeight - ai1Margin)) / ai1Margin;
                targetPosition.y -= prox * prox * ai1Repulsion;
            }

            // Multi-agent separation force (AI vs AI)
            if (this.gameState.currentGameMode() === 'ai_vs_ai') {
                const separationRadius = 250;
                const separationForce = 150;
                const sepVec = Matter.Vector.sub(enemy.position, this.playerBody.position);
                const sepDist = Matter.Vector.magnitude(sepVec);
                if (sepDist < separationRadius && sepDist > 0) {
                    const repulse = Matter.Vector.mult(
                        Matter.Vector.normalise(sepVec),
                        separationForce * (1 - sepDist / separationRadius)
                    );
                    targetPosition.x += repulse.x;
                    targetPosition.y += repulse.y;
                }
            }

            // Hard clamp safety net
            targetPosition.x = Math.max(50, Math.min(window.innerWidth - 50, targetPosition.x));
            targetPosition.y = Math.max(50, Math.min(window.innerHeight - 50, targetPosition.y));
            
            const now = Date.now();

            // Cache player position with ~150ms reaction delay (human-like)
            if (!(eAny.__stalePlayerPosUpdateTime) || now - eAny.__stalePlayerPosUpdateTime > 150) {
                eAny.__stalePlayerPos = { x: this.playerBody.position.x, y: this.playerBody.position.y };
                eAny.__stalePlayerPosUpdateTime = now;
            }

            if (eAny.holdAbilityEndTime && now < eAny.holdAbilityEndTime) {
                // Do not move aiMousePos while holding ability
            } else {
                // EMA smoothing — no snap teleport
                const smoothFactor = 0.08;
                const lerpX = currentMouse.x + (targetPosition.x - currentMouse.x) * smoothFactor * delta * 60;
                const lerpY = currentMouse.y + (targetPosition.y - currentMouse.y) * smoothFactor * delta * 60;
                const maxStep = mouseSpeed * delta * 60;
                const emaDx = lerpX - currentMouse.x;
                const emaDy = lerpY - currentMouse.y;
                const emaDist = Math.sqrt(emaDx * emaDx + emaDy * emaDy);
                if (emaDist > maxStep) {
                    const emaScale = maxStep / emaDist;
                    this.gameState.aiMousePos.set({
                        x: currentMouse.x + emaDx * emaScale,
                        y: currentMouse.y + emaDy * emaScale
                    });
                } else {
                    this.gameState.aiMousePos.set({ x: lerpX, y: lerpY });
                }
            }

            // Tension-modulated fire rate
            const tension = this.battleAi.calculateTension(
                this.currentHealth() / this.maxHealth(),
                (data.health || 1) / (data.maxHealth || 1)
            );
            const fireDelay = (1500 / (this.battleAi.ai1.stats?.attackSpeed || 1)) * (1 + tension * 0.5);
            if ((!eAny.holdAbilityEndTime || now >= eAny.holdAbilityEndTime) && now - this.battleAi.ai1.lastTapTime > fireDelay) {
                this.battleAi.ai1.lastTapTime = now;
                this.fireEnemyProjectile(enemy.position);
            }
            
            // Sync hitbox to EXACT visual 3D position of AI Phoenix
            Matter.Body.setPosition(enemy, this.gameState.aiPhoenixScreenPos());
            Matter.Body.setVelocity(enemy, { x: 0, y: 0 });
            return; // Skip normal force-based movement
        }
        
        // Velocity steering (playtest round 1, speed consistency): the
        // enemy blends toward a capped chase velocity defined in logical
        // units per second. The old model applied a fixed Matter force,
        // whose terminal velocity is inversely proportional to body
        // mass; enemy masses scale with screen size (about 6x slower on
        // a wide screen than on a phone) and with the Runner's delta
        // clamping it also ran about 2x slower at 120 Hz. Steering makes
        // the approach speed a direct, testable number on every screen.
        // The blend rate gives a spin-up time constant of about 0.4 s,
        // matching the old force model's acceleration feel.
        const maxSpeedPx = chaseSpeed * this.logicalUnit; // px per second
        // Gloomwing weave (visual spec Section 3.3; the one behavior
        // change Stage 2 allows): the bat's desired direction swings on
        // a sine across the chase line. The combined direction is
        // renormalized before the same cap is applied, so the weave
        // trades straight-line progress for path curvature and never
        // adds speed: the total stays at the bat cap, 1.685 LU/s.
        let dirX = normalized.x;
        let dirY = normalized.y;
        if (data.type === 'bat') {
          let hash = 0;
          const idStr = data.id || '';
          for (let ci = 0; ci < idStr.length; ci++) hash = (hash * 31 + idStr.charCodeAt(ci)) | 0;
          const phase = (now / 1000) * 7.4 + (Math.abs(hash) % 628) / 100;
          const s = Math.sin(phase);
          const wx = normalized.x + (-normalized.y) * s * 0.6;
          const wy = normalized.y + normalized.x * s * 0.6;
          const len = Math.hypot(wx, wy) || 1;
          dirX = wx / len;
          dirY = wy / len;
          data.weaveValue = s;
        }
        // Stage 3 behavior hooks (visual spec Sections 3.2 and 3.3):
        // a hook replaces the desired velocity (and, for the Imp's
        // dash, the blend rate) inside the same steering model. Every
        // speed below is a Section 3.3 sheet value translated through
        // the retune halving, in LU per second like the caps above.
        let desiredX = dirX * maxSpeedPx;
        let desiredY = dirY * maxSpeedPx;
        let blendK = 2.5;
        if (data.type === 'imp') {
          // Cinder Imp (Charger): approach at Cruise to mid range,
          // flare telegraph 0.5 s, dash in a locked straight line at
          // Dart speed through the player's position at lock time,
          // then 0.8 s of tired drift at Slow before it can charge
          // again. The dash direction locks at the telegraph's end,
          // so the dodge is to move off the line during the flare.
          const LU = this.logicalUnit;
          const distP = Math.hypot(force.x, force.y);
          const state = data.behaviorState || 'approach';
          if (state === 'approach') {
            if (distP <= 0.42 * LU) {
              data.behaviorState = 'telegraph';
              data.telegraphStart = now;
              data.stateUntil = now + 500;
            }
          } else if (state === 'telegraph') {
            desiredX = normalized.x * 0.1 * LU;
            desiredY = normalized.y * 0.1 * LU;
            blendK = 4;
            if (now >= (data.stateUntil || 0)) {
              data.behaviorState = 'dash';
              data.dashDirX = normalized.x;
              data.dashDirY = normalized.y;
              data.stateUntil = now + 450;
            }
          } else if (state === 'dash') {
            desiredX = (data.dashDirX || 0) * 1.7 * LU; // Dart (3.4 sheet), halved
            desiredY = (data.dashDirY || 0) * 1.7 * LU;
            blendK = 14;
            if (now >= (data.stateUntil || 0)) {
              data.behaviorState = 'tired';
              data.stateUntil = now + 800;
            }
          } else { // tired
            desiredX = normalized.x * 0.24 * LU; // Slow drift, flame dimmed
            desiredY = normalized.y * 0.24 * LU;
            if (now >= (data.stateUntil || 0)) data.behaviorState = 'approach';
          }
        } else if (data.type === 'wisp') {
          // Aether Wisp (Orbiter): close to a ring at 25 percent of
          // the min dimension around the player, circle for 2 to 3 s,
          // then dart in a locked straight line through the player's
          // position and back out to the ring. All motion at its
          // Swift cap (2.0 sheet, halved to 1.0).
          const LU = this.logicalUnit;
          const capPx = 1.0 * LU;
          const ringR = 0.25 * LU;
          const rx = -normalized.x; // unit vector, player to wisp
          const ry = -normalized.y;
          const distP = Math.hypot(force.x, force.y);
          const state = data.behaviorState || 'close';
          const steerToRing = (): number => {
            const tx = this.playerBody.position.x + rx * ringR;
            const ty = this.playerBody.position.y + ry * ringR;
            const dx = tx - enemy.position.x;
            const dy = ty - enemy.position.y;
            const d = Math.hypot(dx, dy) || 1;
            desiredX = (dx / d) * capPx;
            desiredY = (dy / d) * capPx;
            return d;
          };
          if (state === 'close' || state === 'return') {
            if (steerToRing() < 0.05 * LU) {
              data.behaviorState = 'orbit';
              data.stateUntil = now + 2000 + Math.random() * 1000;
            }
          } else if (state === 'orbit') {
            const sense = data.orbitDir || 1;
            const err = distP - ringR;
            const corr = Math.max(-0.6, Math.min(0.6, err / (0.1 * LU))) * capPx;
            desiredX = (-ry * sense) * capPx + rx * corr;
            desiredY = (rx * sense) * capPx + ry * corr;
            const mag = Math.hypot(desiredX, desiredY);
            if (mag > capPx) { desiredX = desiredX / mag * capPx; desiredY = desiredY / mag * capPx; }
            if (now >= (data.stateUntil || 0)) {
              data.behaviorState = 'dart';
              data.dashDirX = normalized.x;
              data.dashDirY = normalized.y;
              data.stateUntil = now + 1000;
            }
          } else { // dart
            desiredX = (data.dashDirX || 0) * capPx;
            desiredY = (data.dashDirY || 0) * capPx;
            blendK = 6;
            const relX = enemy.position.x - this.playerBody.position.x;
            const relY = enemy.position.y - this.playerBody.position.y;
            const passed = relX * (data.dashDirX || 0) + relY * (data.dashDirY || 0) > 0;
            if (passed || now >= (data.stateUntil || 0)) data.behaviorState = 'return';
          }
        } else if (data.type === 'mite') {
          // Mite (Swarmer): erratic short-hop chase. The aim re-rolls
          // every 0.4 s with a wide jitter, so a pack shimmers rather
          // than converging on one line. Speed Swift (2.2 sheet,
          // halved to 1.1).
          const capPx = 1.1 * this.logicalUnit;
          if (!data.nextAimAt || now >= data.nextAimAt) {
            data.nextAimAt = now + 400;
            const jitter = (Math.random() - 0.5) * 1.5;
            const cos = Math.cos(jitter), sin = Math.sin(jitter);
            data.aimDirX = normalized.x * cos - normalized.y * sin;
            data.aimDirY = normalized.x * sin + normalized.y * cos;
          }
          desiredX = (data.aimDirX ?? normalized.x) * capPx;
          desiredY = (data.aimDirY ?? normalized.y) * capPx;
        } else if (data.type === 'sentry_shard') {
          // Sentry Shard (Shooter): drifts in from the edge toward
          // the field, anchors once inside the margins, then runs a
          // 2.5 s fire cycle: a 0.4 s core-glow charge (the published
          // attackCharge telegraph) and one aimed projectile slightly
          // faster than the Golem's (9 vs 7.5 per step). Its facing
          // tracks the player for the renderer's rotation.
          const LU = this.logicalUnit;
          data.aimDirX = normalized.x;
          data.aimDirY = normalized.y;
          const margin = 0.08 * LU;
          const inside = enemy.position.x > margin && enemy.position.x < window.innerWidth - margin
            && enemy.position.y > margin && enemy.position.y < window.innerHeight - margin;
          if ((data.behaviorState || 'drift') === 'drift') {
            desiredX = normalized.x * 0.3 * LU;
            desiredY = normalized.y * 0.3 * LU;
            if (inside) data.behaviorState = 'anchored';
          } else {
            desiredX = 0;
            desiredY = 0;
            if (now - (data.lastAttackTime || 0) > 2500) {
              data.lastAttackTime = now;
              this.fireEnemyProjectile(enemy.position, this.scaledSpeed(9));
            }
          }
        } else if (data.type === 'seedmother') {
          // Seedmother (Anchor): crosses the field on a slow diagonal
          // at Creep speed, laying a Rift Mine every 4 s up to her
          // cap of 4 live mines (design sheet 9). Near an edge she
          // re-aims at the center with jitter, so the crossing never
          // ends. The mines she lays carry her id; the cap counts
          // only her own field.
          const LU = this.logicalUnit;
          const edge = 0.12 * LU;
          if (enemy.position.x < edge || enemy.position.x > window.innerWidth - edge
            || enemy.position.y < edge || enemy.position.y > window.innerHeight - edge) {
            const cx = window.innerWidth / 2 - enemy.position.x;
            const cy = window.innerHeight / 2 - enemy.position.y;
            const len = Math.hypot(cx, cy) || 1;
            const jitter = (Math.random() - 0.5) * 0.8;
            const cos = Math.cos(jitter), sin = Math.sin(jitter);
            data.aimDirX = (cx / len) * cos - (cy / len) * sin;
            data.aimDirY = (cx / len) * sin + (cy / len) * cos;
          }
          desiredX = (data.aimDirX ?? normalized.x) * 0.075 * LU;
          desiredY = (data.aimDirY ?? normalized.y) * 0.075 * LU;
          if (now - (data.lastAttackTime || 0) >= 4000) {
            const liveMines = this.enemies.filter(e => {
              const d = e.plugin['data'] as EnemyData;
              return d && d.type === 'rift_mine' && d.motherId === data.id;
            }).length;
            if (liveMines < 4) {
              data.lastAttackTime = now;
              const mine = this.spawner.spawnEnemyOfType(this.getSpawnerContext(), 'rift_mine',
                enemy.position.x, enemy.position.y, this.gameState.selectedWorldIndex());
              if (mine) (mine.plugin['data'] as EnemyData).motherId = data.id;
            }
          }
        } else if (data.type === 'rift_mine') {
          // Rift Mine (Hazard): immobile. Inside its trigger radius
          // (about 12 percent of the min dimension, design sheet 10)
          // it detonates into a 4-projectile cross. The published
          // attackCharge is 1 inside the radius, which doubles the
          // renderer's core blink: the telegraph.
          desiredX = 0;
          desiredY = 0;
          const distP = Math.hypot(force.x, force.y);
          if (distP < 0.12 * this.logicalUnit) this.explodeMine(enemy);
        } else if (data.type === 'shieldback') {
          // Shieldback (Bulwark): a slow advance on the player. Its
          // shield face always turns toward the player (the facing
          // the damage rule and the renderer both read): the hook
          // stores the unit vector to the player on the body data.
          data.aimDirX = normalized.x;
          data.aimDirY = normalized.y;
          desiredX = normalized.x * 0.25 * this.logicalUnit;
          desiredY = normalized.y * 0.25 * this.logicalUnit;
        } else if (data.type === 'pyre_moth') {
          // Pyre Moth (Burster): chases at Swift; inside detonation
          // range (16 percent of the min dimension) it starts a
          // 0.6 s fuse, strobing (published attackCharge), creeping
          // at Slow, and at the end of the fuse it detonates itself
          // through the normal death path, which spawns the
          // 8-projectile ring (design sheet 12).
          const LU = this.logicalUnit;
          const distP = Math.hypot(force.x, force.y);
          if ((data.behaviorState || 'chase') === 'chase') {
            desiredX = normalized.x * 1.2 * LU;
            desiredY = normalized.y * 1.2 * LU;
            if (distP < 0.16 * LU) {
              data.behaviorState = 'fusing';
              data.telegraphStart = now;
              data.stateUntil = now + 600;
            }
          } else {
            desiredX = normalized.x * 0.24 * LU;
            desiredY = normalized.y * 0.24 * LU;
            if (now >= (data.stateUntil || 0)) {
              data.health = 0;
              this.damageEnemy(enemy, 0, enemy.position);
            }
          }
        }
        const vel = Matter.Body.getVelocity(enemy); // px per 1/60 s step
        const curX = vel.x * 60;
        const curY = vel.y * 60;
        const blend = 1 - Math.exp(-blendK * delta);
        const newX = curX + (desiredX - curX) * blend;
        const newY = curY + (desiredY - curY) * blend;
        Matter.Body.setVelocity(enemy, { x: newX / 60, y: newY / 60 });
      });

      // 4. Magnetism for items
      const magnetRadius = 150 * this.speedScale * this.gameState.currentStats().magnetism;
      this.items.forEach(item => {
         const data = item.plugin['data'];
         const isBossGem = this.inBossDefeatSequence() && data && data.type === 'gem';
         
         if (isBossGem && now - this.bossDefeatTimestamp > 1500) {
            // Boss Defeat Homing Phase: Boss gems forcefully float to phoenix after 1.5s
            const force = Matter.Vector.sub(this.playerBody.position, item.position);
            const normalized = Matter.Vector.normalise(force);
            // Cancel existing gravity/velocity and pull strongly
            Matter.Body.setVelocity(item, { x: 0, y: 0 });
            Matter.Body.applyForce(item, item.position, Matter.Vector.mult(normalized, 0.05));
         } else if (data) {
             // Normal Magnetism
             const isXpOrb = data.type === 'xp_orb';
             let targetPos = this.playerBody.position;

             if (this.gameState.currentGameMode() === 'ai_vs_ai') {
                 const enemyPhoenix = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
                 if (enemyPhoenix) {
                     const distToPlayer = Matter.Vector.magnitude(Matter.Vector.sub(this.playerBody.position, item.position));
                     const distToEnemy = Matter.Vector.magnitude(Matter.Vector.sub(enemyPhoenix.position, item.position));
                     if (distToEnemy < distToPlayer) targetPos = enemyPhoenix.position;
                 }
             }

             // Glide (spec Section 2.6): while the collecting bird is
             // gliding, its magnetism is x1.25.
             const glideFactor = (targetPos === this.playerBody.position && this.gameState.playerMovement.gliding) ? 1.25 : 1;
             const activeRadius = (isXpOrb ? 300 : 150) * this.speedScale * this.gameState.currentStats().magnetism * glideFactor;

             const force = Matter.Vector.sub(targetPos, item.position);
             const dist = Matter.Vector.magnitude(force);
             if (dist < activeRadius) {
                const normalized = Matter.Vector.normalise(force);
                const pullStrength = (isXpOrb ? 0.004 : 0.002) * (1 - dist / activeRadius);
                Matter.Body.applyForce(item, item.position, Matter.Vector.mult(normalized, pullStrength));
             } else {
                 // Fall down via gravity
                 Matter.Body.applyForce(item, item.position, { x: 0, y: isXpOrb ? 0.00008 : 0.00015 });
             }
         }
      });

      // 4.5 Homing Missiles
      const homingLvl = this.gameState.currentStats().homingLevel;
      if (homingLvl > 0 && this.enemies.length > 0) {
          Matter.Composite.allBodies(this.engine.world).forEach(body => {
              if (body.label === 'projectile') {
                  const data = body.plugin['data'] as EnemyData;
                  if (data && data.type === 'projectile_player') {
                      let nearest = this.enemies[0];
                      let minDist = Infinity;
                      this.enemies.forEach(e => {
                          const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, body.position));
                          if (dist < minDist) { minDist = dist; nearest = e; }
                      });
                      if (minDist < 600 * this.speedScale) {
                          const force = Matter.Vector.sub(nearest.position, body.position);
                          const normalized = Matter.Vector.normalise(force);
                          // Capped linear scaling for stable physics
                          const pullStrength = 0.0000075 + (0.00000375 * Math.min(homingLvl, 50));
                          Matter.Body.applyForce(body, body.position, Matter.Vector.mult(normalized, pullStrength));
                      }
                  } else if (data && data.type === 'annihilation_fire') {
                      // Homing onto player
                      const force = Matter.Vector.sub(this.playerBody.position, body.position);
                      const normalized = Matter.Vector.normalise(force);
                      Matter.Body.applyForce(body, body.position, Matter.Vector.mult(normalized, 0.00005));
                  }
              }
          });
      }

      // 4.55 Spark Storm homing (S2): each spark steers toward the
      // target it was assigned at cast time (round robin over the
      // live targets, so the swarm spreads across the field instead
      // of piling onto one enemy). Steering rotates the velocity
      // vector by at most 0.15 rad per step and preserves speed, so
      // a spark curves smoothly and a moving target can still shake
      // it. A spark whose target died retargets to the nearest live
      // enemy; an enemy-cast spark seeks the player bird.
      Matter.Composite.allBodies(this.engine.world).forEach(body => {
          if (body.label !== 'projectile') return;
          const data = body.plugin['data'] as EnemyData;
          if (!data || data.type !== 'spark' || !data.targetId) return;
          let targetPos: { x: number, y: number } | null = null;
          if (data.targetId === '__player__') {
              targetPos = this.playerBody.position;
          } else {
              const t = this.enemies.find(e => (e.plugin['data'] as EnemyData)?.id === data.targetId);
              if (t) {
                  targetPos = t.position;
              } else {
                  let best: Matter.Body | null = null;
                  let bestDist = Infinity;
                  for (const e of this.enemies) {
                      const d = Matter.Vector.magnitude(Matter.Vector.sub(e.position, body.position));
                      if (d < bestDist) { bestDist = d; best = e; }
                  }
                  if (best) {
                      const found: Matter.Body = best;
                      data.targetId = (found.plugin['data'] as EnemyData).id;
                      targetPos = found.position;
                  }
              }
          }
          if (!targetPos) return;
          const vel = Matter.Body.getVelocity(body);
          const speed = Math.hypot(vel.x, vel.y);
          if (speed <= 0) return;
          const cur = Math.atan2(vel.y, vel.x);
          const want = Math.atan2(targetPos.y - body.position.y, targetPos.x - body.position.x);
          let diff = want - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = Math.max(-0.15, Math.min(0.15, diff));
          const na = cur + turn;
          Matter.Body.setVelocity(body, { x: Math.cos(na) * speed, y: Math.sin(na) * speed });
      });

      // 4.6 Cleanup off-screen items (in place, never reassigned: the
      // spawner context holds this.items by reference)
      for (let i = this.items.length - 1; i >= 0; i--) {
          const item = this.items[i];
          if (item.position.y > window.innerHeight + 200) {
              // Audit bug 7 (ascension soft-lock): a boss gem that falls past
              // the bottom must still count as collected, or the collected
              // counter never reaches the dropped counter and the ascension
              // never fires. Credit it exactly like a pickup.
              const data = item.plugin['data'] as any;
              if (this.inBossDefeatSequence() && data && data.type === 'gem') {
                  const scale = 3 * Math.max(0.2, 1 - (this.progressPercent() / 100));
                  this.gameState.gems.update(g => g + ((data.value || 0) * scale));
                  this.bossGemsCollected++;
                  if (this.bossGemsCollected >= this.bossGemsDropped && !this.animatingAscension()) {
                      this.triggerAscension();
                  }
              }
              if (item.parent) Matter.Composite.remove(this.engine.world, item);
              this.items.splice(i, 1);
          }
      }

      // 5. Publish bodies to ParticleBg rendering service
      const entities: PhysicsEntity[] = [];
      const renderBodies = [...Matter.Composite.allBodies(this.engine.world)];
      renderBodies.forEach(body => {
         if (body.label !== 'player') {
             const data = body.plugin['data'] as any;
             if (data) {
                 entities.push({
                     id: data.id,
                     x: body.position.x,
                     y: body.position.y,
                     type: data.type,
                     size: body.circleRadius || 20,
                     ownerId: data.ownerId,
                     // Renderer feedback data (visual spec Section 3.1):
                     // health drives the shared hit flash, the golem's
                     // charge (its own 3 s shot timer, normalized) drives
                     // the telegraphed rock orbit, and the bat's weave
                     // value banks its mesh. Display only; no gameplay
                     // code reads these back.
                     health: data.health,
                     maxHealth: data.maxHealth,
                     attackCharge: data.type === 'golem' ? Math.min(1, Math.max(0, (now - (data.lastAttackTime || 0)) / 3000)) : data.type === 'imp' ? this.impTelegraphCharge(data, now) : data.type === 'sentry_shard' ? this.shardCharge(data, now) : data.type === 'rift_mine' ? this.mineArmedCharge(body) : data.type === 'pyre_moth' ? this.mothFuseCharge(data, now) : undefined,
                     weave: data.type === 'bat' ? data.weaveValue : undefined,
                     state: (data.type === 'imp' || data.type === 'wisp' || data.type === 'sentry_shard' || data.type === 'seedmother' || data.type === 'rift_mine' || data.type === 'shieldback' || data.type === 'pyre_moth') ? data.behaviorState : undefined,
                     facing: (data.type === 'shieldback' || data.type === 'sentry_shard') && data.aimDirX !== undefined ? Math.atan2(data.aimDirY || 0, data.aimDirX || 0) : undefined,
                     sparkUntil: data.type === 'shieldback' ? data.sparkUntil : undefined
                 });
             }
         }
      });
      // Deduplicate by ID
const uniqueEntities = Array.from(new Map(entities.map(e => [e.id, e])).values());
      this.gameState.activeEntities.set(uniqueEntities);
    });

    this.startPhysics();
  }


  private initBattleMode() {
      if (this.gameState.currentGameMode() === 'ai_vs_ai') {
          this.gameState.ai1Wins.set(0);
          this.gameState.ai2Wins.set(0);
      }
      this.battleAi.reset();
      
      this.setupAiPhoenix(false);
      if (this.gameState.currentGameMode() === 'ai_vs_ai') {
          this.setupAi2Phoenix(false);
      }
      
      
      this.nextDropIndex = 0;
      this.battleDropReady.set(false);
      this.battleDropGrace.set(false);
      
      const maxHp = this.battleAi.ai1.stats.maxHealth;
      this.bossMaxHealth.set(maxHp);
      this.bossHealth.set(maxHp);
      
      this.battleStartCoins = this.gameState.coins();
      this.battleStartXp = this.gameState.xp();
      this.battleCoinsCollected.set(0);
      
      this.resetCooldowns();
      
      // Entrance is LIVE (not a hard pause): physics keeps running, but AI logic/attacks are
      // disabled and the player can't move or take damage until the intro finishes.
      this.entranceActive.set(true);
      this.gameState.isPaused.set(false);

      // Spawn AI Phoenix off-screen top
      const scale = this.screenScale;
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
      
      Matter.Composite.add(this.engine.world, enemyPhoenix);
      this.enemies.push(enemyPhoenix);
      
      // Cinematic Entrance for AI.
      // Spread spawn positions further apart (AI top third, player bottom third) so the two
      // Phoenixes don't overlap on short viewports and trigger separation-force jitter.
      const aiStartY = -200;
      const aiEndY = Math.max(120, window.innerHeight * 0.22);
      const playerEndY = Math.min(window.innerHeight - 120, window.innerHeight * 0.78);
      
      const duration = 1500;
      const startTime = Date.now();
      
      const animateEntrance = () => {
          if (this.isDead() || this.gameEnded()) return;
          const now = Date.now();
          const progress = Math.min((now - startTime) / duration, 1);
          
          // Easing: easeOutQuad
          const easeProgress = progress * (2 - progress);
          
          const currentAiY = aiStartY + (aiEndY - aiStartY) * easeProgress;
          
          // Override AI physics position and lock mouse to top
          this.gameState.aiPhoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentAiY });
          this.gameState.aiMousePos.set({ x: window.innerWidth / 2, y: 50 });
          Matter.Body.setPosition(enemyPhoenix, { x: window.innerWidth / 2, y: currentAiY });
          Matter.Body.setVelocity(enemyPhoenix, { x: 0, y: 0 }); 
          
          // Animate Player from bottom to their start pos
          if (this.playerBody) {
              const playerStartY = window.innerHeight + 200;
              const currentPlayerY = playerStartY + (playerEndY - playerStartY) * easeProgress;
              this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentPlayerY });
              Matter.Body.setPosition(this.playerBody, { x: window.innerWidth / 2, y: currentPlayerY });
              Matter.Body.setVelocity(this.playerBody, { x: 0, y: 0 });
          }
          
          if (progress < 1) {
              requestAnimationFrame(animateEntrance);
          } else {
              this.gameState.aiPhoenixOverridePosition.set(null);
        if ((this as any).aiEntranceAnimId) cancelAnimationFrame((this as any).aiEntranceAnimId);
              this.gameState.phoenixOverridePosition.set(null);
              // Sync the AI's post-entrance steering target to where it actually landed so it
              // doesn't snap up to y=50 the instant the override clears.
              this.gameState.aiMousePos.set({ x: window.innerWidth / 2, y: aiEndY });
              this.gameState.aiPhoenixScreenPos.set({ x: window.innerWidth / 2, y: aiEndY });
              this.triggerImpactEffect(window.innerWidth / 2, currentAiY, true); // AI flash effect on landing
              if (this.playerBody) {
                  this.triggerImpactEffect(window.innerWidth / 2, playerEndY, false);
              }
              // 1 second standoff, then hand control + AI back on (no unpause needed).
              setTimeout(() => {
                  if (!this.gameEnded() && !this.isDead()) {
                      this.entranceActive.set(false);
                      this.lastClickTime = Date.now();
                  }
              }, 1000);
          }
      };
      
      requestAnimationFrame(animateEntrance);
  }


  private setupAiPhoenix(isRespawn: boolean) {
      const playerStats = this.gameState.currentStats();
      this.battleAi.ai1.stats = JSON.parse(JSON.stringify(playerStats));
      this.battleAi.ai1.stats.maxHealth *= 10; // Scale base health x10 for Battle Mode boss pool
      
      const worldId = this.gameState.selectedWorldIndex();
      const realmAbilities = REALM_ABILITIES[worldId] || ['burst', 'aura'];
      
      const tapAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'tap' && k !== 'rebirth');
      const holdAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'hold' && k !== 'rebirth');
      // S2 (spec Section 7.2): the rival learns each family in the
      // stage it ships, so it now also draws a double move.
      const doubleAbilities = realmAbilities.filter(k => ABILITIES[k]?.type === 'double' && k !== 'rebirth');

      let tap = tapAbilities.length > 0 ? tapAbilities[Math.floor(Math.random() * tapAbilities.length)] : 'burst';
      let hold = holdAbilities.length > 0 ? holdAbilities[Math.floor(Math.random() * holdAbilities.length)] : 'aura';
      let dbl = doubleAbilities.length > 0 ? doubleAbilities[Math.floor(Math.random() * doubleAbilities.length)] : null;

      this.battleAi.ai1.abilities = dbl ? [tap, hold, dbl] : [tap, hold];

      const playerTapLevel = playerStats.activeTapAbility ? (playerStats.unlockedAbilities[playerStats.activeTapAbility]?.level || 1) : 1;
      const playerHoldLevel = playerStats.activeHoldAbility ? (playerStats.unlockedAbilities[playerStats.activeHoldAbility]?.level || 1) : 1;
      // The AI loadout rule (Section 7.2): AI ability levels are the
      // average of the player's EQUIPPED levels. The double slot joins
      // the average when the player has one equipped.
      const playerDoubleLevel = playerStats.activeDoubleAbility ? (playerStats.unlockedAbilities[playerStats.activeDoubleAbility]?.level || 1) : null;
      const equippedLevels = [playerTapLevel, playerHoldLevel, ...(playerDoubleLevel !== null ? [playerDoubleLevel] : [])];
      const avgPlayerLevel = Math.max(1, Math.floor(equippedLevels.reduce((a, b) => a + b, 0) / equippedLevels.length));
      
      this.battleAi.ai1.abilities.forEach(id => {
          this.battleAi.ai1.stats.unlockedAbilities[id] = { level: avgPlayerLevel, modifiers: {} };
          this.battleAi.ai1.stats.unlockedAbilities[id].modifiers = this.gameState.generateAbilityUpgrade(id, avgPlayerLevel, {});
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
          this.battleAi.spendTokens(this.battleAi.ai1.upgradeTokensBox, this.battleAi.ai1.abilityTokensBox, 'ai1', this.getBattleContext());
          this.battleAi.ai1.upgradesWeights = {}; // reset weights after init
      } else {
          // On respawn, spend accumulated tokens from boxes
          this.battleAi.spendTokens(this.battleAi.ai1.upgradeTokensBox, this.battleAi.ai1.abilityTokensBox, 'ai1', this.getBattleContext());
          // (Weights are preserved across respawns)
      }
      this.gameState.aiPhoenixSpeed.set(this.battleAi.ai1.stats.speed);
  }


  private setupAi2Phoenix(isRespawn: boolean) {
      const playerStats = this.gameState.currentStats();
      this.battleAi.ai2.stats = JSON.parse(JSON.stringify(playerStats));
      this.battleAi.ai2.stats.maxHealth *= 10; // AI2 gets x10 health as well
      
      let tap = playerStats.activeTapAbility || 'burst';
      let hold = playerStats.activeHoldAbility || 'aura';
      // S2: ai2 mirrors the player's double slot too (null when the
      // player has none equipped, exactly like its tap/hold mirror).
      let dbl = playerStats.activeDoubleAbility || null;

      this.battleAi.ai2.abilities = dbl ? [tap, hold, dbl] : [tap, hold];

      const playerTapLevel = playerStats.activeTapAbility ? (playerStats.unlockedAbilities[playerStats.activeTapAbility]?.level || 1) : 1;
      const playerHoldLevel = playerStats.activeHoldAbility ? (playerStats.unlockedAbilities[playerStats.activeHoldAbility]?.level || 1) : 1;
      const playerDoubleLevel = playerStats.activeDoubleAbility ? (playerStats.unlockedAbilities[playerStats.activeDoubleAbility]?.level || 1) : null;
      const equippedLevels = [playerTapLevel, playerHoldLevel, ...(playerDoubleLevel !== null ? [playerDoubleLevel] : [])];
      const avgPlayerLevel = Math.max(1, Math.floor(equippedLevels.reduce((a, b) => a + b, 0) / equippedLevels.length));
      
      this.battleAi.ai2.abilities.forEach(id => {
          this.battleAi.ai2.stats.unlockedAbilities[id] = { level: avgPlayerLevel, modifiers: {} };
          this.battleAi.ai2.stats.unlockedAbilities[id].modifiers = this.gameState.generateAbilityUpgrade(id, avgPlayerLevel, {});
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
          
          this.battleAi.spendTokens(this.battleAi.ai2.upgradeTokensBox, this.battleAi.ai2.abilityTokensBox, 'ai2', this.getBattleContext());
          this.battleAi.ai2.upgradesWeights = {}; 
      }
  }


  private resetCooldowns() {
      this.battleAi.ai1.lastTapTime = 0;
      this.battleAi.ai1.lastHoldTime = 0;
      this.battleAi.ai1.lastDoubleTime = 0;
      this.battleAi.ai2.lastTapTime = 0;
      this.battleAi.ai2.lastHoldTime = 0;
      this.battleAi.ai2.lastDoubleTime = 0;
      this.lastClickTime = 0;
      this.holdAbilityEndTime = 0;
      this.doubleAbilityEndTime = 0;
      this.tripleAbilityEndTime = 0;
      this.tapCooldown.set(0);
      this.holdCooldown.set(0);
      this.doubleCooldown.set(0);
      this.tripleCooldown.set(0);
      this.battleAi.ai2.tapCooldown = 0;
      this.battleAi.ai2.holdCooldown = 0;
      this.battleAi.ai2.doubleCooldown = 0;
  }


  private getNextDropTime(index: number): number {
      if (index < 5) return (index + 1) * 60; // 1m, 2m, 3m, 4m, 5m
      if (index < 8) return 300 + (index - 4) * 90; // 6:30, 8:00, 9:30
      return 570 + (index - 7) * 120; // 11:30, 13:30, ...
  }


  getTapIcon() { return ABILITIES[this.gameState.currentStats().activeTapAbility || 'burst']?.icon || '💥'; }

  getHoldIcon() { return ABILITIES[this.gameState.currentStats().activeHoldAbility || 'aura']?.icon || '🌀'; }

  getDoubleIcon() { const id = this.gameState.currentStats().activeDoubleAbility; return (id && ABILITIES[id]?.icon) || '⚡'; }

  getTripleIcon() { const id = this.gameState.currentStats().activeTripleAbility; return (id && ABILITIES[id]?.icon) || '✨'; }

  private slotMaxCooldown(id: string | null): number {
      if (!id) return 1;
      const abilityData = this.gameState.worldUpgrades()[this.gameState.selectedWorldIndex()]?.unlockedAbilities[id];
      const mod = abilityData?.modifiers?.['cooldown'] || 1.0;
      return (ABILITIES[id]?.baseCooldown || 1) * mod;
  }

  getDoubleMaxCooldown() { return this.slotMaxCooldown(this.gameState.currentStats().activeDoubleAbility); }

  getTripleMaxCooldown() { return this.slotMaxCooldown(this.gameState.currentStats().activeTripleAbility); }


  getTapMaxCooldown() {
      const id = this.gameState.currentStats().activeTapAbility || 'burst';
      const abilityData = this.gameState.worldUpgrades()[this.gameState.selectedWorldIndex()]?.unlockedAbilities[id];
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
      return this.slotMaxCooldown(this.gameState.currentStats().activeHoldAbility || 'aura');
  }


  private buildMLState(actor: Matter.Body, target: Matter.Body | undefined, hpRatio: number, targetHpRatio: number, threatType: string): any {
      const projectiles = Matter.Composite.allBodies(this.engine.world).filter(b => b.label === 'projectile' && b.plugin['data']?.type === threatType);
      
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

      const allBodies = Matter.Composite.allBodies(this.engine.world);
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


  private executeKillScreen() {
      const boss = this.enemies.find(e => e.plugin['data']?.type === 'boss');
      if (!boss) return;
      
      this.annihilationModeActive.set(true);
      
      // Clear all enemies except boss
      this.enemies.forEach(e => {
          if (e.plugin['data']?.type !== 'boss') {
              Matter.Composite.remove(this.engine.world, e);
          }
      });
      this.spliceOut(this.enemies, e => e === boss);
      
      // Clear existing projectiles
      const currentBodies = Matter.Composite.allBodies(this.engine.world);
      currentBodies.forEach(b => {
          if (b.label === 'projectile') {
              Matter.Composite.remove(this.engine.world, b);
          }
      });

      // Start Annihilation Barrage (every 200ms)
      if (this.annihilationInterval) clearInterval(this.annihilationInterval);
      this.annihilationInterval = setInterval(() => {
          if (this.isDead() || this.gameEnded() || this.inBossDefeatSequence()) {
              clearInterval(this.annihilationInterval);
              return;
          }
          
          const dir = Matter.Vector.normalise(Matter.Vector.sub(this.playerBody.position, boss.position));
          const angle = Math.atan2(dir.y, dir.x);
          const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
          const proj = Matter.Bodies.circle(boss.position.x, boss.position.y, 20, {
              label: 'projectile', isSensor: true,
              plugin: { data: { id: Math.random().toString(), type: 'annihilation_fire', health: 1, maxHealth: 1 } as EnemyData }
          });
          Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, this.scaledSpeed(7.5)));
          Matter.Composite.add(this.engine.world, proj);
          
      }, 200);
  }






  private calculateBossGemDrop(realmIndex: number): number {
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



  private fireBossWaveAttack(pos: Matter.Vector) {
      this.audioService.playSFX('shoot');
      for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const dir = { x: Math.cos(angle), y: Math.sin(angle) };
          const proj = Matter.Bodies.circle(pos.x, pos.y, 15, {
              label: 'projectile', isSensor: true,
              plugin: { data: { id: Math.random().toString(), type: 'projectile_enemy', health: 1, maxHealth: 1, owner: 'enemy', burstDamage: 10 } as EnemyData }
          });
          Matter.Body.setVelocity(proj, Matter.Vector.mult(dir, this.scaledSpeed(4)));
          Matter.Composite.add(this.engine.world, proj);

          setTimeout(() => {
              if (proj.parent) {
                  Matter.Body.setVelocity(proj, { x: 0, y: 0 }); // Pause
                  setTimeout(() => {
                      if (proj.parent) {
                          const boss = this.enemies.find(e => e.plugin['data']?.type === 'boss');
                          if (boss) {
                              const returnDir = Matter.Vector.normalise(Matter.Vector.sub(boss.position, proj.position));
                              Matter.Body.setVelocity(proj, Matter.Vector.mult(returnDir, this.scaledSpeed(6)));
                              setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj); }, 2000);
                          } else {
                              Matter.Composite.remove(this.engine.world, proj);
                          }
                      }
                  }, 500);
              }
          }, 1500);
      }
  }


  public resolveBattleDrop(playerWon: boolean, px: number, py: number) {
      this.battleDropReady.set(false);
      this.battleDropGrace.set(false);
      
      if (playerWon) {
          this.spawner.triggerBattleDrop(px, py, false, this.getSpawnerContext());
      } else {
          // AI Won -> Steal
          const aiEnemy = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
          if (aiEnemy) {
              const data = aiEnemy.plugin['data'] as EnemyData;
              // AI heals 15-25% max health
              const healPercent = 0.15 + (Math.random() * 0.10);
              data.health = Math.min(data.maxHealth, data.health + (data.maxHealth * healPercent));
              this.bossHealth.set(data.health);
              
              // 50% chance to steal coins
              if (Math.random() < 0.5) {
                 const playerCoins = this.gameState.coins();
                 const stealAmount = Math.floor(playerCoins * 0.10); // steal 10%
                 if (stealAmount > 0) {
                     this.gameState.coins.set(playerCoins - stealAmount);
                     this.battleAi.ai1.coins += stealAmount;
                 }
              }
              
              this.triggerImpactEffect(px, py, false); // Small red burst maybe
          }
          this.battleAi.coinGainRate += 1; // Increase income anyway
      }
  }


  // Contact damage per type (visual spec Section 3.3): the shipped
  // pattern is 10 standard and 50 boss; the Stage 3 sheets name two
  // exceptions, the Mite at 5 and the Cinder Imp at 15 while, and
  // only while, it is in its dash state.
  private contactDamageFor(data: EnemyData): number {
    if (data.type === 'boss' || data.type === 'enemy_phoenix') return 50;
    if (data.type === 'mite') return 5;
    if (data.type === 'imp' && data.behaviorState === 'dash') return 15;
    return 10;
  }

  // The Imp's published telegraph charge: 0 to 1 across the 0.5 s
  // flare, held at 1 through the dash, 0 otherwise. The renderer
  // swells the body and whitens the core off this value.
  private impTelegraphCharge(data: EnemyData, now: number): number {
    if (data.behaviorState === 'telegraph') {
      return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 500));
    }
    if (data.behaviorState === 'dash') return 1;
    return 0;
  }

  // The Sentry Shard's published charge: 0 to 1 across the 0.4 s
  // core-glow window at the end of its 2.5 s fire cycle, driven by
  // the same lastAttackTime the hook fires from.
  private shardCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'anchored') return 0;
    return Math.min(1, Math.max(0, (now - (data.lastAttackTime || 0) - 2100) / 400));
  }

  // The Rift Mine's published armed flag: 1 while the player is
  // inside the trigger radius (the renderer doubles the core blink),
  // 0 otherwise. The detonation itself runs in the steering hook.
  private mineArmedCharge(body: Matter.Body): number {
    const d = Math.hypot(this.playerBody.position.x - body.position.x, this.playerBody.position.y - body.position.y);
    return d < 0.12 * this.logicalUnit ? 1 : 0;
  }

  // The Pyre Moth's published fuse charge: 0 to 1 across its 0.6 s
  // fuse, 0 while chasing. The renderer strobes off this value.
  private mothFuseCharge(data: EnemyData, now: number): number {
    if (data.behaviorState !== 'fusing') return 0;
    return Math.min(1, Math.max(0, (now - (data.telegraphStart || now)) / 600));
  }

  // Rift Mine detonation (design sheet 10): a 4-projectile cross at
  // standard enemy projectile speed and payload. Runs on proximity
  // (steering hook or player contact), never on a shot-clear death:
  // damageEnemy removes a shot mine silently by design.
  private explodeMine(mine: Matter.Body) {
    const data = mine.plugin['data'] as EnemyData;
    if (!data || data.type !== 'rift_mine') return;
    Matter.Composite.remove(this.engine.world, mine);
    this.spliceRemove(this.enemies, mine);
    this.triggerImpactEffect(mine.position.x, mine.position.y, false);
    this.audioService.playSFX('explosion');
    for (let k = 0; k < 4; k++) {
      const angle = k * Math.PI / 2;
      const proj = Matter.Bodies.circle(mine.position.x, mine.position.y, 8, {
        label: 'projectile', isSensor: true,
        plugin: { data: { id: Math.random().toString(), type: 'projectile_enemy', health: 1, maxHealth: 1, owner: 'enemy', burstDamage: 10 } as EnemyData }
      });
      Matter.Body.setVelocity(proj, { x: Math.cos(angle) * this.scaledSpeed(7.5), y: Math.sin(angle) * this.scaledSpeed(7.5) });
      Matter.Composite.add(this.engine.world, proj);
      setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj); }, 1200);
    }
  }

  private damageEnemy(enemy: Matter.Body, damage: number, sourcePos?: { x: number, y: number }) {
    const data = enemy.plugin['data'] as EnemyData;
    if (data.immortalUntil && Date.now() < data.immortalUntil) return;
    // Shieldback frontal reduction (design sheet 11, the one new
    // combat rule in the overhaul): the shield face always turns
    // toward the player, and a hit whose source sits in the front
    // arc (the half facing the player) lands at 25 percent damage
    // with a spark-off flash on the rim. Hits from behind land full.
    // sourcePos is the damaging body's position (a projectile, the
    // player for contact abilities, the egg for the turret blast);
    // it defaults to the player. The reduction applies before the
    // damage number is recorded, so the number shows the real hit.
    if (data.type === 'shieldback' && damage > 0) {
      const src = sourcePos || this.playerBody.position;
      const fx = this.playerBody.position.x - enemy.position.x;
      const fy = this.playerBody.position.y - enemy.position.y;
      const fl = Math.hypot(fx, fy) || 1;
      const sx = src.x - enemy.position.x;
      const sy = src.y - enemy.position.y;
      const sl = Math.hypot(sx, sy) || 1;
      if ((sx / sl) * (fx / fl) + (sy / sl) * (fy / fl) >= 0) {
        damage *= 0.25;
        data.sparkUntil = Date.now() + 180;
      }
    }
    data.health -= damage;
    // Damage numbers record player-dealt damage only; every path into
    // this method is a player-side source (spec Section 4.4).
    this.recordDamageNumber(data.id, enemy.position.x, enemy.position.y, damage, data.type === 'boss');

    if (data.type === 'boss') {
       this.bossHealth.set(Math.max(0, data.health));
    } else if (data.type === 'enemy_phoenix') {
       this.bossHealth.set(Math.max(0, data.health));
    }
    
    if (data.health <= 0) {
      this.audioService.playSFX('explosion');
      
      if (data.type === 'enemy_phoenix') {
          // AI Phoenix Death Logic
          if (this.gameState.currentGameMode() === 'ai_vs_ai') {
              this.audioService.playSFX('explosion');
              this.triggerImpactEffect(enemy.position.x, enemy.position.y, true);
              this.gameState.ai2Wins.update(w => w + 1);
              this.mlAi.addReward(-5); // the one who died is top ai (enemy) — balanced penalty
              data.health = data.maxHealth;
              this.bossHealth.set(data.maxHealth);
              data.immortalUntil = Date.now() + 2000;
              
              // Visual Ash effect for in-place rebirth
              const ashInterval = setInterval(() => {
                  const ash = document.createElement('div');
                  ash.style.position = 'fixed';
                  ash.style.left = `${enemy.position.x + (Math.random()-0.5)*30}px`;
                  ash.style.top = `${enemy.position.y + (Math.random()-0.5)*30}px`;
                  ash.style.width = '4px';
                  ash.style.height = '4px';
                  ash.style.backgroundColor = '#9ca3af';
                  ash.style.borderRadius = '50%';
                  ash.style.pointerEvents = 'none';
                  ash.style.zIndex = '50';
                  document.body.appendChild(ash);
                  setTimeout(() => ash.remove(), 1000);
              }, 100);
              setTimeout(() => clearInterval(ashInterval), 2000);
              
              return;
          }

          if (this.battleAi.ai1.abilities.includes('rebirth')) {
              // Revive via rebirth
              data.health = this.battleAi.ai1.stats.maxHealth;
              data.maxHealth = this.battleAi.ai1.stats.maxHealth;
              this.bossHealth.set(data.maxHealth);
              data.immortalUntil = Date.now() + 2000;
              this.triggerImpactEffect(enemy.position.x, enemy.position.y, true); // big shockwave
              
              // Remove rebirth so it can't be used again this life
              this.battleAi.ai1.abilities = this.battleAi.ai1.abilities.filter(a => a !== 'rebirth');
              return;
          } else {
              // Auto drop and respawn
              this.spawner.triggerBattleDrop(enemy.position.x, enemy.position.y, true, this.getSpawnerContext());
              this.setupAiPhoenix(true); // Rerolls stats and abilities
              data.health = this.battleAi.ai1.stats.maxHealth;
              data.maxHealth = this.battleAi.ai1.stats.maxHealth;
              this.bossHealth.set(data.maxHealth);
              this.triggerImpactEffect(enemy.position.x, enemy.position.y, true); // rebirth effect
              // Visual teleport
              this.gameState.aiPhoenixOverridePosition.set({ x: window.innerWidth / 2, y: -200 });
              Matter.Body.setPosition(enemy, { x: window.innerWidth / 2, y: -200 }); // reset off-screen
              Matter.Body.setVelocity(enemy, { x: 0, y: 0 });
              
              const duration = 1500;
              const startTime = Date.now();
              const aiStartY = -200;
              const aiEndY = window.innerHeight / 2 - 150;
              const animateEntrance = () => {
                  if (this.isDead() || this.gameEnded()) return;
                  const now = Date.now();
                  const progress = Math.min((now - startTime) / duration, 1);
                  const easeProgress = progress * (2 - progress);
                  const currentAiY = aiStartY + (aiEndY - aiStartY) * easeProgress;
                  this.gameState.aiPhoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentAiY });
                  this.gameState.aiMousePos.set({ x: window.innerWidth / 2, y: 50 });
                  Matter.Body.setPosition(enemy, { x: window.innerWidth / 2, y: currentAiY });
                  Matter.Body.setVelocity(enemy, { x: 0, y: 0 }); 
                  
                  if (progress < 1) (this as any).aiEntranceAnimId = requestAnimationFrame(animateEntrance);
                  else {
                      this.gameState.aiPhoenixOverridePosition.set(null);
                      // Sync steering target to landing spot so the AI doesn't snap to y=50.
                      this.gameState.aiMousePos.set({ x: window.innerWidth / 2, y: aiEndY });
                      this.gameState.aiPhoenixScreenPos.set({ x: window.innerWidth / 2, y: aiEndY });
                  }
              };
              requestAnimationFrame(animateEntrance);
              return;
          }
      }
      
      Matter.Composite.remove(this.engine.world, enemy);
      this.spliceRemove(this.enemies, enemy);

      // Brood Pod split (visual spec Section 3.3, sheet 6): on death
      // the Pod bursts into 3 to 5 Mites with outward velocity, in
      // place (never reassigning the enemies array; the spawner
      // pushes into it). Killing a Pod at range is the safe play;
      // the split is the lesson it teaches.
      if (data.type === 'pod') {
          const podCtx = this.getSpawnerContext();
          const podWorld = this.gameState.selectedWorldIndex();
          const brood = 3 + Math.floor(Math.random() * 3);
          for (let i = 0; i < brood; i++) {
              this.spawner.spawnEnemyOfType(podCtx, 'mite',
                  enemy.position.x + (Math.random() - 0.5) * 30 * this.speedScale,
                  enemy.position.y + (Math.random() - 0.5) * 30 * this.speedScale,
                  podWorld, true);
          }
      }

      // Pyre Moth detonation (design sheet 12): dead or fused, it
      // bursts into an 8-projectile ring at standard enemy speed
      // and payload. Shooting it down does not prevent the ring;
      // distance is the counterplay.
      if (data.type === 'pyre_moth') {
          for (let k = 0; k < 8; k++) {
              const angle = k * Math.PI / 4;
              const proj = Matter.Bodies.circle(enemy.position.x, enemy.position.y, 8, {
                  label: 'projectile', isSensor: true,
                  plugin: { data: { id: Math.random().toString(), type: 'projectile_enemy', health: 1, maxHealth: 1, owner: 'enemy', burstDamage: 10 } as EnemyData }
              });
              Matter.Body.setVelocity(proj, { x: Math.cos(angle) * this.scaledSpeed(7.5), y: Math.sin(angle) * this.scaledSpeed(7.5) });
              Matter.Composite.add(this.engine.world, proj);
              setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj); }, 1200);
          }
      }

      if (this.gameState.currentGameMode() === 'ai_vs_ai') {
          this.mlAi.addReward(2);
      }

      // Award XP
      let xp = 0;
      if (data.type === 'slime') xp = 2;
      if (data.type === 'bat') xp = 5;
      if (data.type === 'golem') xp = 20;
      if (data.type === 'imp') xp = 5;
      if (data.type === 'wisp') xp = 5;
      if (data.type === 'pod') xp = 15;
      if (data.type === 'mite') xp = 1;
      if (data.type === 'sentry_shard') xp = 15;
      if (data.type === 'seedmother') xp = 20;
      if (data.type === 'rift_mine') xp = 5;
      if (data.type === 'shieldback') xp = 20;
      if (data.type === 'pyre_moth') xp = 5;
      if (data.type === 'boss') xp = 500;
      this.gameState.addXp(xp);

      // Bestiary Unlock
      if (!this.gameState.unlockedEnemies().includes(data.type) && ['slime', 'bat', 'golem', 'imp', 'wisp', 'pod', 'mite', 'sentry_shard', 'seedmother', 'rift_mine', 'shieldback', 'pyre_moth', 'boss'].includes(data.type)) {
          this.gameState.unlockedEnemies.update(arr => [...arr, data.type]);
      }
      
      // Track Kills & Trophies
      this.gameState.awardTrophy("First Blood");
      const currentKills = this.gameState.sessionKills();
      const killCount = (currentKills[data.type] || 0) + 1;
      this.gameState.sessionKills.set({ ...currentKills, [data.type]: killCount });
      
      if (data.type === 'slime' && killCount >= 50) this.gameState.awardTrophy("Slime Slayer");
      if (data.type === 'bat' && killCount >= 25) this.gameState.awardTrophy("Bat Hunter");
      if (data.type === 'golem' && killCount >= 5) this.gameState.awardTrophy("Golem Breaker");
      
      if (data.type === 'boss') {
        this.gameState.awardTrophy("Realm Conqueror");
        // Boss death is an allowed shake trigger (spec Section 4.3).
        this.triggerShake('boss_death');

        // Setup Cinematic Defeat Sequence
        this.inBossDefeatSequence.set(true);
        this.bossDefeatTimestamp = Date.now();
        this.bossGemsCollected = 0;
        
        // Base gems based on realm index (Only drop on first defeat!)
        const currentWorldIndex = this.gameState.selectedWorldIndex();
        const isFirstDefeat = !this.gameState.unlockedWorlds().includes(currentWorldIndex + 1);
        const intendedGems = isFirstDefeat ? this.calculateBossGemDrop(currentWorldIndex) : 0;
        
        const scaleAtEnd = Math.max(0.2, 1 - (this.progressPercent() / 100));
        
        // Cap physical gem bodies at 100 to prevent physics lag on mobile
        this.bossGemsDropped = isFirstDefeat ? Math.min(100, Math.floor(intendedGems / scaleAtEnd)) : 0;
        
        if (this.bossGemsDropped > 0) {
            const valPerGem = intendedGems / (this.bossGemsDropped * scaleAtEnd);
            for(let i=0; i<this.bossGemsDropped; i++) {
                setTimeout(() => {
                    this.spawner.dropItem(enemy.position.x + (Math.random()-0.5)*150, enemy.position.y + (Math.random()-0.5)*150, 'gem', valPerGem, this.getSpawnerContext());
                    this.audioService.playSFX('drop');
                }, i * 30);
            }
        } else {
            // If no gems dropped, automatically ascend after a delay to let the coins bounce
            setTimeout(() => {
                if (!this.animatingAscension()) this.triggerAscension();
            }, 1500);
        }

        // Safety net (audit bug 7): whatever happens to the physical gem
        // bodies, the defeat sequence must always resolve into ascension.
        setTimeout(() => {
            if (this.inBossDefeatSequence() && !this.animatingAscension()) {
                this.triggerAscension();
            }
        }, 10000);
        
        // Coins explosion (Huge visual blast, value scales to intended)
        const intendedCoins = 1000;
        const physicalCoins = Math.min(150, Math.floor(intendedCoins / scaleAtEnd));
        const valPerCoin = intendedCoins / (physicalCoins * scaleAtEnd);
        for(let i=0; i<physicalCoins; i++) {
           setTimeout(() => {
               this.spawner.dropItem(enemy.position.x + (Math.random()-0.5)*200, enemy.position.y + (Math.random()-0.5)*200, 'coin', valPerCoin, this.getSpawnerContext());
               this.audioService.playSFX('drop');
           }, i * 15); // Stagger drop and sound for a nice "brrrrr" effect
        }
        
        this.triggerMassiveExplosion(enemy.position.x, enemy.position.y);
        
        // Remove the boss completely so it doesn't trigger damage or blocks anymore
        Matter.Composite.remove(this.engine.world, enemy);
        this.spliceRemove(this.enemies, enemy);
        
        // Stop the normal timers so enemies stop spawning
        clearInterval(this.timerInterval);
        this.spawner.stopSpawning();
        clearInterval(this.attackInterval);
        
        // We do NOT call winGame() instantly here anymore!
      } else {
        if (data.type === 'golem') {
            for (let i = 0; i < 5; i++) {
                this.spawner.dropItem(enemy.position.x + (Math.random()-0.5)*20, enemy.position.y + (Math.random()-0.5)*20, 'coin', 10, this.getSpawnerContext());
            }
        } else if (data.type !== 'rift_mine') {
            if (Math.random() < 0.6) { // 60% chance to drop coins
                const amount = Math.floor(Math.random() * 3) + 1; // 1 to 3 coins visually
                for (let i = 0; i < amount; i++) {
                    this.spawner.dropItem(enemy.position.x + (Math.random()-0.5)*15, enemy.position.y + (Math.random()-0.5)*15, 'coin', 5, this.getSpawnerContext());
                }
            }
        }
        // A shot-cleared Rift Mine drops nothing: the clear is the
        // reward (design sheet 10's shot-clear rule).
        if (data.type !== 'rift_mine' && Math.random() < 0.1) { // 10% chance for a heart
            this.spawner.dropItem(enemy.position.x, enemy.position.y + 20, 'heart', 20, this.getSpawnerContext()); // Heals 20
        }
        if (data.type !== 'rift_mine' && !this.crateDroppedThisRun && this.gameState.pendingCratesCount() > 0 && Math.random() < 0.01) {
            this.crateDroppedThisRun = true;
            this.spawner.dropItem(enemy.position.x, enemy.position.y, 'crate', 1, this.getSpawnerContext());
        }
      }
    } else {
      // Hit sound removed permanently
    }
  }



  private takeDamage(amount: number, source?: 'boss_contact') {
    if (this.isDead() || this.gameEnded() || this.gameState.isRebirthing() || this.gameState.isPaused() || this.entranceActive()) return;
    if (Date.now() < this.gameState.immortalUntil) return;

    // Movement i-frames (spec Sections 2.2 and 2.3): a dash or roll
    // in progress cannot be hit, and the dodge does not consume the
    // Celestial Shield or any other defense.
    if (this.gameState.movementIframesActive(this.gameState.playerMovement)) return;

    if (this.gameState.hasCelestialShield() && this.celestialShieldActive()) {
        this.celestialShieldActive.set(false);
        // Hit sound removed permanently
        setTimeout(() => this.celestialShieldActive.set(true), 30000);
        return;
    }

    // Aegis Charm gadget (spec Section 5.3): a one-hit shield armed
    // at run start, consumed by the first hit it negates, with no
    // recharge. Checked after the Celestial Shield, which makes the
    // charm redundant by design when that gem is owned.
    if (this.aegisShieldActive()) {
        this.aegisShieldActive.set(false);
        return;
    }
    
    if (this.gameState.isDrilling()) {
        amount *= 0.1;
    }

    // Taking a hit ends Glide (spec Section 2.6).
    this.gameState.endGlide(this.gameState.playerMovement);

    // Boss-contact hits are one of the four allowed shake triggers
    // (spec Section 4.3).
    if (source === 'boss_contact') this.triggerShake('boss_contact');

    // Hit sound removed permanently
    this.gameState.immortalUntil = Date.now() + 500; // 0.5s i-frames
    this.currentHealth.update(h => Math.max(0, h - amount));
    this.damageFlash.set(true);
    setTimeout(() => this.damageFlash.set(false), 200);

    if (this.currentHealth() <= 0) {
      const activeHold = this.gameState.currentStats().activeHoldAbility;
      if (activeHold === 'rebirth' && this.holdCooldown() === 0 && !this.annihilationModeActive()) {
         this.holdCooldown.set(this.getHoldMaxCooldown());
         this.gameState.isRebirthing.set(true);
         // Hit sound removed permanently
         
         // 3 second Ash visual effect loop
         const ashInterval = setInterval(() => {
             if (!this.gameState.isRebirthing()) {
                 clearInterval(ashInterval);
                 return;
             }
             const ash = document.createElement('div');
             ash.style.position = 'fixed';
             ash.style.left = `${this.playerBody.position.x + (Math.random()-0.5)*30}px`;
             ash.style.top = `${this.playerBody.position.y + (Math.random()-0.5)*30}px`;
             ash.style.width = '4px';
             ash.style.height = '4px';
             ash.style.backgroundColor = '#9ca3af';
             ash.style.borderRadius = '50%';
             ash.style.pointerEvents = 'none';
             ash.style.zIndex = '50';
             document.body.appendChild(ash);
             anime({
                 targets: ash,
                 translateY: -50,
                 opacity: [1, 0],
                 duration: 1000,
                 easing: 'linear',
                 complete: () => ash.remove()
             });
         }, 100);
         
         // 3 second Ash state
         setTimeout(() => {
             clearInterval(ashInterval);
             this.gameState.isRebirthing.set(false);
             this.gameState.immortalUntil = Date.now() + 5000;
             this.gameState.speedBoostUntil = Date.now() + 2500;
             this.currentHealth.set(Math.floor(this.maxHealth() / 2)); 
             
             // Massive explosion
             const radius = 500;
             const explosion = Matter.Bodies.circle(this.playerBody.position.x, this.playerBody.position.y, radius, {
                 isSensor: true, label: 'projectile',
                 plugin: { data: { id: Math.random().toString(), type: 'aura', health: 1, maxHealth: 1, size: radius } as EnemyData }
             });
             Matter.Composite.add(this.engine.world, explosion);
             setTimeout(() => { if (explosion.parent) Matter.Composite.remove(this.engine.world, explosion) }, 500);
             
             this.enemies.forEach(e => {
                 const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, this.playerBody.position));
                 if (dist < radius) this.damageEnemy(e, this.gameState.currentStats().damage * 10, this.playerBody.position);
             });
             
             this.audioService.playSFX('explosion');
             
             // Volcanic fire rebirth particles
             for (let i = 0; i < 30; i++) {
                 const angle = (i / 30) * Math.PI * 2;
                 const speed = this.scaledSpeed(4 + Math.random() * 4);
                 const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
                 const proj = Matter.Bodies.circle(this.playerBody.position.x, this.playerBody.position.y, 15, {
                     isSensor: true, label: 'projectile',
                     plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: this.gameState.currentStats().damage * 3 } as EnemyData }
                 });
                 Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, speed));
                 Matter.Composite.add(this.engine.world, proj);
                 setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj) }, 800 + Math.random() * 600);
             }
         }, 3000);
         return;
      }
      if (this.gameState.currentGameMode() === 'ai_vs_ai') {
          if (this.battleAi.ai2.abilities.includes('rebirth')) {
              this.currentHealth.set(this.battleAi.ai2.stats.maxHealth);
              this.gameState.immortalUntil = Date.now() + 2000;
              this.triggerImpactEffect(this.playerBody.position.x, this.playerBody.position.y, true);
              // Remove rebirth so it can't be used again this life
              this.battleAi.ai2.abilities = this.battleAi.ai2.abilities.filter(a => a !== 'rebirth');
              return;
          }
          this.audioService.playSFX('explosion');
          this.triggerImpactEffect(this.playerBody.position.x, this.playerBody.position.y, true);
          this.gameState.ai1Wins.update(w => w + 1);
          this.mlAi.addReward(10); // the one who died is player (ai 2), top ai wins — balanced reward
          this.currentHealth.set(this.maxHealth());
          this.gameState.immortalUntil = Date.now() + 2000;
          // Re-roll ai2Abilities on respawn
          this.setupAi2Phoenix(true);
          
          // Visual Ash effect for in-place rebirth (teleport removed to fix glitch)
          const ashInterval = setInterval(() => {
              const ash = document.createElement('div');
              ash.style.position = 'fixed';
              ash.style.left = `${this.playerBody.position.x + (Math.random()-0.5)*30}px`;
              ash.style.top = `${this.playerBody.position.y + (Math.random()-0.5)*30}px`;
              ash.style.width = '4px';
              ash.style.height = '4px';
              ash.style.backgroundColor = '#9ca3af';
              ash.style.borderRadius = '50%';
              ash.style.pointerEvents = 'none';
              ash.style.zIndex = '50';
              document.body.appendChild(ash);
              setTimeout(() => ash.remove(), 1000);
          }, 100);
          setTimeout(() => clearInterval(ashInterval), 2000);
          
          return;
      }
      // Phoenix Feather Charm gadget (spec Section 5.3): once per
      // run, dying with no revive tokens (and Rebirth unavailable or
      // on cooldown, which is why control reached here) revives at
      // 50 percent HP instead. Deliberately weaker than a token or
      // Rebirth revive (full HP). Campaign only: Battle death ends
      // the match, and the annihilation phase forbids all revives.
      if (this.gameState.currentGameMode() === 'campaign' && !this.annihilationModeActive()
          && this.gameState.reviveTokens() <= 0
          && this.gameState.currentStats().activeGadget === 'phoenix_feather'
          && !this.featherUsedThisRun) {
          this.featherUsedThisRun = true;
          this.currentHealth.set(Math.floor(this.maxHealth() * 0.5));
          this.gameState.immortalUntil = Date.now() + 2000;
          this.triggerImpactEffect(this.playerBody.position.x, this.playerBody.position.y, true);
          this.audioService.playSFX('heal');
          return;
      }
      this.triggerDeathSequence();
    }
  }


  private startReviveCountdown() {
      if (this.reviveInterval) clearInterval(this.reviveInterval);
      this.reviveInterval = setInterval(() => {
          // Paused while a revive ad is showing: the tick does nothing,
          // so the countdown can never expire mid-ad (Bug 4).
          if (this.adReviveInFlight) return;
          this.reviveCountdown.update(c => c - 1);
          if (this.reviveCountdown() <= 0) {
              clearInterval(this.reviveInterval);
              this.quitGame();
          }
      }, 1000);
  }


  public getReviveCost(): number {
    return 10 * Math.pow(2, this.reviveCount);
  }


  public reviveWithGems() {
    const cost = this.getReviveCost();
    if (this.gameState.gems() >= cost) { 
        this.gameState.gems.update(g => g - cost); 
        this.reviveCount++;
        this.executeRevival(); 
    }
  }


  public reviveWithToken() {
    if (this.gameState.reviveTokens() <= 0) return;
    this.gameState.reviveTokens.update(t => t - 1);
    this.reviveCount++;
    this.gameState.syncProgressToServer();
    this.executeRevival();
  }


  public async reviveWithAd() {
    if (this.adRevivesUsed >= this.maxAdRevivesPerRun) return;
    if (this.adReviveInFlight) return;
    // Pause the countdown for the whole flight of the ad: clear the
    // interval AND raise the in-flight flag, so no countdown path can
    // end the run while the ad is on screen (playtest round 1, Bug 4).
    this.adReviveInFlight = true;
    if (this.reviveInterval) clearInterval(this.reviveInterval);

    let rewarded = false;
    try {
        rewarded = await this.adsService.showRewarded('revive');
    } finally {
        this.adReviveInFlight = false;
    }

    // If the run ended while the ad played (for example the player gave
    // up from the death screen underneath a web simulated ad), do not
    // resurrect into a run that no longer exists.
    if (!this.isDead() || this.gameState.activeScreen() !== 'game') return;

    if (rewarded) {
        this.adRevivesUsed++;
        this.reviveCount++;
        this.executeRevival();
    } else {
        // Ad skipped or failed: resume the countdown from where it paused
        this.startReviveCountdown();
    }
  }


  private executeRevival() {
    clearInterval(this.reviveInterval);
    this.isDead.set(false);
    this.gameState.isDeadMenuOpen.set(false);
    this.gameState.immortalUntil = Date.now() + 5000;
    this.gameState.speedBoostUntil = Date.now() + 2500;
    this.currentHealth.set(this.maxHealth());
    this.gameState.phoenixOverridePosition.set(null);
    this.clearEnemies();
    this.rageModeActive.set(false); // Reset rage mode on revive
    this.killScreenTimer.set(10); // Reset timer just in case
    if (this.engine) this.startPhysics(); // Unfreeze physics
    if (this.bossSpawned()) {
        // Boss fight continues: reset timer so rage mode doesn't trigger instantly
        this.timeRemaining.set(this.totalTimeSignal());
        // Restart the intense BGM if it ended
        if (this.audioService.onIntenseBgmEnded() || this.audioService.getBgmDuration() === 0) {
            this.audioService.playIntenseBgm(this.gameState.selectedWorldIndex());
        } else {
            this.audioService.resumeCurrentBgm();
        }
    }
  }


  // this.enemies and this.items are captured BY REFERENCE in the spawner
  // and battle contexts, and scheduleNextSpawn reuses one captured
  // context for the whole run. Reassigning either array (filter, = [])
  // orphans the captured reference: everything the spawner adds
  // afterwards lands in a dead array, invisible to steering, auto-fire
  // targeting, and item magnetism. Worst case (playtest round 2):
  // spawnBoss called clearEnemies (a reassignment) and then pushed the
  // boss into the orphaned array, so the boss sat off-screen at its
  // spawn point forever and no campaign boss could ever be fought.
  // These arrays must only ever be mutated in place.
  private spliceOut<T>(arr: T[], keep: (item: T) => boolean) {
      for (let i = arr.length - 1; i >= 0; i--) {
          if (!keep(arr[i])) arr.splice(i, 1);
      }
  }

  private spliceRemove<T>(arr: T[], item: T) {
      const idx = arr.indexOf(item);
      if (idx >= 0) arr.splice(idx, 1);
  }

  private clearEnemies() {
    this.enemies.forEach(e => {
        if (e.plugin['data']?.type !== 'boss') {
            Matter.Composite.remove(this.engine.world, e);
        }
    });
    this.spliceOut(this.enemies, e => e.plugin['data']?.type === 'boss');
    this.items.forEach(i => Matter.Composite.remove(this.engine.world, i));
    this.items.length = 0;
  }


  private runCountedForAds = false;

  // A run has ended: count it for the interstitial rules and, at this
  // natural break (results screen or leaving to the menu), consider one
  // interstitial. The AdsService enforces every cap and exemption. This is
  // never called from the death/revive flow.
  private finishRunForAds() {
    if (this.runCountedForAds) return;
    this.runCountedForAds = true;
    this.adsService.onRunFinished();
    this.adsService.maybeShowInterstitial();
  }

  private winGame() {
    this.gameEnded.set(true);
    this.gameWon.set(true);
    this.finishRunForAds();
    
    this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); 

    const currentIdx = this.gameState.selectedWorldIndex();
    const nextIdx = currentIdx + 1;
    if (nextIdx < this.gameState.worlds.length && !this.gameState.unlockedWorlds().includes(nextIdx)) {
      this.gameState.unlockedWorlds.update(worlds => [...worlds, nextIdx]);
    }
    
    this.gameState.syncProgressToServer();
  }

  
  private executeRealmTransition() {
      // 1. Advance to next realm seamlessly
      const currentIdx = this.gameState.selectedWorldIndex();
      const nextIdx = currentIdx + 1;
      
      if (nextIdx < this.gameState.worlds.length && !this.gameState.worlds[nextIdx].isComingSoon) {
          if (!this.gameState.unlockedWorlds().includes(nextIdx)) {
              this.gameState.unlockedWorlds.update(worlds => [...worlds, nextIdx]);
          }
          this.gameState.selectedWorldIndex.set(nextIdx);
          
          // Flash animation for cool realm switch
          const flash = document.createElement('div');
          flash.className = 'fixed inset-0 bg-white z-[100] pointer-events-none transition-opacity duration-1000';
          document.body.appendChild(flash);
          
          // Force reflow
          void flash.offsetWidth;
          
          setTimeout(() => flash.style.opacity = '0', 50);
          setTimeout(() => flash.remove(), 1050);
      } else {
          // If the next realm is coming soon, just go to the main screen by quitting
          this.quitGame();
          return;
      }
      
      this.gameState.syncProgressToServer();
      
      // 2. Reset Sequence States
      this.inBossDefeatSequence.set(false);
      this.animatingAscension.set(false);
      this.bossSpawned.set(false);
      // A new realm is a new run: fresh stamina pool (Section 2.5).
      this.gameState.playerMovement = createMovementState();
      this.rawBrakeHeld = false;
      this.clearEnemies();

      // Start the new realm's world BGM NOW, not after the entrance
      // animation: playWorldBgm resets the audio service's ended flag,
      // and the still-running game loop checks that flag every tick.
      // While it stays latched from the previous realm's finished
      // track, the loop spawns the new realm's boss during the 1.5 s
      // entrance (playtest round 2, probe6: the realm 2 boss spawned
      // instantly and the run blew through realm 2 in seconds).
      this.audioService.playWorldBgm(nextIdx);
      
      // 3. Animate Phoenix entering from bottom
      const startY = window.innerHeight + 200; // Off screen bottom
      const endY = window.innerHeight / 2; // Default starting position
      const duration = 1500;
      const startTime = Date.now();
      
      const animateEntrance = () => {
          const now = Date.now();
          const progress = Math.min((now - startTime) / duration, 1);
          
          // Easing: easeOutQuad (decelerates upwards)
          const currentY = startY + (endY - startY) * (progress * (2 - progress));
          this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentY });
          
          if (progress < 1) {
              requestAnimationFrame(animateEntrance);
          } else {
              this.gameState.phoenixOverridePosition.set(null); // Return to mouse control

              // 4. Restart Level fully (the new realm's BGM was already
              // started in the reset step above).
              this.timeRemaining.set(this.totalTimeSignal());
              this.startGameLoop();
          }
      };
      
      requestAnimationFrame(animateEntrance);
  }


  public togglePause() {
    if (this.gameEnded() || this.isDead()) return;
    
    // If cheat was prepared and we are resuming, trigger it
    if (this.gameState.isPaused() && this.cheatPrepared()) {
        // Fast forward song to 1 second before it ends
        this.audioService.worldBgm.currentTime = Math.max(0, this.audioService.worldBgm.duration - 1);
        this.cheatPrepared.set(false);
    }

    this.gameState.isPaused.set(!this.gameState.isPaused());
    
    if (this.gameState.isPaused()) {
        this.stopPhysics();
        this.audioService.pauseCurrentBgm();
    } else {
        this.startPhysics();
        this.audioService.resumeCurrentBgm();
    }
  }


  private onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { this.togglePause(); return; }
      if (this.gameState.currentGameMode() === 'ai_vs_ai' || this.isDead() || this.gameEnded()) return;
      // Desktop alternatives for the touch verbs (spec Sections 2.2
      // to 2.4) and the slot keys (Section 3.2, desktop testing).
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
          // Shift dashes toward the current steering target.
          const pos = this.gameState.phoenixScreenPos();
          const dx = this.mouseX - pos.x;
          const dy = this.mouseY - pos.y;
          if (Math.hypot(dx, dy) > 10) {
              this.gameState.requestDash(this.gameState.playerMovement, dx, dy);
          }
      } else if (event.code === 'KeyE') {
          this.gameState.requestRoll(this.gameState.playerMovement);
      } else if (event.code === 'Space') {
          this.rawBrakeHeld = true;
          event.preventDefault();
      } else if (event.code === 'KeyQ') {
          this.fireSlot('tap');
      } else if (event.code === 'KeyW') {
          this.fireSlot('double');
      } else if (event.code === 'KeyR') {
          this.fireSlot('triple');
      }
  }

  private onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') this.rawBrakeHeld = false;
  }

  private onVisibilityChange() { if (document.hidden && !this.gameState.isPaused() && !this.gameEnded() && !this.isDead()) this.togglePause(); }

  public onPauseTextClick() {
      this.pauseClickCount++;
      if (this.pauseClickCount >= 5) {
          this.cheatPrepared.set(true);
          this.pauseClickCount = 0;
      }
  }


  public quitFromPause() {
      this.gameState.isPaused.set(false);
      if (this.gameState.currentGameMode() === 'battle') {
          this.triggerDeathSequence();
      } else {
          this.quitGame();
      }
  }


  private onMouseMove(event: MouseEvent) { this.updateMouseInput(event.clientX, event.clientY, false); }

  private onTouchMove(event: TouchEvent) {
      event.preventDefault();
      if (event.touches.length > 0) this.updateMouseInput(event.touches[0].clientX, event.touches[0].clientY, true);
  }


  private updateMouseInput(x: number, y: number, isTouch: boolean) {
      if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen() || this.isDead()) return;
      // Touch targets carry the finger offset, so ability aiming and
      // the hold charge read the same point the bird steers to.
      const adjusted = this.gameState.applyTouchOffset(x, y, isTouch);
      this.mouseX = adjusted.x;
      this.mouseY = adjusted.y;
  }


  private onMouseDown(event: MouseEvent) {
      // Right mouse button is the Feather Brake (spec Section 2.4).
      if (event.button === 2) { this.rawBrakeHeld = true; return; }
      if (event.button !== 0) return;
      this.pressX = event.clientX;
      this.pressY = event.clientY;
      this.pressT = Date.now();
      this.handleInputStart(event.clientX, event.clientY, false);
  }

  private onTouchStart(event: TouchEvent) {
      // Do not prevent default here, as it blocks UI clicks (like the pause button)
      if (event.touches.length >= 2) {
          // Second finger: Feather Brake while it is held; a quick
          // release becomes an Air Roll in onTouchEnd (spec Sections
          // 2.3 and 2.4). It never enters the tap chain.
          this.secondFingerStartT = Date.now();
          this.rawBrakeHeld = true;
          return;
      }
      if (event.touches.length > 0) {
          const t = event.touches[0];
          this.pressX = t.clientX;
          this.pressY = t.clientY;
          this.pressT = Date.now();
          this.handleInputStart(t.clientX, t.clientY, true);
      }
  }


  private handleInputStart(x: number, y: number, isTouch: boolean) {
      if (this.gameState.currentGameMode() === 'ai_vs_ai') return;
      const adjusted = this.gameState.applyTouchOffset(x, y, isTouch);
      this.isMouseHeld = true;
      this.holdStartX = adjusted.x;
      this.holdStartY = adjusted.y;
      this.holdTimer = 0;

      const now = Date.now();
      // Tap-chain parser (spec Section 3.2), additive over the pre-S1
      // behavior: a press within 300 ms of the previous press extends
      // the chain. The second press fires the tap slot, exactly the
      // old single check; the third press fires the double slot
      // additionally; the fourth fires the triple slot and ends the
      // chain. First and second presses behave byte-for-byte as
      // before; only the existence of a third press changes anything.
      if (now - this.tapChainLastTime < 300) {
          this.tapChainCount++;
      } else {
          this.tapChainCount = 1;
      }
      this.tapChainLastTime = now;
      if (!this.gameState.isPaused()) {
          if (this.tapChainCount === 2) {
              this.fireSlot('tap');
          } else if (this.tapChainCount === 3) {
              this.fireSlot('double');
          } else if (this.tapChainCount >= 4) {
              this.fireSlot('triple');
              this.tapChainCount = 0;
          }
      }
      this.lastClickTime = now;
  }

  // Fire one equip slot's move, honoring its own cooldown. Shared by
  // the tap-chain parser and the desktop slot keys.
  private fireSlot(family: 'tap' | 'double' | 'triple') {
      const stats = this.gameState.currentStats();
      const ability = family === 'tap' ? stats.activeTapAbility
          : family === 'double' ? stats.activeDoubleAbility
          : stats.activeTripleAbility;
      if (!ability) return;
      const cooldown = family === 'tap' ? this.tapCooldown()
          : family === 'double' ? this.doubleCooldown()
          : this.tripleCooldown();
      if (cooldown > 0) return;
      const cd = this.triggerAbility(ability, this.playerBody, this.mouseX, this.mouseY, stats, 'player');
      if (cd <= 0) return;
      if (family === 'tap') {
          this.tapCooldown.set(cd);
      } else if (family === 'double') {
          this.doubleCooldown.set(cd);
      } else {
          this.tripleCooldown.set(cd);
          // An ultimate cast is an allowed shake trigger (Section 4.3).
          this.triggerShake('ultimate_cast');
      }
  }

  // Flick Dash gesture (spec Section 2.2): a press released within
  // 120 ms with at least 12 percent of min-dimension travel dashes in
  // the flick's direction. Slow drags and plain taps never dash.
  private evaluateFlick(x: number, y: number) {
      if (this.gameState.currentGameMode() === 'ai_vs_ai') { this.pressT = 0; return; }
      const dt = Date.now() - this.pressT;
      const dx = x - this.pressX;
      const dy = y - this.pressY;
      const travel = Math.hypot(dx, dy);
      const minTravel = 0.12 * Math.min(window.innerWidth, window.innerHeight);
      if (this.pressT > 0 && dt <= 120 && travel >= minTravel) {
          this.gameState.requestDash(this.gameState.playerMovement, dx, dy);
      }
      this.pressT = 0;
  }


  private onMouseUp(event: MouseEvent) {
      if (event.button === 2) { this.rawBrakeHeld = false; return; }
      if (event.button !== 0) return;
      this.evaluateFlick(event.clientX, event.clientY);
      this.isMouseHeld = false;
  }

  private onTouchEnd(event: TouchEvent) {
      if (event.touches.length === 1) {
          // The second finger lifted while the steering finger stays
          // down: a quick second-finger tap is an Air Roll (Section
          // 2.3); a held one was the Feather Brake, now released.
          if (this.secondFingerStartT > 0 && Date.now() - this.secondFingerStartT < 250) {
              this.gameState.requestRoll(this.gameState.playerMovement);
          }
          this.secondFingerStartT = 0;
          this.rawBrakeHeld = false;
          return;
      }
      if (event.touches.length === 0) {
          this.secondFingerStartT = 0;
          this.rawBrakeHeld = false;
          const t = event.changedTouches[0];
          if (t) this.evaluateFlick(t.clientX, t.clientY);
          this.isMouseHeld = false;
      }
  }


  public formatTime(seconds: number): string {
    const totalSeconds = Math.floor(seconds);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }


  private fireProjectile() {
    if (this.enemies.length === 0) return;

    let nearest = this.enemies[0];
    let minDist = Infinity;
    this.enemies.forEach(e => {
      const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, this.playerBody.position));
      if (dist < minDist) { minDist = dist; nearest = e; }
    });

    // Range gate wired to the attackRange stat (spec Sections 3.1
    // and 5.1): the shop passive finally feeds the auto-fire it names.
    // It used to read a hardcoded 500 while the stat sat at base 400.
    if (minDist > this.gameState.currentStats().attackRange * this.speedScale) return;

    const dir = Matter.Vector.normalise(Matter.Vector.sub(nearest.position, this.playerBody.position));

    // Projectiles spawn EXACTLY at the player body (which is now exactly the Phoenix 3D visual position)
    const projectile = Matter.Bodies.circle(this.playerBody.position.x, this.playerBody.position.y, 8, {
      label: 'projectile',
      isSensor: true,
      plugin: {
          data: { id: Math.random().toString(), type: 'projectile_player', health: 1, maxHealth: 1, owner: 'player', burstDamage: this.gameState.currentStats().damage } as EnemyData
      }
    });

    Matter.Body.setVelocity(projectile, Matter.Vector.mult(dir, this.scaledSpeed(7.5)));
    Matter.Composite.add(this.engine.world, projectile);
    
    this.audioService.playSFX('shoot');
    setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.engine.world, projectile); }, 2000);
  }


  private fireEnemyProjectile(source: Matter.Vector, speedPerStep: number = 7.5, targetOverride?: { x: number, y: number }) {
    // Use stale position for reaction delay (human-like ~150ms lag)
    const enemyPhoenix = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
    const eAny = enemyPhoenix as any;
    const targetPos = targetOverride || (eAny?.__stalePlayerPos) || this.playerBody.position;
    const dir = Matter.Vector.normalise(Matter.Vector.sub(targetPos, source));
    const damage = this.battleAi.ai1.stats?.damage || 10;

    // Aim spread: ±3° base, increasing with distance (human-like inaccuracy)
    const dist = Matter.Vector.magnitude(Matter.Vector.sub(this.playerBody.position, source));
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

    Matter.Body.setVelocity(projectile, Matter.Vector.mult(finalDir, this.scaledSpeed(speedPerStep)));
    Matter.Composite.add(this.engine.world, projectile);
    setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.engine.world, projectile); }, 2000);
  }


  private triggerAbility(ability: string, sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      if (ownerId === 'player' && this.gameState.isRebirthing()) return 0;
      
      if (ability === 'drill_attack') return this.triggerDrillAttack(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'burst') return this.triggerBurst(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_dart') return this.triggerFireDart(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'meteor_rush') return this.triggerMeteorRush(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_talon') return this.triggerPhoenixTalon(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'spark_storm') return this.triggerSparkStorm(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_lance') return this.triggerFireLance(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_breath') return this.triggerFireBreath(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_turret') return this.triggerPhoenixTurret(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_inferno') return this.triggerPhoenixInferno(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'inferno_wave') return this.triggerInfernoWave(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'aura') return this.triggerAura(sourceBody, targetX, targetY, stats, ownerId);
      return 0;
  }




  private triggerDrillAttack(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['drill_attack'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
      const duration = 600 * mods['duration'];
      const baseCooldown = ABILITIES['drill_attack']?.baseCooldown || 20;
      const cd = baseCooldown * mods['cooldown'];

      this.audioService.playSFX('shoot');
      
      if (ownerId === 'player') {
          this.gameState.isDrilling.set(true);
      }
      
      setTimeout(() => {
          if (ownerId === 'player') {
              this.gameState.isDrilling.set(false);
          }
      }, duration);
      return cd;
  }


  private triggerFireBreath(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['fire_breath'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0, ammo: 1.0 };
      const baseCooldown = ABILITIES['fire_breath']?.baseCooldown || 8;
      const cd = baseCooldown * mods['cooldown'];

      let nearest = null;
      let minDist = Infinity;
      const validTargets = ownerId === 'player' ? this.enemies : [this.playerBody];
      if (validTargets.length > 0) {
          nearest = validTargets[0];
          validTargets.forEach(e => {
              const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, sourceBody.position));
              if (dist < minDist) { minDist = dist; nearest = e; }
          });
      }
      if (minDist > 500 * this.speedScale || !nearest) return cd;

      const ammo = Math.floor(20 * (mods['ammo'] || 1.0));
      const fireIntervalMs = 50;
      const firingDurationSec = (ammo * fireIntervalMs) / 1000;
      
      const damage = stats.damage * 0.5 * mods['damage'];
      const range = this.scaledSpeed(6 * mods['range']);
      
      const incomingDamage = new Map<string, number>();

      for(let i=0; i<ammo; i++) {
          setTimeout(() => {
              if (!sourceBody.parent || (ownerId === 'player' && (this.isDead() || this.gameState.isRebirthing()))) return;
              
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

              this.audioService.playSFX('shoot');
              
              const spreadAngle = (Math.random() - 0.5) * 0.5;
              const angle = fireAngle + spreadAngle;
              const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
              const proj = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, 15, {
                  isSensor: true, label: 'projectile',
                  // S2 root fix: pellets now carry owner alongside
                  // ownerId (the aura convention). Without owner, the
                  // collision branches could not skip the caster, so a
                  // fire breath cast was eaten by the caster's own body
                  // at spawn and damaged the caster instead of the
                  // target (probe: STAGE-S2.md).
                  plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: damage, owner: ownerId, ownerId: ownerId } as EnemyData }
              });
              Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, range));
              Matter.Composite.add(this.engine.world, proj);
              setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj) }, 500);
          }, i * fireIntervalMs);
      }
      return cd;
  }


  private triggerPhoenixTurret(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['phoenix_turret'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
      const baseCooldown = ABILITIES['phoenix_turret']?.baseCooldown || 14;
      const cd = baseCooldown * mods['cooldown'];
      
      const seekRange = 500 * (mods['range'] || 1.0);
      const tetherRange = 100 * (mods['range'] || 1.0);
      const duration = 6000 * mods['duration'];
      const baseDamage = stats.damage * mods['damage'];
      
      if (ownerId === 'player') {
          this.holdAbilityEndTime = Date.now() + duration + 2000; 
      } else {
          const eAny = sourceBody.plugin['data'] as any;
          if (eAny) eAny.holdAbilityEndTime = Date.now() + duration + 2000;
      }
      
      const egg = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, 20, {
          isStatic: true, isSensor: true, label: 'projectile',
          plugin: { data: { id: Math.random().toString(), type: 'egg', health: 1000, maxHealth: 1000, size: 20, aggroTarget: null, ownerId: ownerId } as any }
      });
      Matter.Composite.add(this.engine.world, egg);
      
      this.audioService.playSFX('drop');
      
      setTimeout(() => {
          if (!egg.parent) return;
          this.audioService.playSFX('shoot');
          
          const baby = Matter.Bodies.circle(egg.position.x, egg.position.y - 30, 15, {
              isSensor: true, label: 'projectile', frictionAir: 0.1,
              plugin: { data: { id: Math.random().toString(), type: 'turret', health: 500, maxHealth: 500, size: 15, ownerId: ownerId } as EnemyData }
          });
          Matter.Composite.add(this.engine.world, baby);
          
          let exploded = false;
          let fireInterval: any;
          let boidLogic: any;
          
          const explode = () => {
              if (exploded) return;
              exploded = true;
              if (boidLogic) Matter.Events.off(this.engine, 'beforeUpdate', boidLogic);
              if (fireInterval) clearInterval(fireInterval);
              
              this.audioService.playSFX('explosion');
              const radius = 200;
              
              for (let i = 0; i < 40; i++) {
                  const angle = Math.random() * Math.PI * 2;
                  const speed = this.scaledSpeed(Math.random() * 4 + 2);
                  const fireDir = { x: Math.cos(angle), y: Math.sin(angle) };
                  const proj = Matter.Bodies.circle(egg.position.x, egg.position.y, 15, {
                      isSensor: true, label: 'projectile',
                      plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: baseDamage * 5, owner: ownerId } as EnemyData }
                  });
                  Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, speed));
                  Matter.Composite.add(this.engine.world, proj);
                  setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj) }, 500 + Math.random() * 300);
              }
              
              const validTargets = ownerId === 'player' ? this.enemies : [this.playerBody];
              validTargets.forEach(e => {
                  const dist = Matter.Vector.magnitude(Matter.Vector.sub(e.position, egg.position));
                  if (dist < radius) {
                      if (e === this.playerBody) this.takeDamage(baseDamage * 5);
                      else this.damageEnemy(e, baseDamage * 5, egg.position);
                  }
              });
              
              if (baby.parent) Matter.Composite.remove(this.engine.world, baby);
              if (egg.parent) Matter.Composite.remove(this.engine.world, egg);
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
              
              const speed = (isReturning ? 2 : (eggData.aggroTarget ? 1.5 : 1)) * this.speedScale;
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
                  
                  const validTargets = ownerId === 'player' ? this.enemies : [this.playerBody];
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
          
          Matter.Events.on(this.engine, 'beforeUpdate', boidLogic);

          fireInterval = setInterval(() => {
              if (!baby.parent || this.gameEnded()) {
                  clearInterval(fireInterval);
                  return;
              }
              
              const validTargets = ownerId === 'player' ? this.enemies : [this.playerBody];
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
                                  plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: baseDamage, owner: ownerId, ownerId: ownerId } as EnemyData }
                              });
                              Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, this.scaledSpeed(7.5)));
                              Matter.Composite.add(this.engine.world, proj);
                              setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj) }, 1000);
                          }, i * 50);
                      }
                  }
              }
          }, 500);

          setTimeout(() => {
              if (!baby.parent || !egg.parent || exploded) return;
              isReturning = true;
              
              const returnCheck = setInterval(() => {
                  if (!baby.parent || !egg.parent || exploded || this.gameEnded()) { clearInterval(returnCheck); return; }
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
  private aimAngle(sourceBody: Matter.Body, targetX: number, targetY: number): number {
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
  private spawnAbilityProjectile(opts: {
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
      Matter.Composite.add(this.engine.world, proj);
      setTimeout(() => { if (proj.parent) Matter.Composite.remove(this.engine.world, proj); }, opts.lifeMs);
      return proj;
  }

  private triggerBurst(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
              angle: k * Math.PI / 4, speedPerStep: this.scaledSpeed(10), lifeMs: 1000
          });
      }
      this.audioService.playSFX('shoot');
      return cd;
  }

  private triggerPhoenixTalon(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
              angle: baseAngle + (i - 1) * 0.15, speedPerStep: this.scaledSpeed(10), lifeMs: 2000
          });
      }
      this.audioService.playSFX('shoot');
      return cd;
  }

  private triggerFireDart(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
          angle: this.aimAngle(sourceBody, targetX, targetY), speedPerStep: this.scaledSpeed(12), lifeMs: 2000
      });
      this.audioService.playSFX('shoot');
      return cd;
  }

  private triggerSparkStorm(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
          targetIds = this.enemies
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
              angle: aim + (i - 2.5) * 0.18, speedPerStep: this.scaledSpeed(8), lifeMs: 2500,
              extra: targetId ? { targetId } : undefined
          });
      }
      this.audioService.playSFX('shoot');
      return cd;
  }

  private triggerFireLance(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
          angle: this.aimAngle(sourceBody, targetX, targetY), speedPerStep: this.scaledSpeed(13), lifeMs: 1600,
          extra: { pierce: true, hitIds: [] }
      });
      this.audioService.playSFX('shoot');
      return cd;
  }

  private triggerMeteorRush(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
      this.audioService.playSFX('shoot');
      if (ownerId === 'player') {
          this.gameState.isMeteorRushing.set(true);
          this.meteorRushUntilMs = Date.now() + duration;
          this.meteorRushDamageValue = damage;
          this.meteorRushHitIds.clear();
          setTimeout(() => { this.gameState.isMeteorRushing.set(false); }, duration);
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


  private triggerAura(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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

      Matter.Composite.add(this.engine.world, aura);
      this.audioService.playSFX('heal');

      const updateAura = () => {
          if (!aura.parent || this.isDead() || this.gameEnded()) return;
          Matter.Body.setPosition(aura, sourceBody.position);
      };

      Matter.Events.on(this.engine, 'beforeUpdate', updateAura);

      const tickInterval = setInterval(() => {
          if (!aura.parent || !sourceBody.parent || this.gameEnded()) {
              clearInterval(tickInterval);
              return;
          }
          const cx = sourceBody.position.x;
          const cy = sourceBody.position.y;
          if (ownerId === 'player') {
              // Snapshot the list: damageEnemy can remove bodies and
              // spawn splits while the loop runs.
              for (const e of [...this.enemies]) {
                  const d = Math.hypot(e.position.x - cx, e.position.y - cy);
                  if (d < radius) this.damageEnemy(e, tickDamage, sourceBody.position);
              }
          } else {
              const d = Math.hypot(this.playerBody.position.x - cx, this.playerBody.position.y - cy);
              if (d < radius && !this.isDead()) this.takeDamage(tickDamage);
          }
      }, 500);

      setTimeout(() => {
          clearInterval(tickInterval);
          if (aura.parent) Matter.Composite.remove(this.engine.world, aura);
          Matter.Events.off(this.engine, 'beforeUpdate', updateAura);
      }, duration);

      return cd;
  }

  private triggerPhoenixInferno(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
          this.playerInfernoUntil = channelEnd;
          this.holdAbilityEndTime = channelEnd;
      } else {
          const d = sourceBody.plugin['data'] as EnemyData;
          if (d) d.infernoUntil = channelEnd;
      }
      this.audioService.playSFX('shoot');

      const range = 0.5 * this.logicalUnit;
      const halfWidth = 30 * this.speedScale;
      let visualFlip = false;
      const tick = setInterval(() => {
          if (Date.now() >= channelEnd || !sourceBody.parent || this.gameEnded()
              || (ownerId === 'player' && (this.isDead() || this.gameState.isRebirthing()))) {
              clearInterval(tick);
              return;
          }
          // The beam follows the caster's current aim: for the
          // player that is the mouse, for the rival its steering
          // target (the player bird).
          let aimX: number, aimY: number;
          if (ownerId === 'player') {
              aimX = this.mouseX; aimY = this.mouseY;
          } else {
              aimX = this.playerBody.position.x; aimY = this.playerBody.position.y;
          }
          const sx = sourceBody.position.x;
          const sy = sourceBody.position.y;
          let ax = aimX - sx;
          let ay = aimY - sy;
          const alen = Math.hypot(ax, ay);
          if (alen < 1) { ax = 0; ay = -1; } else { ax /= alen; ay /= alen; }
          const targets = ownerId === 'player' ? [...this.enemies] : [this.playerBody];
          for (const t of targets) {
              const rx = t.position.x - sx;
              const ry = t.position.y - sy;
              const along = rx * ax + ry * ay;
              if (along < 0 || along > range) continue;
              const perp = Math.abs(rx * -ay + ry * ax);
              if (perp > halfWidth) continue;
              if (t === this.playerBody) this.takeDamage(tickDamage);
              else this.damageEnemy(t, tickDamage, sourceBody.position);
          }
          // Beam visual: short-lived fire blobs along the corridor,
          // alternating ticks. They carry burstDamage 0, so both
          // collision branches skip them; they are pure display.
          visualFlip = !visualFlip;
          if (visualFlip) {
              for (let s = 1; s <= 5; s++) {
                  const bx = sx + ax * range * (s / 6) + (Math.random() - 0.5) * 14 * this.speedScale;
                  const by = sy + ay * range * (s / 6) + (Math.random() - 0.5) * 14 * this.speedScale;
                  const blob = Matter.Bodies.circle(bx, by, 13, {
                      isSensor: true, label: 'projectile',
                      plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: 0, owner: ownerId, ownerId: ownerId } as EnemyData }
                  });
                  Matter.Composite.add(this.engine.world, blob);
                  setTimeout(() => { if (blob.parent) Matter.Composite.remove(this.engine.world, blob); }, 260);
              }
          }
      }, 250);

      return ownerId === 'player' ? cd : cd + channelMs / 1000;
  }

  private triggerInfernoWave(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
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
              angle: k * Math.PI / 8, speedPerStep: this.scaledSpeed(6), lifeMs: 2500,
              extra: { pierce: true, hitIds: sharedHitIds }
          });
      }
      this.audioService.playSFX('shoot');
      return cd;
  }


  private triggerDeathSequence() {
    // Never run two death sequences at once: a second countdown interval
    // would orphan the first, and the orphan would end the run from
    // under the player (playtest round 1, Bug 4 root cause chain).
    if (this.isDead()) return;
    this.isDead.set(true);
    this.gameState.isDeadMenuOpen.set(true);
    this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: window.innerHeight + 200 });
    
    if (this.gameState.currentGameMode() === 'battle') {
        this.gameState.coins.update(c => c + this.battleCoinsCollected());
        this.gameState.syncProgressToServer({
            battleHighscore: this.currentBattleScore(),
            battleBestTime: this.battleTimer(),
            battleBestCoins: this.currentBattleCoinsGained()
        });
    } else {
        this.gameState.syncProgressToServer();
    }

    this.stopPhysics();

    // Disable revive if player dies in Annihilation Phase
    if (this.annihilationModeActive()) {
        setTimeout(() => this.quitGame(), 3000);
        return;
    }

    // Revive mechanic logic: the countdown has exactly one owner,
    // startReviveCountdown, which always clears any previous interval
    // before creating its own.
    this.reviveCountdown.set(10);
    this.startReviveCountdown();
  }

  
  private triggerAscension() {
      this.animatingAscension.set(true);
      
      // Animate Phoenix flying upwards
      const startY = this.gameState.phoenixScreenPos().y;
      const endY = -200; // Off screen top
      const duration = 2000;
      const startTime = Date.now();
      
      const animateFrame = () => {
          const now = Date.now();
          const progress = Math.min((now - startTime) / duration, 1);
          
          // Easing: easeInQuad (accelerates upwards)
          const currentY = startY + (endY - startY) * (progress * progress);
          
          this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: currentY });
          
          if (progress < 1) {
              requestAnimationFrame(animateFrame);
          } else {
              this.executeRealmTransition();
          }
      };
      
      requestAnimationFrame(animateFrame);
  }


  private triggerRageMode() {
      if (this.rageModeActive()) return; // Fix race condition
      this.rageModeActive.set(true);
      const kInt = setInterval(() => {
          if (this.gameEnded() || this.isDead() || this.inBossDefeatSequence()) {
              clearInterval(kInt);
              return;
          }
          if (!this.gameState.isPaused()) {
              this.killScreenTimer.update(t => t - 1);
              if (this.killScreenTimer() <= 0) {
                  clearInterval(kInt);
                  this.executeKillScreen();
              }
          }
      }, 1000);
  }


  private triggerMassiveExplosion(x: number, y: number) {
    const colors = ['#a855f7', '#fbbf24', '#f97316'];
    for (let i = 0; i < 100; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'fixed';
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.width = '10px';
        particle.style.height = '10px';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.borderRadius = '2px'; // Square fragments
        particle.style.pointerEvents = 'none';
        particle.style.zIndex = '100';
        document.body.appendChild(particle);

        const angle = Math.random() * Math.PI * 2;
        const velocity = 100 + Math.random() * 300;

        anime({
            targets: particle,
            translateX: Math.cos(angle) * velocity,
            translateY: Math.sin(angle) * velocity + 150, // gravity effect
            rotate: Math.random() * 360,
            opacity: [1, 0],
            duration: 2000 + Math.random() * 1000,
            easing: 'easeOutCirc',
            complete: () => particle.remove()
        });
    }
  }


  private triggerImpactEffect(x: number, y: number, isBoss: boolean) {
    // Per-frame spark throttle (spec Section 4.6): beyond the frame
    // allowance, spawns are dropped (oldest first in effect, since the
    // earliest calls in the frame win the budget).
    const frameNow = performance.now();
    if (frameNow - this.sparkFrameStart > 17) {
        this.sparkFrameStart = frameNow;
        this.sparkFrameCount = 0;
    }
    let numParticles = isBoss ? 30 : 10;
    const allowance = GameComponent.SPARK_PER_FRAME_BUDGET - this.sparkFrameCount;
    if (allowance <= 0) return;
    numParticles = Math.min(numParticles, allowance);
    this.sparkFrameCount += numParticles;
    const colors = ['#fbbf24', '#f97316', '#ffffff'];
    
    for (let i = 0; i < numParticles; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'fixed';
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.width = isBoss ? '12px' : '6px';
        particle.style.height = isBoss ? '12px' : '6px';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.borderRadius = '50%';
        particle.style.pointerEvents = 'none';
        particle.style.zIndex = '100';
        document.body.appendChild(particle);

        const angle = Math.random() * Math.PI * 2;
        const velocity = isBoss ? 50 + Math.random() * 150 : 20 + Math.random() * 80;

        anime({
            targets: particle,
            translateX: Math.cos(angle) * velocity,
            translateY: Math.sin(angle) * velocity + (isBoss ? 50 : 20), // slight gravity
            opacity: [1, 0],
            scale: [1, 0],
            duration: isBoss ? 1500 : 800,
            easing: 'easeOutExpo',
            complete: () => particle.remove()
        });
    }
  }



  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.spawner.stopSpawning();
    if (this.attackInterval) clearInterval(this.attackInterval);
    if (this.reviveInterval) clearInterval(this.reviveInterval);
    if ((this as any).aiAbilityInterval) clearInterval((this as any).aiAbilityInterval);
    if ((this as any).infiniteBurnInterval) clearInterval((this as any).infiniteBurnInterval);
    
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('touchstart', this.boundTouchStart);
    window.removeEventListener('touchmove', this.boundTouchMove);
    window.removeEventListener('touchend', this.boundTouchEnd);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('contextmenu', this.boundContextMenu);
    document.removeEventListener('visibilitychange', this.boundVisibility);
    
    this.gameState.phoenixOverridePosition.set(null);
    this.gameState.activeEntities.set([]);
    
    if (this.engine) {
        Matter.Events.off(this.engine, 'beforeUpdate');
        Matter.Events.off(this.engine, 'collisionStart');
        Matter.Engine.clear(this.engine);
    }
    this.stopPhysics();
    
    this.audioService.stopIntenseBgm();
  }


  public quitGame() {
      // The revive countdown dies with the run: it must never fire into
      // the menu or into a later run (playtest round 1, Bug 4 chain).
      if (this.reviveInterval) clearInterval(this.reviveInterval);
      this.adReviveInFlight = false;
      this.finishRunForAds();
      if (this.gameState.currentGameMode() === 'battle') {
          // If we quit without dying, still add the collected coins
          if (!this.isDead()) {
              this.gameState.coins.update(c => c + this.battleCoinsCollected());
          }
          this.gameState.syncProgressToServer({
              battleHighscore: this.currentBattleScore(),
              battleBestTime: this.battleTimer(),
              battleBestCoins: this.currentBattleCoinsGained()
          });
      } else {
          this.gameState.syncProgressToServer();
      }
      this.gameState.isDeadMenuOpen.set(false);
      this.gameState.isPaused.set(false);
      this.cheatPrepared.set(false);
      this.gameState.coins.update(c => Math.floor(c));
      this.gameState.gems.update(g => Math.floor(g));
      this.gameState.aiPhoenixOverridePosition.set(null);
      this.gameState.phoenixOverridePosition.set(null);
      
      if ((this as any).activeAbilityIntervals) {
          (this as any).activeAbilityIntervals.forEach((id: any) => clearInterval(id));
          (this as any).activeAbilityIntervals = [];
      }
      if ((this as any).aiAbilityInterval) clearInterval((this as any).aiAbilityInterval);
      if ((this as any).infiniteBurnInterval) clearInterval((this as any).infiniteBurnInterval);
      this.audioService.playMenuBgm();
      if (this.crateCollectedThisRun) {
          this.gameState.activeScreen.set('crate_opening');
      } else {
          this.gameState.activeScreen.set('menu'); 
      }
  }
}
