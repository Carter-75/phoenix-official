import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { GameStateService } from '../../services/game-state.service';
import { AudioService } from '../../services/audio.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed inset-0 flex flex-col items-center p-4 md:p-8 z-50 overflow-y-auto">
      <button (click)="goBack()" class="absolute top-4 left-4 md:top-6 md:left-6 text-white/50 hover:text-white transition flex items-center gap-2">
        <span class="text-2xl">←</span> Back
      </button>

      <div class="bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl p-4 md:p-8 w-full max-w-3xl mt-16 md:mt-12 shadow-[0_0_50px_rgba(255,100,0,0.1)]">
        <h2 class="text-3xl md:text-4xl font-black text-center mb-6 md:mb-8 text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-500">
          GLOBAL LEADERBOARD
        </h2>
        <div class="flex gap-4 justify-center mb-6">
            <button (click)="switchTab('survival')" 
                    [ngClass]="activeTab() === 'survival' ? 'border-orange-500 text-white' : 'border-white/10 text-white/50'"
                    class="px-6 py-2 rounded-full border-2 bg-white/5 hover:bg-white/10 transition font-bold tracking-widest">
                SURVIVAL
            </button>
            <button (click)="switchTab('battle')"
                    [ngClass]="activeTab() === 'battle' ? 'border-fuchsia-500 text-white' : 'border-white/10 text-white/50'"
                    class="px-6 py-2 rounded-full border-2 bg-white/5 hover:bg-white/10 transition font-bold tracking-widest">
                BATTLE MODE
            </button>
        </div>
        
        @if (loading()) {
            <div class="text-center text-white/50 py-12 text-xl animate-pulse">Loading Rankings...</div>
        } @else {
            <div class="space-y-3 overflow-x-auto">
                @for (player of players(); track player.username; let i = $index) {
                    <div class="flex items-center gap-2 md:gap-4 bg-white/5 border border-white/5 p-3 md:p-4 rounded-xl hover:bg-white/10 transition min-w-[300px]">
                        <div class="w-8 md:w-12 text-center font-black text-xl md:text-2xl"
                             [class.text-yellow-400]="i === 0"
                             [class.text-gray-300]="i === 1"
                             [class.text-orange-600]="i === 2"
                             [class.text-white/40]="i > 2">
                            #{{ i + 1 }}
                        </div>
                        <div class="w-12 h-12 rounded-full bg-gradient-to-tr from-orange-500 to-purple-600 flex items-center justify-center text-xl font-black shadow-lg">
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
                            } @else {
                                <div class="text-fuchsia-400 font-bold text-2xl">{{ player.battleHighscore }}</div>
                                <div class="text-white/40 text-sm">{{ formatTime(player.battleBestTime) }} | {{ player.battleBestCoins }} Coins</div>
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
  
  activeTab = signal<'survival' | 'battle'>('survival');
  players = signal<any[]>([]);
  loading = signal(true);

  ngOnInit() {
      this.loadLeaderboard();
  }
  
  switchTab(tab: 'survival' | 'battle') {
      this.audio.playSFX('click');
      this.activeTab.set(tab);
      this.loadLeaderboard();
  }

  loadLeaderboard() {
      this.loading.set(true);
      const endpoint = this.activeTab() === 'battle' ? '/leaderboard/battle' : '/leaderboard';
      this.http.get<any[]>(environment.apiUrl + endpoint).subscribe({
          next: (data) => {
              this.players.set(data);
              this.loading.set(false);
          },
          error: (err) => {
              console.error('Failed to load leaderboard', err);
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
