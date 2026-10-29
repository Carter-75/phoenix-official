import { Component, inject, computed, signal } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { AuthService } from '../../services/auth.service';
import { AudioService } from '../../services/audio.service';
import { WORLDS } from '../../constants/game.constants';
import { CommonModule } from '@angular/common';
import { SettingsComponent } from '../../pages/settings/settings.component';
import { AdsService } from '../../services/ads.service';

@Component({
  selector: 'app-main-menu',
  standalone: true,
  imports: [CommonModule, SettingsComponent],
  styles: [`
    /* Safety net: a menu screen may scroll rather than clip content. */
    .menu-screen { overflow-y: auto; }

    /* Boost pill label: short form on narrow screens (Bug 2). */
    .boost-label-short { display: none; }
    @media (max-width: 560px) {
      .boost-label-full { display: none; }
      .boost-label-short { display: inline; }
    }

    /* Compact layout for short viewports (playtest round 1, Bug 1):
       landscape phones are 360 to 430 px tall, where the standard menu
       is about 500 px tall and the Play button fell off screen under
       the Battle Mode toggle. Below 540 px of height everything
       shrinks to fit with room to spare, the content centres with auto
       margins (so the scroll fallback can never clip the top), and the
       mode toggle drops into the empty centre of the bottom bar row. */
    @media (max-height: 540px) {
      .menu-center {
        margin-top: auto !important;
        margin-bottom: auto !important;
        gap: 0.35rem !important;
        transform: none !important;
      }
      .menu-title { font-size: 2rem !important; line-height: 1.05 !important; }
      .menu-selector { margin-top: 0.15rem !important; padding-top: 0.35rem !important; padding-bottom: 0.35rem !important; }
      .menu-play { margin-top: 0.35rem !important; }
      .menu-play img { width: 4.25rem !important; height: 4.25rem !important; }
      .menu-play p { bottom: -1.1rem !important; font-size: 0.6rem !important; }

      /* Header at short heights (fix round 1 leftover): at 640x360 the
         stacked two-row header (currencies over nav) was about 130 px
         tall and its second row overlapped the top of the PHOENIX
         title. Collapse it into one compact row here, and reserve the
         space above the centred menu content so the two can never
         meet. */
      .menu-header { flex-direction: row !important; align-items: center !important; padding: 0.5rem 0.75rem !important; gap: 0.5rem !important; }
      .menu-header-row { width: auto !important; justify-content: flex-start !important; gap: 0.4rem !important; }
      .menu-header-row > div { padding: 0.2rem 0.55rem !important; gap: 0.35rem !important; }
      .menu-header-row img { width: 1rem !important; height: 1rem !important; }
      .menu-header-row span { font-size: 0.95rem !important; }
      .menu-header-nav { width: auto !important; flex-wrap: nowrap !important; justify-content: flex-end !important; gap: 0.4rem !important; }
      .menu-header-nav button { padding: 0.3rem 0.6rem !important; font-size: 0.72rem !important; white-space: nowrap; }
      .menu-header-nav img { width: 2rem !important; height: 2rem !important; }
      .menu-screen { padding-top: 3.25rem; }
    }
  `],
  template: `
    <!-- Global Header (Currencies & Navigation) - Fixed to screen -->
    <div class="menu-header screen-in fixed top-0 left-0 w-full p-4 md:p-6 flex flex-col md:flex-row justify-between items-start gap-4 pointer-events-none z-50 text-white">
      <div class="menu-header-row flex items-center gap-2 md:gap-4 w-full md:w-auto justify-center md:justify-start pointer-events-auto">
        <!-- Coins -->
        <div class="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <img src="assets/coin_icon.png" alt="Coins" class="w-6 h-6 object-contain" />
          <span class="text-xl font-bold text-orange-400">{{ gameState.coins() }}</span>
        </div>
        <!-- Gems -->
        <div class="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
          <img src="assets/gem_icon.png" alt="Gems" class="w-6 h-6 object-contain" />
          <span class="text-xl font-bold text-white">{{ gameState.gems() }}</span>
        </div>
      </div>
      
      <!-- Navigation -->
      <div class="menu-header-nav flex flex-wrap items-center justify-center md:justify-end gap-2 md:gap-4 w-full md:w-auto pointer-events-auto">
        <button (click)="openCodex()" class="press px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-semibold transition backdrop-blur-md text-white">
          Codex
        </button>
        <button (click)="openLeaderboard()" class="press px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-semibold transition backdrop-blur-md text-white">
          Leaderboard
        </button>
        <button (click)="openProfile()" class="press px-3 py-1.5 md:px-4 md:py-2 text-sm md:text-base bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-semibold transition backdrop-blur-md text-white">
          {{ auth.currentUser() ? (auth.currentUser()!.isTemp ? 'Finish Signup' : auth.currentUser()!.username) : 'Sign In' }}
        </button>
        <button (click)="openShop()" class="transition hover:scale-110 active:scale-95 text-white">
          <img src="assets/shop_icon.png" alt="Shop" class="w-12 h-12 md:w-16 md:h-16 drop-shadow-xl" />
        </button>
      </div>
    </div>

    <!-- Bottom bar: the boost pill (left) and SETTINGS (right) share one
         flex row, so they can never overlap each other or the mode toggle
         (playtest round 1, Bug 2: the wide free-floating pill covered
         part of SETTINGS and the Battle Mode chevron at phone widths).
         The centre of the row stays empty for the mode toggle. -->
    <div class="screen-in fixed bottom-0 inset-x-0 z-50 flex items-end justify-between gap-3 p-4 md:p-6 pointer-events-none">
      <!-- Deliberate 2x boost (rewarded ad, opt-in only) -->
      <button (click)="watchBoostAd()" class="press pointer-events-auto px-4 py-2 rounded-full border font-bold transition max-w-[52vw]"
              [ngClass]="gameState.tempCoinMultiplier() > 1 ? 'bg-orange-500/25 border-orange-400/50 text-white' : 'bg-orange-500/10 border-orange-400/30 text-orange-200 hover:bg-orange-500/20'">
         @if (gameState.tempCoinMultiplier() > 1) {
            ⚡ 2x Boost Active
         } @else {
            <span class="boost-label-full">📺 Watch Ad: 2x Coins + XP (5 min)</span>
            <span class="boost-label-short">📺 2x Boost Ad</span>
         }
      </button>

      <!-- Settings Button -->
      <button (click)="showSettings = true" class="press pointer-events-auto shrink-0 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 hover:text-white font-bold transition">
         SETTINGS ⚙️
      </button>
    </div>

    <div class="fixed inset-0 w-full h-[200vh] transition-transform duration-500 ease-in-out"
         [style.transform]="activeMenuMode === 'campaign' ? 'translateY(0)' : 'translateY(-50%)'">
         
      <!-- Campaign Screen (top 100vh) -->
      <div class="menu-screen w-full h-[100vh] relative flex flex-col items-center justify-center text-white pointer-events-none">

        <!-- Center Content -->
        <div class="menu-center flex flex-col items-center gap-4 pointer-events-auto transform mt-24 md:-translate-y-8 md:mt-0">
          <h1 class="menu-title stagger-in text-6xl md:text-9xl font-black tracking-tighter bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,100,0,0.5)] transition-all duration-500 bg-gradient-to-b text-center"
              [ngClass]="currentWorld().textColorClass">
            PHOENIX<br/>FALL
          </h1>

          <!-- World Selector -->
          <div class="menu-selector stagger-in flex items-center gap-6 mt-4 bg-black/40 backdrop-blur-md px-6 py-3 rounded-full border border-white/10" style="--d: 1">
            <button (click)="prevWorld()" class="press text-white/50 hover:text-white transition text-2xl hover:-translate-x-1">&larr;</button>
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
            <button (click)="nextWorld()" class="press text-white/50 hover:text-white transition text-2xl hover:translate-x-1">&rarr;</button>
          </div>

          <!-- Mode Toggle (mode trio): ONE segmented control for
               all three modes (Fix Round 1, Part 2: Battle is a
               toggle segment like the others, not a swipe). Normal
               and Endless play the selected realm from this screen;
               Battle switches to the Battle screen below. The
               highlight is a sliding indicator behind the labels
               (UI animation pass): it glides between segments over
               300 ms instead of the background swapping instantly. -->
          <div class="stagger-in relative grid grid-cols-3 gap-2 mt-3 bg-black/40 backdrop-blur-md px-2 py-1.5 rounded-full border border-white/10" style="--d: 2">
            <div class="absolute top-1.5 bottom-1.5 left-2 rounded-full transition-all duration-300 ease-out"
                 style="width: calc((100% - 2rem) / 3)"
                 [style.transform]="'translateX(calc(' + (campaignPlayMode() === 'endless' ? 1 : 0) + ' * (100% + 0.5rem)))'"
                 [ngClass]="campaignPlayMode() === 'endless' ? 'bg-violet-500/80' : 'bg-orange-500/80'"></div>
            <button (click)="campaignPlayMode.set('campaign')"
                    class="relative z-10 px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase transition-colors"
                    [ngClass]="campaignPlayMode() === 'campaign' ? 'text-white' : 'text-white/50 hover:text-white'">
              Normal
            </button>
            <button (click)="campaignPlayMode.set('endless')"
                    class="relative z-10 px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase transition-colors"
                    [ngClass]="campaignPlayMode() === 'endless' ? 'text-white' : 'text-white/50 hover:text-white'">
              Endless
            </button>
            <button (click)="activeMenuMode = 'battle'"
                    class="relative z-10 px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase transition-colors text-white/50 hover:text-white">
              Battle
            </button>
          </div>

          <!-- Play Button (Fix Round 2, A4: each mode owns a
               distinct play button scheme and label color. Normal is
               fire orange, Endless is violet, Battle (below) is red.
               Before this, Normal and Endless shared the same gold
               family button and near-white label.) -->
          <button (click)="startGame(campaignPlayMode())"
                  class="menu-play stagger-in relative group mt-8 transition-transform hover:scale-105 active:scale-95" style="--d: 3"
                  [class.opacity-50]="!isWorldUnlocked()"
                  [class.grayscale]="!isWorldUnlocked()">
            <div class="absolute inset-0 rounded-full blur-2xl opacity-50 group-hover:opacity-80 transition-opacity"
                 [ngClass]="campaignPlayMode() === 'endless' ? 'bg-violet-500/25' : 'bg-orange-500/25'"></div>
            <img src="assets/play_button.png" alt="Play" class="relative w-32 h-32 md:w-40 md:h-40"
                 [style.filter]="campaignPlayMode() === 'endless' ? 'hue-rotate(245deg) saturate(1.7) drop-shadow(0 0 30px rgba(139,92,246,0.55))' : 'drop-shadow(0 0 30px rgba(255,77,0,0.45))'" />
            <p class="absolute -bottom-8 left-1/2 -translate-x-1/2 font-bold tracking-widest uppercase text-sm w-max"
               [ngClass]="campaignPlayMode() === 'endless' ? 'text-violet-300' : 'text-orange-300'">
              {{ !isWorldUnlocked() ? 'Coming Soon' : (campaignPlayMode() === 'endless' ? 'Click to Survive' : 'Click to Ascend') }}
            </p>
          </button>
        </div>

      </div>
      
      <!-- Battle Screen (bottom 100vh) -->
      <div class="menu-screen w-full h-[100vh] relative flex flex-col items-center justify-center text-white pointer-events-none">
         <!-- Center Content for Battle Mode -->
         <div class="menu-center flex flex-col items-center gap-4 pointer-events-auto transform mt-24 md:-translate-y-8 md:mt-0">
          <h1 class="menu-title stagger-in text-6xl md:text-9xl font-black tracking-tighter bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,0,0,0.5)] transition-all duration-500 bg-gradient-to-b text-center from-red-500 to-red-900">
            BATTLE<br/>MODE
          </h1>

          <!-- World Selector -->
          <div class="menu-selector stagger-in flex items-center gap-6 mt-4 bg-black/40 backdrop-blur-md px-6 py-3 rounded-full border border-red-500/20 shadow-[0_0_15px_rgba(255,0,0,0.2)]" style="--d: 1">
            <button (click)="prevBattleWorld()" class="press text-red-500/50 hover:text-red-400 transition text-2xl hover:-translate-x-1">&larr;</button>
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
            <button (click)="nextBattleWorld()" class="press text-red-500/50 hover:text-red-400 transition text-2xl hover:translate-x-1">&rarr;</button>
          </div>

          <!-- Mode Toggle (same segmented control as the campaign
               screen): Battle is the active segment here; Normal and
               Endless switch back to the campaign screen with that
               play mode selected. Same sliding indicator (UI
               animation pass), parked on the Battle segment. -->
          <div class="stagger-in relative grid grid-cols-3 gap-2 mt-3 bg-black/40 backdrop-blur-md px-2 py-1.5 rounded-full border border-red-500/20" style="--d: 2">
            <div class="absolute top-1.5 bottom-1.5 left-2 rounded-full bg-red-500/80 transition-all duration-300 ease-out"
                 style="width: calc((100% - 2rem) / 3); transform: translateX(calc(2 * (100% + 0.5rem)))"></div>
            <button (click)="campaignPlayMode.set('campaign'); activeMenuMode = 'campaign'"
                    class="relative z-10 px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase transition-colors text-white/50 hover:text-white">
              Normal
            </button>
            <button (click)="campaignPlayMode.set('endless'); activeMenuMode = 'campaign'"
                    class="relative z-10 px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase transition-colors text-white/50 hover:text-white">
              Endless
            </button>
            <button class="relative z-10 px-4 py-1 rounded-full text-xs font-black tracking-widest uppercase transition-colors text-white">
              Battle
            </button>
          </div>

          <!-- Play Button (A4: Battle's scheme is red, against
               Normal orange and Endless violet above.) -->
          <button (mousedown)="startBattleHold()" (mouseup)="endBattleHold()" (mouseleave)="endBattleHold()"
                  (touchstart)="startBattleHold()" (touchend)="endBattleHold()" (touchcancel)="endBattleHold()"
                  (click)="startGame('battle')"
                  class="menu-play stagger-in relative group mt-8 transition-transform hover:scale-105 active:scale-95" style="--d: 3"
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
  private adsService = inject(AdsService);

  // Deliberate rewarded placement (audit 6.3): the player chooses to watch
  // an ad for a 2x coins and XP boost for 5 minutes. Never damage, never
  // auto-shown. If a boost is already active, the button shows it instead.
  async watchBoostAd() {
    if (this.gameState.tempCoinMultiplier() > 1) return;
    const rewarded = await this.adsService.showRewarded('boost');
    if (rewarded) {
      this.gameState.grantTemporaryMultiplier('coin', 2, 5);
      this.gameState.grantTemporaryMultiplier('xp', 2, 5);
    }
  }

  campaignWorldIndex = signal(0);
  // Mode trio: which campaign-family mode the campaign screen's
  // Play button starts for the selected realm.
  campaignPlayMode = signal<'campaign' | 'endless'>('campaign');
  currentWorld = computed(() => WORLDS[this.campaignWorldIndex()]);
  // Audit bug 1: this was hard-coded to world 0, locking every other world
  // forever. A world is playable when it is in the player's unlockedWorlds.
  isWorldUnlocked = computed(() => this.gameState.unlockedWorlds().includes(this.campaignWorldIndex()));
  
  selectedBattleWorldIndex = signal(0);
  currentBattleWorld = computed(() => WORLDS[this.selectedBattleWorldIndex()]);
  isBattleWorldUnlocked = computed(() => this.gameState.unlockedWorlds().includes(this.selectedBattleWorldIndex()));
  
  showSettings = false;
  // Endless lives on the campaign screen (mode trio), so a return
  // from an Endless run lands on the campaign screen, not Battle.
  activeMenuMode: 'campaign' | 'battle' | 'ai_vs_ai' = (() => {
    const m = this.gameState.currentGameMode();
    return m === 'endless' ? 'campaign' : m;
  })();
  
  private battleHoldTimer: any;
  private holdFired = false;

  // Mode switching is toggle-only (Fix Round 1, Part 2): the old
  // swipe-up / swipe-down and mouse-wheel screen switching was
  // removed; the segmented Normal / Endless / Battle control on
  // both screens is the only way between them.

  nextWorld() {
    let idx = this.campaignWorldIndex() + 1;
    if (idx >= WORLDS.length) idx = 0;
    this.campaignWorldIndex.set(idx);
    // The menu bird wears the selected world's skin (per-world
    // skins): keep the shared selected-world signal in step with the
    // carousel so browsing realms reskins the bird live.
    this.gameState.selectedWorldIndex.set(idx);
  }

  prevWorld() {
    let idx = this.campaignWorldIndex() - 1;
    if (idx < 0) idx = WORLDS.length - 1;
    this.campaignWorldIndex.set(idx);
    this.gameState.selectedWorldIndex.set(idx);
  }

  nextBattleWorld() {
    let idx = this.selectedBattleWorldIndex() + 1;
    if (idx >= WORLDS.length) idx = 0;
    this.selectedBattleWorldIndex.set(idx);
    this.gameState.selectedWorldIndex.set(idx);
  }

  prevBattleWorld() {
    let idx = this.selectedBattleWorldIndex() - 1;
    if (idx < 0) idx = this.gameState.worlds.length - 1;
    this.selectedBattleWorldIndex.set(idx);
    this.gameState.selectedWorldIndex.set(idx);
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

  startGame(mode: 'campaign' | 'endless' | 'battle' | 'ai_vs_ai') {
    if ((mode === 'campaign' || mode === 'endless') && !this.isWorldUnlocked()) return;
    if ((mode === 'battle' || mode === 'ai_vs_ai') && !this.isBattleWorldUnlocked()) return;
    if (this.holdFired && mode === 'battle') return; // Prevent click firing after hold

    this.audio.playSFX('click');
    // A3: Battle's entrance scroll hold is set before the game
    // screen activates, so not even the first frames scroll.
    if (mode === 'battle' || mode === 'ai_vs_ai') this.gameState.entranceScrollHold.set(true);
    this.gameState.currentGameMode.set(mode);
    if (mode === 'campaign' || mode === 'endless') {
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
