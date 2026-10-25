import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ParticleBgComponent } from './components/particle-bg/particle-bg.component';
import { AdBubbleComponent } from './components/ad-bubble/ad-bubble.component';
import { GameStateService } from './services/game-state.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ParticleBgComponent, AdBubbleComponent],
  template: `
    <app-particle-bg></app-particle-bg>
    <app-ad-bubble></app-ad-bubble>
    
    <div class="absolute inset-0 z-10 w-full h-full min-h-screen">
      <router-outlet></router-outlet>

      <!-- Global Policy Modal -->
      @if (!gameState.acceptedLegalPolicies()) {
         <div class="fixed inset-0 bg-black/95 flex flex-col items-center justify-center z-[500] px-4 backdrop-blur-md pointer-events-auto">
            <div class="w-full max-w-lg bg-zinc-900 border border-cyan-500/50 rounded-3xl p-8 flex flex-col items-center text-center shadow-[0_0_50px_rgba(0,255,255,0.2)]">
               <h2 class="text-3xl font-black text-white mb-4">Welcome to Phoenix Fall</h2>
               <p class="text-white/80 mb-6 leading-relaxed">
                  Before you play, please review our 
                  <button (click)="showLegal('tos')" class="text-cyan-400 underline underline-offset-2 font-bold hover:text-cyan-300 mx-1">Terms of Service</button>, 
                  <button (click)="showLegal('privacy')" class="text-cyan-400 underline underline-offset-2 font-bold hover:text-cyan-300 mx-1">Privacy Policy</button>, and 
                  <button (click)="showLegal('refunds')" class="text-cyan-400 underline underline-offset-2 font-bold hover:text-cyan-300 mx-1">Refund Policy</button>. 
                  You must accept these policies to play.
               </p>
               <div class="flex flex-col w-full gap-4">
                  <button (click)="acceptPolicies()" class="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl font-bold text-xl text-white hover:brightness-110 active:scale-95 transition">
                     I Accept & Continue
                  </button>
                  <button (click)="refusePolicies()" class="w-full py-4 bg-black/50 border border-white/10 text-white/50 hover:bg-red-900/50 hover:text-white hover:border-red-500/50 rounded-xl font-bold transition">
                     Refuse & Leave Game
                  </button>
               </div>
            </div>
         </div>
      }

      <!-- Legal Document Reader Modal -->
      @if (activeLegalDoc) {
          <div class="fixed inset-0 bg-black/95 flex flex-col items-center justify-center z-[600] px-4 backdrop-blur-md pointer-events-auto">
             <div class="w-full max-w-2xl bg-zinc-900 border border-cyan-500/50 rounded-3xl p-8 flex flex-col max-h-[80vh] shadow-[0_0_30px_rgba(0,255,255,0.2)]">
                 <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-white">{{ getLegalTitle() }}</h2>
                    <button (click)="activeLegalDoc = null" class="text-white/50 hover:text-white text-3xl font-black">&times;</button>
                 </div>
                 <div class="overflow-y-auto text-white/80 text-sm md:text-base space-y-4 pr-4 custom-scrollbar leading-relaxed">
                    {{ getLegalContent() }}
                 </div>
                 <button (click)="activeLegalDoc = null" class="mt-8 w-full py-4 bg-cyan-600/20 border border-cyan-500 hover:bg-cyan-600/40 rounded-xl font-bold text-cyan-300 transition text-xl">Understood</button>
             </div>
          </div>
      }

    </div>
  `,
})
export class App {
  constructor(public gameState: GameStateService, private auth: AuthService) {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      if (token) {
          localStorage.setItem('auth_token', token);
          const mode = urlParams.get('mode');
          window.history.replaceState({}, document.title, window.location.pathname + (mode ? `?mode=${mode}` : ''));
      }

      this.auth.checkStatus().subscribe(user => {
          if (user) {
              if (user.isTemp) {
                  this.gameState.activeScreen.set('login');
              } else {
                  this.gameState.syncWithUser(user);
              }
          }
      });

      if (urlParams.get('mode') === 'set-username') {
          this.gameState.activeScreen.set('login');
      }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('button')) {
          this.gameState.audio.playSFX('click');
      }
  }

  activeLegalDoc: 'tos' | 'privacy' | 'refunds' | null = null;

  showLegal(doc: 'tos' | 'privacy' | 'refunds') {
      this.activeLegalDoc = doc;
  }

  getLegalTitle(): string {
      if (this.activeLegalDoc === 'tos') return 'Terms of Service';
      if (this.activeLegalDoc === 'privacy') return 'Privacy Policy';
      return 'Refund Policy';
  }

  getLegalContent(): string {
      if (this.activeLegalDoc === 'tos') {
          return "By accessing or using Phoenix Fall, you agree to be bound by these Terms of Service. You may not cheat, hack, or exploit bugs. We reserve the right to ban accounts without notice for any violation. All virtual items remain the property of the developer. We are not responsible for any emotional distress caused by our highly addictive gameplay loop.";
      }
      if (this.activeLegalDoc === 'privacy') {
          return "We collect your email, username, and gameplay analytics. We use this data to optimize monetization, track your engagement, and serve targeted offers. By agreeing, you consent to our use of third-party analytics trackers to monitor your session times and in-game currency balances. If you are under 13, you must have parental consent to play.";
      }
      return "ALL SALES ARE FINAL. Virtual currency (Gems) and in-game upgrades hold no real-world value and cannot be exchanged for fiat currency. We do not offer refunds for accidental purchases, account bans, or buyer's remorse, except where expressly mandated by statutory consumer rights in your jurisdiction. For Monthly Crate Subscriptions, you may upgrade or downgrade your tier at any time through your platform's app store (e.g., Google Play); however, mid-cycle changes will not be refunded. Please contact Google Play or Apple App Store for billing inquiries.";
  }

  acceptPolicies() {
      this.gameState.audio.playSFX('buy');
      this.gameState.acceptedLegalPolicies.set(true);
      // If user is logged in, sync this immediately. Otherwise, it syncs with guest save loop automatically.
      if (!this.gameState.isGuest()) {
          this.auth.acceptPolicies().subscribe();
      }
  }

  refusePolicies() {
      // In a browser, window.close() only works if the script opened the window. 
      // But we can try it or just redirect them away.
      window.location.href = "https://www.google.com";
  }
}
