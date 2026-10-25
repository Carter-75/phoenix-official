import { Component, inject, signal, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import anime from 'animejs';

@Component({
  selector: 'app-ad-bubble',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isVisible() && !isPopped()) {
       <div #bubble class="fixed z-[999] cursor-pointer hover:scale-110 transition-transform pointer-events-auto"
            (click)="onBubbleClick()"
            [style.left.px]="x()"
            [style.top.px]="y()">
          <div class="relative w-16 h-16 rounded-full bg-gradient-to-br from-blue-300/40 to-purple-500/40 border border-white/50 backdrop-blur-sm shadow-[0_0_15px_rgba(255,255,255,0.5)] flex flex-col items-center justify-center animate-[pulse_2s_ease-in-out_infinite]">
             <span class="absolute top-1 left-2 w-3 h-1 bg-white/60 rounded-full rotate-[-45deg]"></span>
             <span class="text-xl drop-shadow-md z-10">{{ getRewardIcon() }}</span>
             <span class="text-[10px] font-black text-white bg-red-600 px-1 rounded absolute -bottom-2 border border-red-900 shadow-sm z-10">AD</span>
          </div>
       </div>
    }
    
    @if (showOfferPrompt()) {
       <div class="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex items-center justify-center pointer-events-auto">
          <div class="bg-zinc-900 border border-white/20 p-8 rounded-3xl max-w-sm w-full flex flex-col items-center shadow-[0_0_50px_rgba(0,0,0,0.8)] text-center">
             <h2 class="text-3xl font-black text-white mb-2">Special Offer!</h2>
             <p class="text-white/70 mb-6">Watch a short ad to receive a free reward!</p>
             
             <div class="bg-black/50 border border-white/10 rounded-2xl p-6 w-full flex flex-col items-center mb-8">
                <span class="text-5xl mb-2">{{ getRewardIcon() }}</span>
                <span class="text-2xl font-bold text-white">{{ rewardText() }}</span>
             </div>
             
             <div class="flex gap-4 w-full">
                <button (click)="declineOffer()" class="flex-1 py-3 bg-red-900/30 hover:bg-red-800/50 border border-red-500/50 rounded-xl text-white font-bold transition">
                   Decline
                </button>
                <button (click)="acceptOffer()" class="flex-1 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:brightness-125 border border-cyan-400/50 rounded-xl text-white font-bold transition flex justify-center items-center gap-2">
                   <span>Watch</span> <span class="text-xl">📺</span>
                </button>
             </div>
          </div>
       </div>
    }
  `
})
export class AdBubbleComponent implements OnInit, OnDestroy {
  @ViewChild('bubble') bubbleRef!: ElementRef;

  private gameState = inject(GameStateService);
  private audioService = inject(AudioService);

  public isVisible = signal<boolean>(false);
  public isPopped = signal<boolean>(false);
  public showOfferPrompt = signal<boolean>(false);
  
  public x = signal<number>(0);
  public y = signal<number>(0);
  
  private dx = 1;
  private dy = 1;
  private spawnInterval: any;
  private moveInterval: any;
  
  public rewardType = signal<'coins' | 'gems' | 'xp_multiplier'>('coins');
  public rewardAmount = signal<number>(0);
  
  ngOnInit() {
      // Try to spawn every 60 seconds.
      this.spawnInterval = setInterval(() => {
          const allowedScreens = ['menu', 'shop', 'profile', 'leaderboard', 'codex'];
          if (!allowedScreens.includes(this.gameState.activeScreen())) return;
          if (!this.isVisible() && !this.showOfferPrompt()) {
              if (Math.random() < 0.3) { // 30% chance every minute
                  this.spawnBubble();
              }
          }
      }, 60000);
      
      // Initial spawn check for testing? No, keep it rare.
  }
  
  ngOnDestroy() {
      clearInterval(this.spawnInterval);
      clearInterval(this.moveInterval);
  }
  
  private spawnBubble() {
      this.isPopped.set(false);
      this.isVisible.set(true);
      
      // Randomize reward
      const rand = Math.random();
      if (rand < 0.6) {
          this.rewardType.set('coins');
          this.rewardAmount.set(500 * Math.max(1, this.gameState.selectedWorldIndex() + 1));
      } else if (rand < 0.9) {
          this.rewardType.set('gems');
          this.rewardAmount.set(10);
      } else {
          this.rewardType.set('xp_multiplier');
          this.rewardAmount.set(2); // x2 multiplier
      }
      
      // Start position (random edge)
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { this.x.set(Math.random() * window.innerWidth); this.y.set(-50); this.dx = Math.random() > 0.5 ? 1 : -1; this.dy = 1; }
      if (edge === 1) { this.x.set(Math.random() * window.innerWidth); this.y.set(window.innerHeight + 50); this.dx = Math.random() > 0.5 ? 1 : -1; this.dy = -1; }
      if (edge === 2) { this.x.set(-50); this.y.set(Math.random() * window.innerHeight); this.dx = 1; this.dy = Math.random() > 0.5 ? 1 : -1; }
      if (edge === 3) { this.x.set(window.innerWidth + 50); this.y.set(Math.random() * window.innerHeight); this.dx = -1; this.dy = Math.random() > 0.5 ? 1 : -1; }
      
      this.moveInterval = setInterval(() => {
          const allowedScreens = ['menu', 'shop', 'profile', 'leaderboard', 'codex'];
          if (!allowedScreens.includes(this.gameState.activeScreen())) {
              this.despawnBubble();
              return;
          }
          this.x.update(v => v + this.dx * 1.5);
          this.y.update(v => v + Math.sin(Date.now() / 500) * 2 + this.dy * 1.5); // Wobbly float
          
          if (this.x() < -100 || this.x() > window.innerWidth + 100 || this.y() < -100 || this.y() > window.innerHeight + 100) {
              this.despawnBubble();
          }
      }, 30);
  }
  
  private despawnBubble() {
      this.isVisible.set(false);
      clearInterval(this.moveInterval);
  }
  
  public onBubbleClick() {
      this.audioService.playSFX('click');
      clearInterval(this.moveInterval); // Stop moving
      this.showOfferPrompt.set(true);
  }
  
  public getRewardIcon(): string {
      if (this.rewardType() === 'coins') return '🪙';
      if (this.rewardType() === 'gems') return '💎';
      return '⭐'; // XP multiplier
  }
  
  public rewardText(): string {
      if (this.rewardType() === 'coins') return `+${this.rewardAmount()} Coins`;
      if (this.rewardType() === 'gems') return `+${this.rewardAmount()} Gems`;
      return `${this.rewardAmount()}x XP (5 min)`;
  }
  
  public declineOffer() {
      this.showOfferPrompt.set(false);
      this.audioService.playSFX('click');
      this.triggerPopAnimation();
  }
  
  public acceptOffer() {
      this.audioService.pauseCurrentBgm();
      
      const win = window as any;
      if (typeof win.adBreak === 'function') {
          win.adBreak({
              type: 'reward',
              name: 'bubble_reward',
              beforeReward: (showAdFn: any) => { showAdFn(); },
              adViewed: () => {
                  this.grantReward();
              },
              adDismissed: () => {
                  this.declineOffer();
              },
              beforeAd: () => {
                  this.audioService.pauseAudioForAd();
              },
              afterAd: () => {
                  this.audioService.resumeAudioAfterAd();
                  this.showOfferPrompt.set(false);
                  this.triggerPopAnimation();
              }
          });
      } else {
          // Mock ad
          setTimeout(() => {
              this.audioService.resumeAudioAfterAd();
              this.grantReward();
          }, 2000);
      }
  }
  
  private grantReward() {
      this.audioService.playSFX('heal');
      
      if (this.rewardType() === 'coins') {
          this.gameState.coins.update(c => c + this.rewardAmount());
      } else if (this.rewardType() === 'gems') {
          this.gameState.gems.update(g => g + this.rewardAmount());
      } else if (this.rewardType() === 'xp_multiplier') {
          this.gameState.grantTemporaryMultiplier('xp', this.rewardAmount(), 5);
      }
      
      this.gameState.syncProgressToServer();
      this.showOfferPrompt.set(false);
      this.triggerPopAnimation();
  }
  
  private triggerPopAnimation() {
      this.isPopped.set(true);
      if (!this.bubbleRef) {
          this.despawnBubble();
          return;
      }
      
      const el = this.bubbleRef.nativeElement;
      anime({
          targets: el,
          scale: 1.5,
          opacity: 0,
          duration: 300,
          easing: 'easeOutQuad',
          complete: () => {
              this.despawnBubble();
          }
      });
  }
}
