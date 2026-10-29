import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { GameStateService } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import { environment } from '../../../environments/environment';
import { WORLDS } from '../../constants/game.constants';
import { TrioMode } from '../../data/mode-records';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 flex flex-col items-center p-4 md:p-8 z-50 overflow-y-auto">
      <button (click)="goBack()" class="press absolute top-4 left-4 md:top-6 md:left-6 text-white/50 hover:text-white transition flex items-center gap-2">
        <span class="text-2xl">←</span> Back
      </button>

      <div class="screen-in bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-4 md:p-8 w-full max-w-3xl mt-16 md:mt-12 shadow-[0_0_50px_rgba(255,100,0,0.1)]">
        <h2 class="text-3xl md:text-4xl font-black text-center mb-6 md:mb-8 text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-orange-500">
          {{ activeTab() === 'world' ? 'PER-WORLD RECORDS' : 'GLOBAL LEADERBOARD' }}
        </h2>
        <div class="flex gap-3 md:gap-4 justify-center mb-6 flex-wrap">
            <button (click)="switchTab('survival')"
                    [ngClass]="activeTab() === 'survival' ? 'border-orange-500 text-white' : 'border-white/10 text-white/50'"
                    class="press px-5 py-2 rounded-full border-2 bg-white/5 hover:bg-white/10 transition font-bold tracking-widest">
                SURVIVAL
            </button>
            <button (click)="switchTab('battle')"
                    [ngClass]="activeTab() === 'battle' ? 'border-orange-500 text-white' : 'border-white/10 text-white/50'"
                    class="press px-5 py-2 rounded-full border-2 bg-white/5 hover:bg-white/10 transition font-bold tracking-widest">
                BATTLE MODE
            </button>
            <button (click)="switchTab('world')"
                    [ngClass]="activeTab() === 'world' ? 'border-orange-500 text-white' : 'border-white/10 text-white/50'"
                    class="press px-5 py-2 rounded-full border-2 bg-white/5 hover:bg-white/10 transition font-bold tracking-widest">
                PER-WORLD
            </button>
        </div>

        @if (activeTab() === 'world') {
            <!-- Per-world grid (mode trio): one board per world per
                 mode, 30 boards, next to the two global boards. -->
            <div class="flex items-center justify-center gap-4 mb-4">
                <button (click)="prevWorld()" class="press text-white/50 hover:text-white transition text-2xl">&larr;</button>
                <div class="w-52 text-center">
                    <div class="text-xs text-white/50 uppercase tracking-widest font-bold">Realm {{ boardWorld() + 1 }}</div>
                    <div class="text-lg font-black tracking-wider text-white">{{ worlds[boardWorld()].name }}</div>
                </div>
                <button (click)="nextWorld()" class="press text-white/50 hover:text-white transition text-2xl">&rarr;</button>
            </div>
            <div class="flex gap-2 justify-center mb-4">
                <button (click)="switchWorldMode('normal')"
                        [ngClass]="worldMode() === 'normal' ? 'bg-orange-500/80 text-white' : 'bg-white/5 text-white/50 hover:text-white'"
                        class="press px-4 py-1.5 rounded-full text-xs font-black tracking-widest uppercase transition">Normal</button>
                <button (click)="switchWorldMode('endless')"
                        [ngClass]="worldMode() === 'endless' ? 'bg-orange-500/80 text-white' : 'bg-white/5 text-white/50 hover:text-white'"
                        class="press px-4 py-1.5 rounded-full text-xs font-black tracking-widest uppercase transition">Endless</button>
                <button (click)="switchWorldMode('battle')"
                        [ngClass]="worldMode() === 'battle' ? 'bg-orange-500/80 text-white' : 'bg-white/5 text-white/50 hover:text-white'"
                        class="press px-4 py-1.5 rounded-full text-xs font-black tracking-widest uppercase transition">Battle</button>
            </div>
            @if (ownRecordText()) {
                <div class="text-center text-white/60 text-sm mb-4">Your best here: <span class="text-white font-bold">{{ ownRecordText() }}</span></div>
            }
        }

        @if (loading()) {
            <div class="text-center text-white/50 py-12 text-xl animate-pulse">Loading Rankings...</div>
        } @else if (players().length === 0) {
            <div class="text-center text-white/50 py-12 text-lg">No records yet. Be the first.</div>
        } @else {
            <div class="space-y-3 overflow-x-auto">
                @for (player of players(); track player.username; let i = $index) {
                    <div class="stagger-in flex items-center gap-2 md:gap-4 bg-white/5 border border-white/5 p-3 md:p-4 rounded-xl hover:bg-white/10 transition min-w-[300px]"
                         [style.--d]="i < 10 ? i : 10">
                        <div class="w-8 md:w-12 text-center font-black text-xl md:text-2xl"
                             [class.text-orange-400]="i === 0"
                             [class.text-gray-300]="i === 1"
                             [class.text-orange-600]="i === 2"
                             [class.text-white/40]="i > 2">
                            #{{ i + 1 }}
                        </div>
                        <div class="w-12 h-12 rounded-full bg-gradient-to-tr from-orange-500 to-orange-600 flex items-center justify-center text-xl font-black shadow-lg">
                          {{ player.username.charAt(0).toUpperCase() }}
                        </div>
                        <div class="flex-1">
                            <h3 class="text-xl font-bold text-white">{{ player.username }}</h3>
                            <div class="text-white/50 text-sm flex gap-3">
                                <span>{{ player.trophies.length }} Trophies</span>
                            </div>
                        </div>
                        <div class="text-right">
                            @if (activeTab() === 'survival') {
                                <div class="text-orange-400 font-bold text-2xl">Lvl {{ player.level }}</div>
                                <div class="text-white/40 text-sm">{{ player.xp }} XP</div>
                            } @else if (activeTab() === 'battle') {
                                <div class="text-orange-400 font-bold text-2xl">{{ player.battleHighscore }}</div>
                                <div class="text-white/40 text-sm">Lvl {{ player.level }} | {{ formatTime(player.battleBestTime) }} | {{ player.battleBestCoins }} Coins</div>
                            } @else if (worldMode() === 'normal') {
                                <div class="text-orange-400 font-bold text-2xl">{{ formatTime(player.bestClearSec) }}</div>
                                <div class="text-white/40 text-sm">Lvl {{ player.level }} | {{ player.clearKills }} Kills</div>
                            } @else if (worldMode() === 'endless') {
                                <div class="text-orange-400 font-bold text-2xl">{{ formatTime(player.bestTimeSec) }}</div>
                                <div class="text-white/40 text-sm">Lvl {{ player.level }} | {{ player.bestKills }} Kills</div>
                            } @else {
                                <div class="text-orange-400 font-bold text-2xl">{{ player.bestScore }}</div>
                                <div class="text-white/40 text-sm">Lvl {{ player.level }} | {{ formatTime(player.bestTimeSec) }} | {{ player.bestCoins }} Coins</div>
                            }
                        </div>
                    </div>
                }
            </div>
        }
      </div>
    </div>
  `
})
export class LeaderboardComponent implements OnInit {
  gameState = inject(GameStateService);
  audio = inject(AudioService);
  http = inject(HttpClient);

  worlds = WORLDS;
  activeTab = signal<'survival' | 'battle' | 'world'>('survival');
  worldMode = signal<TrioMode>('normal');
  boardWorld = signal<number>(0);
  players = signal<any[]>([]);
  loading = signal(true);

  ownRecordText = computed(() => {
      if (this.activeTab() !== 'world') return '';
      const rec = this.gameState.modeRecords()[this.boardWorld()];
      if (!rec) return '';
      const m = this.worldMode();
      if (m === 'normal') {
          return rec.normal ? `Cleared in ${this.formatTime(rec.normal.bestClearSec)} with ${rec.normal.clearKills} kills` : '';
      }
      if (m === 'endless') {
          return rec.endless ? `${this.formatTime(rec.endless.bestTimeSec)} survived, ${rec.endless.bestKills} kills, ${rec.endless.runs} run${rec.endless.runs === 1 ? '' : 's'}` : '';
      }
      return rec.battle ? `Score ${rec.battle.bestScore}, ${this.formatTime(rec.battle.bestTimeSec)}, ${rec.battle.bestCoins} coins` : '';
  });

  ngOnInit() {
      this.loadLeaderboard();
  }

  switchTab(tab: 'survival' | 'battle' | 'world') {
      this.audio.playSFX('click');
      this.activeTab.set(tab);
      this.loadLeaderboard();
  }

  switchWorldMode(mode: TrioMode) {
      this.audio.playSFX('click');
      this.worldMode.set(mode);
      this.loadLeaderboard();
  }

  prevWorld() {
      const w = (this.boardWorld() + this.worlds.length - 1) % this.worlds.length;
      this.boardWorld.set(w);
      this.loadLeaderboard();
  }

  nextWorld() {
      const w = (this.boardWorld() + 1) % this.worlds.length;
      this.boardWorld.set(w);
      this.loadLeaderboard();
  }

  loadLeaderboard() {
      this.loading.set(true);
      const endpoint = this.activeTab() === 'battle' ? '/leaderboard/battle'
          : this.activeTab() === 'world' ? `/leaderboard/world/${this.boardWorld()}/${this.worldMode()}`
          : '/leaderboard';
      this.http.get<any[]>(environment.apiUrl + endpoint).subscribe({
          next: (data) => {
              this.players.set(data);
              this.loading.set(false);
          },
          error: (err) => {
              console.error('Failed to load leaderboard', err);
              this.players.set([]);
              this.loading.set(false);
          }
      });
  }

  formatTime(seconds: number): string {
      if (!seconds) return '0:00';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
  }

  goBack() {
    this.audio.playSFX('click');
    this.gameState.activeScreen.set('menu');
  }
}
