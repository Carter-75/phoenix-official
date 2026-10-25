import { Component, inject, computed, signal } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { AuthService } from '../../services/auth.service';
import { AudioService } from '../../services/audio.service';
import { WORLDS } from '../../constants/game.constants';
import { CommonModule } from '@angular/common';
import { SettingsComponent } from '../../pages/settings/settings.component';

@Component({
  selector: 'app-main-menu',
  standalone: true,
  imports: [CommonModule, SettingsComponent],
  template: `
    <!-- Global Header (Currencies & Navigation) - Fixed to screen -->
    <div class="fixed top-0 left-0 w-full p-4 md:p-6 flex flex-col md:flex-row justify-between items-start gap-4 pointer-events-none z-50 text-white">
      <div class="flex items-center gap-2 md:gap-4 w-full md:w-auto justify-center md:justify-start pointer-events-auto">
        <!-- Coins -->
        <div class="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <img src="assets/coin_icon.png" alt="Coins" class="w-6 h-6 object-contain" />
          <span class="text-xl font-bold text-orange-400">{{ gameState.coins() }}</span>
        </div>
        <!-- Gems -->
        <div class="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <img src="assets/gem_icon.png" alt="Gems" class="w-6 h-6 object-contain" />
          <span class="text-xl font-bold text-purple-400">{{ gameState.gems() }}</span>
        </div>
      </div>
      
      <!-- Navigation -->
      <div class="flex flex-wrap items-center justify-center md:justify-end gap-2 md:gap-4 w-full md:w-auto pointer-events-auto">
        <button (click)="openCodex()" class="px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-semibold transition backdrop-blur-md text-amber-400">
          Codex
        </button>
        <button (click)="openLeaderboard()" class="px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-semibold transition backdrop-blur-md text-white">
          Leaderboard
        </button>
        <button (click)="openProfile()" class="px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-semibold transition backdrop-blur-md text-white">
          {{ auth.currentUser() ? (auth.currentUser()!.isTemp ? 'Finish Signup' : auth.currentUser()!.username) : 'Sign In' }}
        </button>
        <button (click)="openShop()" class="transition hover:scale-110 active:scale-95 text-white">
          <img src="assets/shop_icon.png" alt="Shop" class="w-12 h-12 md:w-16 md:h-16 drop-shadow-xl" />
        </button>
      </div>
    </div>

    <!-- Settings Button - Fixed to bottom right -->
    <button (click)="showSettings = true" class="fixed bottom-6 right-6 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white font-bold transition pointer-events-auto z-50">
       SETTINGS ⚙️
    </button>

    <div class="fixed inset-0 w-full h-[200vh] transition-transform duration-500 ease-in-out"
         [style.transform]="activeMenuMode === 'campaign' ? 'translateY(0)' : 'translateY(-50%)'"
         (touchstart)="onTouchStart($event)"
         (touchend)="onTouchEnd($event)"
         (wheel)="onWheel($event)">
         
      <!-- Campaign Screen (top 100vh) -->
      <div class="w-full h-[100vh] relative flex flex-col items-center justify-center text-white pointer-events-none">
        
        <!-- Center Content -->
        <div class="flex flex-col items-center gap-4 pointer-events-auto transform mt-24 md:-translate-y-8 md:mt-0">
          <h1 class="text-6xl md:text-9xl font-black tracking-tighter bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,100,0,0.5)] transition-all duration-500 bg-gradient-to-b text-center"
              [ngClass]="currentWorld().textColorClass">
            PHOENIX<br/>FALL
          </h1>
          
          <!-- World Selector -->
          <div class="flex items-center gap-6 mt-4 bg-black/40 backdrop-blur-md px-6 py-3 rounded-full border border-white/10">
            <button (click)="prevWorld()" class="text-white/50 hover:text-white transition text-2xl hover:-translate-x-1">&larr;</button>
            <div class="w-48 text-center flex flex-col items-center justify-center">
              <span class="text-sm text-white/50 uppercase tracking-widest font-bold">Realm {{ currentWorld().id + 1 }}</span>
              <span class="text-xl font-black tracking-wider transition-colors duration-300 text-transparent bg-clip-text bg-gradient-to-r"
                    [ngClass]="currentWorld().textColorClass">
                {{ currentWorld().name }}
              </span>
              @if (!isWorldUnlocked()) {
                <span class="absolute -top-3 -right-6 text-xs text-orange-400 font-bold uppercase tracking-widest animate-pulse border border-orange-500/30 bg-black/50 px-2 py-1 rounded-md">Soon</span>
              }
            </div>
            <button (click)="nextWorld()" class="text-white/50 hover:text-white transition text-2xl hover:translate-x-1">&rarr;</button>
          </div>
          
          <!-- Play Button -->
          <button (click)="startGame('campaign')" 
                  class="relative group mt-8 transition-transform hover:scale-105 active:scale-95"
                  [class.opacity-50]="!isWorldUnlocked()"
                  [class.grayscale]="!isWorldUnlocked()">
            <div class="absolute inset-0 bg-white/20 rounded-full blur-2xl opacity-50 group-hover:opacity-80 transition-opacity"></div>
            <img src="assets/play_button.png" alt="Play" class="relative w-32 h-32 md:w-40 md:h-40 drop-shadow-2xl" />
            <p class="absolute -bottom-8 left-1/2 -translate-x-1/2 text-white/80 font-bold tracking-widest uppercase text-sm w-max">
              {{ isWorldUnlocked() ? 'Click to Ascend' : 'Coming Soon' }}
            </p>
          </button>
        </div>
        
        <button (click)="activeMenuMode = 'battle'" class="absolute bottom-6 animate-bounce pointer-events-auto text-white/50 hover:text-white transition group flex flex-col items-center z-10">
           <span class="text-xs uppercase tracking-widest font-bold mb-1 group-hover:text-red-400 transition-colors">Battle Mode</span>
           <span class="text-2xl group-hover:text-red-400 transition-colors">v</span>
        </button>
      </div>
      
      <!-- Battle Screen (bottom 100vh) -->
      <div class="w-full h-[100vh] relative flex flex-col items-center justify-center text-white pointer-events-none">
         <button (click)="activeMenuMode = 'campaign'" class="absolute top-6 animate-bounce pointer-events-auto text-white/50 hover:text-white transition group flex flex-col items-center z-10">
             <span class="text-2xl group-hover:text-orange-400 transition-colors">^</span>
             <span class="text-xs uppercase tracking-widest font-bold mt-1 group-hover:text-orange-400 transition-colors">Campaign</span>
         </button>
         
         <!-- Center Content for Battle Mode -->
         <div class="flex flex-col items-center gap-4 pointer-events-auto transform mt-24 md:-translate-y-8 md:mt-0">
          <h1 class="text-6xl md:text-9xl font-black tracking-tighter bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,0,0,0.5)] transition-all duration-500 bg-gradient-to-b text-center from-red-500 to-red-900">
            BATTLE<br/>MODE
          </h1>
          
          <!-- World Selector -->
          <div class="flex items-center gap-6 mt-4 bg-black/40 backdrop-blur-md px-6 py-3 rounded-full border border-red-500/20 shadow-[0_0_15px_rgba(255,0,0,0.2)]">
            <button (click)="prevBattleWorld()" class="text-red-500/50 hover:text-red-400 transition text-2xl hover:-translate-x-1">&larr;</button>
            <div class="w-48 text-center flex flex-col items-center justify-center">
              <span class="text-sm text-red-400/50 uppercase tracking-widest font-bold">Realm {{ currentBattleWorld().id + 1 }}</span>
              <span class="text-xl font-black tracking-wider transition-colors duration-300 text-transparent bg-clip-text bg-gradient-to-r"
                    [ngClass]="currentBattleWorld().textColorClass">
                {{ currentBattleWorld().name }}
              </span>
              @if (!isBattleWorldUnlocked()) {
                <span class="absolute -top-3 -right-6 text-xs text-orange-400 font-bold uppercase tracking-widest animate-pulse border border-orange-500/30 bg-black/50 px-2 py-1 rounded-md">Soon</span>
              }
            </div>
            <button (click)="nextBattleWorld()" class="text-red-500/50 hover:text-red-400 transition text-2xl hover:translate-x-1">&rarr;</button>
          </div>
          
          <!-- Play Button -->
          <button (mousedown)="startBattleHold()" (mouseup)="endBattleHold()" (mouseleave)="endBattleHold()"
                  (touchstart)="startBattleHold()" (touchend)="endBattleHold()" (touchcancel)="endBattleHold()"
                  (click)="startGame('battle')" 
                  class="relative group mt-8 transition-transform hover:scale-105 active:scale-95"
                  [class.opacity-50]="!isBattleWorldUnlocked()"
                  [class.grayscale]="!isBattleWorldUnlocked()">
            <div class="absolute inset-0 bg-red-600/20 rounded-full blur-2xl opacity-50 group-hover:opacity-80 transition-opacity"></div>
            <img src="assets/play_button.png" alt="Play" class="relative w-32 h-32 md:w-40 md:h-40 drop-shadow-[0_0_30px_rgba(255,0,0,0.8)]" style="filter: hue-rotate(320deg) saturate(2)" />
            <p class="absolute -bottom-8 left-1/2 -translate-x-1/2 text-red-400 font-bold tracking-widest uppercase text-sm w-max">
              {{ isBattleWorldUnlocked() ? 'Click to Duel' : 'Coming Soon' }}
            </p>
          </button>
        </div>
      </div>
      
    </div>
    
    <!-- Settings Overlay (must be outside the sliding container) -->
    @if(showSettings) {
       <app-settings (close)="showSettings = false" class="relative z-50 pointer-events-auto"></app-settings>
    }
  `
})
export class MainMenuComponent {
  gameState = inject(GameStateService);
  auth = inject(AuthService);
  audio = inject(AudioService);

  campaignWorldIndex = signal(0);
  currentWorld = computed(() => WORLDS[this.campaignWorldIndex()]);
  isWorldUnlocked = computed(() => this.campaignWorldIndex() === 0);
  
  selectedBattleWorldIndex = signal(0);
  currentBattleWorld = computed(() => WORLDS[this.selectedBattleWorldIndex()]);
  isBattleWorldUnlocked = computed(() => this.selectedBattleWorldIndex() === 0);
  
  showSettings = false;
  activeMenuMode: 'campaign' | 'battle' | 'ai_vs_ai' = this.gameState.currentGameMode();
  
  private touchStartY = 0;
  private battleHoldTimer: any;
  private holdFired = false;

  onTouchStart(event: TouchEvent) {
    if (event.touches.length > 0) {
      this.touchStartY = event.touches[0].clientY;
    }
  }

  onTouchEnd(event: TouchEvent) {
    if (event.changedTouches.length > 0) {
      const touchEndY = event.changedTouches[0].clientY;
      const diffY = this.touchStartY - touchEndY;
      
      // Swipe Up -> Battle Mode
      if (diffY > 50 && this.activeMenuMode === 'campaign') {
        this.activeMenuMode = 'battle';
      }
      // Swipe Down -> Campaign Mode
      else if (diffY < -50 && this.activeMenuMode === 'battle') {
        this.activeMenuMode = 'campaign';
      }
    }
  }

  onWheel(event: WheelEvent) {
    if (event.deltaY > 50 && this.activeMenuMode === 'campaign') {
      this.activeMenuMode = 'battle';
    } else if (event.deltaY < -50 && this.activeMenuMode === 'battle') {
      this.activeMenuMode = 'campaign';
    }
  }

  nextWorld() {
    let idx = this.campaignWorldIndex() + 1;
    if (idx >= WORLDS.length) idx = 0;
    this.campaignWorldIndex.set(idx);
  }

  prevWorld() {
    let idx = this.campaignWorldIndex() - 1;
    if (idx < 0) idx = WORLDS.length - 1;
    this.campaignWorldIndex.set(idx);
  }

  nextBattleWorld() {
    let idx = this.selectedBattleWorldIndex() + 1;
    if (idx >= WORLDS.length) idx = 0;
    this.selectedBattleWorldIndex.set(idx);
  }

  prevBattleWorld() {
    let idx = this.selectedBattleWorldIndex() - 1;
    if (idx < 0) idx = this.gameState.worlds.length - 1;
    this.selectedBattleWorldIndex.set(idx);
  }

  openShop() {
    this.gameState.activeScreen.set('shop');
  }
  
  openProfile() {
    if (!this.auth.currentUser() || this.auth.currentUser()?.isTemp) {
      this.gameState.activeScreen.set('login');
    } else {
      this.gameState.activeScreen.set('profile');
    }
  }

  openCodex() {
    this.gameState.activeScreen.set('codex');
  }

  openLeaderboard() {
    this.gameState.activeScreen.set('leaderboard');
  }

  startBattleHold() {
    this.holdFired = false;
    this.battleHoldTimer = setTimeout(() => {
        this.holdFired = true;
        this.startGame('ai_vs_ai');
    }, 2000);
  }

  endBattleHold() {
    if (this.battleHoldTimer) {
        clearTimeout(this.battleHoldTimer);
    }
  }

  startGame(mode: 'campaign' | 'battle' | 'ai_vs_ai') {
    if (mode === 'campaign' && !this.isWorldUnlocked()) return;
    if ((mode === 'battle' || mode === 'ai_vs_ai') && !this.isBattleWorldUnlocked()) return;
    if (this.holdFired && mode === 'battle') return; // Prevent click firing after hold

    this.audio.playSFX('click');
    this.gameState.currentGameMode.set(mode);
    if (mode === 'campaign') {
        this.gameState.selectedWorldIndex.set(this.currentWorld().id);
        this.audio.playWorldBgm(this.currentWorld().id);
    } else {
        this.gameState.selectedWorldIndex.set(this.currentBattleWorld().id);
        this.audio.playIntenseBgm(this.currentBattleWorld().id);
    }
    
    // Slight delay so button sound plays before routing
    setTimeout(() => {
        this.gameState.activeScreen.set('game');
    }, 100);
  }
}
