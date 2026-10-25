import { Component, inject, signal, computed } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { AuthService } from '../../services/auth.service';
import { AudioService } from '../../services/audio.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface TrophyDef {
   id: string;
   name: string;
   desc: string;
}

interface RealmTrophies {
   realmName: string;
   trophies: TrophyDef[];
}

const TROPHY_CATALOG: RealmTrophies[] = [
  {
    realmName: 'The Awakening (Realm 1)',
    trophies: [
      { id: 'First Blood', name: 'First Blood', desc: 'Defeat your first enemy.' },
      { id: 'Survivor', name: 'Survivor', desc: 'Survive for 60 seconds in a single run.' },
      { id: 'Healer', name: 'Healer', desc: 'Collect 5 health hearts in a run.' },
      { id: 'Upgraded', name: 'Upgraded', desc: 'Purchase your first permanent upgrade.' },
      { id: 'Ability Unlocked', name: 'Ability Unlocked', desc: 'Unlock an active ability.' },
      { id: 'Slime Slayer', name: 'Slime Slayer', desc: 'Slay 50 slimes in a single run.' },
      { id: 'Bat Hunter', name: 'Bat Hunter', desc: 'Shoot down 25 bats in a single run.' },
      { id: 'Golem Breaker', name: 'Golem Breaker', desc: 'Shatter 5 golems in a single run.' },
      { id: 'Wealthy', name: 'Wealthy', desc: 'Accumulate 1,000 coins.' },
      { id: 'Gem Hoarder', name: 'Gem Hoarder', desc: 'Hoard 10 precious gems.' },
      { id: 'Realm Conqueror', name: 'Realm Conqueror', desc: 'Defeat the Realm Boss.' }
    ]
  },
  {
    realmName: 'The Crimson Void (Realm 2)',
    trophies: [
       // Expandable for future realms
    ]
  }
];

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 flex flex-col items-center p-8 z-50 overflow-y-auto">
      <button (click)="goBack()" class="absolute top-6 left-6 text-white/50 hover:text-white transition flex items-center gap-2">
        <span class="text-2xl">←</span> Back
      </button>

      <div class="bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-8 w-full max-w-2xl mt-12 shadow-[0_0_50px_rgba(255,100,0,0.1)]">
        
        @if (auth.currentUser()) {
          <div class="flex items-center gap-6 mb-12">
            <div class="w-24 h-24 rounded-full bg-gradient-to-tr from-orange-500 to-purple-600 flex items-center justify-center text-4xl font-black shadow-[0_0_30px_rgba(255,100,0,0.5)]">
              {{ auth.currentUser()!.username.charAt(0).toUpperCase() }}
            </div>
            <div>
              <div class="flex items-baseline gap-3">
                <h2 class="text-3xl font-black text-white leading-none">{{ auth.currentUser()!.username }}</h2>
                <div class="text-orange-400 font-bold text-lg leading-none">Lv. {{ auth.currentUser()!.level }}</div>
              </div>
              <div class="flex items-center gap-2 mt-2">
                <div class="w-48 h-2 bg-white/10 rounded-full overflow-hidden border border-white/10">
                  <div class="h-full bg-gradient-to-r from-orange-500 to-red-500" [style.width.%]="(auth.currentUser()!.xp / gameState.getXpRequiredForLevel(auth.currentUser()!.level)) * 100"></div>
                </div>
                <div class="text-white/50 text-xs font-mono">{{ auth.currentUser()!.xp }}/{{ gameState.getXpRequiredForLevel(auth.currentUser()!.level) }} XP</div>
              </div>
            </div>
            
            <button (click)="logout()" class="ml-auto px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/40 rounded-lg transition font-bold border border-red-500/20">
              Logout
            </button>
          </div>
          
          <div class="flex items-center justify-between mb-4">
             <h3 class="text-2xl font-bold text-white">Trophies</h3>
             <input type="text" [(ngModel)]="searchQuery" placeholder="Search trophies..." class="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-orange-500 transition w-64">
          </div>
          
          <div class="space-y-8">
             @for (realm of filteredTrophies(); track realm.realmName) {
                @if (realm.trophies.length > 0) {
                    <div>
                        <h4 class="text-xl font-bold text-orange-400 mb-3 border-b border-white/10 pb-2">{{ realm.realmName }}</h4>
                        <div class="flex flex-wrap gap-3">
                           @for (trophy of realm.trophies; track trophy.id) {
                               @if (hasTrophy(trophy.id)) {
                                   <div class="bg-white/5 border border-yellow-500/30 rounded-lg py-2 px-4 flex items-center gap-3 shadow-[0_0_10px_rgba(234,179,8,0.05)] hover:bg-white/10 transition cursor-help" [title]="trophy.desc">
                                      <span class="text-2xl drop-shadow-md">🏆</span>
                                      <div class="flex flex-col">
                                          <span class="text-yellow-100 font-bold text-sm leading-tight">{{ trophy.name }}</span>
                                          <span class="text-white/40 text-xs">{{ trophy.desc }}</span>
                                      </div>
                                   </div>
                               } @else {
                                   <div class="bg-white/5 border border-white/10 rounded-lg py-2 px-4 flex items-center gap-3 opacity-50 cursor-not-allowed">
                                      <span class="text-2xl grayscale">🔒</span>
                                      <div class="flex flex-col">
                                          <span class="text-white/50 font-bold text-sm leading-tight">???</span>
                                          <span class="text-white/30 text-xs">Keep playing to unlock</span>
                                      </div>
                                   </div>
                               }
                           }
                        </div>
                    </div>
                }
             }
             @if (filteredTrophies().length === 0 || allTrophiesEmpty()) {
                 <div class="w-full text-white/40 text-center py-4 bg-white/5 rounded-xl border border-white/10">No trophies match your search.</div>
             }
          </div>
          
        } @else {
          <div class="text-center py-12 border-b border-white/10 mb-8">
            <h2 class="text-2xl text-white font-bold mb-4">You are not logged in</h2>
            <button (click)="goToLogin()" class="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold rounded-xl hover:brightness-110 transition">
              Login or Register
            </button>
          </div>
        }

        <!-- Cosmetics Settings Section -->
        @if (gameState.hasPurchasedGems() || gameState.hasCosmicTrail() || gameState.hasGoldenAura() || gameState.hasCelestialShield()) {
          <div class="mt-8 mb-8 border-t border-white/10 pt-8">
            <h3 class="text-2xl font-bold text-white mb-6 flex items-center gap-2"><span class="text-3xl">✨</span> Cosmetics</h3>
            <div class="flex flex-col gap-4">
                
                @if (gameState.hasCosmicTrail()) {
                <div class="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                  <div class="flex flex-col">
                     <span class="text-pink-400 font-bold text-lg">Cosmic Trail</span>
                     <span class="text-white/50 text-sm">Toggle the cosmic energy trail effect</span>
                  </div>
                  <button (click)="toggleCosmetic('trail')" class="w-16 h-8 rounded-full transition-colors relative"
                          [ngClass]="!gameState.toggleCosmicTrail() ? 'bg-gray-600' : 'bg-pink-500'">
                     <div class="absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-md"
                          [ngClass]="!gameState.toggleCosmicTrail() ? 'left-1' : 'left-9'"></div>
                  </button>
                </div>
                }

                @if (gameState.hasGoldenAura()) {
                <div class="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                  <div class="flex flex-col">
                     <span class="text-yellow-400 font-bold text-lg">Golden Aura</span>
                     <span class="text-white/50 text-sm">Toggle the swirling golden particle vortex</span>
                  </div>
                  <button (click)="toggleCosmetic('aura')" class="w-16 h-8 rounded-full transition-colors relative"
                          [ngClass]="!gameState.toggleGoldenAura() ? 'bg-gray-600' : 'bg-yellow-500'">
                     <div class="absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-md"
                          [ngClass]="!gameState.toggleGoldenAura() ? 'left-1' : 'left-9'"></div>
                  </button>
                </div>
                }

                @if (gameState.hasCelestialShield()) {
                <div class="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                  <div class="flex flex-col">
                     <span class="text-cyan-400 font-bold text-lg">Celestial Shield</span>
                     <span class="text-white/50 text-sm">Toggle the orbital energy shield visual</span>
                  </div>
                  <button (click)="toggleCosmetic('shield')" class="w-16 h-8 rounded-full transition-colors relative"
                          [ngClass]="!gameState.toggleCelestialShield() ? 'bg-gray-600' : 'bg-cyan-500'">
                     <div class="absolute top-1 w-6 h-6 bg-white rounded-full transition-all shadow-md"
                          [ngClass]="!gameState.toggleCelestialShield() ? 'left-1' : 'left-9'"></div>
                  </button>
                </div>
                }
            </div>
          </div>
        }

        <!-- Settings Section (Always Visible) -->
        <div class="mt-8">
          <h3 class="text-2xl font-bold text-white mb-6 flex items-center gap-2"><span class="text-3xl">⚙️</span> Settings</h3>
          <div class="flex flex-col gap-4">

              <div class="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                <div class="flex flex-col">
                   <span class="text-white font-bold text-lg">Legal & Policies</span>
                   <span class="text-white/50 text-sm">Review our TOS, Privacy, and Refund policies</span>
                </div>
                <button (click)="showLegal('tos')" class="px-6 py-2 bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/40 rounded-lg transition font-bold">
                   View
                </button>
              </div>
          </div>
        </div>

      </div>

      <!-- Legal Modal -->
      @if (activeLegalDoc) {
          <div class="fixed inset-0 bg-black/95 flex flex-col items-center justify-center z-[300] px-4 backdrop-blur-md pointer-events-auto">
             <div class="w-full max-w-2xl bg-zinc-900 border border-cyan-500/50 rounded-3xl p-8 flex flex-col max-h-[80vh] shadow-[0_0_30px_rgba(0,255,255,0.2)]">
                 <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-white">{{ getLegalTitle() }}</h2>
                    <button (click)="activeLegalDoc = null" class="text-white/50 hover:text-white text-3xl font-black">&times;</button>
                 </div>
                 
                 <div class="flex gap-4 mb-6 border-b border-white/10 pb-4">
                    <button (click)="showLegal('tos')" class="text-sm font-bold transition hover:text-cyan-300" [class.text-cyan-400]="activeLegalDoc === 'tos'" [class.text-white]="activeLegalDoc !== 'tos'">Terms of Service</button>
                    <button (click)="showLegal('privacy')" class="text-sm font-bold transition hover:text-cyan-300" [class.text-cyan-400]="activeLegalDoc === 'privacy'" [class.text-white]="activeLegalDoc !== 'privacy'">Privacy Policy</button>
                    <button (click)="showLegal('refunds')" class="text-sm font-bold transition hover:text-cyan-300" [class.text-cyan-400]="activeLegalDoc === 'refunds'" [class.text-white]="activeLegalDoc !== 'refunds'">Refund Policy</button>
                 </div>

                 <div class="overflow-y-auto text-white/80 text-sm md:text-base space-y-4 pr-4 custom-scrollbar leading-relaxed">
                    {{ getLegalContent() }}
                 </div>
                 <button (click)="activeLegalDoc = null" class="mt-8 w-full py-4 bg-cyan-600/20 border border-cyan-500 hover:bg-cyan-600/40 rounded-xl font-bold text-cyan-300 transition text-xl">Close</button>
             </div>
          </div>
      }
    </div>
  `
})
export class ProfileComponent {
  gameState = inject(GameStateService);
  auth = inject(AuthService);
  audio = inject(AudioService);

  searchQuery = signal('');

  hasTrophy(id: string): boolean {
      return this.gameState.trophies().includes(id);
  }

  filteredTrophies = computed(() => {
      const query = this.searchQuery().toLowerCase().trim();
      
      return TROPHY_CATALOG.map(realm => {
          const filtered = realm.trophies.filter(t => {
              if (!query) return true;
              
              // If unlocked, search by name or desc
              if (this.hasTrophy(t.id)) {
                  return t.name.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query);
              }
              
              // If locked, cannot be searched by name/desc, unless they search "???"
              return "???".includes(query) || "keep playing to unlock".includes(query);
          });
          // Sort achieved trophies to top, unachieved to bottom
          const sorted = filtered.sort((a, b) => {
              const aHas = this.hasTrophy(a.id) ? 1 : 0;
              const bHas = this.hasTrophy(b.id) ? 1 : 0;
              return bHas - aHas;
          });
          
          return { ...realm, trophies: sorted };
      }).filter(realm => realm.trophies.length > 0);
  });

  allTrophiesEmpty(): boolean {
      return this.filteredTrophies().every(r => r.trophies.length === 0);
  }

  goBack() {
    this.audio.playSFX('click');
    this.gameState.activeScreen.set('menu');
  }

  goToLogin() {
    this.audio.playSFX('click');
    this.gameState.activeScreen.set('login');
  }
  
  logout() {
      this.audio.playSFX('click');
      this.auth.logout();
  }

  toggleCosmetic(type: string) {
    this.audio.playSFX('click');
    if (type === 'trail') {
        this.gameState.toggleCosmicTrail.set(!this.gameState.toggleCosmicTrail());
    } else if (type === 'aura') {
        this.gameState.toggleGoldenAura.set(!this.gameState.toggleGoldenAura());
    } else if (type === 'shield') {
        this.gameState.toggleCelestialShield.set(!this.gameState.toggleCelestialShield());
    }
    
    // Sync immediately if logged in
    if (this.auth.currentUser() && !this.auth.currentUser()?.isTemp) {
        this.auth.sync({
            toggleCosmicTrail: this.gameState.toggleCosmicTrail(),
            toggleGoldenAura: this.gameState.toggleGoldenAura(),
            toggleCelestialShield: this.gameState.toggleCelestialShield()
        } as any).subscribe();
    }
  }

  activeLegalDoc: 'tos' | 'privacy' | 'refunds' | null = null;

  showLegal(doc: 'tos' | 'privacy' | 'refunds') {
      this.audio.playSFX('click');
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
      return "ALL SALES ARE FINAL. Virtual currency (Gems) and in-game upgrades hold no real-world value and cannot be exchanged for fiat currency. We do not offer refunds for accidental purchases, account bans, or buyer's remorse, except where expressly mandated by statutory consumer rights in your jurisdiction. Please contact Google Play or Apple App Store for billing inquiries.";
  }
}
