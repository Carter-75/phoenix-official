import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, NgZone, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService, STAMINA, createMovementState } from '../../services/game-state.service';
import { phoenixSkinForWorld } from '../../components/particle-bg/particle-bg.component';
import { PhysicsEntity, WorldStats } from '../../models/game.models';
import { ABILITIES, BASE_STATS, REALM_ABILITIES } from '../../constants/game.constants';
import { PI_RULES, DROP_RULES, levelHpBonusFor, ENDLESS_ESCALATION, endlessHpScale, endlessStepAt, endlessPhaseAt } from '../../data/balance.constants';
import {
  bossDefFor, BossFightState, BOSS_ENRAGE_WARNING_SEC, BOSS_PROJECTILE_CAP,
  SHIELD_HEAL_PHASE_CAP_FRAC, SHIELD_HEAL_FIGHT_CAP_FRAC, SHIELD_MIN_HP_FRAC,
  SHIELD_MIN_SPACING_SEC, SHIELD_PHASE_MAX_SEC, SHIELD_REGEN_FRAC_PER_SEC,
  SHIELD_TELEGRAPH_SEC, SHIELD_HP_FRACTIONS,
  SIGNATURE_INTERVAL_SEC, SIGNATURE_INTERVAL_ENRAGED_SEC, bossEvent
} from '../../data/boss-rig';
import { AudioService } from '../../services/audio.service';
import { SettingsComponent } from '../settings/settings.component';
import * as Matter from 'matter-js';
import anime from 'animejs';
import { MlAiService } from '../../services/ml-ai.service';
import { BattleAiService, BattleContext } from '../../services/battle-ai.service';
import { EntitySpawnerService, SPAWN_DEFS } from '../../services/entity-spawner.service';
import { AdsService } from '../../services/ads.service';
import { EnemyData, SPARK_CELL_TYPES, STURDY_UP_TYPES, ARMORED_UP_TYPES } from './game.types';
import { HoldStillTracker } from './hold-still';
import { BossFight } from './boss-fight';
import { AbilityExecutor } from './ability-executor';
import { FxController } from './fx-controller';
import { BattleSetup } from './battle-setup';
import { contactDamageFor, impTelegraphCharge, shardCharge, mineArmedCharge, mothFuseCharge, phantomReappearCharge, wraithLockCharge, serpentCoilCharge, darterLineupCharge } from './enemy-charges';


@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, SettingsComponent],
  template: `
    <div class="fixed inset-0 z-10 w-full h-full pointer-events-none" [style.transform]="shakeTransform()">
      
      <!-- Progress Bar Overlay (Fix Round 1, Part 6: the top rail is
           width-capped so it can never run under the pause button,
           which owns the top-right corner). -->
      <div class="absolute top-4 left-1/2 -translate-x-1/2 w-[68%] max-w-2xl flex flex-col items-center gap-2 pointer-events-auto">
        @if (gameState.currentGameMode() === 'battle' || gameState.currentGameMode() === 'ai_vs_ai') {
           <span class="text-white font-bold tracking-widest uppercase drop-shadow-md text-xl">{{ gameState.currentGameMode() === 'ai_vs_ai' ? 'AI VS AI' : 'BATTLE MODE' }}</span>
           <span class="text-white/90 font-mono text-2xl font-bold">{{ formatTime(battleTimer()) }}</span>

           <span class="text-white font-bold tracking-widest uppercase drop-shadow-md mt-4">{{ rivalName() }}</span>
           <div class="hp-track relative w-full h-4 border border-white/20 rounded-full overflow-hidden shadow-[0_0_15px_rgba(255,0,0,0.2)]">
              <div class="hp-ghost absolute inset-y-0 left-0 rounded-full" [style.width]="bossGhostPercent() + '%'"></div>
              <div class="hp-fill-boss absolute inset-y-0 left-0 rounded-full" [style.width]="bossHealthPercent() + '%'"></div>
           </div>
        } @else if (gameState.currentGameMode() === 'endless') {
           <span class="text-white font-bold tracking-widest uppercase drop-shadow-md">
              ENDLESS
           </span>
           <span class="text-white/90 font-mono text-2xl font-bold">{{ formatTime(gameState.sessionPlayTime()) }}</span>
           <span class="text-white/60 font-mono text-xs tracking-widest uppercase">Escalation {{ endlessStep() + 1 }} · Kills {{ totalSessionKills() }}</span>
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
                  {{ currentWorld().bossName }} @if (bossEnraged()) { <span class="text-red-400">- ENRAGED</span> }
               </span>
               <div class="hp-track relative w-full h-3 border border-white/20 rounded-full overflow-hidden shadow-[0_0_15px_rgba(255,0,0,0.1)]">
                  <div class="hp-ghost absolute inset-y-0 left-0 rounded-full" [style.width]="bossGhostPercent() + '%'"></div>
                  <div class="hp-fill-boss absolute inset-y-0 left-0 rounded-full" [style.width]="bossHealthPercent() + '%'"></div>
               </div>
               @if (bossShieldHealth() > 0) {
               <div class="w-full h-1.5 bg-black/40 border border-white/10 rounded-full overflow-hidden">
                  <div class="h-full transition-all duration-200"
                       [style.background]="bossShieldBarColor()"
                       [style.width]="bossShieldPercent() + '%'"></div>
               </div>
               }
           }
        }
      </div>
      
      <!-- AI vs AI Scoreboard UI (raised above the bottom HUD rail,
           Fix Round 1, Part 6). -->
      @if (gameState.currentGameMode() === 'ai_vs_ai') {
          <div class="absolute bottom-44 right-4 md:right-8 flex flex-col gap-1 pointer-events-auto z-10 p-4 bg-zinc-950/70 backdrop-blur-md border border-white/10 rounded-2xl">
             <div class="text-white/80 font-bold text-xs tracking-widest uppercase mb-1 text-right">Wins</div>
             <div class="text-3xl font-black text-orange-400 drop-shadow-md text-right">{{ gameState.ai1Wins() }}</div>
          </div>
          <div class="absolute bottom-44 left-4 md:left-8 flex flex-col gap-1 pointer-events-auto z-10 p-4 bg-zinc-950/70 backdrop-blur-md border border-white/10 rounded-2xl">
             <div class="text-white/80 font-bold text-xs tracking-widest uppercase mb-1">Wins</div>
             <div class="text-3xl font-black text-red-400 drop-shadow-md">{{ gameState.ai2Wins() }}</div>
          </div>
      }

      <!-- Battle Score UI -->
      @if (gameState.currentGameMode() === 'battle') {
          <div class="absolute bottom-44 left-4 md:left-8 flex flex-col gap-1 pointer-events-auto z-10 p-4 bg-zinc-950/70 backdrop-blur-md border border-white/10 rounded-2xl">
             <div class="text-white/80 font-bold text-xs tracking-widest uppercase mb-1">Battle Stats</div>
             <div class="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500 drop-shadow-md flex items-center gap-2">
                 <span>Score:</span> <span>{{ currentBattleScore() }}</span>
             </div>
             <div class="text-lg font-bold text-orange-300 flex items-center gap-2 drop-shadow-md">
                 <img src="assets/coin_icon.png" class="w-5 h-5"/> <span>{{ gameState.coins() }}</span>
                 <span class="text-xs text-orange-400/80 ml-1">(+{{ currentBattleCoinsGained() }})</span>
             </div>
          </div>
      }
      
      <!-- Bottom HUD rail (Fix Round 1, Part 6): HP, level, status,
           and the ability buttons live in ONE stacked rail with a
           fixed layout, so no element can overlap another. The old
           centered HP cluster and the right-anchored ability row
           collided at phone widths and hid the level line behind
           the buttons. -->
      <div class="absolute bottom-0 inset-x-0 px-4 pb-4 flex flex-col gap-2 pointer-events-none">
        <!-- HP row: bar, readout, and level badge form ONE cluster
             that is positioned as a group, centered in the row so
             its margins to the two screen edges are roughly equal
             and no element is pinned to either edge. (Carter,
             Oct 28: the earlier shortening only cut the flex-1 bar
             in place and left the readout and badge right-anchored,
             splitting the cluster across the row with a hole in the
             middle. The bar keeps its shortened length here, about
             38 percent of the screen width; only the placement
             changed.) -->
        <div class="flex items-center justify-center pointer-events-auto">
          <div class="flex items-center gap-3">
            @if (gameState.currentGameMode() === 'ai_vs_ai') {
                <span class="text-white font-bold tracking-widest uppercase drop-shadow-md text-xs shrink-0">{{ rivalName() }}</span>
            }
            <div class="hp-track relative h-3.5 border border-white/15 rounded-full overflow-hidden shrink-0" style="width: 38vw">
               <div class="hp-ghost absolute inset-y-0 left-0 rounded-full" [style.width]="hpGhostPercent() + '%'"></div>
               <div class="hp-fill absolute inset-y-0 left-0 rounded-full"
                    [class.hp-low-pulse]="hpPercent() <= 25 && hpPercent() > 0"
                    [style.width]="hpPercent() + '%'"></div>
               <div class="absolute inset-0 bg-white/70 rounded-full pointer-events-none transition-opacity duration-200"
                    [style.opacity]="hpHitFlash() ? 0.45 : 0"></div>
            </div>
            <span class="text-red-300 font-bold text-sm shrink-0">{{ currentHealth() }} / {{ maxHealth() }}</span>
            <!-- Account level in the HUD (S6 level audit), a badge
                 inside the HP cluster where it can never be covered.
                 The max HP beside it already includes the level bonus
                 in campaign. -->
            @if (gameState.currentGameMode() === 'campaign' || gameState.currentGameMode() === 'endless') {
              <span class="shrink-0 px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/40 text-orange-300 font-black text-[11px] tracking-widest">LV {{ gameState.level() }}</span>
            }
          </div>
        </div>
        <!-- Status and abilities row: stamina and gadget status on
             the left, the four ability slots on the right. -->
        <div class="flex items-end justify-between gap-3">
          <div class="flex items-center gap-2 pointer-events-auto pb-1">
            <!-- Stamina arc (spec Section 2.5): a slim ring in the
                 skin's mid color, emptying toward the hostile color
                 as it drains. No numbers, no popups. It glows while
                 gliding (Section 2.6). -->
            @if (gameState.currentGameMode() !== 'ai_vs_ai') {
              <div class="w-9 h-9 rounded-full flex items-center justify-center transition-shadow duration-300 shrink-0"
                   [style.background]="staminaArcBackground()"
                   [style.box-shadow]="gameState.playerMovement.gliding ? '0 0 14px rgba(255,255,255,0.55)' : '0 0 6px rgba(0,0,0,0.5)'"
                   title="Stamina">
                <div class="w-6 h-6 rounded-full bg-black/70"></div>
              </div>
            }
            <!-- Defense and charge status (Stage 7 tie-in for S3's
                 signal, plus the S5 Overcharge charge). The Aegis
                 Charm pill exists only while that gadget is equipped:
                 bright, pulsing, and ringed while its one charge is
                 armed, then dimmed and struck through for the rest of
                 the run once the charge has negated its hit, so the
                 negation is never silent. The Overcharge pill shows
                 only while a charge is held, with its remaining
                 window. -->
            @if (gameState.currentGameMode() !== 'ai_vs_ai' && (gameState.currentStats().activeGadget === 'aegis_charm' || overchargeReady())) {
              @if (gameState.currentStats().activeGadget === 'aegis_charm') {
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-sm transition-all duration-300"
                     [class]="aegisShieldActive()
                       ? 'bg-orange-400/20 border-orange-300/70 shadow-[0_0_12px_rgba(255,120,40,0.55)] animate-pulse'
                       : 'bg-black/40 border-white/15 opacity-50'"
                     title="Aegis Charm: one-hit shield">
                  <span class="text-sm" [class.grayscale]="!aegisShieldActive()">🛡️</span>
                  <span class="text-[10px] font-black tracking-widest uppercase"
                        [class]="aegisShieldActive() ? 'text-orange-200' : 'text-white/50 line-through'">Aegis</span>
                </div>
              }
              @if (overchargeReady()) {
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-red-500/25 border-red-300/70 shadow-[0_0_12px_rgba(255,80,40,0.55)] backdrop-blur-sm animate-pulse"
                     title="Overcharge: your next cast ignores its cooldown">
                  <span class="text-sm">⚡</span>
                  <span class="text-[10px] font-black tracking-widest uppercase text-red-200">Overcharge</span>
                </div>
              }
            }
          </div>

          <!-- Ability slots: one uniform tile design for all four
               families, each with its family label. -->
          <div class="flex gap-2 md:gap-3 pointer-events-auto">
            <!-- Tap Ability -->
            <div class="relative w-14 h-14 md:w-16 md:h-16 bg-zinc-950/70 backdrop-blur-md border border-white/15 rounded-2xl overflow-hidden flex items-center justify-center">
              <span class="text-3xl z-10" [class.opacity-50]="tapCooldown() > 0">{{ getTapIcon() }}</span>
              <span class="absolute bottom-1 inset-x-0 z-20 text-center text-[9px] font-bold text-white/50 uppercase tracking-wider">Tap</span>
              @if (tapCooldown() > 0) {
                <div class="absolute bottom-0 left-0 w-full bg-orange-500/40 transition-all" [style.height]="(tapCooldown() / getTapMaxCooldown()) * 100 + '%'"></div>
                <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ tapCooldown().toFixed(1) }}</span>
              }
            </div>
            <!-- Hold Ability -->
            <div class="relative w-14 h-14 md:w-16 md:h-16 bg-zinc-950/70 backdrop-blur-md border border-white/15 rounded-2xl overflow-hidden flex items-center justify-center"
                 [class.ring-2]="holdChargeProgress() > 0" [class.ring-orange-300]="holdChargeProgress() > 0">
              <span class="text-3xl z-10" [class.opacity-50]="holdCooldown() > 0">{{ getHoldIcon() }}</span>
              <span class="absolute bottom-1 inset-x-0 z-20 text-center text-[9px] font-bold text-white/50 uppercase tracking-wider">Hold</span>
              @if (holdCooldown() > 0) {
                <div class="absolute bottom-0 left-0 w-full bg-red-500/40 transition-all" [style.height]="(holdCooldown() / getHoldMaxCooldown()) * 100 + '%'"></div>
                <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ holdCooldown().toFixed(1) }}</span>
              }
              @if (holdChargeProgress() > 0 && (holdCooldown() <= 0 || overchargeReady())) {
                <div class="absolute bottom-0 left-0 w-full bg-orange-400/40" [style.height]="holdChargeProgress() * 100 + '%'"></div>
              }
            </div>
            <!-- Double-tap slot (spec Section 3.2). -->
            <div class="relative w-14 h-14 md:w-16 md:h-16 bg-zinc-950/70 backdrop-blur-md border border-white/15 rounded-2xl overflow-hidden flex items-center justify-center">
              @if (gameState.currentStats().activeDoubleAbility) {
                <span class="text-3xl z-10" [class.opacity-50]="doubleCooldown() > 0">{{ getDoubleIcon() }}</span>
              } @else {
                <span class="text-lg font-black text-white/40 z-10">2x</span>
              }
              <span class="absolute bottom-1 inset-x-0 z-20 text-center text-[9px] font-bold text-white/50 uppercase tracking-wider">Dbl</span>
              @if (doubleCooldown() > 0) {
                <div class="absolute bottom-0 left-0 w-full bg-orange-700/40 transition-all" [style.height]="(doubleCooldown() / getDoubleMaxCooldown()) * 100 + '%'"></div>
                <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ doubleCooldown().toFixed(1) }}</span>
              }
            </div>
            <!-- Triple-tap slot (the ultimate slot, spec Section 3.2). -->
            <div class="relative w-14 h-14 md:w-16 md:h-16 bg-zinc-950/70 backdrop-blur-md border border-white/15 rounded-2xl overflow-hidden flex items-center justify-center">
              @if (gameState.currentStats().activeTripleAbility) {
                <span class="text-3xl z-10" [class.opacity-50]="tripleCooldown() > 0">{{ getTripleIcon() }}</span>
              } @else {
                <span class="text-lg font-black text-white/40 z-10">3x</span>
              }
              <span class="absolute bottom-1 inset-x-0 z-20 text-center text-[9px] font-bold text-white/50 uppercase tracking-wider">Ult</span>
              @if (tripleCooldown() > 0) {
                <div class="absolute bottom-0 left-0 w-full bg-red-700/50 transition-all" [style.height]="(tripleCooldown() / getTripleMaxCooldown()) * 100 + '%'"></div>
                <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ tripleCooldown().toFixed(1) }}</span>
              }
            </div>
          </div>
        </div>
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

      <!-- Hold-charge ring anchored to the finger (fills as you hold still; flashes when ready) -->
      @if (holdChargeProgress() > 0 && (holdCooldown() <= 0 || overchargeReady())) {
        <div class="fixed pointer-events-none z-40 -translate-x-1/2 -translate-y-1/2"
             [style.left.px]="holdChargePos().x" [style.top.px]="holdChargePos().y">
          <div class="w-24 h-24 rounded-full flex items-center justify-center"
               [class.animate-ping]="holdChargeProgress() >= 1"
               [style.background]="'conic-gradient(rgba(255,77,0,0.85) ' + (holdChargeProgress()*360) + 'deg, rgba(255,255,255,0.08) 0deg)'">
            <div class="w-20 h-20 rounded-full bg-black/40 border border-orange-300/40 flex items-center justify-center">
              @if (holdChargeProgress() >= 1) {
                <span class="text-orange-200 text-[10px] font-bold uppercase tracking-widest text-center leading-tight">Release<br/>to move</span>
              } @else {
                <span class="text-orange-100/80 text-xs font-bold">{{ (holdChargeProgress()*100).toFixed(0) }}%</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Boss Warning & Rage Mode (A13: the approach banner is
           timed by the spawner at about 2 s; it no longer lingers
           for the whole fight) -->
      @if (bossWarningVisible() && !rageModeActive()) {
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
      <button (click)="togglePause()" class="press absolute top-4 right-4 md:right-8 w-11 h-11 md:w-12 md:h-12 bg-zinc-950/70 backdrop-blur-md border border-white/15 rounded-full flex items-center justify-center pointer-events-auto hover:bg-white/10 transition z-20">
        <span class="text-white font-bold text-xl">||</span>
      </button>

      <!-- Pause Screen (Fix Round 1, Part 6: a proper obsidian panel
           with the shared button system, not floating text). -->
      @if (gameState.isPaused()) {
        <div data-ui class="backdrop-in absolute inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center pointer-events-auto z-40 px-6">
          <div class="panel-in w-full max-w-xs bg-zinc-950/90 border border-white/10 rounded-3xl p-6 flex flex-col items-center shadow-2xl">
            <h2 (click)="onPauseTextClick()"
                class="text-4xl font-black mb-6 tracking-widest cursor-pointer select-none transition-all duration-300"
                [class.text-red-500]="cheatPrepared()"
                [class.drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]]="cheatPrepared()"
                [class.text-white]="!cheatPrepared()"
                [class.drop-shadow-lg]="!cheatPrepared()">PAUSED</h2>

            <div class="flex flex-col gap-3 w-full">
              <button (click)="togglePause()" class="btn-sheen w-full py-3.5 bg-gradient-to-r from-orange-500 to-red-600 hover:brightness-110 active:scale-95 rounded-2xl text-white font-bold text-lg transition shadow-lg shadow-orange-900/40">
                Resume
              </button>
              <button (click)="showSettings = true" class="press w-full py-3.5 bg-white/5 hover:bg-white/10 border border-white/15 rounded-2xl text-white font-bold text-lg transition">
                Settings
              </button>
              @if (gameState.currentGameMode() === 'ai_vs_ai') {
                  <button (click)="mlAi.downloadWeights()" class="press w-full py-3.5 bg-white/5 hover:bg-white/10 border border-orange-500/40 rounded-2xl text-white font-bold text-lg transition">
                    Download AI Weights
                  </button>
              }
              <button (click)="quitFromPause()" class="press w-full py-3.5 bg-transparent hover:bg-white/5 border border-transparent rounded-2xl text-red-300/70 hover:text-red-300 font-semibold transition">
                Quit to Menu
              </button>
            </div>
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

      <!-- Death / KO Screen. Campaign and Endless open this only
           after the downed bird has fallen off the screen
           (koPanelOpen); Battle and the annihilation phase keep
           their immediate defeat panels. -->
      @if (isDead() && (gameState.currentGameMode() === 'battle' || annihilationModeActive() || koPanelOpen())) {
        <div data-ui class="backdrop-in absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-50 px-6">
          @if (!annihilationModeActive() && gameState.currentGameMode() !== 'battle') {
          <div class="panel-in w-full flex flex-col items-center">
          <h2 class="text-5xl font-black text-red-500 mb-2 drop-shadow-lg tracking-wide">KNOCKED OUT</h2>
          <p class="text-white/80 text-lg font-semibold mb-8 text-center max-w-md">Your phoenix is down. It only truly dies if you give up.</p>

              <div class="flex flex-col gap-4 w-full max-w-sm">
                <button (click)="reviveWithGems()"
                        [disabled]="adReviveInFlight || gameState.gems() < getReviveCost()"
                        [class.opacity-50]="adReviveInFlight || gameState.gems() < getReviveCost()"
                        [class.cursor-not-allowed]="adReviveInFlight || gameState.gems() < getReviveCost()"
                        class="btn-sheen press w-full py-4 bg-gradient-to-r from-orange-500 to-red-600 hover:brightness-110 border border-orange-400/50 rounded-2xl flex justify-center items-center gap-3 transition shadow-lg shadow-orange-900/40">
                  <span class="text-white font-bold text-xl">Instant Revive</span>
                  <img src="assets/gem_icon.png" class="w-6 h-6"/>
                  <span class="text-white font-bold text-xl">{{ getReviveCost() }}</span>
                </button>
                @if (adRevivesUsed < maxAdRevivesPerRun) {
                <button (click)="reviveWithAd()" [disabled]="adReviveInFlight" [class.opacity-50]="adReviveInFlight" class="press w-full mt-2 py-4 bg-white/5 hover:bg-white/10 border border-white/25 rounded-2xl flex justify-center items-center gap-3 transition">
                  <span class="text-white font-bold text-xl">Watch Ad to Revive</span>
                  <span class="text-white/60 font-semibold text-base">({{ maxAdRevivesPerRun - adRevivesUsed }} left)</span>
                  <span class="text-2xl">📺</span>
                </button>
                }
                @if (gameState.reviveTokens() > 0) {
                <button (click)="reviveWithToken()" [disabled]="adReviveInFlight" [class.opacity-50]="adReviveInFlight" class="press w-full mt-2 py-4 bg-white/5 hover:bg-white/10 border border-orange-500/40 rounded-2xl flex justify-center items-center gap-3 transition">
                  <span class="text-white font-bold text-xl">Use Revive Token</span>
                  <span class="text-white font-bold text-xl">({{ gameState.reviveTokens() }})</span>
                  <span class="text-2xl">🪶</span>
                </button>
                }
                @if (gameState.currentStats().activeHoldAbility === 'rebirth' && holdCooldown() > 0) {
                <div class="w-full mt-2 py-3 bg-white/5 border border-white/10 rounded-2xl flex justify-center items-center gap-3 opacity-60">
                  <span class="text-white font-semibold text-base">Rebirth recharging</span>
                  <span class="text-orange-300 font-mono font-bold">{{ holdCooldown() }}s</span>
                </div>
                }
                @if (gameState.currentStats().activeGadget === 'phoenix_feather' && featherUsedThisRun) {
                <div class="w-full mt-2 py-3 bg-white/5 border border-white/10 rounded-2xl flex justify-center items-center gap-3 opacity-60">
                  <span class="text-white font-semibold text-base">Phoenix Feather Charm spent</span>
                </div>
                }
                <button (click)="giveUpFromKo()" [disabled]="adReviveInFlight" [class.opacity-50]="adReviveInFlight" class="press w-full mt-4 py-4 bg-transparent hover:bg-white/5 border border-transparent rounded-2xl text-red-300/70 hover:text-red-300 font-semibold transition">
                  Give Up
                </button>
              </div>
          </div>
          } @else if (gameState.currentGameMode() === 'battle') {
          <div class="panel-in w-full flex flex-col items-center">
          <div class="w-28 h-36 bg-zinc-900 border-2 border-zinc-700 rounded-t-full flex flex-col items-center justify-center mb-6 shadow-[0_0_50px_rgba(0,0,0,1)]">
            <span class="text-5xl text-zinc-500">✝</span>
            <span class="text-zinc-500 mt-2 font-mono text-sm">R.I.P</span>
          </div>
          <h2 class="text-5xl font-black text-red-500 mb-2 drop-shadow-lg tracking-wide">YOU DIED</h2>
              <p class="text-red-500 text-xl font-bold mb-8 uppercase text-center max-w-md">The {{ rivalName() }} emerges victorious.</p>
              <div class="flex flex-col gap-4 w-full max-w-sm">
                <button (click)="quitGame()" class="press w-full mt-4 py-4 bg-red-950/60 hover:bg-red-900/50 border border-red-500/40 rounded-2xl text-white font-bold transition">
                  Accept Fate
                </button>
              </div>
          </div>
          } @else {
          <div class="panel-in w-full flex flex-col items-center">
          <div class="w-28 h-36 bg-zinc-900 border-2 border-zinc-700 rounded-t-full flex flex-col items-center justify-center mb-6 shadow-[0_0_50px_rgba(0,0,0,1)]">
            <span class="text-5xl text-zinc-500">✝</span>
            <span class="text-zinc-500 mt-2 font-mono text-sm">R.I.P</span>
          </div>
          <h2 class="text-5xl font-black text-red-500 mb-2 drop-shadow-lg tracking-wide">YOU DIED</h2>
              <p class="text-red-500 text-xl font-bold mb-8 uppercase text-center max-w-md">Your flames have been permanently extinguished.</p>
              <div class="flex flex-col gap-4 w-full max-w-sm">
                <button (click)="quitGame()" class="press w-full mt-4 py-4 bg-red-950/60 hover:bg-red-900/50 border border-red-500/40 rounded-2xl text-white font-bold transition">
                  Accept Fate
                </button>
              </div>
          </div>
          }
        </div>
      }

      <!-- Revive blast ring: an expanding shockwave drawn over the
           frozen world at the moment the returned phoenix lands its
           revive blast. Sized to the blast's minimum clear distance
           (diameter), scaled and faded by reviveBlastFx.progress. -->
      @if (reviveBlastFx(); as fx) {
        <div class="absolute rounded-full pointer-events-none z-40"
             [style.left.px]="fx.x" [style.top.px]="fx.y"
             [style.width.px]="blastDiameterPx()" [style.height.px]="blastDiameterPx()"
             [style.transform]="'translate(-50%, -50%) scale(' + (0.08 + 0.92 * fx.progress) + ')'"
             [style.opacity]="0.95 * (1 - fx.progress)"
             [style.border]="'5px solid rgba(255, 120, 30, 0.95)'"
             [style.box-shadow]="'0 0 60px 18px rgba(255, 77, 0, 0.45), inset 0 0 60px 18px rgba(255, 77, 0, 0.35)'"></div>
      }

      <!-- End Game Screen -->
      @if (gameEnded() && !isDead()) {
        <div data-ui class="backdrop-in absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto z-50 px-6">
          <div class="panel-in flex flex-col items-center">
          <h2 class="text-6xl font-black text-white mb-4 drop-shadow-lg tracking-wide" [ngClass]="gameWon() ? 'text-orange-400' : 'text-red-500'">
            {{ gameWon() ? 'VICTORY' : 'DEFEAT' }}
          </h2>
          @if (gameWon()) {
            <div class="flex items-center gap-3 mb-8 bg-orange-950/60 px-6 py-3 rounded-full border border-orange-500/40">
              <span class="text-white font-bold">Reward:</span>
              <span class="text-orange-300 font-bold text-2xl">+1</span>
              <img src="assets/gem_icon.png" class="w-8 h-8"/>
            </div>
          }
          <button (click)="quitGame()" class="btn-sheen px-8 py-3.5 bg-gradient-to-r from-orange-500 to-red-600 hover:brightness-110 active:scale-95 border border-orange-400/40 rounded-full text-white font-bold transition shadow-lg shadow-orange-900/40">
            Return to Menu
          </button>
          </div>
        </div>
      }

      <!-- Invisible Physics Container (Hidden entirely, rendered via ParticleBg) -->
      <div #physicsContainer class="absolute inset-0 w-full h-full opacity-0 pointer-events-none"></div>
    </div>
  `
})
export class GameComponent implements OnInit, OnDestroy {
  readonly battleSetup = new BattleSetup(this);
  readonly fx = new FxController(this);
  readonly abilities = new AbilityExecutor(this);

  // Template-bound battle getters: the inline template calls these
  // on the component; the logic lives in BattleSetup.
  getTapIcon() { return this.battleSetup.getTapIcon(); }
  getHoldIcon() { return this.battleSetup.getHoldIcon(); }
  getDoubleIcon() { return this.battleSetup.getDoubleIcon(); }
  getTripleIcon() { return this.battleSetup.getTripleIcon(); }
  getDoubleMaxCooldown() { return this.battleSetup.getDoubleMaxCooldown(); }
  getTripleMaxCooldown() { return this.battleSetup.getTripleMaxCooldown(); }
  getTapMaxCooldown() { return this.battleSetup.getTapMaxCooldown(); }
  getHoldMaxCooldown() { return this.battleSetup.getHoldMaxCooldown(); }


  // Template-bound FX helpers: the inline template calls these on
  // the component; the logic lives in FxController.
  public damageSpriteTop(n: { y: number, born: number }): number { return this.fx.damageSpriteTop(n); }
  public damageSpriteOpacity(n: { y: number, born: number }): number { return this.fx.damageSpriteOpacity(n); }
  public staminaArcBackground(): string { return this.fx.staminaArcBackground(); }

  // Delegating methods for the extracted executors: the playtest
  // harness reaches several of these by name on the component
  // instance (window.__phoenixS1.game) and wraps two of them
  // (triggerAbility, fireProjectile) to count casts, so the
  // component surface and its internal call routing stay exactly
  // as they were before the organization pass.
  public executeKillScreen() { return this.bossFight.executeKillScreen(); }
  public calculateBossGemDrop(realmIndex: number): number { return this.bossFight.calculateBossGemDrop(realmIndex); }
  public bossProjectileCount(): number { return this.bossFight.bossProjectileCount(); }
  public fireBossProjectile(x: number, y: number, angle: number, speedPerStep: number, damage: number = 10, radius: number = 8): boolean { return this.bossFight.fireBossProjectile(x, y, angle, speedPerStep, damage, radius); }
  public fireBossFan(x: number, y: number, bolts: number, speedPerStep: number, radius: number = 8) { return this.bossFight.fireBossFan(x, y, bolts, speedPerStep, radius); }
  public bossTelegraphShowing(): boolean { return this.bossFight.bossTelegraphShowing(); }
  public tickBossRig(boss: Matter.Body, data: EnemyData, st: BossFightState, deltaSec: number) { return this.bossFight.tickBossRig(boss, data, st, deltaSec); }
  public bossAshen(st: BossFightState): boolean { return this.bossFight.bossAshen(st); }
  public startSingularity(boss: Matter.Body, data: EnemyData, st: BossFightState) { return this.bossFight.startSingularity(boss, data, st); }
  public bossShardRingUp(st: BossFightState): boolean { return this.bossFight.bossShardRingUp(st); }
  public startSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) { return this.bossFight.startSignature(boss, data, st); }
  public fireSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) { return this.bossFight.fireSignature(boss, data, st); }
  public endSignature(st: BossFightState) { return this.bossFight.endSignature(st); }
  public tickSignature(boss: Matter.Body, data: EnemyData, st: BossFightState) { return this.bossFight.tickSignature(boss, data, st); }
  public summonBossMinions(boss: Matter.Body) { return this.bossFight.summonBossMinions(boss); }
  public bossPublishCharge(data: EnemyData): number { return this.bossFight.bossPublishCharge(data); }
  public bossPublishState(data: EnemyData): string | undefined { return this.bossFight.bossPublishState(data); }
  public bossFormFlow(st: BossFightState): number { return this.bossFight.bossFormFlow(st); }
  public bossWash(data: EnemyData): [number, number, number] | undefined { return this.bossFight.bossWash(data); }
  public fireBossWaveAttack(pos: Matter.Vector, count: number = 12, angleOffset: number = 0) { return this.bossFight.fireBossWaveAttack(pos, count, angleOffset); }
  public fireProjectile() { return this.abilities.fireProjectile(); }
  // Fix Round 2 (A7): true when any part of the body's bounds is
  // inside the visible arena. Targeted attacks (charge telegraphs
  // here; projectiles at their executor choke points) may not
  // begin while the attacker is still off-screen.
  private bodyOnScreen(body: Matter.Body): boolean {
      const b = body.bounds;
      return b.max.x > 0 && b.min.x < window.innerWidth && b.max.y > 0 && b.min.y < window.innerHeight;
  }

  public fireEnemyProjectile(source: Matter.Vector, speedPerStep: number = 7.5, targetOverride?: { x: number, y: number }) { return this.abilities.fireEnemyProjectile(source, speedPerStep, targetOverride); }
  public fireWraithBolt(source: Matter.Body) { return this.abilities.fireWraithBolt(source); }
  public fireDarterSpread(source: Matter.Body) { return this.abilities.fireDarterSpread(source); }
  public triggerAbility(ability: string, sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerAbility(ability, sourceBody, targetX, targetY, stats, ownerId); }
  public triggerDrillAttack(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerDrillAttack(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerFireBreath(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerFireBreath(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerPhoenixTurret(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerPhoenixTurret(sourceBody, targetX, targetY, stats, ownerId); }
  public aimAngle(sourceBody: Matter.Body, targetX: number, targetY: number): number { return this.abilities.aimAngle(sourceBody, targetX, targetY); }
  public spawnAbilityProjectile(opts: { x: number, y: number, radius: number, type: EnemyData['type'], moveId: string, damage: number, ownerId: string, angle: number, speedPerStep: number, lifeMs: number, extra?: Partial<EnemyData> }): Matter.Body { return this.abilities.spawnAbilityProjectile(opts); }
  public triggerBurst(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerBurst(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerPhoenixTalon(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerPhoenixTalon(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerFireDart(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerFireDart(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerSparkStorm(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerSparkStorm(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerFireLance(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerFireLance(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerMeteorRush(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerMeteorRush(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerAura(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerAura(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerPhoenixInferno(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerPhoenixInferno(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerInfernoWave(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerInfernoWave(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerPhoenixNova(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerPhoenixNova(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerSupernova(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerSupernova(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerDivineWrath(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerDivineWrath(sourceBody, targetX, targetY, stats, ownerId); }
  public spawnWrathColumn(x: number, y: number) { return this.abilities.spawnWrathColumn(x, y); }
  public triggerPhoenixSingularity(sourceBody: Matter.Body, targetX: number, targetY: number, stats: WorldStats, ownerId: string): number { return this.abilities.triggerPhoenixSingularity(sourceBody, targetX, targetY, stats, ownerId); }
  public triggerShake(trigger: string) { return this.fx.triggerShake(trigger); }
  public updateFx(nowPerf: number) { return this.fx.updateFx(nowPerf); }
  public recordDamageNumber(enemyId: string, x: number, y: number, amount: number, isBoss: boolean) { return this.fx.recordDamageNumber(enemyId, x, y, amount, isBoss); }
  public initBattleMode() { return this.battleSetup.initBattleMode(); }
  public setupAiPhoenix(isRespawn: boolean) { return this.battleSetup.setupAiPhoenix(isRespawn); }
  public setupAi2Phoenix(isRespawn: boolean) { return this.battleSetup.setupAi2Phoenix(isRespawn); }
  public resetCooldowns() { return this.battleSetup.resetCooldowns(); }
  public getNextDropTime(index: number): number { return this.battleSetup.getNextDropTime(index); }
  public buildMLState(actor: Matter.Body, target: Matter.Body | undefined, hpRatio: number, targetHpRatio: number, threatType: string): any { return this.battleSetup.buildMLState(actor, target, hpRatio, targetHpRatio, threatType); }
  public resolveBattleDrop(playerWon: boolean, px: number, py: number) { return this.battleSetup.resolveBattleDrop(playerWon, px, py); }

  readonly bossFight = new BossFight(this);

  @ViewChild('physicsContainer', { static: true }) physicsContainer!: ElementRef<HTMLDivElement>;


  public gameState = inject(GameStateService);

  public audioService = inject(AudioService);

  public mlAi = inject(MlAiService);
  private adsService = inject(AdsService);
  public battleAi = inject(BattleAiService);
  public spawner = inject(EntitySpawnerService);

  public Math = Math;

  public currentWorld = computed(() => this.gameState.worlds[this.gameState.selectedWorldIndex()]);
  // The Battle opponent's name for the selected world (Carter,
  // Oct 28, 2026): each world record carries a flush rival name
  // echoing its boss. Falls back to the old generic label if a
  // record ever lacks one.
  public rivalName = computed(() => this.currentWorld().battleRivalName ?? 'AI Phoenix');

  
  get screenScale() {
      return Math.max(0.4, Math.min(1.0, window.innerWidth / 1000));
  }

  // Logical playfield unit for speeds (playtest round 1, speed
  // consistency): the smaller viewport dimension in px. Every gameplay
  // speed is defined against it, so play feels the same on a small
  // phone, a landscape phone, and a tablet. At the 412 px reference
  // phone the factor is exactly 1 and speeds equal the historical
  // pixel values the game was tuned with.
  public get logicalUnit(): number {
      return Math.min(window.innerWidth, window.innerHeight);
  }

  public get speedScale(): number {
      return this.logicalUnit / 412;
  }

  // Convert a speed tuned on the reference phone (px per 1/60 s step,
  // the unit Matter velocities use) into the current viewport's value.
  public scaledSpeed(pxPerStepAtRef: number): number {
      return pxPerStepAtRef * this.speedScale;
  }

  
  public maxHealth = signal<number>(100);

  public currentHealth = signal<number>(100);

  // Animated HP bar state (UI animation pass): the displayed
  // percent, a trailing damage ghost that holds the pre-hit width
  // and then drains, and a brief hit flash. The ghost timer logic
  // lives in the constructor effects; the motion itself is CSS
  // (.hp-fill / .hp-ghost in styles.css).
  public hpPercent = computed(() => Math.max(0, Math.min(100, (this.currentHealth() / Math.max(1, this.maxHealth())) * 100)));
  public hpGhostPercent = signal<number>(100);
  public hpHitFlash = signal<boolean>(false);
  private hpGhostValue = 100;
  private hpLastPct = 100;
  private hpGhostTimer: ReturnType<typeof setTimeout> | null = null;
  private hpFlashTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Fix Round 2 (A13): the "World Boss Approaching" banner shows
  // for about 2 s at the spawn and then clears (it used to render
  // for the entire fight). The spawner flips this on at spawn and
  // times it out there.
  public bossWarningVisible = signal<boolean>(false);

  public bossHealth = signal<number>(1000);

  public inBossDefeatSequence = signal<boolean>(false);

  private bossDefeatTimestamp = 0;

  // Mode trio run bookkeeping (see ngOnInit): the campaign segment
  // markers for per-world Normal records, and the once-per-run
  // guard for the Endless runs counter.
  private segStartPlayTime = 0;
  private segStartKills = 0;
  private endlessRunCounted = false;

  public totalSessionKills(): number {
      return Object.values(this.gameState.sessionKills()).reduce((a, b) => a + b, 0);
  }

  public endlessStep(): number {
      return endlessStepAt(this.gameState.sessionPlayTime());
  }

  private markSegmentStart() {
      this.segStartPlayTime = this.gameState.sessionPlayTime();
      this.segStartKills = this.totalSessionKills();
  }

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
  // Stage 9 boss rig HUD state: the shield segment on the boss bar
  // (the shield and regen addendum's readability rule: the shield
  // shows as its own segment so the player can see both the shield
  // strength and the boss bar refilling behind it), and the enrage
  // flag for the bar's label.
  public bossShieldHealth = signal<number>(0);
  public bossShieldMaxHealth = signal<number>(0);
  public bossEnraged = signal<boolean>(false);
  public bossShieldPercent = computed(() => this.bossShieldMaxHealth() > 0 ? (this.bossShieldHealth() / this.bossShieldMaxHealth()) * 100 : 0);
  public bossShieldBarColor = computed(() => bossDefFor(this.gameState.selectedWorldIndex()).shieldColorHex);

  public bossHealthPercent = computed(() => (this.bossHealth() / this.bossMaxHealth()) * 100);

  // Boss bar damage ghost (UI animation pass): same trail-and-drain
  // treatment as the player bar, driven by the constructor effect.
  public bossGhostPercent = signal<number>(100);
  private bossGhostValue = 100;
  private bossGhostTimer: ReturnType<typeof setTimeout> | null = null;

  
  public showSettings = false;


  // Crate logic: none in-run since S5. The in-run subscription
  // crate drop was removed by the Section 5.6 ruling; pending
  // monthly crates open from the shop's subscription card.


  // Revive UI and the flight lore death flow (Oct 28, 2026).
  // Campaign and Endless deaths enter the down state (see
  // gameState.playerDownPhase): the bird falls, then the KO panel
  // opens with no countdown. The run ends only when the player taps
  // Give Up. Battle keeps its own defeat panel and never uses these.
  public koPanelOpen = signal<boolean>(false);

  // Polls the bird's screen position through the down phases: opens
  // the KO panel once the falling bird has fully left the screen,
  // and fires the revive blast once the returning bird reaches
  // mid-screen. One owner, created on entering the down state and
  // cleared when the run resumes or ends.
  private downWatchInterval: any = null;
  private downPhaseStartedAt = 0;
  private pendingReviveHp = 0;

  // The revive blast (balance-latitude values, recorded in
  // LORE-REVIVE.md; there was no blast before this package): the
  // damage packet is this many seconds of the player's current
  // auto-fire DPS, and regular enemies are knocked out to at least
  // this fraction of the logical unit from the bird (elites get
  // half the knockback distance). The boss takes the packet under
  // the ultimate per-cast cap and is never displaced.
  public readonly REVIVE_BLAST_DPS_SECONDS = 5;
  public readonly REVIVE_BLAST_MIN_DIST_LU = 0.55;

  // The blast ring visual: center and expansion progress (0 to 1),
  // driven by an interval in fireReviveBlast so no CSS keyframes are
  // needed. Null when no blast is showing.
  public reviveBlastFx = signal<{ x: number, y: number, progress: number } | null>(null);

  // True while a revive rewarded ad is on screen (playtest round 1,
  // Bug 4 lineage): the KO panel's other actions stay inert for the
  // whole flight of the ad. Public because the KO template binds it.
  public adReviveInFlight = false;


  // Abilities
  public tapCooldown = signal<number>(0);

  public holdCooldown = signal<number>(0);

  // Double and triple slot cooldowns (spec Section 3.2). The slots and
  // parser are live from S1; their move pools ship in S2 and S4.
  public doubleCooldown = signal<number>(0);

  public tripleCooldown = signal<number>(0);

  public hasRebirthed = false;

  public lastClickTime = 0;

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
  public dmgPending = new Map<string, { total: number, x: number, y: number, lastAdd: number, isBoss: boolean }>();
  public damageSprites = signal<Array<{ id: number, x: number, y: number, amount: number, born: number, size: number, color: string }>>([]);
  public dmgSpriteSeq = 0;
  // Effects clock: bumped every physics frame so the sprite layer and
  // the stamina arc re-render; also carries the shake transform.
  public fxNow = signal<number>(0);
  public shakeTransform = signal<string>('');
  // Every shake that actually fired, with its trigger. The allowed
  // list is SHAKE_ALLOWED_TRIGGERS; the harness asserts on this log.
  public shakeEvents: Array<{ trigger: string, at: number }> = [];
  public shakeStartPerf = 0;
  public shakeDurMs = 0;
  public shakeAmpPx = 0;
  public shakeDirX = 0;
  public shakeDirY = 0;
  // Per-frame impact-spark throttle (spec Section 4.6): spark spawns
  // beyond the per-frame allowance are dropped, oldest first, so a
  // 12-enemy death frame can never hitch the game.
  private sparkFrameStart = 0;
  private sparkFrameCount = 0;
  private static readonly SPARK_PER_FRAME_BUDGET = 90;

  private pauseClickCount = 0;

  public cheatPrepared = signal<boolean>(false);

  
  private tapAbilityEndTime = 0;

  public holdAbilityEndTime = 0;
  // S2: Meteor Rush state for the player-side cast (the rival keeps
  // its rush state on its body data; see EnemyData.meteorRushUntil).
  public meteorRushUntilMs = 0;
  public meteorRushDamageValue = 0;
  public meteorRushHitIds = new Set<string>();

  public doubleAbilityEndTime = 0;

  public tripleAbilityEndTime = 0;

  // S3: Phoenix Inferno channel end for the player (the rival keeps
  // its channel end on its body data, EnemyData.infernoUntil). While
  // the channel is live the player is braked (Feather Brake speed)
  // and the hold cooldown does not tick down.
  public playerInfernoUntil = 0;

  // S3 gadget state (spec Section 5.3): run-local, reset every run.
  // The Feather Charm fires at most once per run; the Aegis Charm's
  // one charge is armed at run start when the gadget is equipped.
  public featherUsedThisRun = false;
  public aegisShieldActive = signal<boolean>(false);

  // S5 Overcharge state (spec Section 5.4): run-local, set by the
  // Overcharge pickup. While ready, the player's next non-ultimate
  // cast ignores its cooldown (it may fire during the cooldown and
  // starts no new one); the charge is consumed by that cast and
  // expires unused after DROP_RULES.overchargeWindowMs.
  public overchargeReady = signal<boolean>(false);
  public overchargeExpiresAt = 0;

  
  // Input Tracking
  public mouseX = window.innerWidth / 2;

  public mouseY = window.innerHeight / 2;

  private isMouseHeld = false;
  // Hold-ability charge feedback (0..1) and the screen position of the charging finger.
  public holdChargeProgress = signal<number>(0);
  public holdChargePos = signal<{x: number, y: number}>({ x: 0, y: 0 });

  private holdTimer = 0;
  // Wall-clock stamp for hold-charge accumulation (Fix Round 1,
  // Part 3): the last live beforeUpdate time in the current charge
  // session; 0 means no session timing is running.
  private lastChargeStamp = 0;

  // Carter's stillness rule (Bird Rebuild): the charge accrues only
  // while the steering pointer is down and has been effectively
  // stationary for a continuous 0.5 s; the tracker owns the samples.
  private holdStill = new HoldStillTracker();


  // Matter.js
  public engine!: Matter.Engine;

  // Fixed-step physics driver (playtest round 1, speed consistency). The
  // engine is advanced in exact 1/60 s steps accumulated from wall-clock
  // time, so physics runs at the same rate on 60, 90, and 120 Hz screens.
  // Matter.Runner cannot do this: it clamps its step delta to a minimum
  // of 16.7 ms, which makes the whole world run about 2x fast at 120 Hz.
  private readonly PHYSICS_STEP_MS = 1000 / 60;
  private physicsRafId: number | null = null;
  private physicsLastTime = 0;
  private physicsAccumulator = 0;

  public playerBody!: Matter.Body;

  
  private timerInterval: any;


  private attackInterval: any;

  public enemies: Matter.Body[] = [];

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

  public annihilationInterval: any = null;

  private infiniteBurnInterval: any = null;

  public killScreenTimer = signal<number>(10);
  // S6: the overtime kill screen is deferred while a campaign
  // boss's rolled enrage is still pending (see triggerRageMode).
  public rageDeferred = false;


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

      // HP bar damage ghost (UI animation pass): when health drops,
      // the ghost keeps the pre-hit width for about 450 ms, then its
      // signal steps to the live width and the CSS transition drains
      // it. Further hits during the hold simply extend the ghost.
      // A heal to or past the ghost snaps it shut at once. The hit
      // flash rides the same drop detection.
      effect(() => {
          const pct = this.hpPercent();
          if (pct < this.hpLastPct) {
              this.hpHitFlash.set(true);
              if (this.hpFlashTimer) clearTimeout(this.hpFlashTimer);
              this.hpFlashTimer = setTimeout(() => { this.hpFlashTimer = null; this.hpHitFlash.set(false); }, 140);
          }
          this.hpLastPct = pct;
          if (pct >= this.hpGhostValue) {
              if (this.hpGhostTimer) { clearTimeout(this.hpGhostTimer); this.hpGhostTimer = null; }
              if (this.hpGhostValue !== pct) { this.hpGhostValue = pct; this.hpGhostPercent.set(pct); }
          } else if (!this.hpGhostTimer) {
              this.hpGhostTimer = setTimeout(() => {
                  this.hpGhostTimer = null;
                  this.hpGhostValue = this.hpPercent();
                  this.hpGhostPercent.set(this.hpGhostValue);
              }, 450);
          }
      });

      // Boss bar damage ghost: the same trail-and-drain on the boss
      // percent. Before any boss exists the percent is meaningless
      // (zero max), so only finite values drive the ghost.
      effect(() => {
          const pct = this.bossHealthPercent();
          if (!Number.isFinite(pct)) return;
          const clamped = Math.max(0, Math.min(100, pct));
          if (clamped >= this.bossGhostValue) {
              if (this.bossGhostTimer) { clearTimeout(this.bossGhostTimer); this.bossGhostTimer = null; }
              if (this.bossGhostValue !== clamped) { this.bossGhostValue = clamped; this.bossGhostPercent.set(clamped); }
          } else if (!this.bossGhostTimer) {
              this.bossGhostTimer = setTimeout(() => {
                  this.bossGhostTimer = null;
                  const now = this.bossHealthPercent();
                  this.bossGhostValue = Number.isFinite(now) ? Math.max(0, Math.min(100, now)) : 100;
                  this.bossGhostPercent.set(this.bossGhostValue);
              }, 450);
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
    this.bossWarningVisible.set(false);
    this.bossEnraged.set(false);
    this.bossShieldHealth.set(0);
    this.inBossDefeatSequence.set(false);
    this.gameState.isDeadMenuOpen.set(false);
    // Down state starts clean on every run init (runtime only).
    this.stopDownWatcher();
    this.koPanelOpen.set(false);
    this.gameState.playerDownPhase.set('none');
    this.reviveBlastFx.set(null);
    
    let hp = this.gameState.currentStats().maxHealth;
    // Level HP bonus (systems spec Section 6.2 ruling, adopted in
    // the design stage and confirmed NOT live by S4; wired here in
    // S6): +10 max HP per account level, capped at +200, computed
    // from the stored level at run start and never stored itself.
    // Campaign-family runs only (Normal and Endless): Battle and AI
    // vs AI replace the player's stat block with their generated
    // sheets below, which already bake their own health budgets.
    // Endless uses the player's real campaign loadout, so it takes
    // the same bonus (mode trio).
    if (this.gameState.currentGameMode() === 'campaign' || this.gameState.currentGameMode() === 'endless') {
        hp += levelHpBonusFor(this.gameState.level());
    }
    if (this.gameState.currentGameMode() === 'ai_vs_ai') hp *= 10;
    this.maxHealth.set(hp);
    this.currentHealth.set(hp);
    this.gameState.sessionPlayTime.set(0);
    this.gameState.sessionKills.set({});
    this.gameState.heartsCollected.set(0);
    // Mode trio segment tracking: a campaign run chains realms in
    // one component lifetime, so per-world Normal records measure
    // the segment (time and kills since the current world began),
    // not the whole session. Reset here and at every realm
    // transition.
    this.segStartPlayTime = 0;
    this.segStartKills = 0;
    this.endlessRunCounted = false;
    this.gameState.isRebirthing.set(false);
    this.gameState.phoenixOverridePosition.set(null);
    this.gameState.isPaused.set(false);
    this.killScreenTimer.set(10);
    this.rageModeActive.set(false);
    this.rageDeferred = false;
    this.annihilationModeActive.set(false);
    this.infiniteBurnActive.set(false);
    this.entranceActive.set(false);
    this.gameState.entranceScrollHold.set(false);
    // S3 gadget run state: the Feather Charm is unused and the Aegis
    // Charm's single charge is armed when it is the equipped gadget.
    this.featherUsedThisRun = false;
    this.playerInfernoUntil = 0;
    this.aegisShieldActive.set(this.gameState.currentStats().activeGadget === 'aegis_charm');
    // S5: no Overcharge charge carries into a new run.
    this.overchargeReady.set(false);
    this.overchargeExpiresAt = 0;
    
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
                },
                // S4: spawn the campaign boss for the selected world
                // through the production spawner (real HP law, real
                // health signals, field cleared). The scripted TTK
                // probe's seeded route: it skips the survival phase,
                // never the fight itself.
                spawnBossNow: () => {
                    this.spawner.spawnBoss(this.getSpawnerContext());
                },
                // Mode trio evidence surface: the run's mode and
                // world, the world's identity (name, skin), the live
                // record set, the Endless escalation state, the
                // field composition, and the Battle rival's applied
                // per-world scaling, all read from the game's own
                // state so the harness verifies what shipped.
                trio: () => {
                    const w = this.gameState.selectedWorldIndex();
                    const world = this.gameState.worlds[w];
                    const rival = (this.battleAi.ai1 as any)?.worldScaling || null;
                    const typeCounts: Record<string, number> = {};
                    for (const e of this.enemies) {
                        const t = e.plugin['data']?.type;
                        if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
                    }
                    return {
                        mode: this.gameState.currentGameMode(),
                        worldIndex: w,
                        worldName: world?.name,
                        skinId: world?.skinId,
                        records: JSON.parse(JSON.stringify(this.gameState.modeRecords())),
                        sessionPlayTime: this.gameState.sessionPlayTime(),
                        sessionKills: this.totalSessionKills(),
                        endless: this.gameState.currentGameMode() === 'endless' ? {
                            step: this.endlessStep(),
                            phase: +endlessPhaseAt(this.gameState.sessionPlayTime()).toFixed(3),
                            hpScale: +endlessHpScale(this.endlessStep()).toFixed(3),
                            stepSeconds: ENDLESS_ESCALATION.stepSeconds
                        } : null,
                        field: { alive: this.enemies.length, typeCounts },
                        rival: rival ? {
                            ...rival,
                            maxHealth: this.battleAi.ai1.stats.maxHealth,
                            damage: this.battleAi.ai1.stats.damage,
                            abilities: [...this.battleAi.ai1.abilities],
                            abilityLevels: Object.fromEntries(this.battleAi.ai1.abilities.map(id => [id, this.battleAi.ai1.stats.unlockedAbilities[id]?.level]))
                        } : null,
                        bossSpawned: this.bossSpawned()
                    };
                },
                // Stage 9: the boss rig's evidence surface. Returns
                // a plain snapshot of the live campaign boss's fight
                // state (fight clock, enrage roll and state, shield
                // numbers, signature state, hazard geometry, and the
                // fight's event log) so the harness verifies enrage
                // windows, shield caps, and telegraph timing from
                // the game's own records, not from screenshots.
                bossFight: () => {
                    const boss = this.enemies.find(e => e.plugin['data']?.type === 'boss');
                    const d = boss?.plugin['data'] as EnemyData | undefined;
                    const st = d?.bossState;
                    if (!boss || !d || !st) return null;
                    const sig = st.sig ? {
                        id: st.sig.id, phase: st.sig.phase,
                        startSec: +st.sig.startSec.toFixed(2), fireSec: +st.sig.fireSec.toFixed(2),
                        telegraphSec: st.sig.telegraphSec,
                        data: JSON.parse(JSON.stringify(st.sig.data))
                    } : null;
                    return {
                        worldIndex: st.worldIndex,
                        bossHp: Math.ceil(d.health), bossMaxHp: d.maxHealth,
                        bossPos: { x: Math.round(boss.position.x), y: Math.round(boss.position.y) },
                        fightSec: +st.fightSec.toFixed(2),
                        enrageAtSec: +st.enrageAtSec.toFixed(2),
                        enrageWarned: st.enrageWarned, enraged: st.enraged,
                        shieldUp: st.shieldUp, shieldHp: Math.ceil(st.shieldHp), shieldMaxHp: st.shieldMaxHp,
                        shieldTelegraph: st.shieldTelegraphStartSec >= 0,
                        healedThisFight: +st.healedThisFight.toFixed(1),
                        healedThisPhase: +st.healedThisPhase.toFixed(1),
                        phasesUsed: st.phasesUsed,
                        bossProjectiles: this.bossProjectileCount(),
                        sig,
                        events: st.events.slice()
                    };
                }
            };
            // S5 economy probes: drop a pickup of any kind at an
            // exact position through the production spawner, so the
            // seeded economy run exercises the shipped drop and
            // collection code, not a harness imitation.
            (window as any).__phoenixS5 = {
                gameState: this.gameState,
                game: this,
                dropPickup: (type: string, x: number, y: number, value: number = 1) => {
                    this.spawner.dropItem(x, y, type as any, value, this.getSpawnerContext());
                },
                itemsSnapshot: () => this.items.map(b => {
                    const d = b.plugin['data'] as any;
                    return { type: d?.type, value: d?.value, x: b.position.x, y: b.position.y };
                }),
            };
        }
    } catch (e) { /* storage unavailable: no hooks, no harm */ }
  }




  public getBattleContext(): BattleContext {
    return {
      gameState: this.gameState,
      bossMaxHealth: this.bossMaxHealth,
      bossHealth: this.bossHealth,
      maxHealth: this.maxHealth,
      currentHealth: this.currentHealth,
      enemies: this.enemies
    };
  }

  public getSpawnerContext() {

      return {
          engine: this.engine,
          enemies: this.enemies,
          items: this.items,
          gameState: this.gameState,
          audioService: this.audioService,
          screenScale: this.screenScale,
          // Endless (mode trio): the spawner's cadence curve reads
          // the escalation phase (0 to 100 inside the step) instead
          // of the campaign survival clock, so attempts quicken as
          // a step builds, then reset with the next step's heavier
          // HP scale.
          progressPercent: () => this.gameState.currentGameMode() === 'endless'
              ? endlessPhaseAt(this.gameState.sessionPlayTime()) * 100
              : this.progressPercent(),
          endlessPhase: () => this.gameState.currentGameMode() === 'endless'
              ? endlessPhaseAt(this.gameState.sessionPlayTime())
              : null,
          enemyHpScale: () => this.gameState.currentGameMode() === 'endless'
              ? endlessHpScale(this.endlessStep())
              : 1,
          gameEnded: () => this.gameEnded(),
          isDead: () => this.isDead(),
          bossSpawned: this.bossSpawned,
          bossWarningVisible: this.bossWarningVisible,
          bossMaxHealth: this.bossMaxHealth,
          bossHealth: this.bossHealth,
          bossShieldHealth: this.bossShieldHealth,
          bossShieldMaxHealth: this.bossShieldMaxHealth,
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
          
      } else if (this.gameState.currentGameMode() === 'endless') {
          // Endless (mode trio): no countdown, no boss, no overtime.
          // sessionPlayTime above is the survival clock; the
          // escalation step and phase derive from it in the spawner
          // context, and the run ends only on death (the standard
          // death and revive flow) or quit.
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
          // S6 audit fix: the trail's trickle used to write the xp
          // signal directly, bypassing addXp, so its XP accumulated
          // without ever running the level-up check (levels only
          // moved when some other grant landed). Route it through
          // the one XP path like every other grant.
          this.gameState.addXp(5);
      }
    }, 1000);

    this.spawner.scheduleNextSpawn(this.getSpawnerContext());

    const attackSpeed = this.gameState.currentStats().attackSpeed;
    this.attackInterval = setInterval(() => {
      if (this.gameEnded() || this.isDead() || this.gameState.isPaused() || this.entranceActive()) return;
      this.fireProjectile();
    }, 1000 / attackSpeed);
    
  }


  // Parked targeting publisher (Fix Round 3): the game owns the
  // enemy list and the auto-fire range gate, so it publishes the
  // nearest in-range enemy's heading angle on gameState (world
  // space, the bird physics atan2 convention, y flipped from
  // screen space); the parked branch in bird-physics owns turning
  // the heading toward it at the capped rate. Mirrors the
  // executor's range gate exactly (attackRange stat x speedScale)
  // and its body set (this.enemies), so anything that can pull the
  // parked heading is something auto-fire can reach once the cone
  // sweeps onto it. Bodies at point-blank range are skipped: no
  // meaningful direction, and contact handles them.
  private publishParkedTarget() {
    const gs = this.gameState;
    if (this.gameEnded() || this.isDead() || !this.playerBody || !this.enemies) {
      gs.parkedTargetAngle = null;
      return;
    }
    const range = gs.currentStats().attackRange * this.speedScale;
    const px = this.playerBody.position.x;
    const py = this.playerBody.position.y;
    let best: Matter.Body | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      const data = e.plugin?.data as EnemyData | undefined;
      if (data && typeof data.health === 'number' && data.health <= 0) continue;
      const dx = e.position.x - px;
      const dy = e.position.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist >= 2 && dist <= range && dist < bestDist) { best = e; bestDist = dist; }
    }
    gs.parkedTargetAngle = best
      ? Math.atan2(-(best.position.y - py), best.position.x - px)
      : null;
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

      // S6 contact granularity fix: one event can carry several
      // pairs for the same pair of bodies (the player body is a
      // compound of core plus two wings, and a large enemy can
      // touch more than one part at once). Everything in the
      // player branch below keys off the OTHER body's identity, so
      // each other body is processed at most once per event; the
      // old code ran the whole branch per pair, which is how a
      // single boss touch could call takeDamage several times
      // inside one millisecond (Stage 9 dodge-bot logs).
      const seenOtherIds = new Set<string>();
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA.parent;
        const bodyB = pairs[i].bodyB.parent;
        
        // Player taking damage
        if (bodyA.label === 'player' || bodyB.label === 'player') {
          const otherBody = bodyA.label === 'player' ? bodyB : bodyA;
          const data = otherBody.plugin['data'] as EnemyData;
          if (!data) continue;
          if (data.id) {
              if (seenOtherIds.has(data.id)) continue;
              seenOtherIds.add(data.id);
          }
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

            // Stage 5: a phased or reappearing Shroud Phantom
            // cannot hit either (design sheet 13). Contact passes
            // through it in both directions while it is out of
            // phase: no damage, no knockback.
            if (data.type === 'phantom' && data.behaviorState !== 'solid') {
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
            // S6 contact cadence: one body deals contact damage at
            // most once per 500 ms of sustained touch, matching the
            // post-hit i-frame window takeDamage already grants.
            // Before this, a body resting against the player could
            // re-trigger collisionStart on every separation jitter
            // (compound parts, knockback decay, steering blend), and
            // each re-trigger was a fresh full hit the moment the
            // i-frames lapsed mid-overlap: contact, not the boss's
            // patterns, was what killed the Stage 9 dodge-bot in
            // Worlds 1 and 4. The cadence makes one touch one hit,
            // then the player must separate and re-touch (or half a
            // second of honest contact pass) for the next.
            const nowContact = Date.now();
            if (data.lastContactAt && nowContact - data.lastContactAt < 500) continue;
            data.lastContactAt = nowContact;
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
            let contactAmount = rushContactDamage > 0 ? rushContactDamage : contactDamageFor(data);
            // Aegis Plating (spec Section 5.2, stage S5): each
            // stack subtracts 1 from contact damage taken, boss
            // contact excluded, and a hit can never drop below 1.
            // The rival's Meteor Rush replacement hit is an ability
            // hit riding this contact event, not plain contact, and
            // is not reduced.
            if (rushContactDamage <= 0 && data.type !== 'boss') {
                const stacks = this.gameState.currentStats().aegisPlating || 0;
                if (stacks > 0) contactAmount = Math.max(1, contactAmount - stacks);
            }
            this.takeDamage(contactAmount,
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
          } else if (otherBody.label === 'projectile' && (data.type === 'projectile_enemy' || data.type === 'projectile_player' || data.type === 'annihilation_fire' || data.type === 'fire' || data.type === 'aura' || data.type === 'dart' || data.type === 'talon' || data.type === 'spark' || data.type === 'lance' || data.type === 'nova')) {
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
                        // S4: an enemy-cast ultimate's hit on the
                        // player is clamped by the same per-cast cap
                        // as its hits on a boss (see clampUltDamage).
                        let dmg = data.burstDamage || 10;
                        if (data.ultCastId) dmg = this.clampUltDamage(data.ultCastId, '__player__', this.currentHealth(), dmg);
                        this.takeDamage(dmg);
                    }
                } else {
                    this.takeDamage(data.burstDamage || 10);
                }
            }
            
            if (data.type !== 'aura') {
                Matter.Composite.remove(this.engine.world, otherBody);
            }
          } else if (otherBody.label === 'item') {
            // One physical item grants once. The player body is a
            // compound of three parts (core and two wings), and an
            // item overlapping more than one part arrives as
            // several pairs in a single collision event; the item
            // is only removed at the end of this branch, so
            // without this guard a centered pickup granted up to
            // three times (measured in the S5 harness: one Spark
            // Cell refilling 150 stamina instead of its stated 50,
            // and the same over-grant on coins, gems, and hearts).
            if ((otherBody as any).__phoenixCollected) continue;
            (otherBody as any).__phoenixCollected = true;
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
            if (data.type === 'spark_cell') {
                // Spark Cell (spec Section 5.4): instant stamina
                // refill, the drop's value is the amount (50).
                this.audioService.playSFX('heal');
                this.gameState.addStamina(data.value || DROP_RULES.sparkCellStamina);
            }
            if (data.type === 'overcharge') {
                // Overcharge (spec Section 5.4): the next move cast
                // within the window ignores its cooldown. Picking up
                // a second cell while one is held only refreshes the
                // window; there is never more than one charge.
                this.audioService.playSFX('heal');
                this.overchargeReady.set(true);
                this.overchargeExpiresAt = Date.now() + DROP_RULES.overchargeWindowMs;
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
            this.damageEnemy(other, damage, projectile.position, projData.ultCastId);
          } else if (other.label === 'projectile') {
              const pData = projectile.plugin['data'] as EnemyData;
              const oData = other.plugin['data'] as EnemyData;
              
              // Stage 5: the Lance Wraith's bolt passes through the
              // player's fire (design sheet 14), so it is exempt
              // from the clash on either side of the pair.
              if (pData && oData && pData.owner && oData.owner && pData.owner !== oData.owner && pData.moveId !== 'wraith_bolt' && oData.moveId !== 'wraith_bolt') {
                  const destructible = ['fire', 'projectile_player', 'projectile_enemy', 'dart', 'talon', 'spark', 'lance', 'nova'];
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
      // The charge stamp resets too, so paused wall time is never
      // banked into the hold charge on resume (Fix Round 1, Part 3).
      if (this.gameState.isPaused()) { this.lastChargeStamp = 0; return; }
      this.publishParkedTarget();
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
              // S4: ai2's triple slot chains on its tap decision,
              // mirroring its double slot exactly.
              {
                  const triAbility = this.battleAi.ai2.abilities.find(ab => ABILITIES[ab]?.type === 'triple');
                  if (triAbility && mlAction.useTap > 0.5) {
                      const triFatigueMult = 1 + (this.battleAi.ai2.tripleFatigue || 0);
                      if (!this.battleAi.ai2.lastTripleTime || now - this.battleAi.ai2.lastTripleTime > (this.battleAi.ai2.tripleCooldown || 0) * 1000 * triFatigueMult) {
                          const cd = this.triggerAbility(triAbility, this.playerBody, mlAction.targetX, mlAction.targetY, this.battleAi.ai2.stats, 'player');
                          this.battleAi.ai2.lastTripleTime = now;
                          this.battleAi.ai2.tripleCooldown = cd;
                          this.battleAi.ai2.tripleFatigue = (this.battleAi.ai2.tripleFatigue || 0) + 0.3;
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
      // fills over 1.5 s; at full charge the ability fires. The
      // charge in exchange is the family's higher cooldowns (turret
      // 14, aura 17, rebirth 75). The Focus Charm gadget multiplies
      // the charge time by 0.75. Releasing the press, or having no
      // ready hold move, ends the session.
      //
      // Bird Rebuild (Carter's final rule, Oct 28 2026) replaces the
      // fixed-origin drift radius of Fix Round 1 Part 3: the charge
      // accrues ONLY while the steering pointer is touching AND
      // effectively stationary, and accrual begins only after 0.5 s
      // of continuous stillness. Any movement beyond the stillness
      // threshold pauses accrual (progress kept), and resuming
      // requires a fresh 0.5 s of stillness wherever the finger now
      // rests. The tracker (hold-still.ts) measures stillness as
      // path length over the trailing 0.5 s, so a slow continuous
      // drag can never charge even though each step is sub-pixel.
      // Accumulation stays wall-clock based (clamped per event, the
      // Fix Round 1 Part 3 fix), so the percent tracks real elapsed
      // time and rises continuously at any refresh rate.
      const chargeMs = 1500 * (this.gameState.currentStats().activeGadget === 'focus_charm' ? 0.75 : 1);
      if (this.isMouseHeld && !this.isDead() && !this.gameState.isPaused() && !this.gameState.isRebirthing()) {
        const holdAbility = this.gameState.currentStats().activeHoldAbility;
        // Brake and charge are mutually exclusive (spec Section 2.4):
        // holding the brake before a charge starts blocks the charge;
        // a charge already in progress takes precedence.
        // S5 Overcharge: a held charge also lets a hold move charge
        // and fire during its cooldown (see fireSlot).
        if (!holdAbility || (this.holdCooldown() > 0 && !this.overchargeActive()) || (this.rawBrakeHeld && this.holdTimer <= 0)) {
            this.holdTimer = 0;
            this.lastChargeStamp = 0;
            if (this.holdChargeProgress() !== 0) this.holdChargeProgress.set(0);
        } else {
            // Sample the live pointer position every physics tick so
            // the stillness window stays populated even when no
            // input events fire (a planted finger fires none).
            this.holdStill.sample(now, this.mouseX, this.mouseY);
            // Wall-clock accumulation: each event adds the real time
            // since the previous live event (clamped at 100 ms, so a
            // pause or hitch can never bank more than a fifteenth of
            // the charge in one step). The stamp advances whether or
            // not the pointer is still, so time spent moving is
            // never banked.
            const stepMs = this.lastChargeStamp ? Math.min(100, Math.max(0, now - this.lastChargeStamp)) : 0;
            this.lastChargeStamp = now;
            if (this.holdStill.isStill(now)) {
                this.holdTimer += stepMs;
            } else if (this.holdStill.movedBeyondBudget(now)) {
                // Fix Round 2 (A2, Carter's rule, played live on his
                // phone): moving past the stillness budget CLEARS
                // the charge to zero at once, and the indicator
                // (bound to the progress signal set below) hides.
                // The Bird Rebuild freeze-and-keep pause is gone.
                // A later stop during the SAME touch re-arms by
                // itself: isStill turns true again only after a
                // fresh 0.5 s stillness window, and accrual then
                // restarts from zero without lifting the finger.
                this.holdTimer = 0;
            }
            // While the pointer sits inside its 0.5 s arming window
            // (still, but not yet armed) the timer does not advance
            // and is not cleared: there is nothing to clear yet.
            this.holdChargeProgress.set(Math.min(1, this.holdTimer / chargeMs));
            this.holdChargePos.set({ x: this.mouseX, y: this.mouseY });
            if (this.holdTimer >= chargeMs) {
                const cd = this.triggerAbility(holdAbility, this.playerBody, this.mouseX, this.mouseY, this.gameState.currentStats(), 'player');
                if (cd > 0) {
                    // S5 Overcharge: a charged cast consumes the
                    // charge and starts no cooldown.
                    if (this.overchargeActive()) this.consumeOvercharge();
                    else this.holdCooldown.set(cd);
                }
                this.holdTimer = 0;
                this.lastChargeStamp = 0;
                this.holdChargeProgress.set(0);
            }
        }
      } else {
        this.holdTimer = 0;
        this.lastChargeStamp = 0;
        this.holdStill.release();
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
        // Stage 5 types (Section 3.3 speeds through the same halving):
        // Shroud Phantom Cruise (1.2 sheet), Lance Wraith Slow (0.6),
        // War Chanter Cruise (1.0), Loom Serpent Swift (2.0), Storm
        // Darter Cruise between passes (1.0). Their hooks below own
        // the actual motion; the caps here are the defaults.
        if (data.type === 'phantom') chaseSpeed = 0.6;
        if (data.type === 'wraith') chaseSpeed = 0.3;
        if (data.type === 'chanter') chaseSpeed = 0.5;
        if (data.type === 'serpent') chaseSpeed = 1.0;
        if (data.type === 'darter') chaseSpeed = 0.5;
        if (data.type === 'golem') {
            chaseSpeed = 0.005;
            // Golem Ranged Attack
            if (now - (data.lastAttackTime || 0) > 3000) {
                data.lastAttackTime = now;
                this.fireEnemyProjectile(enemy.position);
            }
        }
        if (data.type === 'boss') {
            // Stage 9 boss rig: advance the fight state machine
            // (enrage, shield phases, signature schedule, hazards)
            // on the fight clock before the shipped attack logic.
            const st = data.bossState;
            if (st) this.tickBossRig(enemy, data, st, delta);
            const rigEnraged = !!st?.enraged;
            chaseSpeed = this.rageModeActive() ? 0.0085 : (rigEnraged ? 0.0056 : 0.0035); // Much faster in rage; enrage scales aggression too
            
            const intensity = this.audioService.getAudioIntensity();
            
            // Audio reactive boss attacks
            // Threshold varies if rage mode is active
            const attackThreshold = (this.rageModeActive() || rigEnraged) ? 0.25 : 0.35;
            
            if (!this.annihilationModeActive() && !(st && this.bossAshen(st))) {
                if (intensity > attackThreshold && now - (data.lastAttackTime || 0) > ((this.rageModeActive() || rigEnraged) ? 3000 : 6000)) {
                    data.lastAttackTime = now;
                    this.fireBossWaveAttack(enemy.position);
                }
                
                if (intensity > attackThreshold - 0.1 && now - (data.lastMinionTime || 0) > ((this.rageModeActive() || rigEnraged) ? 2000 : 4000)) {
                    data.lastMinionTime = now;
                    this.summonBossMinions(enemy);
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
            // Final sweep (S3/S4 later-AI-pass flag, closed): the
            // rival is force-braked during its own Phoenix Inferno
            // channel and its Divine Wrath cast lock, the same
            // commitment the player pays through playerInfernoUntil.
            // Both timestamps already live on its body data; this is
            // the reader they were missing.
            aiMove.braking = minDist < 320 * this.speedScale
                || Date.now() < (data.infernoUntil || 0)
                || Date.now() < (data.wrathLockUntil || 0);
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

                // S4: the rival's triple (ultimate) slot chains on
                // its tap decision the same way, on its own body
                // clock and fatigue, through the same path. The
                // campaign gate does not apply here: Battle is not a
                // world run, and the rival's loadout comes from the
                // realm pool, as with every other family.
                const triAb = this.battleAi.ai1.abilities.find(ab => ABILITIES[ab]?.type === 'triple');
                const triFatigueMult = 1 + (this.battleAi.ai1.tripleFatigue || 0);
                if (mlAction.useTap > 0.5 && triAb && (!eAny.lastTripleAbilityTime || now >= eAny.lastTripleAbilityTime + (eAny.tripleCooldown || 0) * triFatigueMult)) {
                    const cd = this.triggerAbility(triAb, enemy, mlAction.targetX, mlAction.targetY, this.battleAi.ai1.stats, 'enemy');
                    eAny.lastTripleAbilityTime = now;
                    eAny.tripleCooldown = cd;
                    this.battleAi.ai1.tripleFatigue += 0.3;
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
        if (data.type === 'boss' && data.bossState && bossDefFor(data.bossState.worldIndex).movement === 'patrolTop') {
          // Storm Wyvern sheet: the boss flies wide arcs across the
          // top of the field rather than hovering at the player. The
          // anchor sweeps on the fight clock; the steering blend
          // below carries the body to it at a capped patrol speed.
          const LU = this.logicalUnit;
          const t = data.bossState.fightSec;
          const ax = window.innerWidth / 2 + Math.sin(t * 0.25) * window.innerWidth * 0.32;
          const ay = window.innerHeight * 0.24 + Math.sin(t * 0.7) * window.innerHeight * 0.04;
          const dx = ax - enemy.position.x;
          const dy = ay - enemy.position.y;
          const d = Math.hypot(dx, dy) || 1;
          const patrolSpeed = Math.min(0.55 * LU, d * 1.2);
          desiredX = (dx / d) * patrolSpeed;
          desiredY = (dy / d) * patrolSpeed;
          blendK = 1.5;
        }
        if (data.type === 'boss' && data.bossState) {
          // Stage 10 boss movement hooks, inside the same steering
          // model as every other hook.
          const bst = data.bossState;
          const LU = this.logicalUnit;
          if (this.bossAshen(bst)) {
            // The King's ash does not move.
            desiredX = 0; desiredY = 0; blendK = 6;
          } else if (bst.sig?.data?.dashState === 'dash') {
            // Royal Decree and the Eternal Drill: a locked-line
            // dash across the field at 2.2 LU per second, fast
            // enough to cross in about a second, slow enough that
            // the telegraphed line is a real dodge read at cruise.
            const d = bst.sig.data;
            const dx = d.dashTx - enemy.position.x;
            const dy = d.dashTy - enemy.position.y;
            const dist = Math.hypot(dx, dy) || 1;
            desiredX = (dx / dist) * 2.2 * LU;
            desiredY = (dy / dist) * 2.2 * LU;
            blendK = 10;
          } else if (bst.sig && bst.sig.id === 'emperors_breath' && bst.sig.phase === 'active') {
            // The Emperor holds and breathes; the cone does the
            // moving (its sweep is capped in the signature tick).
            desiredX = 0; desiredY = 0; blendK = 4;
          } else if (bossDefFor(bst.worldIndex).movement === 'passes') {
            // Dragon Emperor sheet: slow heavy passes across the
            // whole field, the most mobile boss before the finale.
            const t = bst.fightSec;
            const ax = window.innerWidth / 2 + Math.sin(t * 0.16) * window.innerWidth * 0.36;
            const ay = window.innerHeight * (0.32 + 0.13 * Math.sin(t * 0.09 + 1.3));
            const dx = ax - enemy.position.x;
            const dy = ay - enemy.position.y;
            const dist = Math.hypot(dx, dy) || 1;
            const passSpeed = Math.min(0.5 * LU, dist * 1.2);
            desiredX = (dx / dist) * passSpeed;
            desiredY = (dy / dist) * passSpeed;
            blendK = 1.2;
          }
        }
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
            // A7: a targeted attack may not begin until the body
            // is inside the visible arena.
            if (distP <= 0.42 * LU && this.bodyOnScreen(enemy)) {
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
        } else if (data.type === 'phantom') {
          // Shroud Phantom (Phaser): a fixed, learnable cycle
          // (design sheet 13). Solid for 2.5 s, chasing at Cruise.
          // Phased for 1.0 s: translucent, unable to be hit and
          // unable to hit (both paths check the phase), drifting
          // toward a flank anchor beside the player. Then a 0.7 s
          // reappear shimmer at the anchor (the telegraph; still
          // harmless and untouchable while it gathers), then solid
          // again. The teleport at the reappear guarantees the
          // gather happens at the flank even if the drift fell short.
          const LU = this.logicalUnit;
          const state = data.behaviorState || 'solid';
          if (state === 'solid') {
            desiredX = normalized.x * 0.6 * LU;
            desiredY = normalized.y * 0.6 * LU;
            if (now >= (data.stateUntil || 0)) {
              let side = Math.random() < 0.5 ? 1 : -1;
              const m = 0.06 * LU;
              let ax = this.playerBody.position.x + (-normalized.y) * side * 0.3 * LU;
              let ay = this.playerBody.position.y + normalized.x * side * 0.3 * LU;
              if (ax < m || ax > window.innerWidth - m || ay < m || ay > window.innerHeight - m) {
                side = -side;
                ax = this.playerBody.position.x + (-normalized.y) * side * 0.3 * LU;
                ay = this.playerBody.position.y + normalized.x * side * 0.3 * LU;
              }
              data.anchorX = Math.max(m, Math.min(window.innerWidth - m, ax));
              data.anchorY = Math.max(m, Math.min(window.innerHeight - m, ay));
              data.behaviorState = 'phased';
              data.stateUntil = now + 1000;
            }
          } else if (state === 'phased') {
            const dx = (data.anchorX ?? enemy.position.x) - enemy.position.x;
            const dy = (data.anchorY ?? enemy.position.y) - enemy.position.y;
            const d = Math.hypot(dx, dy) || 1;
            const sp = Math.min(0.9 * LU, d * 2);
            desiredX = (dx / d) * sp;
            desiredY = (dy / d) * sp;
            blendK = 4;
            if (now >= (data.stateUntil || 0)) {
              Matter.Body.setPosition(enemy, { x: data.anchorX ?? enemy.position.x, y: data.anchorY ?? enemy.position.y });
              Matter.Body.setVelocity(enemy, { x: 0, y: 0 });
              data.behaviorState = 'reappear';
              data.telegraphStart = now;
              data.stateUntil = now + 700;
            }
          } else { // reappear
            desiredX = 0;
            desiredY = 0;
            if (now >= (data.stateUntil || 0)) {
              data.behaviorState = 'solid';
              data.stateUntil = now + 2500;
            }
          }
        } else if (data.type === 'wraith') {
          // Lance Wraith (Sniper): holds a ring at about 45 percent
          // of the min dimension from the player. In band and off
          // cooldown it locks on for 0.7 s: its aim tracks the
          // player and the lock line is published for the renderer.
          // At the lock's end it fires one fast piercing bolt along
          // the aim, then retreats through its 1.8 s cooldown
          // (design sheet 14). The aim vector lives on the body
          // data: the bolt, the published facing, and the renderer
          // all read the same line.
          const LU = this.logicalUnit;
          const distP = Math.hypot(force.x, force.y);
          const ringR = 0.45 * LU;
          data.aimDirX = normalized.x;
          data.aimDirY = normalized.y;
          const state = data.behaviorState || 'stalk';
          if (state === 'lock') {
            desiredX = normalized.x * 0.05 * LU;
            desiredY = normalized.y * 0.05 * LU;
            blendK = 4;
            if (now >= (data.stateUntil || 0)) {
              this.fireWraithBolt(enemy);
              data.lastAttackTime = now;
              data.behaviorState = 'retreat';
              data.stateUntil = now + 1800;
            }
          } else if (state === 'retreat') {
            desiredX = -normalized.x * 0.3 * LU;
            desiredY = -normalized.y * 0.3 * LU;
            if (now >= (data.stateUntil || 0)) data.behaviorState = 'stalk';
          } else { // stalk: settle onto the ring
            const err = distP - ringR;
            const dirS = err >= 0 ? 1 : -1;
            const mag = Math.min(0.3 * LU, Math.abs(err) * 2);
            desiredX = normalized.x * dirS * mag;
            desiredY = normalized.y * dirS * mag;
            if (Math.abs(err) < 0.08 * LU && now - (data.lastAttackTime || 0) > 2500) {
              data.behaviorState = 'lock';
              data.telegraphStart = now;
              data.stateUntil = now + 700;
            }
          }
        } else if (data.type === 'chanter') {
          // War Chanter (Support): never attacks (design sheet 15).
          // It keeps at least 35 percent of the min dimension from
          // the player, fleeing at Cruise when pressed, and every
          // 5 s it pulses: every other enemy within 30 percent of
          // the min dimension gains 25 percent speed for 3 s (the
          // buffUntil the steering loop and renderer read). Mines
          // are excluded: they have no speed to gain.
          const LU = this.logicalUnit;
          const distP = Math.hypot(force.x, force.y);
          if (distP < 0.35 * LU) {
            desiredX = -normalized.x * 0.5 * LU;
            desiredY = -normalized.y * 0.5 * LU;
          } else if (distP > 0.5 * LU) {
            desiredX = normalized.x * 0.3 * LU;
            desiredY = normalized.y * 0.3 * LU;
          } else {
            desiredX = -normalized.y * 0.15 * LU;
            desiredY = normalized.x * 0.15 * LU;
          }
          if (now - (data.lastAttackTime || 0) >= 5000) {
            data.lastAttackTime = now;
            data.lastPulseAt = now;
            const buffR = 0.30 * LU;
            for (const other of this.enemies) {
              if (other === enemy) continue;
              const od = other.plugin['data'] as EnemyData;
              if (!od || od.type === 'rift_mine') continue;
              const d = Math.hypot(other.position.x - enemy.position.x, other.position.y - enemy.position.y);
              if (d <= buffR) od.buffUntil = now + 3000;
            }
          }
        } else if (data.type === 'serpent') {
          // Loom Serpent (Weaver, elite): a sine-weave chase at
          // Swift with a wide amplitude. Every 6 s it coils for
          // 0.5 s (the ribbon bunches, the head flares: the
          // telegraph), then lunges in a locked straight line at
          // Dart speed through the player's position (design sheet
          // 17). The ribbon segments derive from the head's recent
          // path each tick and are published as virtual entities.
          const LU = this.logicalUnit;
          const state = data.behaviorState || 'weave';
          if (!data.trail) data.trail = [];
          data.trail.unshift({ x: enemy.position.x, y: enemy.position.y });
          if (data.trail.length > 300) data.trail.length = 300;
          const bunch = state === 'coil' ? 1 - 0.65 * Math.min(1, (now - (data.telegraphStart || now)) / 500) : 1;
          const spacing = 0.085 * LU * bunch;
          const segs: Array<{ x: number, y: number }> = [];
          let acc = 0;
          for (let i = 1; i < data.trail.length && segs.length < 7; i++) {
            const a = data.trail[i - 1], b = data.trail[i];
            acc += Math.hypot(b.x - a.x, b.y - a.y);
            if (acc >= spacing * (segs.length + 1)) segs.push({ x: b.x, y: b.y });
          }
          data.segmentPositions = segs;
          // Published facing follows the head's travel direction.
          const hv = Matter.Body.getVelocity(enemy);
          if (Math.abs(hv.x) > 0.01 || Math.abs(hv.y) > 0.01) {
            const hl = Math.hypot(hv.x, hv.y) || 1;
            data.aimDirX = hv.x / hl;
            data.aimDirY = hv.y / hl;
          }
          if (state === 'coil') {
            desiredX = normalized.x * 0.12 * LU;
            desiredY = normalized.y * 0.12 * LU;
            blendK = 5;
            if (now >= (data.stateUntil || 0)) {
              data.behaviorState = 'lunge';
              data.dashDirX = normalized.x;
              data.dashDirY = normalized.y;
              data.stateUntil = now + 550;
            }
          } else if (state === 'lunge') {
            desiredX = (data.dashDirX || 0) * 1.685 * LU; // Dart cap, the Serpent's strike class
            desiredY = (data.dashDirY || 0) * 1.685 * LU;
            blendK = 12;
            if (now >= (data.stateUntil || 0)) {
              data.behaviorState = 'weave';
              data.stateUntil = now + 6000;
            }
          } else { // weave
            let hash = 0;
            const idStr = data.id || '';
            for (let ci = 0; ci < idStr.length; ci++) hash = (hash * 31 + idStr.charCodeAt(ci)) | 0;
            const s = Math.sin((now / 1000) * 3.2 + (Math.abs(hash) % 628) / 100);
            data.weaveValue = s;
            const wx = normalized.x + (-normalized.y) * s * 0.9;
            const wy = normalized.y + normalized.x * s * 0.9;
            const len = Math.hypot(wx, wy) || 1;
            desiredX = (wx / len) * 1.0 * LU;
            desiredY = (wy / len) * 1.0 * LU;
            if (now >= (data.stateUntil || 0) && this.bodyOnScreen(enemy)) {
              data.behaviorState = 'coil';
              data.telegraphStart = now;
              data.stateUntil = now + 500;
            }
          }
        } else if (data.type === 'darter') {
          // Storm Darter (mobile Shooter): repositions at Cruise
          // to a staging point at pass distance on its own bearing
          // from the player, lines up for 0.5 s with wingtips
          // sparking (the telegraph), then makes a strafing pass
          // at Dart (3.2 sheet, halved to 1.6) through the player's
          // locked position, firing a 3-shot spread at the pass
          // midpoint (design sheet 16). It never hovers near the
          // player: after the pass it repositions again.
          const LU = this.logicalUnit;
          const state = data.behaviorState || 'reposition';
          if (state === 'pass') {
            desiredX = (data.dashDirX || 0) * 1.6 * LU;
            desiredY = (data.dashDirY || 0) * 1.6 * LU;
            blendK = 10;
            data.aimDirX = data.dashDirX;
            data.aimDirY = data.dashDirY;
            const relX = enemy.position.x - (data.anchorX || 0);
            const relY = enemy.position.y - (data.anchorY || 0);
            const along = relX * (data.dashDirX || 0) + relY * (data.dashDirY || 0);
            // The spread fires at the crossing of the locked
            // position, or at the end of the pass window if
            // player-fire knockback held the darter off the
            // crossing: exactly one spread per pass, at its
            // closest approach either way.
            if (!data.passFired && (along >= 0 || now >= (data.stateUntil || 0))) {
              data.passFired = true;
              this.fireDarterSpread(enemy);
            }
            if (now >= (data.stateUntil || 0) || along > 0.75 * LU) {
              data.behaviorState = 'reposition';
            }
          } else if (state === 'lineup') {
            desiredX = 0;
            desiredY = 0;
            // The aim settles onto the player's current position;
            // it locks when the pass begins.
            data.aimDirX = normalized.x;
            data.aimDirY = normalized.y;
            if (now >= (data.stateUntil || 0)) {
              data.dashDirX = normalized.x;
              data.dashDirY = normalized.y;
              data.anchorX = this.playerBody.position.x;
              data.anchorY = this.playerBody.position.y;
              data.passFired = false;
              data.behaviorState = 'pass';
              data.stateUntil = now + 1200;
            }
          } else { // reposition
            const sx = this.playerBody.position.x - normalized.x * 0.55 * LU;
            const sy = this.playerBody.position.y - normalized.y * 0.55 * LU;
            const dx = sx - enemy.position.x;
            const dy = sy - enemy.position.y;
            const d = Math.hypot(dx, dy) || 1;
            data.aimDirX = dx / d;
            data.aimDirY = dy / d;
            desiredX = (dx / d) * 0.5 * LU;
            desiredY = (dy / d) * 0.5 * LU;
            if (d < 0.05 * LU) {
              data.behaviorState = 'lineup';
              data.telegraphStart = now;
              data.stateUntil = now + 500;
            }
          }
        }
        // War Chanter buff (Stage 5): while the buff window is
        // open this enemy flies 25 percent faster (design sheet
        // 15). Applied to the composed desired velocity, so it
        // covers chase, hooks, and dashes alike; the total clamps
        // to the game's fastest dash class (the Cinder Imp's
        // 1.7 LU/s), a speed the field already knows how to show.
        if (data.buffUntil && now < data.buffUntil) {
          desiredX *= 1.25;
          desiredY *= 1.25;
          const sp = Math.hypot(desiredX, desiredY);
          const cap = 1.7 * this.logicalUnit;
          if (sp > cap) { desiredX = desiredX / sp * cap; desiredY = desiredY / sp * cap; }
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
                     attackCharge: data.type === 'boss' ? this.bossPublishCharge(data) : data.type === 'golem' ? Math.min(1, Math.max(0, (now - (data.lastAttackTime || 0)) / 3000)) : data.type === 'imp' ? impTelegraphCharge(data, now) : data.type === 'sentry_shard' ? shardCharge(data, now) : data.type === 'rift_mine' ? mineArmedCharge(body, this.playerBody, this.logicalUnit) : data.type === 'pyre_moth' ? mothFuseCharge(data, now) : data.type === 'phantom' ? phantomReappearCharge(data, now) : data.type === 'wraith' ? wraithLockCharge(data, now) : data.type === 'serpent' ? serpentCoilCharge(data, now) : data.type === 'darter' ? darterLineupCharge(data, now) : undefined,
                     weave: data.type === 'bat' || data.type === 'serpent' ? data.weaveValue : undefined,
                     state: data.type === 'boss' ? this.bossPublishState(data) : (data.type === 'imp' || data.type === 'wisp' || data.type === 'sentry_shard' || data.type === 'seedmother' || data.type === 'rift_mine' || data.type === 'shieldback' || data.type === 'pyre_moth' || data.type === 'phantom' || data.type === 'wraith' || data.type === 'chanter' || data.type === 'serpent' || data.type === 'darter') ? data.behaviorState : undefined,
                     facing: (data.type === 'shieldback' || data.type === 'sentry_shard' || data.type === 'wraith' || data.type === 'darter' || data.type === 'serpent') && data.aimDirX !== undefined ? Math.atan2(data.aimDirY || 0, data.aimDirX || 0) : undefined,
                     sparkUntil: data.type === 'shieldback' ? data.sparkUntil : undefined,
                     buffed: data.buffUntil !== undefined && now < data.buffUntil ? true : undefined,
                     // Stage 10 / S6 renderer data (display only):
                     // the World 10 elite tint flag, the Chaos
                     // Demon's form fields, and the Roulette wash.
                     elite: data.elite || undefined,
                     bossForm: data.type === 'boss' ? data.bossState?.formIdx : undefined,
                     bossFormFlow: data.type === 'boss' && data.bossState ? this.bossFormFlow(data.bossState) : undefined,
                     wash: data.type === 'boss' ? this.bossWash(data) : undefined,
                     // A6: travel direction for the bolt renderer.
                     vx: body.velocity.x,
                     vy: body.velocity.y,
                     // A10: per-ability drawn looks key on these.
                     moveId: data.moveId,
                     owner: data.owner
                 });
             }
         }
      });
      // Stage 5 virtual entities (no physics body): the Lance
      // Wraith's lock-on line, the War Chanter's expanding pulse
      // ring, and the Loom Serpent's ribbon segments. Display only;
      // every value derives from the owning body's data.
      for (const body of renderBodies) {
          const data = body.plugin['data'] as EnemyData;
          if (!data) continue;
          if (data.type === 'wraith' && data.behaviorState === 'lock') {
              const px = this.playerBody.position.x, py = this.playerBody.position.y;
              const dx = px - body.position.x, dy = py - body.position.y;
              const dist = Math.hypot(dx, dy);
              entities.push({
                  id: data.id + ':line',
                  x: body.position.x + dx / 2,
                  y: body.position.y + dy / 2,
                  type: 'wraith_line',
                  size: Math.max(1, dist / 2),
                  attackCharge: wraithLockCharge(data, now),
                  facing: Math.atan2(dy, dx)
              });
          }
          if (data.type === 'chanter' && data.lastPulseAt && now - data.lastPulseAt < 700) {
              const p = (now - data.lastPulseAt) / 700;
              entities.push({
                  id: data.id + ':pulse',
                  x: body.position.x,
                  y: body.position.y,
                  type: 'chanter_pulse',
                  size: Math.max(1, 0.30 * this.logicalUnit * p),
                  attackCharge: p
              });
          }
          if (data.type === 'serpent' && data.segmentPositions) {
              const headSize = body.circleRadius || 20;
              data.segmentPositions.forEach((seg, i) => {
                  entities.push({
                      id: data.id + ':seg' + i,
                      x: seg.x,
                      y: seg.y,
                      type: 'serpent_segment',
                      size: headSize * (0.92 - i * 0.07)
                  });
              });
          }
          // Stage 9 boss rig virtual entities (no physics bodies):
          // the shield shell, the Crystal Titan's shard ring, and
          // every signature's telegraph and hazard visuals. Display
          // only; every value derives from the boss's fight state,
          // which is also what the harness reads as evidence.
          if (data.type === 'boss' && data.bossState) {
              const st = data.bossState;
              const bossR = body.circleRadius || 150;
              if (st.shieldUp || st.shieldTelegraphStartSec >= 0) {
                  const frac = st.shieldUp
                      ? st.shieldHp / Math.max(1, st.shieldMaxHp)
                      : Math.min(1, (st.fightSec - st.shieldTelegraphStartSec) / SHIELD_TELEGRAPH_SEC);
                  entities.push({
                      id: data.id + ':shield',
                      x: body.position.x,
                      y: body.position.y,
                      type: 'boss_shield',
                      size: bossR * 1.04,
                      attackCharge: Math.max(0, Math.min(1, frac))
                  });
              }
              const sig = st.sig;
              if (sig) {
                  const charge = sig.phase === 'telegraph'
                      ? Math.min(1, Math.max(0, (st.fightSec - sig.startSec) / sig.telegraphSec)) : 1;
                  if (sig.id === 'flame_ring') {
                      entities.push({
                          id: data.id + ':ring', x: sig.data.cx, y: sig.data.cy,
                          type: 'boss_ring', size: sig.data.ringR, attackCharge: charge
                      });
                      sig.data.pillars.forEach((p: any, i: number) => {
                          entities.push({
                              id: data.id + ':pillar' + i, x: p.x, y: p.y,
                              type: 'boss_pillar', size: 36, attackCharge: charge
                          });
                      });
                  } else if (sig.id === 'shadow_split' && sig.phase === 'active') {
                      sig.data.copies.forEach((c: any, i: number) => {
                          entities.push({
                              id: data.id + ':copy' + i, x: c.x, y: c.y,
                              type: 'boss_shadow', size: bossR, attackCharge: 0.5
                          });
                      });
                  } else if (sig.id === 'shard_fan' && sig.phase === 'active' && sig.data.ringUp) {
                      for (let i = 0; i < 6; i++) {
                          const a = st.fightSec * 0.9 + (i / 6) * Math.PI * 2;
                          const rr = bossR + 48 * this.speedScale;
                          entities.push({
                              id: data.id + ':shard' + i,
                              x: body.position.x + Math.cos(a) * rr,
                              y: body.position.y + Math.sin(a) * rr,
                              type: 'boss_shard', size: 36, attackCharge: 0.8
                          });
                      }
                  } else if (sig.id === 'storm_call') {
                      sig.data.columns.forEach((c: any, i: number) => {
                          entities.push({
                              id: data.id + ':col' + i, x: c.x, y: window.innerHeight / 2,
                              type: 'boss_column', size: window.innerHeight / 2, attackCharge: charge
                          });
                      });
                  } else if (sig.id === 'harvest_arc') {
                      sig.data.arcs.forEach((arc: any, i: number) => {
                          entities.push({
                              id: data.id + ':arc' + i, x: sig.data.cx, y: sig.data.cy,
                              type: 'boss_arc', size: sig.data.radius, attackCharge: charge,
                              facing: arc.ang
                          });
                      });
                  } else if (sig.id === 'royal_decree') {
                      // Stage 10: the crown flare ring during the
                      // telegraph, and the locked dash line for the
                      // whole wind-up between the fan and the dash.
                      if (sig.phase === 'telegraph') {
                          entities.push({
                              id: data.id + ':crown', x: body.position.x, y: body.position.y,
                              type: 'boss_ring', size: 0.12 * this.logicalUnit, attackCharge: charge
                          });
                      }
                      if (sig.data.dashState === 'windup') {
                          const dx = sig.data.dashTx - body.position.x, dy = sig.data.dashTy - body.position.y;
                          entities.push({
                              id: data.id + ':dashline', x: body.position.x + dx / 2, y: body.position.y + dy / 2,
                              type: 'boss_line', size: Math.max(1, Math.hypot(dx, dy) / 2), attackCharge: 0.9,
                              facing: Math.atan2(dy, dx)
                          });
                      }
                  } else if (sig.id === 'frozen_court') {
                      // Each ring publishes while it draws (charge =
                      // draw progress) and while it stands solid
                      // (charge 1), on the locked court center.
                      sig.data.rings.forEach((r: any, i: number) => {
                          let c = -1;
                          if (sig.phase === 'telegraph') {
                              if (i === 0) c = charge;
                          } else if (st.fightSec >= r.drawAtSec && st.fightSec <= r.untilSec) {
                              c = st.fightSec >= r.solidAtSec ? 1 : Math.min(1, Math.max(0, (st.fightSec - r.drawAtSec) / sig.data.drawSec));
                          }
                          if (c >= 0) {
                              entities.push({
                                  id: data.id + ':frostring' + i, x: sig.data.cx, y: sig.data.cy,
                                  type: 'boss_ring', size: r.r, attackCharge: c
                              });
                          }
                      });
                  } else if (sig.id === 'emperors_breath') {
                      entities.push({
                          id: data.id + ':cone', x: body.position.x, y: body.position.y,
                          type: 'boss_cone', size: sig.data.coneLen, attackCharge: charge,
                          facing: sig.data.coneAng
                      });
                  } else if (sig.id === 'chaos_roulette') {
                      // The announcement halo; the pattern's color
                      // itself rides the boss entity's wash field.
                      if (sig.phase === 'telegraph') {
                          entities.push({
                              id: data.id + ':halo', x: body.position.x, y: body.position.y,
                              type: 'boss_ring', size: bossR * 1.18, attackCharge: charge
                          });
                      }
                  } else if (sig.id === 'singularity') {
                      const d = sig.data;
                      if (d.kind === 'burst' && sig.phase === 'telegraph') {
                          entities.push({
                              id: data.id + ':bursttele', x: body.position.x, y: body.position.y,
                              type: 'boss_ring', size: 0.30 * this.logicalUnit, attackCharge: charge
                          });
                      } else if (d.kind === 'drill' && sig.phase === 'telegraph') {
                          const dx = d.dashTx - body.position.x, dy = d.dashTy - body.position.y;
                          entities.push({
                              id: data.id + ':drillline', x: body.position.x + dx / 2, y: body.position.y + dy / 2,
                              type: 'boss_line', size: Math.max(1, Math.hypot(dx, dy) / 2), attackCharge: charge,
                              facing: Math.atan2(dy, dx)
                          });
                      } else if (d.kind === 'aura' && sig.phase === 'active') {
                          entities.push({
                              id: data.id + ':aura', x: body.position.x, y: body.position.y,
                              type: 'boss_ring', size: 0.34 * this.logicalUnit, attackCharge: 0.7
                          });
                      } else if (d.kind === 'singularity' && sig.phase === 'telegraph') {
                          entities.push({
                              id: data.id + ':sing', x: body.position.x, y: body.position.y,
                              type: 'boss_ring', size: Math.max(8, 0.40 * this.logicalUnit * (1 - 0.85 * charge)), attackCharge: charge
                          });
                      }
                  }
              }
          }
      }
      // Deduplicate by ID
const uniqueEntities = Array.from(new Map(entities.map(e => [e.id, e])).values());
      this.gameState.activeEntities.set(uniqueEntities);
    });

    this.startPhysics();
  }




  // Contact damage per type (visual spec Section 3.3): the shipped
  // pattern is 10 standard and 50 boss; the Stage 3 sheets name two
  // exceptions, the Mite at 5 and the Cinder Imp at 15 while, and
  // only while, it is in its dash state.

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

  // S4 ultimate cast registry (systems spec Section 1.6): at cast
  // time the live HP of every boss-class target (the campaign boss,
  // the Battle rival) is snapshotted, and every damage packet the
  // cast deals to such a target is clamped so the cast's total
  // against that target never exceeds
  // PI_RULES.ultimateBossHpCapFraction (25 percent) of the
  // snapshot, the boss's HP at cast time. Packets an enemy cast
  // deals to the player are keyed '__player__' and clamped by the
  // same fraction of the player's HP at cast time, so a rival
  // ultimate is dangerous, never a one-shot. Entries are dropped
  // a few seconds after the longest ultimate resolves.
  private ultCastSeq = 0;
  private ultCasts = new Map<string, { base: Map<string, number>, dealt: Map<string, number> }>();

  public registerUltCast(casterOwnerId: string): string {
    const id = 'ult_' + (++this.ultCastSeq) + '_' + Date.now();
    const base = new Map<string, number>();
    for (const e of this.enemies) {
      const d = e.plugin['data'] as EnemyData;
      if (d && (d.type === 'boss' || d.type === 'enemy_phoenix')) base.set(d.id, d.health);
    }
    if (casterOwnerId !== 'player') base.set('__player__', this.currentHealth());
    this.ultCasts.set(id, { base, dealt: new Map<string, number>() });
    setTimeout(() => this.ultCasts.delete(id), 12000);
    return id;
  }

  public clampUltDamage(castId: string, targetKey: string, fallbackBase: number, damage: number): number {
    const cast = this.ultCasts.get(castId);
    if (!cast) return damage;
    if (!cast.base.has(targetKey)) cast.base.set(targetKey, fallbackBase);
    const base = cast.base.get(targetKey) || 0;
    const cap = PI_RULES.ultimateBossHpCapFraction * base;
    const dealt = cast.dealt.get(targetKey) || 0;
    const clamped = Math.min(damage, Math.max(0, cap - dealt));
    cast.dealt.set(targetKey, dealt + clamped);
    return clamped;
  }

  public damageEnemy(enemy: Matter.Body, damage: number, sourcePos?: { x: number, y: number }, ultCastId?: string) {
    const data = enemy.plugin['data'] as EnemyData;
    // S6 corpse guard: a body whose health already ran out is
    // dead, even if its removal lands a frame later. Without
    // this, two lethal packets in the same frame (an auto-fire
    // shot and an ability hit, say) each ran the whole death
    // branch: XP, coins, and drops granted twice for one kill
    // (proven in the S6 level audit: one slime paid 4 XP against
    // its table value of 2).
    if (data.health <= 0) return;
    if (data.immortalUntil && Date.now() < data.immortalUntil) return;
    // Shroud Phantom phase rule (design sheet 13): while phased or
    // gathering at its reappear point it cannot be hit. Shots that
    // reach it do nothing; the fixed cycle is the counterplay.
    if (data.type === 'phantom' && data.behaviorState !== 'solid') return;
    // S4 ultimate cap, enforced per packet before any other
    // reduction, so the recorded damage number is the real hit.
    if (ultCastId && damage > 0 && (data.type === 'boss' || data.type === 'enemy_phoenix')) {
      damage = this.clampUltDamage(ultCastId, data.id, data.health, damage);
    }
    // Stage 10: the Phoenix King's ash cannot be hit (the False
    // Rebirth window is a held arena, mirrored from the player's
    // own rebirth ash, which also cannot act or be acted on).
    if (data.type === 'boss' && data.bossState && this.bossAshen(data.bossState)) return;
    // Stage 9 boss shield gate (shield and regen addendum): while
    // a shield phase is up, player damage strikes the shield, not
    // the boss; breaking the shield ends the regen immediately.
    // The Crystal Titan's signature shard ring blocks the same way
    // during its up windows. Boss HP, the kill path, and the
    // damage number all behave as if the shield were the target.
    if (data.type === 'boss' && data.bossState && damage > 0) {
      const st = data.bossState;
      if (st.shieldUp) {
        st.shieldHp -= damage;
        this.recordDamageNumber(data.id, enemy.position.x, enemy.position.y, damage, true);
        if (st.shieldHp <= 0) {
          st.shieldUp = false;
          st.shieldHp = 0;
          this.bossShieldHealth.set(0);
          bossEvent(st, 'shield_break', `healed this phase ${st.healedThisPhase.toFixed(0)}`);
        } else {
          this.bossShieldHealth.set(Math.ceil(st.shieldHp));
        }
        return;
      }
      if (this.bossShardRingUp(st)) {
        this.recordDamageNumber(data.id, enemy.position.x, enemy.position.y, 0, true);
        return;
      }
    }
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
    // Fix Round 2 (A9): the bullet-hit sound. Every path into this
    // method is a player-side damage source, so one call here
    // covers bolts, ability projectiles, zones, and contact moves;
    // the service throttles it to a readable cadence.
    if (damage > 0) this.audioService.playSFX('hit');
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
      // Stage 5 batch C, on the shipped ladder: Standard kills at
      // 10, the support at 15 (the Sentry Shard's tier), the elite
      // Serpent at 50 (between Armored 20 and boss 500).
      if (data.type === 'phantom') xp = 10;
      if (data.type === 'wraith') xp = 10;
      if (data.type === 'chanter') xp = 15;
      if (data.type === 'serpent') xp = 50;
      if (data.type === 'darter') xp = 10;
      if (data.type === 'boss') xp = 500;
      this.gameState.addXp(xp);

      // Bestiary Unlock
      if (!this.gameState.unlockedEnemies().includes(data.type) && ['slime', 'bat', 'golem', 'imp', 'wisp', 'pod', 'mite', 'sentry_shard', 'seedmother', 'rift_mine', 'shieldback', 'pyre_moth', 'phantom', 'wraith', 'chanter', 'serpent', 'darter', 'boss'].includes(data.type)) {
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
        // S4: this kill feeds the per-world triple gate (systems
        // spec Section 3.4). Recorded for every defeat, first or
        // repeat; the record is what the shop and cast paths read.
        this.gameState.recordBossBeaten(currentWorldIndex);
        // Mode trio: the same kill is the world's Normal result.
        // The segment clock and kill count measure this world only
        // (they reset at run start and at every realm transition),
        // so a chained run still records each world honestly.
        if (this.gameState.currentGameMode() === 'campaign') {
            this.gameState.recordNormalClear(currentWorldIndex,
                this.gameState.sessionPlayTime() - this.segStartPlayTime,
                this.totalSessionKills() - this.segStartKills);
        }
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
        if (data.type !== 'rift_mine') {
            // Pickup drops (spec Section 5.4, stage S5; rates and
            // values in DROP_RULES). Coins above are unchanged.
            // Heart: 10 percent base, 12 percent from Sturdy class
            // kills and up, heals 20 as shipped.
            const heartChance = STURDY_UP_TYPES.has(data.type) ? DROP_RULES.heartSturdyChance : DROP_RULES.heartBaseChance;
            if (Math.random() < heartChance) {
                this.spawner.dropItem(enemy.position.x, enemy.position.y + 20, 'heart', DROP_RULES.heartHealValue, this.getSpawnerContext());
            }
            // Gem: 25 percent from Elite class kills (the Serpent).
            if (data.type === 'serpent' && Math.random() < DROP_RULES.gemEliteChance) {
                this.spawner.dropItem(enemy.position.x, enemy.position.y, 'gem', 1, this.getSpawnerContext());
            }
            // Spark Cell: 8 percent from Swift and Dart class kills;
            // the drop's value is the stamina it restores (50).
            if (SPARK_CELL_TYPES.has(data.type) && Math.random() < DROP_RULES.sparkCellChance) {
                this.spawner.dropItem(enemy.position.x, enemy.position.y, 'spark_cell', DROP_RULES.sparkCellStamina, this.getSpawnerContext());
            }
            // Overcharge: 2 percent from Armored class kills and
            // up; the next non-ultimate cast ignores its cooldown.
            if (ARMORED_UP_TYPES.has(data.type) && Math.random() < DROP_RULES.overchargeChance) {
                this.spawner.dropItem(enemy.position.x, enemy.position.y, 'overcharge', 1, this.getSpawnerContext());
            }
        }
        // The in-run subscription crate drop is removed (spec
        // Section 5.6 ruling, stage S5): pending monthly crates now
        // open from the shop's subscription card, so a crate can
        // never be lost to a death mid-run.
      }
    } else {
      // Hit sound removed permanently
    }
  }



  public takeDamage(amount: number, source?: 'boss_contact') {
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
                     plugin: { data: { id: Math.random().toString(), type: 'fire', moveId: 'rebirth_fire', health: 1, maxHealth: 1, burstDamage: this.gameState.currentStats().damage * 3 } as EnemyData }
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
      // Rebirth revive (full HP). Campaign-family only (Normal and
      // Endless): Battle death ends the match, and the annihilation
      // phase forbids all revives.
      if ((this.gameState.currentGameMode() === 'campaign' || this.gameState.currentGameMode() === 'endless') && !this.annihilationModeActive()
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


  // The player's current auto-fire output: damage per shot times
  // shots per second (the attack loop fires every 1000 /
  // attackSpeed ms). The revive blast packet is defined in seconds
  // of this output, so it scales with the player's build.
  public autoFireDps(): number {
      const stats = this.gameState.currentStats();
      return stats.damage * stats.attackSpeed;
  }

  public blastDiameterPx(): number {
      return 2 * this.REVIVE_BLAST_MIN_DIST_LU * this.logicalUnit;
  }

  // Enter the down state (campaign and Endless only; Battle and the
  // annihilation phase never reach here). The world freezes: physics
  // was already stopped by the caller, isDead holds the game loop,
  // the spawner, and auto-fire still, and playerDownPhase freezes
  // the scroll and switches the bird to its falling branch. Any hold
  // charge in progress is cleared so no phantom cast can fire from
  // the grave. Nothing is recorded yet: the run is not over.
  private enterDownState() {
      this.holdTimer = 0;
      this.holdChargeProgress.set(0);
      this.holdStill.release();
      this.gameState.phoenixOverridePosition.set(null);
      this.gameState.playerDownPhase.set('falling');
      this.downPhaseStartedAt = Date.now();
      this.startDownWatcher();
  }

  // One watcher for the whole down sequence. Falling: when the
  // bird's screen position passes fully below the viewport (sprite
  // half-height plus margin), the KO panel opens. Return: when the
  // bird reaches mid-screen (or a generous timeout passes, so a
  // wedged bird can never soft-lock the run), the revive blast
  // fires. The watcher clears itself when the phase leaves the
  // down family.
  private startDownWatcher() {
      if (this.downWatchInterval) return;
      this.downWatchInterval = setInterval(() => {
          const phase = this.gameState.playerDownPhase();
          if (phase === 'falling') {
              const pos = this.gameState.phoenixScreenPos();
              const exitMargin = Math.max(120, window.innerHeight * 0.16);
              if (pos.y > window.innerHeight + exitMargin) {
                  this.gameState.playerDownPhase.set('ko');
                  this.koPanelOpen.set(true);
                  this.gameState.isDeadMenuOpen.set(true);
                  this.downPhaseStartedAt = Date.now();
              }
          } else if (phase === 'return') {
              const pos = this.gameState.phoenixScreenPos();
              const dx = pos.x - window.innerWidth / 2;
              const dy = pos.y - window.innerHeight / 2;
              const arrived = Math.hypot(dx, dy) < 30;
              const timedOut = Date.now() - this.downPhaseStartedAt > 5000;
              if (arrived || timedOut) {
                  this.fireReviveBlast();
              }
          } else if (phase === 'none') {
              this.stopDownWatcher();
          }
      }, 40);
  }

  private stopDownWatcher() {
      if (this.downWatchInterval) {
          clearInterval(this.downWatchInterval);
          this.downWatchInterval = null;
      }
  }

  // Give Up on the KO panel: the only action that truly ends a
  // campaign or Endless run. quitGame records the run (Endless
  // records here, at the real end, not at the knockdown) and
  // returns to the menu exactly as before.
  public giveUpFromKo() {
      if (this.adReviveInFlight) return;
      this.stopDownWatcher();
      this.koPanelOpen.set(false);
      this.gameState.playerDownPhase.set('none');
      this.quitGame();
  }

  // The shared revive sequence for every revive source (token,
  // gems, watch-ad): the KO panel closes, the world stays frozen,
  // and the bird re-enters from below the screen, steered by the
  // normal flight override to mid-screen. The watcher fires the
  // blast on arrival. HP is restored per the source's rule at the
  // blast moment (all three sources restore full HP today, matching
  // the old executeRevival; the Rebirth and Feather auto-revives
  // keep their own 50 percent rules upstream and never come here).
  private beginReviveReturn(hpToRestore: number) {
      this.pendingReviveHp = hpToRestore;
      this.koPanelOpen.set(false);
      this.gameState.isDeadMenuOpen.set(false);
      this.gameState.playerDownPhase.set('return');
      this.downPhaseStartedAt = Date.now();
      this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      this.startDownWatcher();
  }

  // The revive blast: an expanding shockwave at the bird's position.
  // Every on-screen regular enemy takes the packet (REVIVE_BLAST_
  // DPS_SECONDS of current auto-fire DPS) and is knocked radially
  // outward so none remains closer than the minimum clear distance
  // (elites: half the knockback distance, full damage). The boss
  // takes the packet through the ultimate per-cast cap (25 percent
  // of current boss HP) and is never displaced. Positions clamp at
  // the screen bounds so nothing is pushed through a wall or lost.
  private fireReviveBlast() {
      this.gameState.playerDownPhase.set('blast');
      const center = { ...this.gameState.phoenixScreenPos() };
      const stats = this.gameState.currentStats();
      const packet = this.REVIVE_BLAST_DPS_SECONDS * stats.damage * stats.attackSpeed;
      const minDist = this.REVIVE_BLAST_MIN_DIST_LU * this.logicalUnit;
      const castId = this.registerUltCast('player');

      for (const enemy of [...this.enemies]) {
          const data = enemy.plugin['data'] as EnemyData;
          if (!data) continue;
          if (data.type === 'boss') {
              this.damageEnemy(enemy, packet, center, castId);
              continue;
          }
          const pos = enemy.position;
          const onScreen = pos.x >= -80 && pos.x <= window.innerWidth + 80
              && pos.y >= -80 && pos.y <= window.innerHeight + 80;
          if (!onScreen) continue;
          this.damageEnemy(enemy, packet, center, castId);
          // Knockback applies to survivors only (damageEnemy may
          // have killed and spliced the body out of the field).
          if (data.health <= 0 || !this.enemies.includes(enemy)) continue;
          const dx = pos.x - center.x;
          const dy = pos.y - center.y;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist) {
              const target = data.elite ? dist + (minDist - dist) / 2 : minDist;
              const ux = dist > 1 ? dx / dist : 0;
              const uy = dist > 1 ? dy / dist : -1;
              const nx = Math.max(10, Math.min(window.innerWidth - 10, center.x + ux * target));
              const ny = Math.max(-70, Math.min(window.innerHeight - 10, center.y + uy * target));
              Matter.Body.setPosition(enemy, { x: nx, y: ny });
              Matter.Body.setVelocity(enemy, { x: 0, y: 0 });
          }
      }

      this.triggerImpactEffect(center.x, center.y, true);
      this.audioService.playSFX('explosion');
      // The ring visual: progress driven here, bound by the template.
      const fxStart = Date.now();
      this.reviveBlastFx.set({ x: center.x, y: center.y, progress: 0 });
      const fxInterval = setInterval(() => {
          const p = (Date.now() - fxStart) / 650;
          if (p >= 1) {
              clearInterval(fxInterval);
              this.reviveBlastFx.set(null);
          } else {
              this.reviveBlastFx.set({ x: center.x, y: center.y, progress: p });
          }
      }, 33);

      this.completeReviveReturn();
  }

  // After the blast: restore HP per the revive source's rule, grant
  // the standard post-revive invulnerability window (the same 5 s
  // the old executeRevival granted, plus its 2.5 s speed boost),
  // unfreeze the world, and hand control back.
  private completeReviveReturn() {
      this.currentHealth.set(this.pendingReviveHp);
      this.gameState.immortalUntil = Date.now() + 5000;
      this.gameState.speedBoostUntil = Date.now() + 2500;
      this.gameState.phoenixOverridePosition.set(null);
      this.rageModeActive.set(false); // Reset rage mode on revive
      this.killScreenTimer.set(10); // Reset timer just in case
      this.gameState.playerDownPhase.set('none');
      this.isDead.set(false);
      this.stopDownWatcher();
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


  public getReviveCost(): number {
    return 10 * Math.pow(2, this.reviveCount);
  }


  public reviveWithGems() {
    if (!this.koPanelOpen()) return;
    const cost = this.getReviveCost();
    if (this.gameState.gems() >= cost) {
        this.gameState.gems.update(g => g - cost);
        this.reviveCount++;
        this.beginReviveReturn(this.maxHealth());
    }
  }


  public reviveWithToken() {
    if (!this.koPanelOpen()) return;
    if (this.gameState.reviveTokens() <= 0) return;
    this.gameState.reviveTokens.update(t => t - 1);
    this.reviveCount++;
    this.gameState.syncProgressToServer();
    this.beginReviveReturn(this.maxHealth());
  }


  public async reviveWithAd() {
    if (!this.koPanelOpen()) return;
    if (this.adRevivesUsed >= this.maxAdRevivesPerRun) return;
    if (this.adReviveInFlight) return;
    // The ad revive is an extra revive unit on the KO panel. The
    // in-flight flag holds the panel's other actions inert for the
    // whole flight of the ad (playtest round 1, Bug 4 lineage), and
    // the server-verified grant rules are unchanged (SSV kinds and
    // the per-run cap of 2 live in the ads service and the cap
    // check above).
    this.adReviveInFlight = true;

    let rewarded = false;
    try {
        rewarded = await this.adsService.showRewarded('revive');
    } finally {
        this.adReviveInFlight = false;
    }

    // If the run ended while the ad played (for example the player
    // gave up from a state where that was still possible), do not
    // resurrect into a run that no longer exists.
    if (!this.isDead() || this.gameState.activeScreen() !== 'game'
        || this.gameState.playerDownPhase() !== 'ko') return;

    if (rewarded) {
        this.adRevivesUsed++;
        this.reviveCount++;
        this.beginReviveReturn(this.maxHealth());
    }
    // Ad skipped or failed: the player stays on the KO panel. There
    // is no countdown to resume; the down state simply continues.
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
  public spliceOut<T>(arr: T[], keep: (item: T) => boolean) {
      for (let i = arr.length - 1; i >= 0; i--) {
          if (!keep(arr[i])) arr.splice(i, 1);
      }
  }

  public spliceRemove<T>(arr: T[], item: T) {
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
          // Mode trio: the new realm starts a fresh record segment.
          this.markSegmentStart();
          
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
      this.bossEnraged.set(false);
      this.bossShieldHealth.set(0);
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


  // Fix Round 2 (A11, Carter's rule): a tap that lands on a UI
  // control belongs to the UI and never becomes a flight target,
  // a hold session, or a tap-chain press, on any screen. The
  // handlers below are window-level, so without this gate every
  // button tap (pause, resume, menu buttons) also steered the
  // phoenix to the button.
  private isUiTarget(event: Event): boolean {
      const t = event.target as HTMLElement | null;
      return !!t && typeof t.closest === 'function'
          && !!t.closest('button, a, input, select, textarea, [data-ui]');
  }

  private onMouseMove(event: MouseEvent) {
      if (this.isUiTarget(event)) return;
      this.updateMouseInput(event.clientX, event.clientY, false);
  }

  private onTouchMove(event: TouchEvent) {
      if (this.isUiTarget(event)) return;
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
      this.holdStill.sample(Date.now(), adjusted.x, adjusted.y);
  }


  private onMouseDown(event: MouseEvent) {
      // Right mouse button is the Feather Brake (spec Section 2.4).
      if (event.button === 2) { this.rawBrakeHeld = true; return; }
      if (event.button !== 0) return;
      // A11: UI presses are consumed by the UI; they also disarm
      // the flick parser so the matching release cannot dash.
      if (this.isUiTarget(event)) { this.pressT = 0; return; }
      this.pressX = event.clientX;
      this.pressY = event.clientY;
      this.pressT = Date.now();
      this.handleInputStart(event.clientX, event.clientY, false);
  }

  private onTouchStart(event: TouchEvent) {
      // Do not prevent default here, as it blocks UI clicks (like the pause button)
      // A11: a touch that starts on a UI control is the UI's alone:
      // it never steers, never brakes, and a single-finger UI press
      // disarms the flick parser so its release cannot dash.
      if (this.isUiTarget(event)) { if (event.touches.length === 1) this.pressT = 0; return; }
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
      this.holdStill.press(Date.now(), adjusted.x, adjusted.y);
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

  // S5: the Overcharge charge is live while held and inside its
  // window; an expired charge clears itself on first read.
  private overchargeActive(): boolean {
      if (!this.overchargeReady()) return false;
      if (Date.now() > this.overchargeExpiresAt) {
          this.overchargeReady.set(false);
          this.overchargeExpiresAt = 0;
          return false;
      }
      return true;
  }

  private consumeOvercharge() {
      this.overchargeReady.set(false);
      this.overchargeExpiresAt = 0;
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
      // S5 Overcharge (spec Section 5.4): a held charge lets the
      // next non-ultimate cast ignore its cooldown entirely: it may
      // fire during the cooldown and starts no new one. Ultimates
      // are excluded and never consume the charge.
      const charged = family !== 'triple' && this.overchargeActive();
      if (cooldown > 0 && !charged) return;
      // S4 triple gate (systems spec Section 3.4): the cast path
      // refuses an ultimate until this world's boss has been beaten
      // once, whatever a save claims is equipped. The shop refuses
      // the unlock and the equip earlier; this is the last line.
      if (family === 'triple' && !this.gameState.isWorldBossBeaten(this.gameState.selectedWorldIndex())) return;
      const cd = this.triggerAbility(ability, this.playerBody, this.mouseX, this.mouseY, stats, 'player');
      if (cd <= 0) return;
      if (charged) {
          this.consumeOvercharge();
          return;
      }
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
      this.holdStill.release();
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
          this.holdStill.release();
      }
  }


  public formatTime(seconds: number): string {
    const totalSeconds = Math.floor(seconds);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }




  private triggerDeathSequence() {
    // Never run two death sequences at once.
    if (this.isDead()) return;
    this.isDead.set(true);

    if (this.gameState.currentGameMode() === 'battle') {
        // Battle keeps its shipped defeat behavior: the result is
        // recorded at the defeat, the panel opens immediately, and
        // Accept Fate ends the match. The down state, the fall, and
        // the revive blast are campaign and Endless only.
        this.gameState.isDeadMenuOpen.set(true);
        this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: window.innerHeight + 200 });
        this.gameState.coins.update(c => c + this.battleCoinsCollected());
        // Mode trio: the same result lands in the world's Battle
        // record (the globals above keep feeding the global board).
        this.gameState.recordBattleResult(this.gameState.selectedWorldIndex(),
            this.currentBattleScore(), this.battleTimer(), this.currentBattleCoinsGained());
        this.gameState.syncProgressToServer({
            battleHighscore: this.currentBattleScore(),
            battleBestTime: this.battleTimer(),
            battleBestCoins: this.currentBattleCoinsGained()
        });
        this.stopPhysics();
        return;
    }

    this.stopPhysics();

    // Disable revive if player dies in Annihilation Phase: the
    // flames are extinguished, the panel shows at once, and the run
    // force-ends on its existing timer. No down state, no revives.
    if (this.annihilationModeActive()) {
        this.gameState.isDeadMenuOpen.set(true);
        this.gameState.phoenixOverridePosition.set({ x: window.innerWidth / 2, y: window.innerHeight + 200 });
        setTimeout(() => this.quitGame(), 3000);
        return;
    }

    // Campaign and Endless (flight lore death flow): lethal damage
    // is a knockdown, not a run end. The bird falls, the KO panel
    // opens after it leaves the screen, and the run is recorded
    // only when the player gives up (quitGame) or later ends for
    // real. Endless therefore records at the true end now, not at
    // the knockdown; a revived run keeps accumulating.
    this.enterDownState();
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


  public triggerRageMode() {
      if (this.rageModeActive()) return; // Fix race condition
      // Enrage and overtime (S6 item 4): the run clock (300 s) and
      // the intense track both end before the top of every enrage
      // window in a natural run (the boss arrives at about 128 s,
      // so the old kill screen started at about 172 s of fight
      // time, while enrage rolls reach 195, 234, and 247 s). The
      // top of each window could therefore never be seen outside
      // the harness. Resolution: while a campaign boss is alive
      // and its rolled enrage is still pending, the kill screen
      // defers; tickBossRig starts it 20 s after the enrage lands.
      // The overtime system's purpose is intact (an over-long
      // fight still ends, and pre-boss overtime is unchanged);
      // only the pre-emption of a mechanic Carter mandated for
      // every boss is removed.
      const bossBody = this.enemies.find(e => e.plugin['data']?.type === 'boss');
      const bst = (bossBody?.plugin['data'] as EnemyData | undefined)?.bossState;
      if (bst && !bst.enraged && !this.inBossDefeatSequence() && !this.isDead()) {
          this.rageDeferred = true;
          return;
      }
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


  public triggerImpactEffect(x: number, y: number, isBoss: boolean) {
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
    // Fix Round 2 (A10): impact sparks are now flame shards, not
    // round dots: elongated slivers in a white-gold to flame-red
    // family, spun as they fly. Counts, the per-frame budget,
    // velocities, and durations are exactly as shipped.
    const colors = ['#fff7e0', '#fbbf24', '#f97316', '#dc2626'];

    for (let i = 0; i < numParticles; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'fixed';
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.width = isBoss ? '14px' : '8px';
        particle.style.height = isBoss ? '5px' : '3px';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.borderRadius = '2px';
        particle.style.pointerEvents = 'none';
        particle.style.zIndex = '100';
        document.body.appendChild(particle);

        const angle = Math.random() * Math.PI * 2;
        const velocity = isBoss ? 50 + Math.random() * 150 : 20 + Math.random() * 80;

        anime({
            targets: particle,
            translateX: Math.cos(angle) * velocity,
            translateY: Math.sin(angle) * velocity + (isBoss ? 50 : 20), // slight gravity
            rotate: (Math.random() * 360 - 180),
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
    this.stopDownWatcher();
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
      // The down state dies with the run: its watcher must never
      // fire into the menu or into a later run.
      this.stopDownWatcher();
      this.koPanelOpen.set(false);
      this.gameState.playerDownPhase.set('none');
      this.reviveBlastFx.set(null);
      this.adReviveInFlight = false;
      this.finishRunForAds();
      if (this.gameState.currentGameMode() === 'battle') {
          // If we quit without dying, still add the collected coins
          if (!this.isDead()) {
              this.gameState.coins.update(c => c + this.battleCoinsCollected());
          }
          this.gameState.recordBattleResult(this.gameState.selectedWorldIndex(),
              this.currentBattleScore(), this.battleTimer(), this.currentBattleCoinsGained());
          this.gameState.syncProgressToServer({
              battleHighscore: this.currentBattleScore(),
              battleBestTime: this.battleTimer(),
              battleBestCoins: this.currentBattleCoinsGained()
          });
      } else if (this.gameState.currentGameMode() === 'ai_vs_ai') {
          // Mode trio: AI vs AI results are per-world records too
          // (accumulated win totals for this world).
          this.gameState.recordAiVsAiResult(this.gameState.selectedWorldIndex(),
              this.gameState.ai1Wins(), this.gameState.ai2Wins());
          this.gameState.syncProgressToServer();
      } else if (this.gameState.currentGameMode() === 'endless') {
          this.gameState.recordEndlessRun(this.gameState.selectedWorldIndex(),
              this.gameState.sessionPlayTime(), this.totalSessionKills(), !this.endlessRunCounted);
          this.endlessRunCounted = true;
          this.gameState.syncProgressToServer();
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
      this.gameState.activeScreen.set('menu');
  }
}
