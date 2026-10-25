import { Component, inject, signal, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService } from '../../services/game-state.service';
import anime from 'animejs';
import { AudioService } from '../../services/audio.service';

@Component({
  selector: 'app-crate-opening',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 w-full h-full bg-black/90 backdrop-blur-md flex flex-col items-center justify-center z-50 overflow-hidden">
      
      <!-- Crate Container -->
      <div #crateContainer class="relative z-20 cursor-pointer w-64 h-64 flex items-center justify-center" (click)="openCrate()">
         @if (!isOpened()) {
            <!-- Unopened Crate visual -->
            <div class="w-48 h-48 bg-gradient-to-b from-yellow-500 to-amber-700 border-8 border-yellow-800 rounded-lg shadow-[0_0_50px_rgba(251,191,36,0.5)] flex items-center justify-center relative overflow-hidden">
                <div class="absolute inset-0 bg-white/20 blur-xl opacity-50"></div>
                <!-- Lock / Center piece -->
                <div class="w-16 h-16 bg-gradient-to-br from-gray-300 to-gray-600 rounded-full border-4 border-gray-800 flex items-center justify-center shadow-lg">
                   <div class="w-4 h-8 bg-gray-800 rounded-full"></div>
                </div>
            </div>
            
            <p class="absolute -bottom-10 text-white/50 animate-pulse font-mono uppercase tracking-widest text-sm">Tap to Open</p>
         } @else {
            <!-- Opened Crate visual -->
            <div class="w-48 h-48 bg-gradient-to-b from-yellow-700 to-amber-900 border-8 border-yellow-900 rounded-lg opacity-50 flex flex-col justify-end">
                <div class="w-full h-1/2 bg-black/50 border-t-8 border-yellow-900"></div>
            </div>
         }
      </div>

      <!-- Rewards Overlay -->
      @if (showRewards()) {
          <div class="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none mt-40">
             <h2 class="text-5xl font-black text-white drop-shadow-lg mb-8 uppercase tracking-widest animate-[bounce_1s_ease-in-out_infinite]">Monthly Crate</h2>
             
             <div class="flex gap-12">
                 <div class="flex flex-col items-center bg-black/50 border border-yellow-500/50 p-6 rounded-2xl shadow-[0_0_30px_rgba(251,191,36,0.3)]">
                     <span class="text-5xl mb-2">🪙</span>
                     <span class="text-3xl font-bold text-yellow-400">{{ coinsRewarded() }}</span>
                     <span class="text-sm text-white/50 font-mono mt-1">COINS</span>
                     @if (gameState.tempCoinMultiplier() > 1) {
                         <span class="text-xs text-green-400 font-bold mt-2 px-2 py-1 bg-green-900/50 rounded">x{{ gameState.tempCoinMultiplier() }} ACTIVE</span>
                     }
                 </div>
                 
                 <div class="flex flex-col items-center bg-black/50 border border-fuchsia-500/50 p-6 rounded-2xl shadow-[0_0_30px_rgba(217,70,239,0.3)]">
                     <img src="assets/gem_icon.png" class="w-12 h-12 mb-2 object-contain filter drop-shadow-lg" />
                     <span class="text-3xl font-bold text-fuchsia-400">{{ gemsRewarded() }}</span>
                     <span class="text-sm text-white/50 font-mono mt-1">GEMS</span>
                 </div>
             </div>
             
             <button (click)="claimAndClose()" class="mt-16 px-12 py-4 bg-white text-black font-black text-2xl rounded-full hover:scale-105 active:scale-95 transition pointer-events-auto shadow-[0_0_20px_rgba(255,255,255,0.5)]">
                 COLLECT
             </button>
          </div>
      }
    </div>
  `
})
export class CrateOpeningComponent implements OnInit {
  @ViewChild('crateContainer') crateContainer!: ElementRef;
  
  public gameState = inject(GameStateService);
  private audioService = inject(AudioService);
  
  public isOpened = signal<boolean>(false);
  public showRewards = signal<boolean>(false);
  
  public coinsRewarded = signal<number>(0);
  public gemsRewarded = signal<number>(0);
  
  ngOnInit() {
      this.audioService.playIntenseBgm(0); // Suspenseful music
  }

  public openCrate() {
      if (this.isOpened()) return;
      this.isOpened.set(true);
      
      this.audioService.playSFX('explosion');
      
      // Calculate Rewards
      const baseCoins = 5000;
      const baseGems = 100;
      
      const actualCoins = baseCoins * this.gameState.tempCoinMultiplier();
      const actualGems = baseGems * this.gameState.tempCoinMultiplier(); // Multipliers boost gems too in the crate
      
      this.coinsRewarded.set(actualCoins);
      this.gemsRewarded.set(actualGems);
      
      // Vibrate/Shake
      anime({
          targets: this.crateContainer.nativeElement,
          translateX: [
            { value: -10, duration: 50 },
            { value: 10, duration: 50 },
            { value: -10, duration: 50 },
            { value: 10, duration: 50 },
            { value: 0, duration: 50 }
          ],
          scale: [1, 1.2, 0.8, 1],
          easing: 'easeInOutQuad'
      });
      
      // Particle spray
      this.sprayParticles('coin', 30);
      this.sprayParticles('gem', 10);
      
      // Show rewards UI after particles
      setTimeout(() => {
          this.showRewards.set(true);
          this.gameState.addCoins(baseCoins); // The addCoins handles the multipliers inside the service
          this.gameState.gems.update(g => g + baseGems);
          this.gameState.syncProgressToServer();
      }, 1500);
  }
  
  public claimAndClose() {
      this.gameState.activeScreen.set('menu');
      this.audioService.playMenuBgm();
  }
  
  private sprayParticles(type: 'coin' | 'gem', count: number) {
      const container = this.crateContainer.nativeElement as HTMLElement;
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      
      const colors = type === 'coin' ? ['#fbbf24', '#f59e0b', '#d97706'] : ['#d946ef', '#c026d3', '#a21caf'];
      
      for(let i=0; i<count; i++) {
          const p = document.createElement('div');
          p.style.position = 'fixed';
          p.style.left = cx + 'px';
          p.style.top = cy + 'px';
          p.style.width = type === 'coin' ? '16px' : '20px';
          p.style.height = type === 'coin' ? '16px' : '20px';
          p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
          p.style.borderRadius = type === 'coin' ? '50%' : '4px';
          if (type === 'coin') p.style.border = '2px solid #b45309';
          p.style.pointerEvents = 'none';
          p.style.zIndex = '40';
          document.body.appendChild(p);
          
          const angle = (Math.PI * 1.5) + (Math.random() - 0.5); // Upwards arc
          const velocity = 300 + Math.random() * 500;
          
          anime({
              targets: p,
              translateX: Math.cos(angle) * velocity,
              translateY: Math.sin(angle) * velocity + 400, // Gravity
              rotate: Math.random() * 720,
              opacity: [1, 1, 0],
              duration: 1500 + Math.random() * 1000,
              easing: 'easeOutCirc',
              complete: () => p.remove()
          });
      }
  }
}
