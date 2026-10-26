import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { ABILITIES, GADGETS, WORLDS } from '../../constants/game.constants';
import { PASSIVE_BY_STAT, AD_UPGRADE_MAX_COST, GEM_EXCHANGE_COINS_PER_GEM } from '../../data/balance.constants';
import { WorldStats } from '../../models/game.models';
import { IapService } from '../../services/iap.service';
import { AdsService } from '../../services/ads.service';
import { environment } from '../../../environments/environment';
import { CommonModule } from '@angular/common';



@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 flex flex-col items-center justify-start w-full min-h-screen text-white bg-black/80 backdrop-blur-md p-6 overflow-y-auto">
      <!-- Header -->
      <div class="w-full max-w-5xl flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0 mb-8 mt-4">
        <button (click)="closeShop()" class="text-white/70 hover:text-white flex items-center gap-2 transition px-4 py-2 bg-white/5 rounded-full border border-white/10 hover:bg-white/10 self-start md:self-auto">
          <span class="text-xl">&larr;</span> Back
        </button>
        
        <!-- Current World Badge -->
        <div class="hidden md:flex flex-col items-center">
          <span class="text-xs uppercase tracking-widest text-white/50">Upgrading Realm</span>
          <span class="font-bold text-lg" [ngClass]="currentWorld().textColorClass">{{ currentWorld().name }}</span>
        </div>

        <div class="flex gap-2 md:gap-4 self-end md:self-auto">
          <div class="flex items-center gap-2 bg-black/60 px-3 py-1.5 md:px-4 md:py-2 rounded-full border border-white/10 shadow-[0_0_15px_rgba(255,100,0,0.2)]">
            <img src="assets/coin_icon.png" alt="Coins" class="w-5 h-5 md:w-6 md:h-6 object-contain" />
            <span class="text-lg md:text-xl font-bold text-orange-400">{{ gameState.coins() }}</span>
          </div>
          <div class="flex items-center gap-2 bg-black/60 px-3 py-1.5 md:px-4 md:py-2 rounded-full border border-white/10 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
            <img src="assets/gem_icon.png" alt="Gems" class="w-5 h-5 md:w-6 md:h-6 object-contain" />
            <span class="text-lg md:text-xl font-bold text-purple-400">{{ gameState.gems() }}</span>
          </div>
        </div>
      </div>

      <!-- First purchase bonus: the only promotion in the store, stated
           plainly with no countdown and no fake discounts. (The crazy deal,
           holiday inflation, ghost deal, and deal radar were deleted: audit
           bug 37, Google Play deceptive-behavior risk.) -->
      @if (activeTab() === 'gems' && !gameState.hasPurchasedGems()) {
        <div class="w-full max-w-4xl bg-gradient-to-r from-red-600 to-orange-600 rounded-xl p-4 mb-6 flex justify-between items-center shadow-lg shadow-red-500/50 border border-yellow-400">
          <div class="flex items-center gap-3">
             <span class="text-3xl">🔥</span>
             <div>
                <h3 class="font-black text-white text-xl uppercase tracking-wider">First Purchase Bonus</h3>
                <p class="text-white/80 text-sm font-bold">Your first gem pack grants double gems. Prices shown include the bonus.</p>
             </div>
          </div>
        </div>
      }

      <!-- Tabs -->
      <div class="w-full max-w-lg flex bg-black/40 border border-white/10 rounded-full p-1 mb-8">
        <button (click)="setTab('passives')" 
                [class.bg-white_10]="activeTab() === 'passives'"
                [class.text-orange-400]="activeTab() === 'passives'"
                class="flex-1 py-3 rounded-full font-bold transition-all"
                [ngClass]="activeTab() === 'passives' ? 'bg-white/10 text-orange-400 shadow-md' : 'text-white/50 hover:text-white'">
          Passives
        </button>
        <button (click)="setTab('abilities')" 
                [class.bg-white_10]="activeTab() === 'abilities'"
                [class.text-cyan-400]="activeTab() === 'abilities'"
                class="flex-1 py-3 rounded-full font-bold transition-all"
                [ngClass]="activeTab() === 'abilities' ? 'bg-white/10 text-cyan-400 shadow-md' : 'text-white/50 hover:text-white'">
          Abilities
        </button>
        <button (click)="setTab('gems')" 
                [class.bg-white_10]="activeTab() === 'gems'"
                [class.text-purple-400]="activeTab() === 'gems'"
                class="flex-1 py-3 rounded-full font-bold transition-all flex justify-center items-center gap-2"
                [ngClass]="activeTab() === 'gems' ? 'bg-white/10 text-purple-400 shadow-md' : 'text-white/50 hover:text-white'">
          Premium
        </button>
      </div>

      <!-- Passives Tab -->
      @if (activeTab() === 'passives') {
        <!-- Passive lanes (systems spec Section 5.1, stage S5): the
             nine passives grouped Offense, Survival, Utility. Every
             card shows its step against the hard cap from PASSIVES;
             at the cap the card reads MAX and every purchase path
             (coins, gems, ads) refuses. The ad option appears only
             while the step's coin cost is at most 1,000 (Section
             5.6); above that the card says so plainly. -->
        <div class="w-full max-w-5xl animate-fade-in">
          <h2 class="text-xl font-black text-white uppercase tracking-widest border-b border-white/20 pb-2 mb-4">Offense</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">

          <!-- Damage Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-orange-500/20 rounded-full flex items-center justify-center border border-orange-500/30">
              <span class="text-4xl">🔥</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Firepower</h3>
              <p class="text-white/50 text-sm">Increase Damage</p>
              <p class="text-orange-400 font-mono mt-1">Lvl {{ gameState.currentStats().damage - 10 }} / 10</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('damage')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('damage', 250, 1, 10))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyDamage(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('damage', 250, 1, 10))) {
                     <button (click)="buyWithAd('damage')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('damage', 250, 1, 10)) {
                 @if (adGrantAllowed(getCost('damage', 250, 1, 10))) {
                   <button (click)="buyWithAd('damage')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyDamage()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('damage', 250, 1, 10) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyDamage()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('damage', 250, 1, 10)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('damage', 250, 1, 10) }}
                 </button>
              }
            </div>
          </div>

          <!-- Attack Speed Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center border border-green-500/30">
              <span class="text-4xl">🏹</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Rapid Fire</h3>
              <p class="text-white/50 text-sm">Increase Attack Speed</p>
              <p class="text-green-400 font-mono mt-1">Lvl {{ ((gameState.currentStats().attackSpeed - 1) * 10).toFixed(0) }} / 10</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('attackSpeed')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('attackSpeed', 300, 0.1, 1))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyAttackSpeed(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('attackSpeed', 300, 0.1, 1))) {
                     <button (click)="buyWithAd('attackSpeed')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('attackSpeed', 300, 0.1, 1)) {
                 @if (adGrantAllowed(getCost('attackSpeed', 300, 0.1, 1))) {
                   <button (click)="buyWithAd('attackSpeed')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyAttackSpeed()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('attackSpeed', 300, 0.1, 1) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyAttackSpeed()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('attackSpeed', 300, 0.1, 1)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('attackSpeed', 300, 0.1, 1) }}
                 </button>
              }
            </div>
          </div>

          <!-- Homing Bullets Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30">
              <span class="text-4xl">🎯</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Seeker</h3>
              <p class="text-white/50 text-sm">Homing Bullets</p>
              <p class="text-indigo-400 font-mono mt-1">Lvl {{ gameState.currentStats().homingLevel }} / 5</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('homingLevel')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('homingLevel', 300, 1, 0))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyHoming(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('homingLevel', 300, 1, 0))) {
                     <button (click)="buyWithAd('homingLevel')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('homingLevel', 300, 1, 0)) {
                 @if (adGrantAllowed(getCost('homingLevel', 300, 1, 0))) {
                   <button (click)="buyWithAd('homingLevel')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyHoming()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('homingLevel', 300, 1, 0) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyHoming()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('homingLevel', 300, 1, 0)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('homingLevel', 300, 1, 0) }}
                 </button>
              }
            </div>
          </div>
          </div>

          <h2 class="text-xl font-black text-white uppercase tracking-widest border-b border-white/20 pb-2 mb-4">Survival</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8">

          <!-- Max Health Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center border border-red-500/30">
              <span class="text-4xl">❤️</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Vitality</h3>
              <p class="text-white/50 text-sm">Increase Max Health</p>
              <p class="text-red-400 font-mono mt-1">Lvl {{ (gameState.currentStats().maxHealth - 100) / 10 }} / 10</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('maxHealth')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('maxHealth', 100, 10, 100))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyHealth(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('maxHealth', 100, 10, 100))) {
                     <button (click)="buyWithAd('maxHealth')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('maxHealth', 100, 10, 100)) {
                 @if (adGrantAllowed(getCost('maxHealth', 100, 10, 100))) {
                   <button (click)="buyWithAd('maxHealth')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyHealth()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('maxHealth', 100, 10, 100) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyHealth()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('maxHealth', 100, 10, 100)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('maxHealth', 100, 10, 100) }}
                 </button>
              }
            </div>
          </div>

          <!-- Speed Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500/30">
              <span class="text-4xl">⚡</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Agility</h3>
              <p class="text-white/50 text-sm">Increase Flight Speed</p>
              <p class="text-blue-400 font-mono mt-1">Lvl {{ ((gameState.currentStats().speed - 2) * 10).toFixed(0) }} / 6</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('speed')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('speed', 150, 0.1, 2))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buySpeed(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('speed', 150, 0.1, 2))) {
                     <button (click)="buyWithAd('speed')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('speed', 150, 0.1, 2)) {
                 @if (adGrantAllowed(getCost('speed', 150, 0.1, 2))) {
                   <button (click)="buyWithAd('speed')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buySpeed()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('speed', 150, 0.1, 2) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buySpeed()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('speed', 150, 0.1, 2)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('speed', 150, 0.1, 2) }}
                 </button>
              }
            </div>
          </div>

          <!-- Aegis Plating (new in S5, spec Section 5.2) -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-slate-400/20 rounded-full flex items-center justify-center border border-slate-300/30">
              <span class="text-4xl">🛡️</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Aegis Plating</h3>
              <p class="text-white/50 text-sm">-1 Contact Damage Taken per stack (boss contact excluded)</p>
              <p class="text-slate-300 font-mono mt-1">Lvl {{ gameState.currentStats().aegisPlating }} / 3</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('aegisPlating')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('aegisPlating', 400, 1, 0))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyAegisPlating(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('aegisPlating', 400, 1, 0))) {
                     <button (click)="buyWithAd('aegisPlating')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('aegisPlating', 400, 1, 0)) {
                 @if (adGrantAllowed(getCost('aegisPlating', 400, 1, 0))) {
                   <button (click)="buyWithAd('aegisPlating')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyAegisPlating()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('aegisPlating', 400, 1, 0) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyAegisPlating()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('aegisPlating', 400, 1, 0)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('aegisPlating', 400, 1, 0) }}
                 </button>
              }
            </div>
          </div>
          </div>

          <h2 class="text-xl font-black text-white uppercase tracking-widest border-b border-white/20 pb-2 mb-4">Utility</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">

          <!-- Magnetism Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-purple-500/20 rounded-full flex items-center justify-center border border-purple-500/30">
              <span class="text-4xl">🧲</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Magnetism</h3>
              <p class="text-white/50 text-sm">Attract more coins</p>
              <p class="text-purple-400 font-mono mt-1">Lvl {{ ((gameState.currentStats().magnetism - 1) * 10).toFixed(0) }} / 10</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('magnetism')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('magnetism', 200, 0.1, 1))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyMagnet(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('magnetism', 200, 0.1, 1))) {
                     <button (click)="buyWithAd('magnetism')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('magnetism', 200, 0.1, 1)) {
                 @if (adGrantAllowed(getCost('magnetism', 200, 0.1, 1))) {
                   <button (click)="buyWithAd('magnetism')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyMagnet()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('magnetism', 200, 0.1, 1) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyMagnet()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('magnetism', 200, 0.1, 1)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('magnetism', 200, 0.1, 1) }}
                 </button>
              }
            </div>
          </div>

          <!-- Attack Range Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-teal-500/20 rounded-full flex items-center justify-center border border-teal-500/30">
              <span class="text-4xl">🔭</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Reach</h3>
              <p class="text-white/50 text-sm">Increase Attack Range</p>
              <p class="text-teal-400 font-mono mt-1">Lvl {{ (gameState.currentStats().attackRange - 400) / 50 }} / 5</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('attackRange')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('attackRange', 250, 50, 400))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyAttackRange(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('attackRange', 250, 50, 400))) {
                     <button (click)="buyWithAd('attackRange')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('attackRange', 250, 50, 400)) {
                 @if (adGrantAllowed(getCost('attackRange', 250, 50, 400))) {
                   <button (click)="buyWithAd('attackRange')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyAttackRange()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('attackRange', 250, 50, 400) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyAttackRange()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('attackRange', 250, 50, 400)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('attackRange', 250, 50, 400) }}
                 </button>
              }
            </div>
          </div>

          <!-- Aura Radius Upgrade -->
          <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-lg shadow-black/50">
            <div class="w-20 h-20 bg-cyan-500/20 rounded-full flex items-center justify-center border border-cyan-500/30">
              <span class="text-4xl">🌀</span>
            </div>
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Aura (Hold)</h3>
              <p class="text-white/50 text-sm">Increase Aura Radius</p>
              <p class="text-cyan-400 font-mono mt-1">Lvl {{ (gameState.currentStats().auraRadius - 250) / 10 }} / 10</p>
            </div>
            <div class="w-full mt-4">
              @if (passiveAtMax('auraRadius')) {
                 <div class="w-full py-3 text-center rounded-xl border border-white/15 bg-white/5 text-white/60 font-black tracking-widest">MAX</div>
              } @else if (canAffordWithGemsButNotCoins(getCost('auraRadius', 400, 10, 250))) {
                 <div class="flex gap-2 w-full">
                   <button (click)="buyAuraRadius(true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                     <img src="assets/gem_icon.png" class="w-7 h-7"/>
                   </button>
                   @if (adGrantAllowed(getCost('auraRadius', 400, 10, 250))) {
                     <button (click)="buyWithAd('auraRadius')" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                       <span class="text-2xl">📺</span>
                     </button>
                   } @else {
                     <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                   }
                 </div>
              } @else if (gameState.coins() < getCost('auraRadius', 400, 10, 250)) {
                 @if (adGrantAllowed(getCost('auraRadius', 400, 10, 250))) {
                   <button (click)="buyWithAd('auraRadius')" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                     <span class="text-xl">📺</span>
                   </button>
                 } @else {
                   <button (click)="buyAuraRadius()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 opacity-50" disabled>
                     <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('auraRadius', 400, 10, 250) }}
                   </button>
                   <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                 }
              } @else {
                 <button (click)="buyAuraRadius()" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition" [disabled]="gameState.coins() < getCost('auraRadius', 400, 10, 250)">
                   <img src="assets/coin_icon.png" class="w-5 h-5"/> {{ getCost('auraRadius', 400, 10, 250) }}
                 </button>
              }
            </div>
          </div>
          </div>
        </div>
      }

      <!-- Abilities Tab -->
      @if (activeTab() === 'abilities') {
         <!-- Loadout: the four equip slots (spec Section 3.2). One move
              per family; equipping happens on each move's card. The
              double and triple pools arrive in later stages, so those
              slots read Empty until their families ship. -->
         <div class="w-full max-w-5xl mb-6 bg-white/5 border border-white/10 rounded-3xl p-4 animate-fade-in">
            <div class="text-xs font-bold text-white/50 uppercase tracking-widest mb-3">Loadout</div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
               @for (slot of loadoutSlots; track slot.family) {
                  <div class="bg-black/30 border border-white/10 rounded-2xl px-4 py-3">
                     <div class="text-[10px] font-bold text-white/40 uppercase tracking-widest">{{ slot.label }}</div>
                     <div class="text-white font-bold mt-1 truncate">{{ slot.name }}</div>
                  </div>
               }
            </div>
         </div>
         <div class="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 animate-fade-in pb-12">
            @for (ability of abilitiesList; track ability.id) {
               <div class="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col hover:bg-white/10 transition shadow-lg relative">
                  <!-- Equipped Badge -->
                  @if (gameState.currentStats().activeTapAbility === ability.id || gameState.currentStats().activeHoldAbility === ability.id || gameState.currentStats().activeDoubleAbility === ability.id || gameState.currentStats().activeTripleAbility === ability.id) {
                     <div class="absolute -top-3 right-4 bg-cyan-500 text-black px-3 py-1 rounded-full text-xs font-bold uppercase shadow-lg">Equipped</div>
                  }
                  <div class="flex items-center gap-4 mb-4">
                     <div class="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 shrink-0 text-3xl">
                        {{ ability.icon }}
                     </div>
                     <div>
                        <h3 class="text-xl font-bold text-white flex items-center gap-2">
                           {{ ability.name }}
                           <span class="text-xs bg-white/20 px-2 py-0.5 rounded text-white/70 uppercase">{{ ability.type }}</span>
                        </h3>
                        <p class="text-white/50 text-sm mt-1">{{ ability.desc }}</p>
                     </div>
                  </div>
                  
                  <div class="mt-auto pt-4 border-t border-white/10 flex items-center gap-4">
                     @if (!gameState.currentStats().unlockedAbilities[ability.id]) {
                        <!-- Locked -->
                        @if (ability.type === 'triple' && !gameState.isWorldBossBeaten(gameState.selectedWorldIndex())) {
                           <div class="w-full py-3 px-2 text-center text-amber-300/90 text-sm font-bold border border-amber-400/30 rounded-xl bg-amber-400/10">Beat this realm's boss to unlock its ultimate</div>
                        } @else {
                        <div class="w-full">
                           @if (canAffordWithGemsButNotCoins(ability.unlockCost)) {
                              <div class="flex gap-2 w-full">
                                 <button (click)="unlockAbility(ability.id, ability.unlockCost, true)" class="flex-1 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(200,0,255,0.3)]">
                                    <img src="assets/gem_icon.png" class="w-7 h-7"/>
                                 </button>
                                 @if (adGrantAllowed(ability.unlockCost)) {
                                   <button (click)="buyWithAd('unlock_' + ability.id)" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                                      <span class="text-2xl">📺</span>
                                   </button>
                                 } @else {
                                   <div class="flex-1 py-3 px-2 rounded-xl border border-white/10 text-white/40 text-[11px] font-bold flex items-center justify-center text-center">No ad option above 1,000 coins</div>
                                 }
                              </div>
                           } @else if (gameState.coins() < ability.unlockCost) {
                              @if (adGrantAllowed(ability.unlockCost)) {
                                <button (click)="buyWithAd('unlock_' + ability.id)" class="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-95 transition shadow-[0_0_15px_rgba(0,200,255,0.3)]">
                                   <span class="text-xl">📺</span> Unlock
                                </button>
                              } @else {
                                <button (click)="unlockAbility(ability.id, ability.unlockCost)" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-sm flex items-center justify-center gap-1 opacity-50" disabled>
                                   Unlock <img src="assets/coin_icon.png" class="w-4 h-4"/> {{ ability.unlockCost }}
                                </button>
                                <p class="text-white/40 text-[11px] font-bold text-center mt-2">No ad option above 1,000 coins</p>
                              }
                           } @else {
                              <button (click)="unlockAbility(ability.id, ability.unlockCost)" class="w-full py-3 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-sm flex items-center justify-center gap-1 hover:brightness-110 active:scale-95 transition disabled:opacity-50" [disabled]="gameState.coins() < ability.unlockCost">
                                 Unlock <img src="assets/coin_icon.png" class="w-4 h-4"/> {{ ability.unlockCost }}
                              </button>
                           }
                        </div>
                        }
                     } @else {
                        <!-- Unlocked -->
                        <div class="flex flex-col w-full gap-2">
                           <div class="flex flex-col gap-1 w-full">
                              <span class="text-cyan-400 font-mono text-sm font-bold">Level {{ gameState.currentStats().unlockedAbilities[ability.id].level }}</span>
                              <!-- Dynamic Stats Display -->
                              <div class="flex flex-wrap gap-1 text-[10px] uppercase font-mono">
                                 @for (mod of gameState.currentStats().unlockedAbilities[ability.id].modifiers | keyvalue; track mod.key) {
                                    @if (mod.value !== 1.0) {
                                       <span class="bg-black/30 border border-white/10 px-1.5 py-0.5 rounded text-white/60">
                                          {{ mod.key }}: <span [ngClass]="mod.key === 'cooldown' ? (mod.value < 1.0 ? 'text-green-400' : 'text-red-400') : (mod.value > 1.0 ? 'text-green-400' : 'text-red-400')">{{ mod.value | number:'1.2-2' }}x</span>
                                       </span>
                                    }
                                 }
                              </div>
                           </div>
                           <div class="flex gap-1 w-full mt-2">
                              <button (click)="equipAbility(ability.id, ability.type)" class="flex-1 py-2 bg-white/10 border border-white/20 rounded-xl font-bold text-white text-sm hover:bg-white/20 transition">
                                 Equip
                              </button>
                              @if (canAffordWithGemsButNotCoins(getAbilityCost(ability.id, ability.upgradeCost))) {
                                 <div class="flex-1 flex gap-1">
                                    <button (click)="upgradeAbility(ability.id, getAbilityCost(ability.id, ability.upgradeCost), true)" class="flex-1 py-2 bg-gradient-to-r from-purple-600 to-fuchsia-600 rounded-xl flex items-center justify-center hover:brightness-110 transition disabled:opacity-50">
                                       <img src="assets/gem_icon.png" class="w-4 h-4"/>
                                    </button>
                                    @if (adGrantAllowed(getAbilityCost(ability.id, ability.upgradeCost))) {
                                      <button (click)="buyWithAd('upgrade_' + ability.id)" class="flex-1 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center hover:brightness-110 transition disabled:opacity-50">
                                         <span class="text-lg">📺</span>
                                      </button>
                                    } @else {
                                      <div class="flex-1 py-2 px-1 rounded-xl border border-white/10 text-white/40 text-[10px] font-bold flex items-center justify-center text-center">No ad option above 1,000</div>
                                    }
                                 </div>
                              } @else if (gameState.coins() < getAbilityCost(ability.id, ability.upgradeCost)) {
                                 @if (adGrantAllowed(getAbilityCost(ability.id, ability.upgradeCost))) {
                                   <button (click)="buyWithAd('upgrade_' + ability.id)" class="flex-1 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center gap-1 hover:brightness-110 transition disabled:opacity-50">
                                      <span class="text-lg">📺</span> Upgrade
                                   </button>
                                 } @else {
                                   <button (click)="upgradeAbility(ability.id, getAbilityCost(ability.id, ability.upgradeCost))" class="flex-1 py-2 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-1 opacity-50" disabled>
                                      <img src="assets/coin_icon.png" class="w-3 h-3"/> {{ getAbilityCost(ability.id, ability.upgradeCost) }}
                                   </button>
                                 }
                              } @else {
                                 <button (click)="upgradeAbility(ability.id, getAbilityCost(ability.id, ability.upgradeCost))" class="flex-1 py-2 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-1 hover:brightness-110 transition disabled:opacity-50" [disabled]="gameState.coins() < getAbilityCost(ability.id, ability.upgradeCost)">
                                    <img src="assets/coin_icon.png" class="w-3 h-3"/> {{ getAbilityCost(ability.id, ability.upgradeCost) }}
                                 </button>
                              }
                           </div>
                        </div>
                     }
                  </div>
               </div>
            }
         </div>
      }

      <!-- Gadget Slot (systems spec Section 5.3, stage S3): one
           gadget per world, bought with coins, equipped outside the
           move slots. Each fires at most once per run. -->
      @if (activeTab() === 'abilities') {
         <div class="w-full max-w-5xl mb-6 animate-fade-in">
            <div class="text-xs font-bold text-white/50 uppercase tracking-widest mb-3">Gadget (one per run effect)</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pb-12">
               @for (gadget of gadgetsList; track gadget.id) {
                  <div class="bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col hover:bg-white/10 transition shadow-lg relative">
                     @if (gameState.currentStats().activeGadget === gadget.id) {
                        <div class="absolute -top-3 right-4 bg-cyan-500 text-black px-3 py-1 rounded-full text-xs font-bold uppercase shadow-lg">Equipped</div>
                     }
                     <div class="flex items-center gap-3 mb-3">
                        <div class="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20 shrink-0 text-2xl">{{ gadget.icon }}</div>
                        <h3 class="text-lg font-bold text-white">{{ gadget.name }}</h3>
                     </div>
                     <p class="text-white/50 text-sm">{{ gadget.desc }}</p>
                     <div class="mt-auto pt-4 border-t border-white/10">
                        @if (!gameState.currentStats().unlockedGadgets.includes(gadget.id)) {
                           <button (click)="buyGadget(gadget.id)" class="w-full py-2 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-1 hover:brightness-110 transition disabled:opacity-50" [disabled]="gameState.coins() < gadget.cost">
                              Buy <img src="assets/coin_icon.png" class="w-4 h-4"/> {{ gadget.cost }}
                           </button>
                        } @else if (gameState.currentStats().activeGadget === gadget.id) {
                           <button (click)="equipGadget(null)" class="w-full py-2 bg-white/10 border border-white/20 rounded-xl font-bold text-white text-sm hover:bg-white/20 transition">Unequip</button>
                        } @else {
                           <button (click)="equipGadget(gadget.id)" class="w-full py-2 bg-white/10 border border-white/20 rounded-xl font-bold text-white text-sm hover:bg-white/20 transition">Equip</button>
                        }
                     </div>
                  </div>
               }
            </div>
         </div>
      }

      <!-- Gems Tab -->
      @if (activeTab() === 'gems') {
        @if (!iapService.purchasesEnabled()) {
          <div class="w-full max-w-4xl mb-6 px-6 py-4 rounded-2xl bg-amber-500/10 border border-amber-400/40 text-amber-200 text-center font-semibold animate-fade-in">
            Purchases are not available in this version yet. Nothing here can be bought or charged.
          </div>
        } @else if (iapService.purchasesUnavailable()) {
          <div class="w-full max-w-4xl mb-6 px-6 py-4 rounded-2xl bg-amber-500/10 border border-amber-400/40 text-amber-200 text-center font-semibold animate-fade-in">
            That purchase could not be completed because billing is not configured yet. Nothing was granted.
          </div>
        }
        <div class="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
          
          <!-- Package 1 -->
          <div class="bg-white/5 border border-purple-500/20 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-[0_0_20px_rgba(168,85,247,0.1)] hover:shadow-[0_0_30px_rgba(168,85,247,0.2)] relative overflow-hidden">
            <img src="assets/gem_icon.png" class="w-24 h-24 object-contain drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]" />
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Single Gem</h3>
              <p class="text-purple-400 font-bold text-xl mt-1">{{ calculatedGems()[0] }} Gem</p>
            </div>
            <button (click)="buyGems(calculatedGems()[0], 0)" class="mt-4 w-full py-3 bg-white/10 border border-purple-500/50 rounded-xl font-bold text-lg text-white hover:bg-purple-600/50 hover:border-purple-500 active:scale-95 transition flex justify-center gap-2" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
&dollar;{{ basePrices[0] }}
            </button>
          </div>

          <!-- Package 2 (Best Value) -->
          <div class="relative transform md:-translate-y-2 mt-4 md:mt-0 flex flex-col w-full h-full">
            <!-- Out-of-bounds Ribbon -->
            <div class="absolute -top-3 left-1/2 -translate-x-1/2 bg-purple-500 text-white px-4 py-1 rounded-full text-sm font-bold tracking-widest uppercase shadow-lg z-20 whitespace-nowrap">Most Popular</div>
            
            <!-- Clipped Card -->
            <div class="relative w-full h-full bg-gradient-to-b from-purple-900/40 to-black/40 border border-purple-500/50 rounded-3xl p-6 flex flex-col items-center gap-4 hover:brightness-110 transition shadow-[0_0_30px_rgba(168,85,247,0.3)] overflow-hidden">
                @if (!gameState.hasPurchasedGems()) {
                    <div class="absolute top-4 -right-8 bg-red-600 text-white text-xs font-bold py-1 px-10 rotate-45 shadow-lg z-10 pointer-events-none">2X BONUS</div>
                }
                <img src="assets/gem_icon.png" class="w-32 h-32 object-contain drop-shadow-[0_0_25px_rgba(168,85,247,0.8)] mt-2" />
                <div class="text-center">
                  <h3 class="text-2xl font-bold text-white">Handful of Gems</h3>
                  <p class="text-purple-400 font-bold text-xl mt-1">{{ calculatedGems()[1] }} Gems</p>
                </div>
                <button (click)="buyGems(calculatedGems()[1], 1)" class="mt-4 w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl font-bold text-lg text-white hover:brightness-110 active:scale-95 transition shadow-lg shadow-purple-500/30 flex justify-center gap-2" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
&dollar;{{ basePrices[1] }}
                </button>
            </div>
          </div>

          <!-- Package 3 -->
          <div class="bg-white/5 border border-purple-500/20 rounded-3xl p-6 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-[0_0_20px_rgba(168,85,247,0.1)] hover:shadow-[0_0_30px_rgba(168,85,247,0.2)] relative overflow-hidden">
            @if (!gameState.hasPurchasedGems()) {
                <div class="absolute top-4 -right-8 bg-red-600 text-white text-xs font-bold py-1 px-10 rotate-45 shadow-lg z-10">2X BONUS</div>
            }
            <img src="assets/gem_icon.png" class="w-24 h-24 object-contain drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]" />
            <div class="text-center">
              <h3 class="text-2xl font-bold text-white">Chest of Gems</h3>
              <p class="text-purple-400 font-bold text-xl mt-1">{{ calculatedGems()[2] }} Gems</p>
            </div>
            <button (click)="buyGems(calculatedGems()[2], 2)" class="mt-4 w-full py-3 bg-white/10 border border-purple-500/50 rounded-xl font-bold text-lg text-white hover:bg-purple-600/50 hover:border-purple-500 active:scale-95 transition flex justify-center gap-2" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
&dollar;{{ basePrices[2] }}
            </button>
          </div>

          <!-- Currency Exchange -->
          <div class="col-span-full md:col-span-3 bg-white/5 border border-purple-500/30 rounded-3xl p-6 mt-4 flex flex-col items-center gap-4 hover:bg-white/10 transition shadow-[0_0_20px_rgba(168,85,247,0.15)] relative overflow-hidden">
            <div class="absolute inset-0 bg-gradient-to-r from-purple-900/20 to-transparent"></div>
            <div class="flex flex-col md:flex-row items-center justify-between w-full relative z-10 gap-6">
               <div class="flex items-center gap-4">
                  <div class="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center border border-purple-500/50 shrink-0">
                    <img src="assets/gem_icon.png" class="w-10 h-10 drop-shadow-[0_0_10px_rgba(168,85,247,1)]"/>
                  </div>
                  <div>
                    <h3 class="text-2xl font-bold text-white">Gem Exchange</h3>
                    <p class="text-white/50 text-sm">Exchange 1 Gem for exactly 1,500 Coins, instantly. No multipliers apply.</p>
                  </div>
               </div>
               <div class="flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                  <div class="text-right">
                    <p class="text-white font-bold text-xl flex items-center gap-2 justify-end">
                       -1 <img src="assets/gem_icon.png" class="w-5 h-5"/>
                    </p>
                    <p class="text-orange-400 font-bold text-xl flex items-center gap-2 justify-end mt-1">
                       +1500 <img src="assets/coin_icon.png" class="w-5 h-5"/>
                    </p>
                  </div>
                  <button (click)="exchangeGem()" class="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-xl hover:brightness-110 active:scale-95 transition disabled:opacity-50 disabled:grayscale shrink-0 relative overflow-hidden group" [disabled]="gameState.gems() < 1">
                    <span class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform"></span>
                    Exchange
                  </button>
               </div>
            </div>
          </div>

          <!-- Remove Ads -->
          <div class="col-span-1 md:col-span-3 mt-8">
            <div class="bg-gradient-to-br from-emerald-900/50 to-teal-900/50 border border-emerald-500/50 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              <div class="flex items-center gap-4 mb-4 md:mb-0">
                 <div class="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-500/50 shrink-0">
                    <span class="text-3xl">🚫</span>
                 </div>
                 <div>
                    <h3 class="text-xl font-bold text-white">Remove Ads</h3>
                    <p class="text-emerald-300/80 text-sm">Removes all interstitial ads forever. Optional rewarded ads stay available whenever you choose them.</p>
                    @if (gameState.hasRemoveAds()) {
                      <p class="text-green-400 font-bold text-sm mt-1">✓ Owned</p>
                    }
                 </div>
              </div>
              @if (!gameState.hasRemoveAds()) {
                 <button (click)="buyRemoveAds()" class="px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition flex items-center gap-2 whitespace-nowrap shadow-lg shadow-emerald-500/30" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
                    Buy $4.99
                 </button>
              }
            </div>
          </div>

          <!-- Subscriptions Section -->
          <div class="col-span-1 md:col-span-3 mt-8">
            <h2 class="text-2xl font-black text-white uppercase tracking-widest border-b border-white/20 pb-2 mb-6">Subscriptions</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div class="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 border border-indigo-500/50 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between shadow-[0_0_20px_rgba(99,102,241,0.2)]">
                 <div class="flex items-center gap-4 mb-4 md:mb-0">
                    <div class="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/50 shrink-0">
                       <span class="text-3xl">📦</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white flex items-center gap-2">Monthly Crate Pass</h3>
                       <p class="text-indigo-300/80 text-sm">Get a reward crate once per month: 5,000 Coins and 100 Gems, exactly as shown when it opens.</p>
                       @if (gameState.pendingCratesCount() > 0) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active ({{ gameState.pendingCratesCount() }} Crate(s) Ready to Open)</p>
                       }
                    </div>
                 </div>
                 @if (gameState.pendingCratesCount() > 0) {
                   <button (click)="openPendingCrate()" class="px-8 py-4 bg-gradient-to-r from-amber-500 to-yellow-500 text-black rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition flex items-center gap-2 whitespace-nowrap shadow-lg shadow-amber-500/30">
                      Open Crate
                   </button>
                 } @else {
                   <button (click)="buySubscription()" class="px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition flex items-center gap-2 whitespace-nowrap shadow-lg shadow-indigo-500/30" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
                      Subscribe $2.99/mo
                   </button>
                 }
               </div>
            </div>
          </div>

          <!-- Temporary Boosts Section -->
          <div class="col-span-1 md:col-span-3 mt-8">
            <h2 class="text-2xl font-black text-white uppercase tracking-widest border-b border-white/20 pb-2 mb-6">Temporary Boosts</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div class="bg-gradient-to-br from-blue-900/40 to-cyan-900/40 border border-blue-500/30 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                 <div class="flex items-center gap-4 mb-4 md:mb-0">
                    <div class="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500/50 shrink-0">
                       <span class="text-3xl">⚡</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white">x2 Rewards (1 Min)</h3>
                       <p class="text-blue-300/80 text-sm">Double Coins & XP for 60 seconds. Multipliers combine up to x10 Coins and x4 XP.</p>
                       @if (gameState.tempCoinMultiplier() > 1) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active</p>
                       }
                    </div>
                 </div>
                 <button (click)="buyTempMultiplier(2)" class="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition whitespace-nowrap shadow-lg" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
                    Buy $0.99
                 </button>
               </div>
               
               <div class="bg-gradient-to-br from-fuchsia-900/40 to-pink-900/40 border border-fuchsia-500/30 rounded-3xl p-6 flex flex-col md:flex-row items-center justify-between shadow-[0_0_20px_rgba(217,70,239,0.1)]">
                 <div class="flex items-center gap-4 mb-4 md:mb-0">
                    <div class="w-16 h-16 bg-fuchsia-500/20 rounded-full flex items-center justify-center border border-fuchsia-500/50 shrink-0">
                       <span class="text-3xl">🔥</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white">x10 Rewards (5 Mins)</h3>
                       <p class="text-fuchsia-300/80 text-sm">10x Coins and 4x XP for 5 full minutes. Multipliers combine up to x10 Coins and x4 XP.</p>
                    </div>
                 </div>
                 <button (click)="buyTempMultiplier(10)" class="px-6 py-3 bg-gradient-to-r from-fuchsia-600 to-pink-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition whitespace-nowrap shadow-lg" [disabled]="iapService.isProcessing() || !iapService.purchasesEnabled()">
                    Buy $4.99
                 </button>
               </div>
            </div>
          </div>

          <!-- Permanent Boosts Section -->
          <div class="col-span-1 md:col-span-3 mt-8">
            <h2 class="text-2xl font-black text-white uppercase tracking-widest border-b border-white/20 pb-2 mb-6">Permanent Boosts</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
               <!-- Coin Doubler -->
               <div class="bg-white/5 border border-yellow-500/30 rounded-3xl p-6 flex items-center justify-between shadow-[0_0_20px_rgba(234,179,8,0.1)]">
                 <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center border border-yellow-500/50">
                       <span class="text-3xl">💰</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white">Coin Doubler</h3>
                       <p class="text-yellow-400/80 text-sm">Earn 2x Coins forever! Multipliers combine up to x10 Coins.</p>
                       @if (gameState.coinMultiplier() > 1) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active</p>
                       }
                    </div>
                 </div>
                 @if (gameState.coinMultiplier() === 1) {
                    <button (click)="buyCoinMultiplier()" class="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition disabled:opacity-50 flex items-center gap-2" [disabled]="gameState.gems() < 50">
                       <img src="assets/gem_icon.png" class="w-5 h-5"/> 50
                    </button>
                 }
               </div>

               <!-- XP Doubler -->
               <div class="bg-white/5 border border-blue-500/30 rounded-3xl p-6 flex items-center justify-between shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                 <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500/50">
                       <span class="text-3xl">⭐</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white">XP Doubler</h3>
                       <p class="text-blue-400/80 text-sm">Earn 2x XP forever! Multipliers combine up to x4 XP.</p>
                       @if (gameState.xpMultiplier() > 1) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active</p>
                       }
                    </div>
                 </div>
                 @if (gameState.xpMultiplier() === 1) {
                    <button (click)="buyXpMultiplier()" class="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition disabled:opacity-50 flex items-center gap-2" [disabled]="gameState.gems() < 50">
                       <img src="assets/gem_icon.png" class="w-5 h-5"/> 50
                    </button>
                 }               </div>

               <!-- Cosmic Phoenix Trail -->
               <div class="bg-white/5 border border-pink-500/30 rounded-3xl p-6 flex items-center justify-between shadow-[0_0_20px_rgba(236,72,153,0.1)] col-span-1 md:col-span-2">
                 <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-pink-500/20 rounded-full flex items-center justify-center border border-pink-500/50">
                       <span class="text-3xl">✨</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white flex items-center gap-2">Cosmic Phoenix Trail <span class="bg-pink-500/20 text-pink-400 text-xs px-2 py-0.5 rounded font-bold uppercase">Cosmetic</span></h3>
                       <p class="text-pink-400/80 text-sm">Leave a stunning starry trail that generates passive XP!</p>
                       @if (gameState.hasCosmicTrail()) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active</p>
                       }
                    </div>
                 </div>
                 @if (!gameState.hasCosmicTrail()) {
                    <button (click)="buyCosmicTrail()" class="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition disabled:opacity-50 flex items-center gap-2" [disabled]="gameState.gems() < 200">
                       <img src="assets/gem_icon.png" class="w-5 h-5"/> 200
                    </button>
                 }
               </div>

               <!-- Golden Aura of Midas -->
               <div class="bg-white/5 border border-amber-500/30 rounded-3xl p-6 flex items-center justify-between shadow-[0_0_20px_rgba(245,158,11,0.1)] col-span-1 md:col-span-2">
                 <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center border border-amber-500/50">
                       <span class="text-3xl">📿</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white flex items-center gap-2">Golden Aura of Midas <span class="bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 rounded font-bold uppercase">Cosmetic</span></h3>
                       <p class="text-amber-400/80 text-sm">A beautiful golden ring with a 10% chance to multiply coins by 5x!</p>
                       @if (gameState.hasGoldenAura()) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active</p>
                       }
                    </div>
                 </div>
                 @if (!gameState.hasGoldenAura()) {
                    <button (click)="buyGoldenAura()" class="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition disabled:opacity-50 flex items-center gap-2" [disabled]="gameState.gems() < 300">
                       <img src="assets/gem_icon.png" class="w-5 h-5"/> 300
                    </button>
                 }
               </div>

               <!-- Celestial Shield -->
               <div class="bg-white/5 border border-cyan-500/30 rounded-3xl p-6 flex items-center justify-between shadow-[0_0_20px_rgba(6,182,212,0.1)] col-span-1 md:col-span-2">
                 <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center border border-cyan-500/50">
                       <span class="text-3xl">💠</span>
                    </div>
                    <div>
                       <h3 class="text-xl font-bold text-white flex items-center gap-2">Celestial Shield <span class="bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 rounded font-bold uppercase">Cosmetic</span></h3>
                       <p class="text-cyan-400/80 text-sm">A stunning orbital shield that blocks 1 hit. Recharges slowly.</p>
                       @if (gameState.hasCelestialShield()) {
                         <p class="text-green-400 font-bold text-sm mt-1">✓ Active</p>
                       }
                    </div>
                 </div>
                 @if (!gameState.hasCelestialShield()) {
                    <button (click)="buyCelestialShield()" class="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl font-bold text-lg hover:brightness-110 active:scale-95 transition disabled:opacity-50 flex items-center gap-2" [disabled]="gameState.gems() < 400">
                       <img src="assets/gem_icon.png" class="w-5 h-5"/> 400
                    </button>
                 }
               </div>

            </div>
          </div>

        </div>
      }
      <!-- Payment Processing Modal -->
      @if (iapService.isProcessing()) {
        <div class="fixed inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center z-50">
           <div class="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
           <h3 class="text-2xl font-bold text-white mb-2">Processing Payment...</h3>
           <p class="text-white/50">Contacting Google Play / Payment Provider</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .animate-fade-in {
      animation: fadeIn 0.3s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class ShopComponent implements OnInit {
  activeTab = signal<'passives' | 'abilities' | 'gems'>('passives');
  iapService = inject(IapService);
  private adsService = inject(AdsService);
  currentWorld = computed(() => WORLDS[this.gameState.selectedWorldIndex()]);

  // Honest pricing: these are the prices and amounts, full stop. The first
  // gem purchase grants double, and the amounts below already include that
  // bonus while it applies. (Deleted: dynamic deal pricing with fake
  // inflation, ghost deals, deal radar, and the whale trap modal. Audit
  // bug 37.)
  basePrices = [1.99, 9.99, 49.99];
  baseGems = [20, 150, 1000];

  calculatedGems = computed(() => {
     const firstPurchaseBonus = !this.gameState.hasPurchasedGems();
     return this.baseGems.map(g => firstPurchaseBonus ? g * 2 : g);
  });

  constructor(public gameState: GameStateService) {}

  setTab(tab: 'passives' | 'abilities' | 'gems') {
      this.activeTab.set(tab);
      if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('phoenix_shop_last_tab', tab);
      }
  }

  ngOnInit() {
      let savedTab: string | null = null;
      if (typeof window !== 'undefined' && window.localStorage) {
          savedTab = localStorage.getItem('phoenix_shop_last_tab');
      }

      if (savedTab === 'passives' || savedTab === 'abilities' || savedTab === 'gems') {
          this.activeTab.set(savedTab);
      } else {
          this.activeTab.set('gems');
          if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem('phoenix_shop_last_tab', 'gems');
          }
      }
  }

  get abilitiesList() { return Object.values(ABILITIES); }

  get gadgetsList() { return Object.values(GADGETS); }

  // Gadget slot (spec Section 5.3): bought per world with coins,
  // no upgrade levels, one equipped at a time.
  buyGadget(id: string) {
      const gadget = GADGETS[id];
      if (!gadget) return;
      if (this.gameState.currentStats().unlockedGadgets.includes(id)) return;
      if (this.gameState.coins() < gadget.cost) return;
      this.gameState.coins.update(c => c - gadget.cost);
      this.gameState.worldUpgrades.update(upgrades => {
          const worldId = this.gameState.selectedWorldIndex();
          const stats = upgrades[worldId];
          return { ...upgrades, [worldId]: { ...stats, unlockedGadgets: [...(stats.unlockedGadgets || []), id] } };
      });
      this.gameState.audio.playSFX('buy');
  }

  equipGadget(id: string | null) {
      this.gameState.worldUpgrades.update(upgrades => {
          const worldId = this.gameState.selectedWorldIndex();
          const stats = upgrades[worldId];
          return { ...upgrades, [worldId]: { ...stats, activeGadget: id } };
      });
      this.gameState.audio.playSFX('click');
  }

  
  async buyWithAd(type: string) {
    // The ad-granted upgrade ceiling (spec Section 5.6, stage S5):
    // above 1,000 coins of current cost the ad grants nothing and
    // no ad is shown; the cards hide the option and say why.
    if (!this.adGrantAllowed(this.adTargetCost(type))) return;
    // Passive caps bind on the ad path too (Section 5.2).
    if (PASSIVE_BY_STAT[type] && this.passiveAtMax(type)) return;
    const executeUpgrade = () => {
        if (type.startsWith('unlock_')) {
            const id = type.replace('unlock_', '');
            this.unlockAbility(id, 0, false, true);
            return;
        }
        if (type.startsWith('upgrade_')) {
            const id = type.replace('upgrade_', '');
            this.upgradeAbility(id, 0, false, true);
            return;
        }

        switch(type) {
            case 'maxHealth': this.buyHealth(false, true); break;
            case 'speed': this.buySpeed(false, true); break;
            case 'magnetism': this.buyMagnet(false, true); break;
            case 'damage': this.buyDamage(false, true); break;
            case 'attackSpeed': this.buyAttackSpeed(false, true); break;
            case 'attackRange': this.buyAttackRange(false, true); break;
            case 'auraRadius': this.buyAuraRadius(false, true); break;
            case 'homingLevel': this.buyHoming(false, true); break;
            case 'aegisPlating': this.buyAegisPlating(false, true); break;
        }
    };

    // Real rewarded ad via AdsService (AdMob with SSV). The SSV callback
    // also grants a revive token server-side for logged-in players.
    const rewarded = await this.adsService.showRewarded('upgrade');
    if (rewarded) executeUpgrade();
  }

  closeShop() {
    this.gameState.audio.playSFX('click');
    this.gameState.syncProgressToServer(); // Instantly save any purchased upgrades to backend
    this.gameState.activeScreen.set('menu');
  }

  unlockAbility(id: string, cost: number, useGems: boolean = false, fromAd: boolean = false) {
    // S4 triple gate (systems spec Section 3.4): an ultimate may
    // only be unlocked in a world after that world's boss has been
    // beaten once. Every purchase path, ads included, refuses
    // before the gate; the template shows the reason on the card.
    if (ABILITIES[id]?.type === 'triple' && !this.gameState.isWorldBossBeaten(this.gameState.selectedWorldIndex())) {
        return;
    }
    if (fromAd) {
         if (!this.gameState.currentStats().unlockedAbilities[id]) {
             this.gameState.worldUpgrades.update(upgrades => {
                 const worldId = this.gameState.selectedWorldIndex();
                 const stats = upgrades[worldId];
                 return { ...upgrades, [worldId]: { ...stats, unlockedAbilities: { ...stats.unlockedAbilities, [id]: { level: 1, modifiers: { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 } } } } };
             });
             this.gameState.awardTrophy("Ability Unlocked");
             this.gameState.audio.playSFX('buy');
         }
         return;
    }

    if (useGems) {
        const gemCost = this.getGemCost(cost);
        if (this.gameState.gems() >= gemCost && !this.gameState.currentStats().unlockedAbilities[id]) {
            this.gameState.gems.update(c => c - gemCost);
            this.gameState.worldUpgrades.update(upgrades => {
                const worldId = this.gameState.selectedWorldIndex();
                const stats = upgrades[worldId];
                return { ...upgrades, [worldId]: { ...stats, unlockedAbilities: { ...stats.unlockedAbilities, [id]: { level: 1, modifiers: { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 } } } } };
            });
            this.gameState.awardTrophy("Ability Unlocked");
            this.gameState.audio.playSFX('buy');
        }
    } else if (this.gameState.coins() >= cost && !this.gameState.currentStats().unlockedAbilities[id]) {
        this.gameState.coins.update(c => c - cost);
        this.gameState.worldUpgrades.update(upgrades => {
            const worldId = this.gameState.selectedWorldIndex();
            const stats = upgrades[worldId];
            return { ...upgrades, [worldId]: { ...stats, unlockedAbilities: { ...stats.unlockedAbilities, [id]: { level: 1, modifiers: { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 } } } } };
        });
        this.gameState.awardTrophy("Ability Unlocked");
        this.gameState.audio.playSFX('buy');
    }
  }

  upgradeAbility(id: string, cost: number, useGems: boolean = false, fromAd: boolean = false) {
     if (fromAd) {
         if (this.gameState.currentStats().unlockedAbilities[id]) {
             this.gameState.worldUpgrades.update(upgrades => {
                 const worldId = this.gameState.selectedWorldIndex();
                 const stats = upgrades[worldId];
                 const currentLvl = stats.unlockedAbilities[id]?.level || 1;
                 const currentModifiers = stats.unlockedAbilities[id]?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
                 const newModifiers = this.gameState.generateAbilityUpgrade(id, currentLvl + 1, currentModifiers);
                 return { ...upgrades, [worldId]: { ...stats, unlockedAbilities: { ...stats.unlockedAbilities, [id]: { level: currentLvl + 1, modifiers: newModifiers } } } };
             });
             this.gameState.audio.playSFX('buy');
         }
         return;
     }

     if (useGems) {
         const gemCost = this.getGemCost(cost);
         if (this.gameState.gems() >= gemCost && this.gameState.currentStats().unlockedAbilities[id]) {
             this.gameState.gems.update(c => c - gemCost);
             this.gameState.worldUpgrades.update(upgrades => {
                 const worldId = this.gameState.selectedWorldIndex();
                 const stats = upgrades[worldId];
                 const currentLvl = stats.unlockedAbilities[id]?.level || 1;
                 const currentModifiers = stats.unlockedAbilities[id]?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
                 const newModifiers = this.gameState.generateAbilityUpgrade(id, currentLvl + 1, currentModifiers);
                 return { ...upgrades, [worldId]: { ...stats, unlockedAbilities: { ...stats.unlockedAbilities, [id]: { level: currentLvl + 1, modifiers: newModifiers } } } };
             });
             this.gameState.audio.playSFX('buy');
         }
     } else if (this.gameState.coins() >= cost && this.gameState.currentStats().unlockedAbilities[id]) {
         this.gameState.coins.update(c => c - cost);
         this.gameState.worldUpgrades.update(upgrades => {
             const worldId = this.gameState.selectedWorldIndex();
             const stats = upgrades[worldId];
             const currentLvl = stats.unlockedAbilities[id]?.level || 1;
             const currentModifiers = stats.unlockedAbilities[id]?.modifiers || { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0 };
             const newModifiers = this.gameState.generateAbilityUpgrade(id, currentLvl + 1, currentModifiers);
             return { ...upgrades, [worldId]: { ...stats, unlockedAbilities: { ...stats.unlockedAbilities, [id]: { level: currentLvl + 1, modifiers: newModifiers } } } };
         });
         this.gameState.audio.playSFX('buy');
     }
  }

  equipAbility(id: string, type: 'tap' | 'double' | 'hold' | 'triple') {
      // S4 triple gate, equip path (see unlockAbility).
      if (type === 'triple' && !this.gameState.isWorldBossBeaten(this.gameState.selectedWorldIndex())) {
          return;
      }
      this.gameState.worldUpgrades.update(upgrades => {
          const worldId = this.gameState.selectedWorldIndex();
          const stats = upgrades[worldId];
          return {
              ...upgrades,
              [worldId]: {
                  ...stats,
                  activeTapAbility: type === 'tap' ? id : stats.activeTapAbility,
                  activeHoldAbility: type === 'hold' ? id : stats.activeHoldAbility,
                  activeDoubleAbility: type === 'double' ? id : stats.activeDoubleAbility,
                  activeTripleAbility: type === 'triple' ? id : stats.activeTripleAbility
              }
          };
      });
  }

  // The four equip slots with their current occupants, for the
  // loadout strip (spec Section 3.2).
  get loadoutSlots() {
      const stats = this.gameState.currentStats();
      const nameOf = (id: string | null) => id ? (ABILITIES[id]?.name || id) : 'Empty';
      return [
          { family: 'tap', label: 'Tap', name: nameOf(stats.activeTapAbility) },
          { family: 'double', label: 'Double-Tap', name: nameOf(stats.activeDoubleAbility) },
          { family: 'hold', label: 'Hold', name: nameOf(stats.activeHoldAbility) },
          { family: 'triple', label: 'Triple-Tap (Ultimate)', name: nameOf(stats.activeTripleAbility) }
      ];
  }

  getCost(stat: keyof WorldStats, baseCost: number, step: number, offset: number): number {
     const currentVal = this.gameState.currentStats()[stat] as number;
     const level = Math.max(0, (currentVal - offset) / step);
     return Math.floor(baseCost * Math.pow(1.5, level));
  }

  // Passive hard caps (spec Section 5.2, stage S5): a passive at
  // its cap value refuses every purchase path, and its card reads
  // MAX. The cap table is PASSIVES in balance.constants.ts.
  passiveAtMax(stat: string): boolean {
     const def = PASSIVE_BY_STAT[stat];
     if (!def) return false;
     const current = (this.gameState.currentStats() as any)[stat] as number;
     return typeof current === 'number' && current >= def.maxValue;
  }

  passiveSteps(stat: string): number {
     const def = PASSIVE_BY_STAT[stat];
     if (!def) return 0;
     const current = (this.gameState.currentStats() as any)[stat] as number;
     return Math.max(0, Math.round((current - def.baseValue) / def.stepAmount));
  }

  // The ad-granted upgrade ceiling (spec Section 5.6): the ad
  // option exists only while the step's current coin cost is at
  // most AD_UPGRADE_MAX_COST (1,000).
  adGrantAllowed(coinCost: number): boolean {
     return coinCost <= AD_UPGRADE_MAX_COST;
  }

  // The current coin cost of whatever buyWithAd would grant, so
  // the ceiling check prices the same step the ad would buy.
  private adTargetCost(type: string): number {
     if (type.startsWith('unlock_')) {
         const id = type.replace('unlock_', '');
         return ABILITIES[id]?.unlockCost ?? 0;
     }
     if (type.startsWith('upgrade_')) {
         const id = type.replace('upgrade_', '');
         return ABILITIES[id] ? this.getAbilityCost(id, ABILITIES[id].upgradeCost) : 0;
     }
     const def = PASSIVE_BY_STAT[type];
     if (!def) return 0;
     return this.getCost(def.stat as keyof WorldStats, def.stepCost, def.stepAmount, def.baseValue);
  }

  getGemCost(coinCost: number): number {
      // Gem price for coin-priced upgrades: grows with the coin cost
      return Math.max(1, Math.ceil(Math.pow(coinCost / 80, 1.35)));
  }

  canAffordWithGemsButNotCoins(cost: number): boolean {
      return this.gameState.coins() < cost && this.gameState.gems() >= this.getGemCost(cost);
  }

  getAbilityCost(id: string, baseCost: number): number {
     const level = this.gameState.currentStats().unlockedAbilities[id]?.level || 1;
     return Math.floor(baseCost * Math.pow(1.5, level - 1));
  }

  buyCoinMultiplier() {
    if (this.gameState.gems() >= 50 && this.gameState.coinMultiplier() === 1) {
        this.gameState.gems.update(g => g - 50);
        this.gameState.coinMultiplier.set(2);
        this.gameState.audio.playSFX('buy');
    }
  }



  buyCosmicTrail() {
    if (this.gameState.gems() >= 200 && !this.gameState.hasCosmicTrail()) {
        this.gameState.gems.update(g => g - 200);
        this.gameState.hasCosmicTrail.set(true);
        this.gameState.audio.playSFX('buy');
    }
  }

  buyGoldenAura() {
    if (this.gameState.gems() >= 300 && !this.gameState.hasGoldenAura()) {
        this.gameState.gems.update(g => g - 300);
        this.gameState.hasGoldenAura.set(true);
        this.gameState.audio.playSFX('buy');
    }
  }

  buyCelestialShield() {
    if (this.gameState.gems() >= 400 && !this.gameState.hasCelestialShield()) {
        this.gameState.gems.update(g => g - 400);
        this.gameState.hasCelestialShield.set(true);
        this.gameState.audio.playSFX('buy');
    }
  }

  buyXpMultiplier() {
    if (this.gameState.gems() >= 50 && this.gameState.xpMultiplier() === 1) {
        this.gameState.gems.update(g => g - 50);
        this.gameState.xpMultiplier.set(2);
        this.gameState.audio.playSFX('buy');
    }
  }

  buyHealth(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('maxHealth')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('maxHealth', 100, 10, 100);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].maxHealth += 10;
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].maxHealth += 10;
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].maxHealth += 10;
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buySpeed(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('speed')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('speed', 150, 0.1, 2);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].speed = +(u[this.gameState.selectedWorldIndex()].speed + 0.1).toFixed(2);
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].speed = +(u[this.gameState.selectedWorldIndex()].speed + 0.1).toFixed(2);
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].speed = +(u[this.gameState.selectedWorldIndex()].speed + 0.1).toFixed(2);
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buyMagnet(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('magnetism')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('magnetism', 200, 0.1, 1);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].magnetism = +(u[this.gameState.selectedWorldIndex()].magnetism + 0.1).toFixed(2);
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].magnetism = +(u[this.gameState.selectedWorldIndex()].magnetism + 0.1).toFixed(2);
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].magnetism = +(u[this.gameState.selectedWorldIndex()].magnetism + 0.1).toFixed(2);
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buyDamage(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('damage')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('damage', 250, 1, 10);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].damage += 1;
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].damage += 1;
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].damage += 1;
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buyAttackSpeed(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('attackSpeed')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('attackSpeed', 300, 0.1, 1);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].attackSpeed = +(u[this.gameState.selectedWorldIndex()].attackSpeed + 0.1).toFixed(2);
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].attackSpeed = +(u[this.gameState.selectedWorldIndex()].attackSpeed + 0.1).toFixed(2);
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].attackSpeed = +(u[this.gameState.selectedWorldIndex()].attackSpeed + 0.1).toFixed(2);
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buyAttackRange(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('attackRange')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('attackRange', 250, 50, 400);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].attackRange += 50;
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].attackRange += 50;
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].attackRange += 50;
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buyAuraRadius(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('auraRadius')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('auraRadius', 400, 10, 250);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].auraRadius += 10;
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].auraRadius += 10;
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].auraRadius += 10;
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  buyHoming(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('homingLevel')) return; // S5 hard cap (Section 5.2)

    const cost = this.getCost('homingLevel', 300, 1, 0);
        if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].homingLevel += 1;
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].homingLevel += 1;
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].homingLevel += 1;
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  // Aegis Plating (spec Section 5.2, stage S5): minus 1 contact
  // damage per stack, 3 stacks at most, in the Survival lane. Same
  // three-path shape as the other passives; the cap guard is first.
  buyAegisPlating(useGems: boolean = false, isFree: boolean = false) {
    if (this.passiveAtMax('aegisPlating')) return; // S5 hard cap (Section 5.2)
    const cost = this.getCost('aegisPlating', 400, 1, 0);
    if (isFree) {
      this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].aegisPlating = (u[this.gameState.selectedWorldIndex()].aegisPlating || 0) + 1;
          return { ...u };
        });
      this.gameState.audio.playSFX('buy');
    } else if (useGems) {
      const gemCost = this.getGemCost(cost);
      if (this.gameState.gems() >= gemCost) {
        this.gameState.gems.update(c => c - gemCost);
        this.gameState.worldUpgrades.update(u => {
          u[this.gameState.selectedWorldIndex()].aegisPlating = (u[this.gameState.selectedWorldIndex()].aegisPlating || 0) + 1;
          return { ...u };
        });
        this.gameState.audio.playSFX('buy');
      }
    } else if (this.gameState.coins() >= cost) {
      this.gameState.coins.update(c => c - cost);
      this.gameState.worldUpgrades.update(u => {
        u[this.gameState.selectedWorldIndex()].aegisPlating = (u[this.gameState.selectedWorldIndex()].aegisPlating || 0) + 1;
        return { ...u };
      });
      this.gameState.audio.playSFX('buy');
    }
  }

  // The gem exchange (spec Section 5.6, stage S5): a plain
  // exchange, 1 gem for exactly 1,500 coins, granted instantly and
  // directly (no multiplier, no spin; the old gacha presentation
  // and its 1 second spin delay are gone).
  exchangeGem() {
    if (this.gameState.gems() >= 1) {
      this.gameState.gems.update(g => g - 1);
      this.gameState.coins.update(c => c + GEM_EXCHANGE_COINS_PER_GEM);
      this.gameState.audio.playSFX('buy');
    }
  }

  // Opens one pending monthly crate (stage S5: crates no longer
  // drop inside runs, so the opening lives here on the card that
  // announces them).
  openPendingCrate() {
    if (this.gameState.pendingCratesCount() <= 0) return;
    this.gameState.audio.playSFX('click');
    this.gameState.activeScreen.set('crate_opening');
  }

  buyGems(amount: number, tierIndex: number) {
    let sku = environment.googlePlay.skuTier1;
    if (tierIndex === 1) sku = environment.googlePlay.skuTier2;
    if (tierIndex === 2) sku = environment.googlePlay.skuTier3;

    this.iapService.orderProduct(sku, amount);
  }

  buyRemoveAds() {
     this.iapService.orderProduct(environment.googlePlay.skuRemoveAds, 0);
  }

  buySubscription() {
     this.iapService.orderSubscription(environment.googlePlay.subMonthlyStandard);
  }

  buyTempMultiplier(multiplier: number) {
     if (multiplier === 2) {
        this.iapService.orderProduct(environment.googlePlay.skuTempMultiplierX2, 0);
     } else if (multiplier === 10) {
        this.iapService.orderProduct(environment.googlePlay.skuTempMultiplierX10, 0);
     }
  }
}
