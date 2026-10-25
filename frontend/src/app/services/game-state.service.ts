import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AudioService } from './audio.service';
import { AuthService, User } from './auth.service';
import { StorageService } from './storage.service';
import { NotificationService } from './notification.service';
import { WorldStats, PhysicsEntity, World, AbilityData } from '../models/game.models';
import { WORLDS, ABILITIES, REALM_ABILITIES, BASE_STATS, WORLD_0_STATS, ABILITY_UPGRADE_TARGETS } from '../constants/game.constants';

@Injectable({
  providedIn: 'root'
})
export class GameStateService {
  public audio = inject(AudioService);
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private storage = inject(StorageService);
  private notificationService = inject(NotificationService);

  public isGuest = computed(() => !this.auth.currentUser() || this.auth.currentUser()?.isTemp);

  // Currency & Progress
  public level = signal<number>(0);
  public xp = signal<number>(0);
  public trophies = signal<string[]>([]);
  public coins = signal<number>(100); 
  public gems = signal<number>(0);
  public hasPurchasedGems = signal<boolean>(false);
  public upsellChance = signal<number>(1.0);
  public acceptedLegalPolicies = signal<boolean>(false);
  public unlockedEnemies = signal<string[]>([]);

  // Stats Tracking (Session only, for trophies)
  public sessionKills = signal<Record<string, number>>({});
  public sessionPlayTime = signal<number>(0);
  public heartsCollected = signal<number>(0);

  // Per-World Stats
  public worldUpgrades = signal<Record<number, WorldStats>>({
    0: JSON.parse(JSON.stringify(WORLD_0_STATS)),
    1: JSON.parse(JSON.stringify(BASE_STATS)),
    2: JSON.parse(JSON.stringify(BASE_STATS)),
    3: JSON.parse(JSON.stringify(BASE_STATS)),
    4: JSON.parse(JSON.stringify(BASE_STATS)),
    5: JSON.parse(JSON.stringify(BASE_STATS)),
    6: JSON.parse(JSON.stringify(BASE_STATS)),
    7: JSON.parse(JSON.stringify(BASE_STATS)),
    8: JSON.parse(JSON.stringify(BASE_STATS)),
    9: JSON.parse(JSON.stringify(BASE_STATS))
  });

  // UI State
  // Screens: 'menu' | 'game' | 'shop' | 'login' | 'profile' | 'leaderboard' | 'crate_opening'
  public activeScreen = signal<'menu' | 'game' | 'shop' | 'login' | 'profile' | 'leaderboard' | 'codex' | 'crate_opening'>('menu');
  public unlockedWorlds = signal<number[]>([0]); // IDs of unlocked worlds
  public selectedWorldIndex = signal<number>(0);
  public currentGameMode = signal<'campaign' | 'battle' | 'ai_vs_ai'>('campaign');
  public crazyDealTimer = signal<number>(0);
  public crazyDealExpiresAt = signal<number | null>(null);
  public coinMultiplier = signal<number>(1);
  public xpMultiplier = signal<number>(1);
  public hasCosmicTrail = signal<boolean>(false);
  public hasGoldenAura = signal<boolean>(false);
  public hasCelestialShield = signal<boolean>(false);
  
  // Subscription / Crate Drops
  public pendingCratesCount = signal<number>(0);
  public lastCrateMonth = signal<string>(''); // e.g. "2026-06"
  
  // Temporary Multipliers
  public tempCoinMultiplier = signal<number>(1);
  public tempCoinMultiplierExpiresAt = signal<number>(0);
  public tempXpMultiplier = signal<number>(1);
  public tempXpMultiplierExpiresAt = signal<number>(0);
  
  public toggleCosmicTrail = signal<boolean>(true);
  public toggleGoldenAura = signal<boolean>(true);
  public toggleCelestialShield = signal<boolean>(true);
  public speedBoostUntil = 0;
  public immortalUntil = 0;
  
  public mousePos = signal<{x: number, y: number}>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  public phoenixScreenPos = signal<{x: number, y: number}>({x: window.innerWidth / 2, y: window.innerHeight / 2});
  public phoenixOverridePosition = signal<{x: number, y: number} | null>(null);
  public aiPhoenixScreenPos = signal<{x: number, y: number}>({x: window.innerWidth / 2, y: 100});
  public aiMousePos = signal<{x: number, y: number}>({ x: window.innerWidth / 2, y: 100 });
  public ai2MousePos = signal<{x: number, y: number}>({ x: window.innerWidth / 2, y: window.innerHeight - 100 });

  public isPaused = signal<boolean>(false);
  public isRebirthing = signal<boolean>(false);
  public isDrilling = signal<boolean>(false);
  public isDeadMenuOpen = signal<boolean>(false);
  public activeEntities = signal<PhysicsEntity[]>([]);

  // AI vs AI Scoreboard
  public ai1Wins = signal<number>(0);
  public ai2Wins = signal<number>(0);

  private router = inject(Router);

  constructor() {
      this.router.events.subscribe(event => {
          if (event instanceof NavigationEnd) {
              const path = event.urlAfterRedirects.slice(1);
              if (path && this.activeScreen() !== path) {
                  this.activeScreen.set(path as any);
              }
          }
      });

      effect(() => {
          const screen = this.activeScreen();
          const currentUrlTree = this.router.parseUrl(this.router.url);
          if (currentUrlTree.root.children['primary']?.segments[0]?.path !== screen) {
              this.router.navigate([`/${screen}`], { queryParamsHandling: 'preserve' });
          }
      });

      this.notificationService.setupNotifications((expiresAt) => this.triggerCrazyDeal(expiresAt));
      const localData = this.storage.getItem('phoenix_guest_data');
      if (localData) {
          try {
              const data = JSON.parse(localData);
              this.level.set(data.level || 0);
              this.xp.set(data.xp || 0);
              this.trophies.set(data.trophies || []);
              this.coins.set(Math.floor(data.coins !== undefined ? data.coins : 100));
              
              // Boot-up creep: Increase chance of popup by 10% each session
              if (data.gems !== undefined) this.gems.set(Math.floor(data.gems));
              if (data.hasPurchasedGems !== undefined) this.hasPurchasedGems.set(data.hasPurchasedGems);
              if (data.acceptedLegalPolicies !== undefined) this.acceptedLegalPolicies.set(data.acceptedLegalPolicies);
              if (data.upsellChance !== undefined) {
                  let chance = data.upsellChance + 0.1;
                  if (chance > 0.33) chance = 0.33;
                  if (this.storage.getItem('phoenix_last_upsell') === 'true') {
                      chance = 0;
                      this.storage.setItem('phoenix_last_upsell', 'false');
                  }
                  this.upsellChance.set(chance);
              } else {
                  if (data.activeScreen) this.activeScreen.set(data.activeScreen);
                  if (data.activeScreen) this.activeScreen.set(data.activeScreen);
                  if (data.unlockedWorlds) this.unlockedWorlds.set(data.unlockedWorlds);
                  if (data.selectedWorldIndex) this.selectedWorldIndex.set(data.selectedWorldIndex);
                  if (data.coinMultiplier) this.coinMultiplier.set(data.coinMultiplier);
                  if (data.xpMultiplier) this.xpMultiplier.set(data.xpMultiplier);
                  if (data.hasCosmicTrail !== undefined) this.hasCosmicTrail.set(data.hasCosmicTrail);
                  if (data.hasGoldenAura !== undefined) this.hasGoldenAura.set(data.hasGoldenAura);
                  if (data.hasCelestialShield !== undefined) this.hasCelestialShield.set(data.hasCelestialShield);
                  if (data.lastCrateMonth !== undefined) this.lastCrateMonth.set(data.lastCrateMonth);
                  if (data.pendingCratesCount !== undefined) this.pendingCratesCount.set(data.pendingCratesCount);
                  
                  this.checkTemporaryMultipliers();
                  
                  if (data.toggleCosmicTrail !== undefined) this.toggleCosmicTrail.set(data.toggleCosmicTrail);
                  if (data.toggleGoldenAura !== undefined) this.toggleGoldenAura.set(data.toggleGoldenAura);
                  if (data.toggleCelestialShield !== undefined) this.toggleCelestialShield.set(data.toggleCelestialShield);

                  if (data.unlockedEnemies !== undefined) this.unlockedEnemies.set(data.unlockedEnemies);
                  if (data.crazyDealExpiresAt) {
                      this.crazyDealExpiresAt.set(data.crazyDealExpiresAt);
                  }
                  
                  // Restore world upgrades
                  if (data.worldUpgrades) {
                      Object.keys(data.worldUpgrades).forEach(key => {
                          const upgrades = data.worldUpgrades[key as unknown as number];
                          Object.keys(upgrades).forEach(statKey => {
                              if (statKey === 'unlockedAbilities') {
                                  const abilities = (upgrades as any)[statKey] as Record<string, any>;
                                  Object.keys(abilities).forEach(abKey => {
                                      const ability = abilities[abKey];
                                      if (ability && typeof ability.level === 'number' && !ability.modifiers) {
                                          ability.modifiers = {
                                              cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0, ammo: 1.0
                                          };
                                      }
                                  });
                              } else if (typeof upgrades[statKey as keyof WorldStats] === 'number' && isNaN(upgrades[statKey as keyof WorldStats] as number)) {
                                  (upgrades as any)[statKey] = (BASE_STATS as any)[statKey];
                              }
                          });
                      });
                  }
                  this.worldUpgrades.set(data.worldUpgrades);
              }
          } catch (e) {}
      }

      effect(() => {
          const screen = this.activeScreen();
          if (screen === 'menu' || screen === 'shop' || screen === 'login' || screen === 'profile' || screen === 'leaderboard' || screen === 'codex') {
              setTimeout(() => this.audio.playMenuBgm(), 0);
          } else if (screen === 'game') {
              setTimeout(() => this.audio.playWorldBgm(this.selectedWorldIndex()), 0);
          }
      });

      // Save guest state
      effect(() => {
          const stateToSave = {
              level: this.level(),
              xp: this.xp(),
              trophies: this.trophies(),
              coins: this.coins(),
              gems: this.gems(),
              hasPurchasedGems: this.hasPurchasedGems(),
              acceptedLegalPolicies: this.acceptedLegalPolicies(),
              upsellChance: this.upsellChance(),
              unlockedWorlds: this.unlockedWorlds(),
              worldUpgrades: this.worldUpgrades(),
              coinMultiplier: this.coinMultiplier(),
              xpMultiplier: this.xpMultiplier(),
              hasCosmicTrail: this.hasCosmicTrail(),
              hasGoldenAura: this.hasGoldenAura(),
              hasCelestialShield: this.hasCelestialShield(),
              pendingCratesCount: this.pendingCratesCount(),
              lastCrateMonth: this.lastCrateMonth(),
              toggleCosmicTrail: this.toggleCosmicTrail(),
              toggleGoldenAura: this.toggleGoldenAura(),
              toggleCelestialShield: this.toggleCelestialShield(),
              unlockedEnemies: this.unlockedEnemies(),
              crazyDealExpiresAt: this.crazyDealExpiresAt()
          };
          if (!this.auth.currentUser() || this.auth.currentUser()?.isTemp) {
              this.storage.setItem('phoenix_guest_data', JSON.stringify(stateToSave));
          }
      });
      
      // Global Trophy Trackers
      effect(() => {
          if (this.coins() >= 1000) this.awardTrophy("Wealthy");
          if (this.gems() >= 10) this.awardTrophy("Gem Hoarder");
      }, { allowSignalWrites: true });

      // Crazy Deal Timer Interval (Calculates remaining seconds from absolute expiry timestamp)
      setInterval(() => {
          const expiresAt = this.crazyDealExpiresAt();
          if (expiresAt) {
              const remaining = Math.floor((expiresAt - Date.now()) / 1000);
              if (remaining > 0) {
                  this.crazyDealTimer.set(remaining);
              } else {
                  this.crazyDealExpiresAt.set(null);
                  this.crazyDealTimer.set(0);
              }
          }
      }, 1000);

      // Web Push Check
      const params = new URLSearchParams(window.location.search);
      if (params.get('crazyDealExpiresAt')) {
          const expiresAt = parseInt(params.get('crazyDealExpiresAt') || '0', 10);
          const now = Date.now();
          // Ensure the deal hasn't expired, and the requested expiry is not more than ~10 minutes into the future
          if (expiresAt > now && (expiresAt - now) <= 605000) {
              this.triggerCrazyDeal(expiresAt);
          }
          window.history.replaceState({}, document.title, window.location.pathname);
      }
  }

  public checkMonthlyCrateEligibility(isSubscribed: boolean) {
      if (!isSubscribed) return;
      const currentMonth = new Date().toISOString().substring(0, 7); // e.g. "2026-06"
      if (this.lastCrateMonth() !== currentMonth) {
          let monthDiff = 1;
          if (this.lastCrateMonth()) {
              const last = new Date(this.lastCrateMonth() + '-01');
              const curr = new Date(currentMonth + '-01');
              monthDiff = (curr.getFullYear() - last.getFullYear()) * 12 + (curr.getMonth() - last.getMonth());
          }
          
          if (monthDiff > 0) {
              const maxAllowed = 3;
              const newTotal = Math.min(this.pendingCratesCount() + monthDiff, maxAllowed);
              this.pendingCratesCount.set(newTotal);
              this.lastCrateMonth.set(currentMonth);
              this.syncProgressToServer();
          }
      }
  }

  public grantTemporaryMultiplier(type: 'coin' | 'xp', mult: number, durationMinutes: number) {
      const expiresAt = Date.now() + (durationMinutes * 60 * 1000);
      if (type === 'coin') {
          this.tempCoinMultiplier.set(mult);
          this.tempCoinMultiplierExpiresAt.set(expiresAt);
      } else {
          this.tempXpMultiplier.set(mult);
          this.tempXpMultiplierExpiresAt.set(expiresAt);
      }
      this.syncProgressToServer();
  }

  private checkTemporaryMultipliers() {
      if (Date.now() > this.tempCoinMultiplierExpiresAt()) {
          this.tempCoinMultiplier.set(1);
          this.tempCoinMultiplierExpiresAt.set(0);
      }
      if (Date.now() > this.tempXpMultiplierExpiresAt()) {
          this.tempXpMultiplier.set(1);
          this.tempXpMultiplierExpiresAt.set(0);
      }
  }

  public triggerCrazyDeal(expiresAt?: number) {
      if (expiresAt) {
          this.crazyDealExpiresAt.set(expiresAt);
      } else {
          // Fallback if no specific expiry was given: 5 Minutes (300 seconds) from now
          this.crazyDealExpiresAt.set(Date.now() + 1000 * 60 * 5);
      }
      this.activeScreen.set('shop');
  }

  // World State
  public worlds = WORLDS;

  // Computed helper for current world's stats, falling back to defaults for any newly added stats missing in local storage


  public currentStats = computed(() => {
      const stats = this.worldUpgrades()[this.selectedWorldIndex()];
      return { 
          ...BASE_STATS, 
          ...stats,
          unlockedAbilities: { ...BASE_STATS.unlockedAbilities, ...(stats?.unlockedAbilities || {}) }
      };
  });

  // Phoenix Automation State
  public aiPhoenixOverridePosition = signal<{x: number, y: number} | null>(null);
  public aiPhoenixSpeed = signal<number>(1.2);
  public ai2PhoenixSpeed = signal<number>(1.2);

  // Sync with DB User
  syncWithUser(user: User) {
      if (!user) return;
      this.level.set(user.level || 1);
      this.xp.set(user.xp || 0);
      this.trophies.set(user.trophies || []);
      this.coins.set(Math.floor(Number(user.coins !== undefined && user.coins !== null ? user.coins : 100)) || 100);
      this.gems.set(Math.floor(Number(user.gems)) || 0);
      if (user.acceptedLegalPolicies) this.acceptedLegalPolicies.set(true);
      this.unlockedWorlds.set(user.unlockedWorlds && user.unlockedWorlds.length > 0 ? user.unlockedWorlds : [0]);
      if (user.worldUpgrades && Object.keys(user.worldUpgrades).length > 0) {
          const upgrades = user.worldUpgrades;
          // Migration for old saves
          Object.keys(upgrades).forEach(key => {
              if (!upgrades[key as any]) upgrades[key as any] = { ...BASE_STATS };
              if (upgrades[key as any].auraRadius < 250) upgrades[key as any].auraRadius = 250;
              if (upgrades[key as any].attackRange === undefined) upgrades[key as any].attackRange = 400;
              if (!upgrades[key as any].unlockedAbilities) upgrades[key as any].unlockedAbilities = {};
              if (upgrades[key as any].activeTapAbility === undefined) upgrades[key as any].activeTapAbility = null;
              if (upgrades[key as any].activeHoldAbility === undefined) upgrades[key as any].activeHoldAbility = null;
              
              // Auto-heal NaN
              Object.keys(upgrades[key as any]).forEach(statKey => {
                  if (statKey === 'unlockedAbilities') {
                      const abilities = upgrades[key as any][statKey] as Record<string, any>;
                      Object.keys(abilities).forEach(abKey => {
                          const ability = abilities[abKey];
                          if (ability && typeof ability.level === 'number' && !ability.modifiers) {
                              // Migrate old format to AbilityData
                              ability.modifiers = {
                                  cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0, ammo: 1.0
                              };
                          }
                      });
                  } else if (typeof upgrades[key as any][statKey as keyof WorldStats] === 'number' && isNaN(upgrades[key as any][statKey as keyof WorldStats] as number)) {
                      (upgrades[key as any] as any)[statKey] = (BASE_STATS as any)[statKey];
                  }
              });
          });
          this.worldUpgrades.set(upgrades);
      }
  }

  // Dynamic Upgrade System
  public upgradeAbility(worldId: number, abilityId: string) {
      const abilityConfig = ABILITIES[abilityId];
      if (!abilityConfig) return;
      if (this.coins() < abilityConfig.upgradeCost) return;

      this.coins.set(this.coins() - abilityConfig.upgradeCost);

      const upgrades = { ...this.worldUpgrades() };
      const worldStats = upgrades[worldId];
      if (!worldStats.unlockedAbilities[abilityId]) {
          worldStats.unlockedAbilities[abilityId] = { level: 1, modifiers: { cooldown: 1.0, speed: 1.0, duration: 1.0, damage: 1.0, radius: 1.0, range: 1.0, ammo: 1.0 } };
      }

      const abilityData = worldStats.unlockedAbilities[abilityId];
      abilityData.level++;
      abilityData.modifiers = this.generateAbilityUpgrade(abilityId, abilityData.level, abilityData.modifiers);

      this.worldUpgrades.set(upgrades);
      this.audio.playSFX('heal'); // Level up sound
  }

  public generateAbilityUpgrade(abilityId: string, currentLevel: number, currentModifiers: Record<string, number>): Record<string, number> {
      const config = ABILITY_UPGRADE_TARGETS[abilityId] || { targetLevel: 30, stats: { cooldown: 0.25, damage: 5.0 } };
      const newModifiers = { ...currentModifiers };
      
      const statsKeys = Object.keys(config.stats);

      // Ensure stats exist
      statsKeys.forEach(stat => {
          if (newModifiers[stat] === undefined) {
              newModifiers[stat] = 1.0;
          }
      });

      const expectedProgress = currentLevel / config.targetLevel; 
      
      let weights = statsKeys.map(stat => {
          const targetVal = config.stats[stat];
          const currentVal = newModifiers[stat];
          const isReduction = targetVal < 1.0; 
          
          let progress = 0;
          if (isReduction) {
              progress = (1.0 - currentVal) / (1.0 - targetVal);
          } else {
              progress = (currentVal - 1.0) / (targetVal - 1.0);
          }
          
          // The "Cone Idea": Heavily weight stats that fall behind
          let deficit = expectedProgress - progress;
          let weight = Math.max(0.01, 1.0 + (deficit * 10)); 
          return { stat, weight };
      });
      
      const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
      let rand = Math.random() * totalWeight;
      let chosenStat = statsKeys[0];
      for (let i = 0; i < weights.length; i++) {
          const w = weights[i];
          rand -= w.weight;
          if (rand <= 0) {
              chosenStat = w.stat;
              break;
          }
      }
      
      // Apply buff
      const targetVal = config.stats[chosenStat];
      const isReduction = targetVal < 1.0;
      const totalDelta = Math.abs(targetVal - 1.0);
      const avgDeltaPerLevel = totalDelta / config.targetLevel;
      
      // Randomize between 0.5x and 1.5x of the average step
      const buffAmount = avgDeltaPerLevel * (0.5 + Math.random());
      
      if (isReduction) {
          newModifiers[chosenStat] = Math.max(0.05, newModifiers[chosenStat] - buffAmount);
      } else {
          newModifiers[chosenStat] += buffAmount;
      }
      
      return newModifiers;
  }

  // Helper for XP math
  public getXpRequiredForLevel(level: number): number {
      return Math.floor(100 * Math.pow(1.05, level));
  }

  public addXp(amount: number) {
      this.checkTemporaryMultipliers();
      const multiplier = this.xpMultiplier() * this.tempXpMultiplier();
      this.xp.update(x => x + (amount * multiplier));
      this.checkLevelUp();
  }
  
  private checkLevelUp() {
      let currentXp = this.xp();
      let currentLevel = this.level();
      let leveledUp = false;
      
      let safetyCounter = 1000; // Prevent infinite loop lockups
      while (safetyCounter-- > 0) {
          let req = this.getXpRequiredForLevel(currentLevel);
          if (currentXp >= req) {
              currentXp -= req;
              currentLevel++;
              leveledUp = true;
          } else {
              break;
          }
      }
      
      this.xp.set(currentXp);
      this.level.set(currentLevel);
      if (leveledUp) {
          this.audio.playSFX('heal'); // Level up sound placeholder
      }
  }

  public addCoins(amount: number) {
    this.checkTemporaryMultipliers();
    let multiplier = this.coinMultiplier() * this.tempCoinMultiplier();
    
    // Golden Aura of Midas check (10% chance for 5x coins)
    if (this.hasGoldenAura() && Math.random() < 0.10) {
        multiplier *= 5;
    }
    
    this.coins.update(c => c + (amount * multiplier));
  }

  public awardTrophy(name: string) {
      const current = this.trophies();
      if (!current.includes(name)) {
          this.trophies.set([...current, name]);
          // Simple visual notification
          const el = document.createElement('div');
          el.className = 'fixed bottom-4 right-4 bg-black/90 text-yellow-400 border border-yellow-500/30 px-5 py-2 rounded-xl font-bold shadow-[0_0_15px_rgba(255,200,0,0.15)] z-50 flex items-center gap-2 animate-fade-in transition-opacity duration-500';
          el.innerHTML = `<span class="text-2xl">🏆</span> <span>${name} Unlocked</span>`;
          document.body.appendChild(el);
          setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 3000);
      }
  }

  public async syncProgressToServer(battleStats?: Record<string, number>) {
      if (!this.auth.currentUser() || this.auth.currentUser()?.isTemp) return;
      
      this.coins.update(c => Math.floor(c));
      this.gems.update(g => Math.floor(g));

      const payload = {
          level: this.level(),
          xp: this.xp(),
          trophies: this.trophies(),
          coins: this.coins(),
          gems: this.gems(),
          unlockedWorlds: this.unlockedWorlds(),
          worldUpgrades: this.worldUpgrades(),
          hasPurchasedGems: this.hasPurchasedGems(),
          acceptedLegalPolicies: this.acceptedLegalPolicies(),
          upsellChance: this.upsellChance(),
          coinMultiplier: this.coinMultiplier(),
          xpMultiplier: this.xpMultiplier(),
          hasCosmicTrail: this.hasCosmicTrail(),
          hasGoldenAura: this.hasGoldenAura(),
          hasCelestialShield: this.hasCelestialShield(),
          pendingCratesCount: this.pendingCratesCount(),
          lastCrateMonth: this.lastCrateMonth(),
          toggleCosmicTrail: this.toggleCosmicTrail(),
          toggleGoldenAura: this.toggleGoldenAura(),
          toggleCelestialShield: this.toggleCelestialShield(),
          unlockedEnemies: this.unlockedEnemies(),
          crazyDealExpiresAt: this.crazyDealExpiresAt(),
          ...(battleStats || {})
      };
      
      try {
          await firstValueFrom(this.http.post(environment.apiUrl + '/auth/sync', payload));
      } catch (e) {
          console.error("Failed to sync progress", e);
      }
  }

  async migrateGuestData() {
      const localData = this.storage.getItem('phoenix_guest_data');
      if (!localData) return;
      
      try {
          const parsed = JSON.parse(localData);
          await firstValueFrom(this.http.post(environment.apiUrl + '/auth/sync', parsed));
          this.storage.removeItem('phoenix_guest_data');
      } catch (e) {
          console.error("Failed to migrate guest data", e);
      }
  }

  // Upgrades
  public purchaseUpgrade(type: keyof WorldStats, cost: number, amount: number) {
    if (this.coins() >= cost) {
      this.coins.update(c => c - cost);
      
      this.worldUpgrades.update(upgrades => {
        const currentWorldId = this.selectedWorldIndex();
        const currentWorldStats = upgrades[currentWorldId];
        let currentVal = currentWorldStats[type] as number;
        if (type === 'maxHealth') {
            currentVal = BASE_STATS[type] as number;
        } else if (type === 'speed') {
            currentVal = BASE_STATS[type] as number;
        }
        
        return {
          ...upgrades,
          [currentWorldId]: {
            ...currentWorldStats,
            [type]: currentVal + amount
          }
        };
      });
      this.awardTrophy("Upgraded");
      return true;
    }
    return false;
  }

  public startGame(mode: 'campaign' | 'battle' = 'campaign') {
    this.currentGameMode.set(mode);
    this.activeScreen.set('game');
  }
}
