import { Component, inject, computed, signal, effect, untracked, DestroyRef } from '@angular/core';
import { BoostIndicatorComponent, activeBoosts } from '../boost-indicator/boost-indicator.component';
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
  imports: [CommonModule, SettingsComponent, BoostIndicatorComponent],
  styles: [`
    /* Safety net: a menu screen may scroll rather than clip content. */
    .menu-screen { overflow-y: auto; }

    /* Mode switch (Fix Round 4, ADD 1): the two menu screens swap
       in place with a short fade. The shipped track carried a
       500 ms transform transition, so selecting Battle visibly
       travelled the whole menu by one full screen, which Carter
       reads on his phone as the screen scrolling down; he wants
       the screen to stay where it is. The track still positions
       the active screen with the same translateY step (the Fix
       Round 3 geometry is unchanged), but with no transition the
       frame itself never travels, and the incoming screen only
       fades in over its own frame. */
    .mode-fade { animation: modeFade 0.28s ease-out both; }
    @keyframes modeFade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .mode-fade { animation: none; }
    }

    /* Safe-area lift for the fixed menu chrome (Fix Round 3):
       the app runs edge-to-edge in the Android WebView
       (viewport-fit=cover), so plain top-0 / bottom-0 chrome sits
       inside the status-bar zone at the top and the gesture-bar
       zone at the bottom on device (Carter's phone: wallet pills
       half cut at the top edge, bottom row text cut at the bottom
       edge). The base values keep the shipped p-3 / p-4 / md
       paddings exactly; the env() term adds the device inset on
       top of them and resolves to 0 where there are no insets. */
    .menu-header { padding-top: calc(0.75rem + env(safe-area-inset-top, 0px)); }
    .menu-bottombar { padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); }
    @media (min-width: 768px) {
      .menu-header { padding-top: calc(1.25rem + env(safe-area-inset-top, 0px)); }
      .menu-bottombar { padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px)); }
    }

    /* A16 redesign surface: one ember-glass material for every menu
       panel (wallet pills, nav cluster, realm selector, mode track),
       a soft vignette over the living backdrop, and a slow pulse
       ring behind the play medallion. */
    .glass {
      background: rgba(10, 7, 12, 0.55);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.10);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .vignette {
      background: radial-gradient(ellipse 92% 66% at 50% 42%, transparent 52%, rgba(0, 0, 0, 0.52) 100%);
    }
    .play-ring {
      position: absolute; inset: -0.6rem; border-radius: 9999px;
      border: 2px solid rgba(255, 120, 40, 0.38);
      animation: playPulse 2.6s ease-out infinite;
      pointer-events: none;
    }
    .play-ring.ring-violet { border-color: rgba(167, 139, 250, 0.42); }
    .play-ring.ring-red { border-color: rgba(248, 113, 113, 0.48); }
    @keyframes playPulse {
      0% { transform: scale(0.94); opacity: 0.9; }
      70% { transform: scale(1.13); opacity: 0; }
      100% { transform: scale(1.13); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .play-ring { animation: none; opacity: 0.45; }
    }

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
      /* Short viewports keep the shipped centered-below label for
         every mode (Fix Round 4): the per-mode spots are a portrait
         treatment, and this compact layout has no room above or
         beside the smaller medallion. */
      .menu-play p { top: auto !important; bottom: -1.1rem !important; left: 50% !important; transform: translateX(-50%) !important; margin-top: 0 !important; font-size: 0.6rem !important; }

      /* Header at short heights (fix round 1 leftover): at 640x360 the
         stacked two-row header (currencies over nav) was about 130 px
         tall and its second row overlapped the top of the PHOENIX
         title. Collapse it into one compact row here, and reserve the
         space above the centred menu content so the two can never
         meet. */
      .menu-header { flex-direction: row !important; align-items: center !important; padding: calc(0.5rem + env(safe-area-inset-top, 0px)) 0.75rem 0.5rem !important; gap: 0.5rem !important; }
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
    <!-- Global Header (Currencies & Navigation) - Fixed to screen.
         A16: one ember-glass material across the wallet pills and the
         nav cluster. The shop lives in the plus buttons inside the
         currency pills (A15); there is no chest button. -->
    <div class="menu-header screen-in fixed top-0 left-0 w-full p-3 md:p-5 flex flex-col md:flex-row justify-between items-center gap-2.5 pointer-events-none z-50 text-white">
      <div class="menu-header-row flex items-center gap-2 md:gap-3 w-full md:w-auto justify-center md:justify-start pointer-events-auto">
        <!-- Coins -->
        <div class="glass flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full">
          <img src="assets/coin_icon.png" alt="Coins" class="w-6 h-6 object-contain" />
          <span class="text-lg font-black text-orange-400 tabular-nums">{{ gameState.coins() }}</span>
          <button (click)="openShopCoins()" aria-label="Open the upgrade shop" class="press w-6 h-6 rounded-full bg-orange-500 text-black text-lg font-black leading-none flex items-center justify-center hover:brightness-110 active:scale-90 transition shadow-[0_0_10px_rgba(255,77,0,0.55)]">+</button>
        </div>
        <!-- Gems -->
        <div class="glass flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full">
          <img src="assets/gem_icon.png" alt="Gems" class="w-6 h-6 object-contain" />
          <span class="text-lg font-black text-white tabular-nums">{{ gameState.gems() }}</span>
          <button (click)="openShopGems()" aria-label="Open the premium shop" class="press w-6 h-6 rounded-full bg-violet-500 text-white text-lg font-black leading-none flex items-center justify-center hover:brightness-110 active:scale-90 transition shadow-[0_0_10px_rgba(168,85,247,0.55)]">+</button>
        </div>
      </div>

      <!-- Navigation -->
      <div class="menu-header-nav glass flex items-center gap-1 p-1 rounded-full pointer-events-auto">
        <button (click)="openCodex()" class="press px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest text-white/70 hover:text-white hover:bg-white/10 transition">
          Codex
        </button>
        <button (click)="openLeaderboard()" class="press px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest text-white/70 hover:text-white hover:bg-white/10 transition">
          Leaderboard
        </button>
        <button (click)="openProfile()" class="press px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest text-white/70 hover:text-white hover:bg-white/10 transition">
          {{ auth.currentUser() ? (auth.currentUser()!.isTemp ? 'Finish Signup' : auth.currentUser()!.username) : 'Sign In' }}
        </button>
      </div>
    </div>

    <!-- Bottom bar: the boost pill (left) and SETTINGS (right) share one
         flex row, so they can never overlap each other or the mode toggle
         (playtest round 1, Bug 2: the wide free-floating pill covered
         part of SETTINGS and the Battle Mode chevron at phone widths).
         The centre of the row stays empty for the mode toggle. -->
    <div class="menu-bottombar screen-in fixed bottom-0 inset-x-0 z-50 flex items-end justify-between gap-3 p-4 md:p-6 pointer-events-none">
      <!-- Deliberate 2x boost (rewarded ad, opt-in only). While any
           boost runs, the pill turns into the live boost indicator
           (icon, multiplier, countdown, end time) and offers no ad. -->
      @if (boostActive()) {
        <div class="pointer-events-auto max-w-[60vw]" role="status">
          <app-boost-indicator></app-boost-indicator>
        </div>
      } @else {
        <button (click)="watchBoostAd()" class="press pointer-events-auto px-4 py-2 rounded-full border font-bold transition max-w-[52vw] shadow-[0_10px_30px_rgba(0,0,0,0.45)] bg-orange-500/10 border-orange-400/30 text-orange-200 hover:bg-orange-500/20">
            <span class="boost-label-full">📺 Watch Ad: 2x Coins + XP (5 min)</span>
            <span class="boost-label-short">📺 2x Boost Ad</span>
        </button>
      }

      <!-- Settings Button -->
      <button (click)="showSettings = true" class="press glass pointer-events-auto shrink-0 px-4 py-2 rounded-full text-white/60 hover:text-white font-bold transition">
         SETTINGS ⚙️
      </button>
    </div>

    <!-- Slide geometry (Fix Round 3): the track is 200% of the
         viewport height and each screen is half of it, so both
         screens tile the exact frame the fixed chrome anchors to.
         The old 200vh / 100vh units resolve against the large
         viewport on the Android WebView (system-bar areas
         included), which let the visible composition sit offset
         from the chrome's frame and read as a vertical shift when
         switching screens. Percentages of the fixed containing
         block cannot drift that way. Fix Round 4 (ADD 1): the
         track no longer transitions its transform; the 500 ms
         animated slide read as the screen scrolling down on
         Carter's phone. The step is now instant and the incoming
         screen crossfades in place (.mode-fade). -->
    <div class="fixed inset-0 w-full h-[200%]"
         [style.transform]="activeMenuMode === 'campaign' ? 'translateY(0)' : 'translateY(-50%)'">

      <!-- Campaign Screen (top half: one viewport tall) -->
      <div class="menu-screen w-full h-1/2 relative flex flex-col items-center justify-center text-white pointer-events-none" [class.mode-fade]="activeMenuMode === 'campaign'">
        <div class="vignette absolute inset-0 pointer-events-none"></div>

        <!-- Center Content -->
        <div class="menu-center relative flex flex-col items-center gap-4 pointer-events-auto transform mt-24 md:-translate-y-8 md:mt-0">
          <div class="flex flex-col items-center">
            <div class="stagger-in text-[10px] font-black uppercase tracking-[0.45em] text-orange-300/80 mb-2" style="--d: 0">Ten realms, one flame</div>
            <h1 class="menu-title stagger-in text-6xl md:text-9xl font-black tracking-tighter bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,100,0,0.5)] transition-all duration-500 bg-gradient-to-b text-center"
                [ngClass]="currentWorld().textColorClass">
              PHOENIX<br/>FALL
            </h1>
            <div class="stagger-in mt-3 flex items-center gap-2" style="--d: 0">
              <div class="h-px w-16 bg-gradient-to-r from-transparent to-orange-500/80"></div>
              <div class="w-1.5 h-1.5 rotate-45 bg-orange-400 shadow-[0_0_8px_rgba(255,120,40,0.9)]"></div>
              <div class="h-px w-16 bg-gradient-to-l from-transparent to-orange-500/80"></div>
            </div>
          </div>

          <!-- World Selector -->
          <div class="menu-selector stagger-in glass flex items-center gap-5 mt-2 px-4 py-2.5 rounded-2xl" style="--d: 1">
            <button (click)="prevWorld()" class="press w-9 h-9 shrink-0 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition text-xl hover:-translate-x-0.5">&larr;</button>
            <div class="w-48 relative text-center flex flex-col items-center justify-center">
              <span class="text-[11px] text-white/50 uppercase tracking-[0.3em] font-bold">Realm {{ currentWorld().id + 1 }}</span>
              <span class="text-xl font-black tracking-wider transition-colors duration-300 text-transparent bg-clip-text bg-gradient-to-r"
                    [ngClass]="currentWorld().textColorClass">
                {{ currentWorld().name }}
              </span>
              @if (!isWorldUnlocked()) {
                <span class="absolute -top-3 -right-6 text-xs text-orange-400 font-bold uppercase tracking-widest animate-pulse border border-orange-500/30 bg-black/50 px-2 py-1 rounded-md">Locked</span>
              }
            </div>
            <button (click)="nextWorld()" class="press w-9 h-9 shrink-0 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition text-xl hover:translate-x-0.5">&rarr;</button>
          </div>

          <!-- Mode Toggle (mode trio): ONE segmented control for
               all three modes (Fix Round 1, Part 2: Battle is a
               toggle segment like the others, not a swipe). Normal
               and Endless play the selected realm from this screen;
               Battle switches to the Battle screen below. The
               highlight is a sliding indicator behind the labels
               (UI animation pass): it glides between segments over
               300 ms instead of the background swapping instantly. -->
          <div class="stagger-in glass relative grid grid-cols-3 gap-2 mt-1 px-2 py-1.5 rounded-full" style="--d: 2">
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
            <div class="play-ring" [class.ring-violet]="campaignPlayMode() === 'endless'"></div>
            <div class="absolute inset-0 rounded-full blur-2xl opacity-50 group-hover:opacity-80 transition-opacity"
                 [ngClass]="campaignPlayMode() === 'endless' ? 'bg-violet-500/25' : 'bg-orange-500/25'"></div>
            <img src="assets/play_button.png" alt="Play" class="relative w-32 h-32 md:w-40 md:h-40"
                 [style.filter]="campaignPlayMode() === 'endless' ? 'hue-rotate(245deg) saturate(1.7) drop-shadow(0 0 30px rgba(139,92,246,0.55))' : 'drop-shadow(0 0 30px rgba(255,77,0,0.45))'" />
            <!-- Fix Round 4 (ADD 2): the label sits in a different
                 place per mode (Carter: the wording and colors
                 already read correctly; only the location never
                 changed). All three spots live in the band above
                 the medallion: Normal centered, Endless shifted
                 left, Battle (below) shifted right. The band
                 BELOW the medallion is only about 19 px tall on
                 Carter's phone between the medallion's bottom
                 edge and the bottom button row, so no below spot
                 can stay clear of both; the A4 design hung the
                 label there centered and it crowded the row.
                 Texts and colors are the A4 ones, unchanged.
                 transition-all glides the label sideways between
                 the Normal and Endless spots on this screen. -->
            <p class="absolute -top-8 left-1/2 font-bold tracking-widest uppercase text-sm w-max transition-all duration-300"
               [ngClass]="campaignPlayMode() === 'endless'
                 ? '-translate-x-[92%] text-violet-300'
                 : '-translate-x-1/2 text-orange-300'">
              {{ !isWorldUnlocked() ? unlockHint(campaignWorldIndex()) : (campaignPlayMode() === 'endless' ? 'Click to Survive' : 'Click to Ascend') }}
            </p>
          </button>
        </div>

      </div>

      <!-- Battle Screen (bottom half: one viewport tall) -->
      <div class="menu-screen w-full h-1/2 relative flex flex-col items-center justify-center text-white pointer-events-none" [class.mode-fade]="activeMenuMode === 'battle'">
         <div class="vignette absolute inset-0 pointer-events-none"></div>
         <!-- Center Content for Battle Mode -->
         <div class="menu-center relative flex flex-col items-center gap-4 pointer-events-auto transform mt-24 md:-translate-y-8 md:mt-0">
          <div class="flex flex-col items-center">
            <div class="stagger-in text-[10px] font-black uppercase tracking-[0.45em] text-red-300/80 mb-2" style="--d: 0">Face the rival phoenix</div>
            <h1 class="menu-title stagger-in text-6xl md:text-9xl font-black tracking-tighter bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,0,0,0.5)] transition-all duration-500 bg-gradient-to-b text-center from-red-500 to-red-900">
              BATTLE<br/>MODE
            </h1>
            <div class="stagger-in mt-3 flex items-center gap-2" style="--d: 0">
              <div class="h-px w-16 bg-gradient-to-r from-transparent to-red-500/80"></div>
              <div class="w-1.5 h-1.5 rotate-45 bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]"></div>
              <div class="h-px w-16 bg-gradient-to-l from-transparent to-red-500/80"></div>
            </div>
          </div>

          <!-- World Selector -->
          <div class="menu-selector stagger-in glass flex items-center gap-5 mt-2 px-4 py-2.5 rounded-2xl shadow-[0_0_15px_rgba(255,0,0,0.2)]" style="--d: 1">
            <button (click)="prevBattleWorld()" class="press w-9 h-9 shrink-0 rounded-full bg-white/5 border border-red-500/20 flex items-center justify-center text-red-400/60 hover:text-red-300 transition text-xl hover:-translate-x-0.5">&larr;</button>
            <div class="w-48 relative text-center flex flex-col items-center justify-center">
              <span class="text-[11px] text-red-400/50 uppercase tracking-[0.3em] font-bold">Realm {{ currentBattleWorld().id + 1 }}</span>
              <span class="text-xl font-black tracking-wider transition-colors duration-300 text-transparent bg-clip-text bg-gradient-to-r"
                    [ngClass]="currentBattleWorld().textColorClass">
                {{ currentBattleWorld().name }}
              </span>
              @if (!isBattleWorldUnlocked()) {
                <span class="absolute -top-3 -right-6 text-xs text-orange-400 font-bold uppercase tracking-widest animate-pulse border border-orange-500/30 bg-black/50 px-2 py-1 rounded-md">Locked</span>
              }
            </div>
            <button (click)="nextBattleWorld()" class="press w-9 h-9 shrink-0 rounded-full bg-white/5 border border-red-500/20 flex items-center justify-center text-red-400/60 hover:text-red-300 transition text-xl hover:translate-x-0.5">&rarr;</button>
          </div>

          <!-- Mode Toggle (same segmented control as the campaign
               screen): Battle is the active segment here; Normal and
               Endless switch back to the campaign screen with that
               play mode selected. Same sliding indicator (UI
               animation pass), parked on the Battle segment. -->
          <div class="stagger-in glass relative grid grid-cols-3 gap-2 mt-1 px-2 py-1.5 rounded-full" style="--d: 2">
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
            <div class="play-ring ring-red"></div>
            <div class="absolute inset-0 bg-red-600/20 rounded-full blur-2xl opacity-50 group-hover:opacity-80 transition-opacity"></div>
            <img src="assets/play_button.png" alt="Play" class="relative w-32 h-32 md:w-40 md:h-40 drop-shadow-[0_0_30px_rgba(255,0,0,0.8)]" style="filter: hue-rotate(320deg) saturate(2)" />
            <p class="absolute -top-8 left-1/2 -translate-x-[8%] text-red-400 font-bold tracking-widest uppercase text-sm w-max">
              {{ isBattleWorldUnlocked() ? 'Click to Duel' : unlockHint(selectedBattleWorldIndex()) }}
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
  private boostNow = signal(Date.now());
  private boostTimer = setInterval(() => this.boostNow.set(Date.now()), 1000);
  private boostTimerCleanup = inject(DestroyRef).onDestroy(() => clearInterval(this.boostTimer));
  boostActive = computed(() => activeBoosts(this.gameState, this.boostNow()).length > 0);

  async watchBoostAd() {
    if (this.boostActive()) return;
    const rewarded = await this.adsService.showRewarded('boost');
    if (rewarded) {
      this.gameState.grantTemporaryMultiplier('coin', 2, 5);
      this.gameState.grantTemporaryMultiplier('xp', 2, 5);
    }
  }

  // The carousels open on the shared selected realm (persisted in
  // GameStateService), so a run that chained into a new realm after a
  // boss kill returns to the menu showing that realm, not realm 1.
  campaignWorldIndex = signal(this.initialWorldIndex());
  // Mode trio: which campaign-family mode the campaign screen's
  // Play button starts for the selected realm.
  campaignPlayMode = signal<'campaign' | 'endless'>('campaign');
  currentWorld = computed(() => WORLDS[this.campaignWorldIndex()]);
  // Audit bug 1: this was hard-coded to world 0, locking every other world
  // forever. A world is playable when it is in the player's unlockedWorlds.
  isWorldUnlocked = computed(() => this.gameState.unlockedWorlds().includes(this.campaignWorldIndex()));
  
  selectedBattleWorldIndex = signal(this.initialWorldIndex());
  private initialWorldIndex(): number {
    const idx = this.gameState.selectedWorldIndex();
    return Number.isInteger(idx) && idx >= 0 && idx < WORLDS.length ? idx : 0;
  }
  currentBattleWorld = computed(() => WORLDS[this.selectedBattleWorldIndex()]);
  // Keep both pickers on the same realm the background renders
  // (gameState.selectedWorldIndex). The menu can mount before the
  // saved or server-restored realm lands, so a one-time read is not
  // enough: whenever the shared realm changes, the pickers follow.
  private readonly syncPickers = effect(() => {
    const idx = this.initialWorldIndex();
    untracked(() => {
      if (this.campaignWorldIndex() !== idx) this.campaignWorldIndex.set(idx);
      if (this.selectedBattleWorldIndex() !== idx) this.selectedBattleWorldIndex.set(idx);
    });
  });
  // Locked realms are progression gated, not unreleased: say how to unlock.
  unlockHint(index: number): string {
    const prev = this.gameState.worlds[index - 1];
    return prev ? `Locked: beat the ${prev.name} boss` : 'Locked';
  }
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

  // Shop entry (A15): the treasure chest button is gone. The coins
  // plus opens the shop on the last tab the player visited (the shop
  // restores phoenix_shop_last_tab itself, defaulting to Passives);
  // the gems plus asks for the Premium tab explicitly through the
  // one-shot phoenix_shop_open_tab request key.
  openShopCoins() {
    try { localStorage.removeItem('phoenix_shop_open_tab'); } catch { /* storage unavailable */ }
    this.gameState.activeScreen.set('shop');
  }

  openShopGems() {
    try { localStorage.setItem('phoenix_shop_open_tab', 'gems'); } catch { /* storage unavailable */ }
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
