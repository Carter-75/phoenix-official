import { Component, inject, OnInit, signal } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { AuthService, User } from '../../services/auth.service';
import { AudioService } from '../../services/audio.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fixed inset-0 flex flex-col items-center justify-center p-4 z-50">
      <button (click)="goBack()" class="absolute top-6 left-6 text-white/50 hover:text-white transition flex items-center gap-2">
        <span class="text-2xl">←</span> Back
      </button>

      <div class="bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-[0_0_50px_rgba(255,100,0,0.1)]">
        <h2 class="text-3xl font-black text-center mb-8 text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500">
           {{ mode() === 'email' ? 'ACCOUNT ACCESS' : 'CHOOSE USERNAME' }}
        </h2>
        
        @if (error()) {
          <div class="bg-red-500/20 text-red-400 p-3 rounded-lg text-sm mb-4 border border-red-500/20">
            {{ error() }}
          </div>
        }

        <div class="space-y-4">
          @if (mode() === 'email') {
              <button (click)="loginWithGoogle()" 
                      class="w-full p-4 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors text-white font-semibold gap-3">
                <svg class="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
              
              <div class="relative flex items-center justify-center py-4">
                <div class="border-t border-white/10 w-full"></div>
                <span class="bg-transparent px-4 text-white/40 text-sm absolute backdrop-blur-md">or</span>
              </div>
          }

          @if (mode() === 'email') {
            <input [(ngModel)]="email" type="email" placeholder="Email Address" class="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50 transition">
            <input [(ngModel)]="password" type="password" placeholder="Password" class="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50 transition">
          }

          @if (mode() === 'set-username') {
            <p class="text-white/60 text-center mb-4">You successfully authenticated! Now pick a unique username for the leaderboard.</p>
            <input [(ngModel)]="username" type="text" placeholder="Username" class="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50 transition">
          }

          <!-- Agreement (Fix Round 1, Part 5): consent lives only in
               this sign-up flow. Creating an account (email
               auto-register or the username step after Google) is
               blocked until the box is ticked; the tick is recorded
               through the existing accept-policies endpoint when the
               account is created. Signing in to an existing account
               does not require it. -->
          @if (mode() === 'email' || !agreedToPolicies()) {
            <label class="flex items-start gap-3 p-4 bg-black/40 border border-white/10 rounded-xl cursor-pointer text-left">
              <input type="checkbox" [checked]="agreedToPolicies()" (change)="agreedToPolicies.set($any($event.target).checked)" class="mt-1 w-5 h-5 shrink-0 accent-orange-500">
              <span class="text-sm text-white/70 leading-relaxed">
                I agree to the
                <button type="button" (click)="$event.preventDefault(); showLegal('tos')" class="text-orange-300 underline underline-offset-2 font-bold">Terms of Service</button>,
                <button type="button" (click)="$event.preventDefault(); showLegal('privacy')" class="text-orange-300 underline underline-offset-2 font-bold">Privacy Policy</button>, and
                <button type="button" (click)="$event.preventDefault(); showLegal('refunds')" class="text-orange-300 underline underline-offset-2 font-bold">Refund Policy</button>
                <span class="text-white/40"> (required to create an account)</span>
              </span>
            </label>
          }
          
          <button (click)="submit()"
                  class="w-full mt-4 p-4 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-xl font-bold hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:grayscale">
            {{ mode() === 'email' ? 'Continue' : 'Complete Signup' }}
          </button>


        </div>
      </div>

      <!-- Legal Document Reader (opened from the agreement links) -->
      @if (activeLegalDoc) {
          <div class="fixed inset-0 bg-black/95 flex flex-col items-center justify-center z-[600] px-4 backdrop-blur-md">
             <div class="w-full max-w-2xl bg-zinc-900 border border-orange-500/40 rounded-3xl p-8 flex flex-col max-h-[80vh]">
                 <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-white">{{ getLegalTitle() }}</h2>
                    <button (click)="activeLegalDoc = null" class="text-white/50 hover:text-white text-3xl font-black">&times;</button>
                 </div>
                 <div class="overflow-y-auto text-white/80 text-sm md:text-base space-y-4 pr-4 leading-relaxed">
                    {{ getLegalContent() }}
                 </div>
                 <button (click)="activeLegalDoc = null" class="mt-8 w-full py-4 bg-orange-600/20 border border-orange-500 hover:bg-orange-600/40 rounded-xl font-bold text-orange-200 transition text-xl">Understood</button>
             </div>
          </div>
      }
    </div>
  `
})
export class LoginComponent implements OnInit {
  private gameState = inject(GameStateService);
  private authService = inject(AuthService);
  private audioService = inject(AudioService);
  
  // Signals, not plain fields: these are written from HTTP subscribe
  // callbacks, and a plain-field write during change detection throws
  // NG0100 in dev builds and wedges the view on the email form, making
  // the username step unreachable (playtest round 2, objective 4).
  mode = signal<'email' | 'set-username'>('email');

  // Agreement state for the sign-up flow (Fix Round 1, Part 5).
  agreedToPolicies = signal(false);
  activeLegalDoc: 'tos' | 'privacy' | 'refunds' | null = null;

  email = '';
  password = '';
  username = '';
  error = signal('');

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
          return "By accessing or using Phoenix Fall, you agree to these Terms of Service. Do not cheat, hack, exploit bugs, interfere with the service, or use unauthorized third-party software to gain an unfair advantage. Virtual currency, items, upgrades, and other virtual content have no cash value and cannot be exchanged for money. We may suspend or close an account that seriously or repeatedly violates these terms, subject to applicable law. The game is provided as available, without warranties beyond those required by law.";
      }
      if (this.activeLegalDoc === 'privacy') {
          return "If you create an account, we store your email address, username, a password hash or Google account identifier, gameplay progress, virtual currency balances, purchase entitlements, and leaderboard statistics. Guest progress is stored on your device unless you sign in. We do not sell personal data. We use account and gameplay data to operate, secure, sync, and support the game. Google AdMob may collect device and advertising identifiers and ad interaction data to provide and measure ads. Google Play processes purchases and payments. You can delete your account and associated server data from your profile. Contact hello@phoenixwebsites.ai with privacy questions.";
      }
      return "In-app purchases are processed by Google Play. Refund requests are handled under Google Play policies and applicable consumer law. Virtual currency and items have no cash value and cannot be exchanged for money. The Monthly Crate Pass renews through Google Play until cancelled in Google Play settings; cancelling stops future renewals. Contact Google Play for payment and refund support.";
  }

  // Record the sign-up consent on the account (the same
  // accept-policies endpoint the old entry gate used) and flip the
  // local flag so the guest save carries it too.
  private recordConsent() {
      this.gameState.acceptedLegalPolicies.set(true);
      this.authService.acceptPolicies().subscribe({ error: () => {} });
  }

  ngOnInit() {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('mode') === 'set-username' || this.authService.currentUser()?.isTemp) {
          this.mode.set('set-username');
      } else if (urlParams.get('error')) {
          this.error.set('Google Authentication Failed.');
      }
  }

  goBack() {
    this.audioService.playSFX('click'); 
    window.history.replaceState({}, document.title, "/");
    this.gameState.activeScreen.set('menu');
  }

  submit() {
    this.audioService.playSFX('buy');
    this.error.set('');
    
    if (this.mode() === 'email') {
        if (!this.email || !this.password) {
            this.error.set("Please fill in all fields");
            return;
        }
        
        this.authService.login({ email: this.email, password: this.password }).subscribe({
            next: async (user: User) => {
                if (user.isTemp) {
                    this.mode.set('set-username');
                } else {
                    // A ticked agreement on a plain sign-in is recorded
                    // too (keeps accounts created before the consent
                    // step existed current); unticked sign-ins proceed
                    // untouched.
                    if (this.agreedToPolicies()) this.recordConsent();
                    // Final sweep (playtest round 2 product gap):
                    // an existing-account email login used to skip
                    // the guest migration every other path runs
                    // (Google login, auto-register, complete-signup),
                    // so progress earned as a guest on this device
                    // was stranded when signing into an existing
                    // account by email. It now migrates first, in
                    // the same order as the Google path.
                    await this.gameState.migrateGuestData();
                    this.gameState.syncWithUser(user);
                    this.goBack();
                }
            },
            error: (err) => {
                if (err.error?.message === 'USER_NOT_FOUND') {
                    // Auto-register is account creation: the agreement
                    // must be ticked first (Fix Round 1, Part 5).
                    if (!this.agreedToPolicies()) {
                        this.error.set('To create your account, please tick the agreement to the Terms of Service, Privacy Policy, and Refund Policy first.');
                        return;
                    }
                    this.authService.register({ email: this.email, username: this.email.split('@')[0], password: this.password }).subscribe({
                        next: async (newUser: User) => {
                            if (newUser.isTemp) {
                                this.mode.set('set-username');
                            } else {
                                this.recordConsent();
                                await this.gameState.migrateGuestData();
                                this.gameState.syncWithUser(newUser);
                                this.goBack();
                            }
                        },
                        error: (registerErr) => {
                            this.error.set(registerErr.error?.message || 'Registration failed');
                        }
                    });
                } else {
                    this.error.set(err.error?.message || 'Login failed');
                }
            }
        });
    } else if (this.mode() === 'set-username') {
        // Completing the username step completes account creation
        // (email pending signups and Google sign-ups land here), so
        // the agreement must be ticked before it runs.
        if (!this.agreedToPolicies()) {
            this.error.set('To finish creating your account, please tick the agreement to the Terms of Service, Privacy Policy, and Refund Policy first.');
            return;
        }
        this.authService.completeSignup(this.username).subscribe({
            next: async (user) => {
                this.recordConsent();
                await this.gameState.migrateGuestData();
                this.gameState.syncWithUser(user);
                this.goBack();
            },
            error: (err) => this.error.set(err.error?.message || 'Failed to set username')
        });
    }
  }

  async loginWithGoogle() {
    this.audioService.playSFX('click');
    try {
        const user = await this.authService.loginWithGoogle();
        if (user && user.isTemp) {
            this.mode.set('set-username');
        } else if (user) {
            await this.gameState.migrateGuestData();
            this.gameState.syncWithUser(user);
            this.goBack();
        }
    } catch(err) {
        this.error.set('Native Google Authentication Failed.');
    }
  }
}
