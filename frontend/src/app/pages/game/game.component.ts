import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, NgZone, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService } from '../../services/game-state.service';
import { PhysicsEntity, WorldStats } from '../../models/game.models';
import { ABILITIES, BASE_STATS, REALM_ABILITIES } from '../../constants/game.constants';
import { Capacitor } from '@capacitor/core';
import { AudioService } from '../../services/audio.service';
import { SettingsComponent } from '../settings/settings.component';
import * as Matter from 'matter-js';
import anime from 'animejs';
import { MlAiService } from '../../services/ml-ai.service';
import { BattleAiService, BattleContext } from '../../services/battle-ai.service';
import { EntitySpawnerService } from '../../services/entity-spawner.service';

interface EnemyData {
  id: string;
  type: 'bat' | 'slime' | 'golem' | 'boss' | 'projectile_player' | 'projectile_enemy' | 'aura' | 'coin' | 'gem' | 'heart' | 'xp_orb' | 'drill' | 'fire' | 'turret' | 'egg' | 'crate' | 'annihilation_fire' | 'enemy_phoenix';
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
}

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, SettingsComponent],
  template: `
    <div class="fixed inset-0 z-10 w-full h-full pointer-events-none">
      
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
      </div>

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
                <button (click)="reviveWithAd()" class="w-full mt-2 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:brightness-125 border border-cyan-400/50 rounded-2xl flex justify-center items-center gap-3 transition shadow-[0_0_20px_rgba(0,200,255,0.3)]">
                  <span class="text-white font-bold text-xl">Watch Ad to Revive</span>
                  <span class="text-2xl">📺</span>
                </button>
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
  public battleAi = inject(BattleAiService);
  public spawner = inject(EntitySpawnerService);

  public Math = Math;

  public currentWorld = computed(() => this.gameState.worlds[this.gameState.selectedWorldIndex()]);

  
  get screenScale() {
      return Math.max(0.4, Math.min(1.0, window.innerWidth / 1000));
  }

  
  public maxHealth = signal<number>(100);

  public currentHealth = signal<number>(100);

  public damageFlash = signal<boolean>(false);

  public reviveCount = 0;

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


  // Abilities
  public tapCooldown = signal<number>(0);

  public holdCooldown = signal<number>(0);

  public hasRebirthed = false;

  private lastClickTime = 0;

  private pauseClickCount = 0;

  public cheatPrepared = signal<boolean>(false);

  
  private lastUpdateTime = Date.now();

  private tapAbilityEndTime = 0;

  private holdAbilityEndTime = 0;

  
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

  private runner!: Matter.Runner;

  private playerBody!: Matter.Body;

  
  private timerInterval: any;


  private attackInterval: any;

  private enemies: Matter.Body[] = [];

  private items: Matter.Body[] = [];


  // Listeners bound
  private boundKeyDown = this.onKeyDown.bind(this);

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
    document.addEventListener('visibilitychange', this.boundVisibility);
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
          
          if (this.battleTimer() > 0 && this.battleTimer() % 60 === 0) {
              this.mlAi.pushGlobalWeights();
          }
          
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
          
          if (this.gameState.currentGameMode() === 'ai_vs_ai' && this.gameState.sessionPlayTime() % 60 === 0) {
              this.mlAi.pushGlobalWeights();
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


  private initPhysics() {
    const Engine = Matter.Engine,
          Runner = Matter.Runner,
          Bodies = Matter.Bodies,
          Composite = Matter.Composite;

    this.engine = Engine.create({ gravity: { x: 0, y: 0 } });
    
    // Speed up physics engine if running natively on a mobile device
    if (Capacitor.isNativePlatform()) {
        this.engine.timing.timeScale = 1.35;
    }

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

            if (this.gameState.isDrilling()) {
                this.damageEnemy(otherBody, this.gameState.currentStats().burstDamage * 3);
                this.triggerImpactEffect(otherBody.position.x, otherBody.position.y, false);
                continue; // Skip player taking damage while drilling
            }
            this.takeDamage(data.type === 'boss' || data.type === 'enemy_phoenix' ? 50 : 10);
            
            // Knockback logic
            const force = Matter.Vector.sub(this.playerBody.position, otherBody.position);
            const normalized = Matter.Vector.normalise(force);
            if (data.type !== 'boss') {
                Matter.Body.applyForce(otherBody, otherBody.position, Matter.Vector.mult(normalized, -0.05));
            }
          } else if (otherBody.label === 'projectile' && (data.type === 'projectile_enemy' || data.type === 'projectile_player' || data.type === 'annihilation_fire' || data.type === 'fire' || data.type === 'aura')) {
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
            } else if (data.type === 'fire' || data.type === 'projectile_player' || data.type === 'aura') {
                this.takeDamage(data.burstDamage || 10);
            } else {
                this.takeDamage(10);
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
            this.items = this.items.filter(i => i !== otherBody);
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
                this.items = this.items.filter(i => i !== itemBody);
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

            if (projData.type !== 'aura') { 
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
            this.damageEnemy(other, damage);
          } else if (other.label === 'projectile') {
              const pData = projectile.plugin['data'] as EnemyData;
              const oData = other.plugin['data'] as EnemyData;
              
              if (pData && oData && pData.owner && oData.owner && pData.owner !== oData.owner) {
                  const destructible = ['fire', 'projectile_player', 'projectile_enemy'];
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
    Matter.Events.on(this.engine, 'beforeUpdate', () => {
      // Hard pause (pause menu / tab hidden): freeze everything.
      if (this.gameState.isPaused()) { this.lastUpdateTime = Date.now(); return; }
      const now = Date.now();
      const delta = Math.min(0.1, (now - this.lastUpdateTime) / 1000); // exact real-time delta
      this.lastUpdateTime = now;
      
      // Cooldowns
      if (now > this.tapAbilityEndTime) {
          this.tapCooldown.update(c => Math.max(0, c - delta));
      }
      if (now > this.holdAbilityEndTime) {
          this.holdCooldown.update(c => Math.max(0, c - delta));
      }

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
          const mouseSpeed = 3.0 * ai2SpeedMult;
          const currentMouse = this.gameState.ai2MousePos();
          
          let threatX = 0, threatY = 0;
          let minDist = Infinity;
          const allBodies = Matter.Composite.allBodies(this.engine.world);
          for (let b of allBodies) {
              if (b.label === 'projectile' && b.plugin['data']?.type === 'projectile_enemy') {
                  const distToProj = Matter.Vector.magnitude(Matter.Vector.sub(this.playerBody.position, b.position));
                  if (distToProj < minDist) {
                      minDist = distToProj;
                      threatX = b.position.x;
                      threatY = b.position.y;
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
          }

          // Auto-fire (Normal projectiles)
          if ((!this.holdAbilityEndTime || now >= this.holdAbilityEndTime) && now - this.lastClickTime > (1500 / (this.gameState.currentStats().attackSpeed || 1))) {
              this.lastClickTime = now;
              this.fireProjectile();
          }
      }

      // 2. Track Hold-Still for the hold ability.
      // Player presses and holds WITHOUT moving; a charge ring fills; at full charge the ability
      // fires and the ring flashes "release". Moving the finger (>10px) cancels the charge so the
      // player can keep flying normally.
      const HOLD_CHARGE_MS = 3000;
      if (this.isMouseHeld && !this.isDead() && !this.gameState.isPaused() && !this.gameState.isRebirthing()) {
        const dist = Math.hypot(this.mouseX - this.holdStartX, this.mouseY - this.holdStartY);
        const holdAbility = this.gameState.currentStats().activeHoldAbility;
        if (dist > 10 || !holdAbility || this.holdCooldown() > 0) {
            // Finger moved (normal flight) OR no hold ability OR on cooldown -> no charge.
            this.holdStartX = this.mouseX;
            this.holdStartY = this.mouseY;
            this.holdTimer = 0;
            if (this.holdChargeProgress() !== 0) this.holdChargeProgress.set(0);
        } else {
            this.holdTimer += delta * 1000;
            this.holdChargeProgress.set(Math.min(1, this.holdTimer / HOLD_CHARGE_MS));
            this.holdChargePos.set({ x: this.mouseX, y: this.mouseY });
            if (this.holdTimer >= HOLD_CHARGE_MS) {
                const cd = this.triggerAbility(holdAbility, this.playerBody, this.mouseX, this.mouseY, this.gameState.currentStats(), 'player');
                if (cd > 0) this.holdCooldown.set(cd);
                this.holdTimer = 0;
                this.holdChargeProgress.set(0);
            }
        }
      } else if (this.holdChargeProgress() !== 0) {
        this.holdChargeProgress.set(0);
      }

      // 3. Update enemies
      this.enemies.forEach(enemy => {
        const force = Matter.Vector.sub(this.playerBody.position, enemy.position);
        const normalized = Matter.Vector.normalise(force);
        
        const data = enemy.plugin['data'] as EnemyData;
        if (!data) return;

        let moveSpeed = 0.00025;
        if (data.type === 'bat') moveSpeed = 0.0005;
        if (data.type === 'slime') moveSpeed = 0.00012;
        if (data.type === 'golem') {
            moveSpeed = 0.00005;
            // Golem Ranged Attack
            if (now - (data.lastAttackTime || 0) > 3000) {
                data.lastAttackTime = now;
                this.fireEnemyProjectile(enemy.position);
            }
        }
        if (data.type === 'boss') {
            moveSpeed = this.rageModeActive() ? 0.0005 : 0.0002; // Much faster
            
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
            moveSpeed *= (1 + intensity);

            // Strict Bounds Checking for Boss
            if (enemy.position.x < 100) Matter.Body.setPosition(enemy, { x: 100, y: enemy.position.y });
            if (enemy.position.x > window.innerWidth - 100) Matter.Body.setPosition(enemy, { x: window.innerWidth - 100, y: enemy.position.y });
            if (enemy.position.y < 100) Matter.Body.setPosition(enemy, { x: enemy.position.x, y: 100 });
            if (enemy.position.y > window.innerHeight - 100) Matter.Body.setPosition(enemy, { x: enemy.position.x, y: window.innerHeight - 100 });
        }
        if (data.type === 'enemy_phoenix') {
            // During the entrance the AI is flown in by the entrance RAF override; skip its
            // combat brain (no targeting, no firing, no movement forces) until intro ends.
            if (this.entranceActive()) return;
            const aiSpeedMult = this.battleAi.ai1.stats?.speed || 1;
            const mouseSpeed = 3.0 * aiSpeedMult; 
            const currentMouse = this.gameState.aiMousePos();
            
            let threatX = 0, threatY = 0;
            let minDist = Infinity;
            let inDanger = false;
            const allBodies = Matter.Composite.allBodies(this.engine.world);
            for (let b of allBodies) {
                if (b.label === 'projectile' && b.plugin['data']?.type === 'projectile_player') {
                    const distToProj = Matter.Vector.magnitude(Matter.Vector.sub(enemy.position, b.position));
                    if (distToProj < minDist) {
                        minDist = distToProj;
                        threatX = b.position.x;
                        threatY = b.position.y;
                    }
                    if (distToProj < 120) {
                        inDanger = true;
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
        
        // Delta-time scaled enemy forces for consistent cross-device behavior
        const dtScale = delta / (1 / 60); // Normalize to 60fps baseline
        Matter.Body.applyForce(enemy, enemy.position, Matter.Vector.mult(normalized, moveSpeed * dtScale));
      });

      // 4. Magnetism for items
      const magnetRadius = 150 * this.gameState.currentStats().magnetism;
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
             const activeRadius = (isXpOrb ? 300 : 150) * this.gameState.currentStats().magnetism;
             let targetPos = this.playerBody.position;
             
             if (this.gameState.currentGameMode() === 'ai_vs_ai') {
                 const enemyPhoenix = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
                 if (enemyPhoenix) {
                     const distToPlayer = Matter.Vector.magnitude(Matter.Vector.sub(this.playerBody.position, item.position));
                     const distToEnemy = Matter.Vector.magnitude(Matter.Vector.sub(enemyPhoenix.position, item.position));
                     if (distToEnemy < distToPlayer) targetPos = enemyPhoenix.position;
                 }
             }
             
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
                      if (minDist < 600) {
                          const force = Matter.Vector.sub(nearest.position, body.position);
                          const normalized = Matter.Vector.normalise(force);
                          // Capped linear scaling for stable physics
                          const pullStrength = 0.00003 + (0.000015 * Math.min(homingLvl, 50));
                          Matter.Body.applyForce(body, body.position, Matter.Vector.mult(normalized, pullStrength));
                      }
                  } else if (data && data.type === 'annihilation_fire') {
                      // Homing onto player
                      const force = Matter.Vector.sub(this.playerBody.position, body.position);
                      const normalized = Matter.Vector.normalise(force);
                      Matter.Body.applyForce(body, body.position, Matter.Vector.mult(normalized, 0.0002));
                  }
              }
          });
      }

      // 4.6 Cleanup off-screen items
      this.items = this.items.filter(item => {
          if (item.position.y > window.innerHeight + 200) {
              if (item.parent) Matter.Composite.remove(this.engine.world, item);
              return false;
          }
          return true;
      });

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
                     ownerId: data.ownerId
                 });
             }
         }
      });
      // Deduplicate by ID
const uniqueEntities = Array.from(new Map(entities.map(e => [e.id, e])).values());
      this.gameState.activeEntities.set(uniqueEntities);
    });

    this.runner = Runner.create();
    Runner.run(this.runner, this.engine);
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
                      this.lastUpdateTime = Date.now();
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
      
      let tap = tapAbilities.length > 0 ? tapAbilities[Math.floor(Math.random() * tapAbilities.length)] : 'burst';
      let hold = holdAbilities.length > 0 ? holdAbilities[Math.floor(Math.random() * holdAbilities.length)] : 'aura';
      
      this.battleAi.ai1.abilities = [tap, hold];
      
      const playerTapLevel = playerStats.activeTapAbility ? (playerStats.unlockedAbilities[playerStats.activeTapAbility]?.level || 1) : 1;
      const playerHoldLevel = playerStats.activeHoldAbility ? (playerStats.unlockedAbilities[playerStats.activeHoldAbility]?.level || 1) : 1;
      const avgPlayerLevel = Math.max(1, Math.floor((playerTapLevel + playerHoldLevel) / 2));
      
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
      
      this.battleAi.ai2.abilities = [tap, hold];
      
      const playerTapLevel = playerStats.activeTapAbility ? (playerStats.unlockedAbilities[playerStats.activeTapAbility]?.level || 1) : 1;
      const playerHoldLevel = playerStats.activeHoldAbility ? (playerStats.unlockedAbilities[playerStats.activeHoldAbility]?.level || 1) : 1;
      const avgPlayerLevel = Math.max(1, Math.floor((playerTapLevel + playerHoldLevel) / 2));
      
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
      this.battleAi.ai2.lastTapTime = 0;
      this.battleAi.ai2.lastHoldTime = 0;
      this.lastClickTime = 0;
      this.holdAbilityEndTime = 0;
      this.tapCooldown.set(0);
      this.holdCooldown.set(0);
      this.battleAi.ai2.tapCooldown = 0;
      this.battleAi.ai2.holdCooldown = 0;
  }


  private getNextDropTime(index: number): number {
      if (index < 5) return (index + 1) * 60; // 1m, 2m, 3m, 4m, 5m
      if (index < 8) return 300 + (index - 4) * 90; // 6:30, 8:00, 9:30
      return 570 + (index - 7) * 120; // 11:30, 13:30, ...
  }


  getTapIcon() { return ABILITIES[this.gameState.currentStats().activeTapAbility || 'burst']?.icon || '💥'; }

  getHoldIcon() { return ABILITIES[this.gameState.currentStats().activeHoldAbility || 'aura']?.icon || '🌀'; }


  getTapMaxCooldown() {
      const id = this.gameState.currentStats().activeTapAbility || 'burst';
      const abilityData = this.gameState.worldUpgrades()[this.gameState.selectedWorldIndex()]?.unlockedAbilities[id];
      const mod = abilityData?.modifiers?.['cooldown'] || 1.0;
      if (id === 'drill_attack') return 3 * mod; 
      if (id === 'fire_breath') return 8 * mod;  
      return 5 * mod; // burst
  }


  getHoldMaxCooldown() {
      const id = this.gameState.currentStats().activeHoldAbility || 'aura';
      const abilityData = this.gameState.worldUpgrades()[this.gameState.selectedWorldIndex()]?.unlockedAbilities[id];
      const mod = abilityData?.modifiers?.['cooldown'] || 1.0;
      if (id === 'phoenix_turret') return 10 * mod;
      if (id === 'rebirth') return 60 * mod; // 60s cooldown for Rebirth
      return 15 * mod; // aura
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
      this.enemies = [boss];
      
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
          Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, 15));
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
          Matter.Body.setVelocity(proj, Matter.Vector.mult(dir, 8));
          Matter.Composite.add(this.engine.world, proj);
          
          setTimeout(() => {
              if (proj.parent) {
                  Matter.Body.setVelocity(proj, { x: 0, y: 0 }); // Pause
                  setTimeout(() => {
                      if (proj.parent) {
                          const boss = this.enemies.find(e => e.plugin['data']?.type === 'boss');
                          if (boss) {
                              const returnDir = Matter.Vector.normalise(Matter.Vector.sub(boss.position, proj.position));
                              Matter.Body.setVelocity(proj, Matter.Vector.mult(returnDir, 12));
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


  private damageEnemy(enemy: Matter.Body, damage: number) {
    const data = enemy.plugin['data'] as EnemyData;
    if (data.immortalUntil && Date.now() < data.immortalUntil) return;
    data.health -= damage;
    
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
      this.enemies = this.enemies.filter(e => e !== enemy);
      
      if (this.gameState.currentGameMode() === 'ai_vs_ai') {
          this.mlAi.addReward(2);
      }
      
      // Award XP
      let xp = 0;
      if (data.type === 'slime') xp = 2;
      if (data.type === 'bat') xp = 5;
      if (data.type === 'golem') xp = 20;
      if (data.type === 'boss') xp = 500;
      this.gameState.addXp(xp);
      
      // Bestiary Unlock
      if (!this.gameState.unlockedEnemies().includes(data.type) && ['slime', 'bat', 'golem', 'boss'].includes(data.type)) {
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
        this.enemies = this.enemies.filter(e => e !== enemy);
        
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
        } else {
            if (Math.random() < 0.6) { // 60% chance to drop coins
                const amount = Math.floor(Math.random() * 3) + 1; // 1 to 3 coins visually
                for (let i = 0; i < amount; i++) {
                    this.spawner.dropItem(enemy.position.x + (Math.random()-0.5)*15, enemy.position.y + (Math.random()-0.5)*15, 'coin', 5, this.getSpawnerContext());
                }
            }
        }
        if (Math.random() < 0.1) { // 10% chance for a heart
            this.spawner.dropItem(enemy.position.x, enemy.position.y + 20, 'heart', 20, this.getSpawnerContext()); // Heals 20
        }
        if (!this.crateDroppedThisRun && this.gameState.pendingCratesCount() > 0 && Math.random() < 0.01) {
            this.crateDroppedThisRun = true;
            this.spawner.dropItem(enemy.position.x, enemy.position.y, 'crate', 1, this.getSpawnerContext());
        }
      }
    } else {
      // Hit sound removed permanently
    }
  }



  private takeDamage(amount: number) {
    if (this.isDead() || this.gameEnded() || this.gameState.isRebirthing() || this.gameState.isPaused() || this.entranceActive()) return;
    if (Date.now() < this.gameState.immortalUntil) return;
    
    if (this.gameState.hasCelestialShield() && this.celestialShieldActive()) {
        this.celestialShieldActive.set(false);
        // Hit sound removed permanently
        setTimeout(() => this.celestialShieldActive.set(true), 30000);
        return;
    }
    
    if (this.gameState.isDrilling()) {
        amount *= 0.1;
    }

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
                 if (dist < radius) this.damageEnemy(e, this.gameState.currentStats().damage * 10);
             });
             
             this.audioService.playSFX('explosion');
             
             // Volcanic fire rebirth particles
             for (let i = 0; i < 30; i++) {
                 const angle = (i / 30) * Math.PI * 2;
                 const speed = 8 + Math.random() * 8;
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
      this.triggerDeathSequence();
    }
  }


  private startReviveCountdown() {
      if (this.reviveInterval) clearInterval(this.reviveInterval);
      this.reviveInterval = setInterval(() => {
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


  public reviveWithAd() {
    // Pause the countdown while ad plays
    clearInterval(this.reviveInterval);
    
    const win = window as any;
    if (typeof win.adBreak === 'function') {
        win.adBreak({
            type: 'reward',
            name: 'revive_ad',
            beforeReward: (showAdFn: any) => { showAdFn(); },
            adViewed: () => {
                this.executeRevival();
            },
            adDismissed: () => {
                // User skipped ad, resume countdown
                this.startReviveCountdown();
            },
            beforeAd: () => {
                this.audioService.pauseAudioForAd();
            },
            afterAd: () => {
                this.audioService.resumeAudioAfterAd();
            }
        });
    } else {
        console.warn("Google AdSense adBreak API not found. Mocking ad watch...");
        // Mock 2 second ad watch
        this.audioService.pauseAudioForAd();
        
        setTimeout(() => {
            this.audioService.resumeAudioAfterAd();
            
            this.executeRevival();
        }, 2000);
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
    if (this.runner && this.engine) Matter.Runner.run(this.runner, this.engine); // Unfreeze physics
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


  private clearEnemies() {
    this.enemies.forEach(e => {
        if (e.plugin['data']?.type !== 'boss') {
            Matter.Composite.remove(this.engine.world, e);
        }
    });
    this.enemies = this.enemies.filter(e => e.plugin['data']?.type === 'boss');
    this.items.forEach(i => Matter.Composite.remove(this.engine.world, i));
    this.items = [];
  }


  private winGame() {
    this.gameEnded.set(true);
    this.gameWon.set(true);
    
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
      this.clearEnemies();
      
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
              
              // 4. Restart Level fully
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
        Matter.Runner.stop(this.runner);
        this.audioService.pauseCurrentBgm();
    } else {
        Matter.Runner.run(this.runner, this.engine);
        this.audioService.resumeCurrentBgm();
    }
  }


  private onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') this.togglePause(); }

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


  private onMouseMove(event: MouseEvent) { this.updateMouseInput(event.clientX, event.clientY); }

  private onTouchMove(event: TouchEvent) { 
      event.preventDefault(); 
      if (event.touches.length > 0) this.updateMouseInput(event.touches[0].clientX, event.touches[0].clientY); 
  }

  
  private updateMouseInput(x: number, y: number) {
      if (this.gameState.isPaused() || this.gameState.isDeadMenuOpen() || this.isDead()) return;
      this.mouseX = x;
      this.mouseY = y;
  }


  private onMouseDown(event: MouseEvent) { this.handleInputStart(event.clientX, event.clientY); }

  private onTouchStart(event: TouchEvent) { 
      // Do not prevent default here, as it blocks UI clicks (like the pause button)
      if (event.touches.length > 0) this.handleInputStart(event.touches[0].clientX, event.touches[0].clientY); 
  }

  
  private handleInputStart(x: number, y: number) {
      if (this.gameState.currentGameMode() === 'ai_vs_ai') return;
      this.isMouseHeld = true;
      this.holdStartX = x;
      this.holdStartY = y;
      this.holdTimer = 0;

      const now = Date.now();
      if (now - this.lastClickTime < 300 && this.tapCooldown() <= 0 && !this.gameState.isPaused()) {
          const ability = this.gameState.currentStats().activeTapAbility;
          if (ability) {
              const cd = this.triggerAbility(ability, this.playerBody, this.mouseX, this.mouseY, this.gameState.currentStats(), 'player');
              if (cd > 0) this.tapCooldown.set(cd);
          }
      }
      this.lastClickTime = now;
  }


  private onMouseUp() { this.isMouseHeld = false; }

  private onTouchEnd() { this.isMouseHeld = false; }


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

    if (minDist > 500) return; 

    const dir = Matter.Vector.normalise(Matter.Vector.sub(nearest.position, this.playerBody.position));
    
    // Projectiles spawn EXACTLY at the player body (which is now exactly the Phoenix 3D visual position)
    const projectile = Matter.Bodies.circle(this.playerBody.position.x, this.playerBody.position.y, 8, {
      label: 'projectile',
      isSensor: true,
      plugin: {
          data: { id: Math.random().toString(), type: 'projectile_player', health: 1, maxHealth: 1, owner: 'player', burstDamage: this.gameState.currentStats().damage } as EnemyData
      }
    });

    Matter.Body.setVelocity(projectile, Matter.Vector.mult(dir, 15));
    Matter.Composite.add(this.engine.world, projectile);
    
    this.audioService.playSFX('shoot');
    setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.engine.world, projectile); }, 2000);
  }


  private fireEnemyProjectile(source: Matter.Vector) {
    // Use stale position for reaction delay (human-like ~150ms lag)
    const enemyPhoenix = this.enemies.find(e => e.plugin['data']?.type === 'enemy_phoenix');
    const eAny = enemyPhoenix as any;
    const targetPos = (eAny?.__stalePlayerPos) || this.playerBody.position;
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

    Matter.Body.setVelocity(projectile, Matter.Vector.mult(finalDir, 15));
    Matter.Composite.add(this.engine.world, projectile);
    setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.engine.world, projectile); }, 2000);
  }


  private triggerAbility(ability: string, sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      if (ownerId === 'player' && this.gameState.isRebirthing()) return 0;
      
      if (ability === 'drill_attack') return this.triggerDrillAttack(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'burst') return this.triggerBurst(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'fire_breath') return this.triggerFireBreath(sourceBody, targetX, targetY, stats, ownerId);
      else if (ability === 'phoenix_turret') return this.triggerPhoenixTurret(sourceBody, targetX, targetY, stats, ownerId);
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
      if (minDist > 500 || !nearest) return cd; 

      const ammo = Math.floor(20 * (mods['ammo'] || 1.0));
      const fireIntervalMs = 50;
      const firingDurationSec = (ammo * fireIntervalMs) / 1000;
      
      const damage = stats.damage * 0.5 * mods['damage'];
      const range = 12 * mods['range'];
      
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
                  plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: damage, ownerId: ownerId } as EnemyData }
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
      const baseCooldown = ABILITIES['phoenix_turret']?.baseCooldown || 12;
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
                  const speed = Math.random() * 8 + 4;
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
                      else this.damageEnemy(e, baseDamage * 5);
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
              
              const speed = isReturning ? 4 : (eggData.aggroTarget ? 3 : 2);
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
                                  plugin: { data: { id: Math.random().toString(), type: 'fire', health: 1, maxHealth: 1, burstDamage: baseDamage, ownerId: ownerId } as EnemyData }
                              });
                              Matter.Body.setVelocity(proj, Matter.Vector.mult(fireDir, 15));
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


  private triggerBurst(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['burst'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, damage: 1.0, count: 1.0 };
      const baseCooldown = ABILITIES['burst']?.baseCooldown || 5;
      const cd = baseCooldown * mods['cooldown'];
      const damage = (stats.damage || 10) * 1.5 * mods['damage'];
      const count = Math.max(1, Math.floor(3 * mods['count']));
      
      for(let i = 0; i < count; i++) {
          const angleOffset = (i - (count - 1)/2) * 0.15;
          const dir = Matter.Vector.normalise(Matter.Vector.sub({ x: targetX, y: targetY }, sourceBody.position));
          const rotDir = Matter.Vector.rotate(dir, angleOffset);
          
          const projectile = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, 8, {
              label: 'projectile',
              isSensor: true,
              plugin: { data: { id: Math.random().toString(), type: ownerId === 'player' ? 'projectile_player' : 'projectile_enemy', ownerId: ownerId, burstDamage: damage, health: 1, maxHealth: 1 } as EnemyData }
          });
          Matter.Body.setVelocity(projectile, Matter.Vector.mult(rotDir, 20));
          Matter.Composite.add(this.engine.world, projectile);
          setTimeout(() => { if (projectile.parent) Matter.Composite.remove(this.engine.world, projectile); }, 2000);
      }
      this.audioService.playSFX('shoot');
      return cd;
  }


  private triggerAura(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number {
      const abilityData = stats.unlockedAbilities['aura'];
      const mods = abilityData?.modifiers || { cooldown: 1.0, duration: 1.0, radius: 1.0, damage: 1.0 };
      const baseCooldown = ABILITIES['aura']?.baseCooldown || 12;
      const cd = baseCooldown * mods['cooldown'];
      
      const duration = 5000 * mods['duration'];
      const radius = 150 * mods['radius'];
      
      const aura = Matter.Bodies.circle(sourceBody.position.x, sourceBody.position.y, radius, {
          isSensor: true,
          label: 'projectile',
          plugin: { data: { id: Math.random().toString(), type: 'aura', ownerId: ownerId, burstDamage: stats.damage * 0.5 * mods['damage'], health: 1, maxHealth: 1 } as EnemyData }
      });
      
      Matter.Composite.add(this.engine.world, aura);
      this.audioService.playSFX('heal');
      
      const updateAura = () => {
          if (!aura.parent || this.isDead() || this.gameEnded()) return;
          Matter.Body.setPosition(aura, sourceBody.position);
      };
      
      Matter.Events.on(this.engine, 'beforeUpdate', updateAura);
      
      setTimeout(() => {
          if (aura.parent) Matter.Composite.remove(this.engine.world, aura);
          Matter.Events.off(this.engine, 'beforeUpdate', updateAura);
      }, duration);
      
      return cd;
  }


  private triggerDeathSequence() {
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

    if (this.runner) Matter.Runner.stop(this.runner);
    
    // Disable revive if player dies in Annihilation Phase
    if (this.annihilationModeActive()) {
        setTimeout(() => this.quitGame(), 3000);
        return;
    }
    
    // Revive mechanic logic
    this.reviveCountdown.set(10);
    this.reviveInterval = setInterval(() => {
        this.reviveCountdown.update(c => c - 1);
        if (this.reviveCountdown() <= 0) {
            clearInterval(this.reviveInterval);
            this.quitGame();
        }
    }, 1000);
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
    const numParticles = isBoss ? 30 : 10;
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
    document.removeEventListener('visibilitychange', this.boundVisibility);
    
    this.gameState.phoenixOverridePosition.set(null);
    this.gameState.activeEntities.set([]);
    
    if (this.engine) {
        Matter.Events.off(this.engine, 'beforeUpdate');
        Matter.Events.off(this.engine, 'collisionStart');
        Matter.Engine.clear(this.engine);
    }
    if (this.runner) {
        Matter.Runner.stop(this.runner);
    }
    
    this.audioService.stopIntenseBgm();
  }


  public quitGame() { 
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
