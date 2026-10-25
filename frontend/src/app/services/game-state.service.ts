import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AudioService } from './audio.service';
import { AuthService, User } from './auth.service';
import { StorageService } from './storage.service';
import { WorldStats, PhysicsEntity, World, AbilityData } from '../models/game.models';
import { WORLDS, ABILITIES, REALM_ABILITIES, BASE_STATS, WORLD_0_STATS, deterministicAbilityModifiers } from '../constants/game.constants';

// Systems S1 (spec Sections 2.5 and 3.5): save version for the
// deterministic ability-modifier migration. Stored modifiers are
// recomputed from stored levels only while a save's flag is below this
// version; see migrateAbilityModifiers.
export const MODIFIERS_VERSION = 1;

// One-time backup key for the pre-migration guest save (spec Section
// 7.3 mitigation). Written once, never overwritten, never synced.
export const GUEST_SAVE_BACKUP_KEY = 'phoenix_guest_data_backup_pre_s1';

// Movement resource and verb state for one bird (spec Section 2).
// Run-local: never saved, never synced, never sold. The game component
// requests verbs and reads i-frames; the particle renderer owns the
// per-frame motion, glide tracking, and stamina regeneration, calling
// tickMovement each substep. Directions: dashDir is a screen-space unit
// vector (the renderer flips y into world space); rollDir is a
// world-space unit vector the renderer computes from the bird heading.
export interface MovementState {
  stamina: number;
  lastSpendAt: number; // Date.now() ms of the last stamina spend
  dashUntil: number; // Date.now() ms; dash motion and i-frames derive from this
  dashDirX: number;
  dashDirY: number;
  rollRequestedAt: number; // Date.now() ms; 0 when no roll is pending
  rollUntil: number; // Date.now() ms; set by the renderer when a roll starts
  rollDirX: number;
  rollDirY: number;
  rollSide: number; // visual roll direction: +1 or -1
  braking: boolean;
  gliding: boolean;
  straightTime: number; // seconds of near-straight flight accumulated
  lastHeading: number | null; // radians, renderer-tracked
  lastLateralSign: number; // last steering direction sign, for roll side choice
}

export function createMovementState(): MovementState {
  return {
    stamina: 100, lastSpendAt: 0,
    dashUntil: 0, dashDirX: 0, dashDirY: 0,
    rollRequestedAt: 0, rollUntil: 0, rollDirX: 0, rollDirY: 0, rollSide: 1,
    braking: false, gliding: false, straightTime: 0, lastHeading: null, lastLateralSign: 1
  };
}

// Stamina tuning (spec Section 2.5): one shared 100 point pool, dash
// 35, roll 50, regeneration 25 per second after a 0.6 s delay from the
// last spend. Gliding doubles regeneration and halves the next spend.
export const STAMINA = {
  max: 100,
  dashCost: 35,
  rollCost: 50,
  regenPerSecond: 25,
  regenDelayMs: 600,
  dashMs: 220,
  dashIframeBonusMs: 50,
  rollMs: 350
};

@Injectable({
  providedIn: 'root'
})
export class GameStateService {
  public audio = inject(AudioService);
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private storage = inject(StorageService);

  public isGuest = computed(() => !this.auth.currentUser() || this.auth.currentUser()?.isTemp);

  // Currency & Progress
  public level = signal<number>(0);
  public xp = signal<number>(0);
  public trophies = signal<string[]>([]);
  public coins = signal<number>(100); 
  public gems = signal<number>(0);
  public hasPurchasedGems = signal<boolean>(false);
  // Server-granted entitlements (set from the account record, never locally)
  public hasRemoveAds = signal<boolean>(false);
  public reviveTokens = signal<number>(0);
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

  // Local presentation and feel preferences (spec Sections 2.1, 4.3,
  // 4.4). Stored with the other local preferences, NOT in the synced
  // save: they describe this device, not the player's progression.
  public touchOffsetEnabled = signal<boolean>(true);
  public screenShakeSetting = signal<'on' | 'reduced' | 'off'>('on');
  public damageNumbersEnabled = signal<boolean>(true);

  // Movement state per bird (spec Section 2.5): the player, the Battle
  // rival (ai1), and the second AI in AI vs AI (ai2, which flies the
  // main bird). The AI birds spend from the same pool at the same costs
  // as the player; parity is a rule, not a hope (spec Section 7.2).
  public playerMovement: MovementState = createMovementState();
  public aiMovement: MovementState = createMovementState();
  public ai2Movement: MovementState = createMovementState();
  // The player bird's skin is not state: it is derived from the
  // selected world (visual spec addendum, Oct 25, 2026; each WORLDS
  // entry carries its skinId, resolved by phoenixSkinForWorld). There
  // is no skin selection and nothing about skins is stored or synced.
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
      // Local preferences first: the guest restore below and every
      // settings consumer read them.
      const prefOffset = this.storage.getItem('phoenix_pref_touch_offset');
      if (prefOffset !== null) this.touchOffsetEnabled.set(prefOffset !== '0');
      const prefShake = this.storage.getItem('phoenix_pref_screen_shake');
      if (prefShake === 'reduced' || prefShake === 'off') this.screenShakeSetting.set(prefShake);
      const prefDmg = this.storage.getItem('phoenix_pref_damage_numbers');
      if (prefDmg !== null) this.damageNumbersEnabled.set(prefDmg !== '0');

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

      // Restore the guest save. Audit bug 2: this used to sit inside the else
      // branch of the upsellChance check, and every real save HAS an
      // upsellChance, so progression silently never restored. Every field now
      // restores unconditionally, field by field.
      const localData = this.storage.getItem('phoenix_guest_data');
      if (localData) {
          try {
              const data = JSON.parse(localData);
              // Deterministic-modifier migration (spec Sections 3.5
              // and 7.3): before anything reads this save, keep a
              // one-time backup of the untouched pre-migration bytes
              // under a separate key, then recompute stored modifiers
              // from stored levels if the version flag is absent.
              const guestHasVersion = typeof data.modifiersVersion === 'number' && data.modifiersVersion >= MODIFIERS_VERSION;
              if (!guestHasVersion && data.worldUpgrades) {
                  if (!this.storage.getItem(GUEST_SAVE_BACKUP_KEY)) {
                      this.storage.setItem(GUEST_SAVE_BACKUP_KEY, localData);
                  }
                  this.migrateAbilityModifiers(data.worldUpgrades, false);
              }
              // selectedSkinId was added one stage ago and never
              // shipped; the skin is becoming world-determined, so the
              // field is transient: drop it silently wherever a save
              // still carries it (it is not restored and not re-saved).
              delete data.selectedSkinId;
              this.level.set(data.level || 0);
              this.xp.set(data.xp || 0);
              this.trophies.set(data.trophies || []);
              this.coins.set(Math.floor(data.coins !== undefined ? data.coins : 100));
              if (data.gems !== undefined) this.gems.set(Math.floor(data.gems));
              if (data.hasPurchasedGems !== undefined) this.hasPurchasedGems.set(data.hasPurchasedGems);
              if (data.acceptedLegalPolicies !== undefined) this.acceptedLegalPolicies.set(data.acceptedLegalPolicies);
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
              if (data.hasRemoveAds !== undefined) this.hasRemoveAds.set(data.hasRemoveAds);
              if (data.reviveTokens !== undefined) this.reviveTokens.set(data.reviveTokens);

              this.checkTemporaryMultipliers();

              if (data.toggleCosmicTrail !== undefined) this.toggleCosmicTrail.set(data.toggleCosmicTrail);
              if (data.toggleGoldenAura !== undefined) this.toggleGoldenAura.set(data.toggleGoldenAura);
              if (data.toggleCelestialShield !== undefined) this.toggleCelestialShield.set(data.toggleCelestialShield);
              if (data.unlockedEnemies !== undefined) this.unlockedEnemies.set(data.unlockedEnemies);

              // Restore world upgrades (with legacy migrations)
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
              hasRemoveAds: this.hasRemoveAds(),
              reviveTokens: this.reviveTokens(),
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
              modifiersVersion: MODIFIERS_VERSION,
              unlockedEnemies: this.unlockedEnemies()
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

  // Deterministic-modifier migration (spec Sections 3.5 and 7.3).
  // Recomputes every stored ability's modifiers from its stored level
  // when the save's version flag is absent; levels, unlocks, equip
  // choices, and every other field are untouched. When the flag is
  // present, stored modifiers are kept exactly as they are and only a
  // missing modifiers record (a legacy shape the old loader filled with
  // 1.0s) is filled, from the same deterministic curve. Recomputing is
  // a pure function of level, so running it on an already-migrated
  // record reproduces the identical values.
  public migrateAbilityModifiers(worldUpgrades: Record<string, any>, hasVersionFlag: boolean): void {
      if (!worldUpgrades || typeof worldUpgrades !== 'object') return;
      Object.keys(worldUpgrades).forEach(key => {
          const record = worldUpgrades[key];
          if (!record || typeof record !== 'object') return;
          if (record.activeDoubleAbility === undefined) record.activeDoubleAbility = null;
          if (record.activeTripleAbility === undefined) record.activeTripleAbility = null;
          const abilities = record.unlockedAbilities;
          if (!abilities || typeof abilities !== 'object') return;
          Object.keys(abilities).forEach(abKey => {
              const ability = abilities[abKey];
              if (!ability || typeof ability.level !== 'number') return;
              if (!hasVersionFlag || !ability.modifiers) {
                  ability.modifiers = deterministicAbilityModifiers(abKey, ability.level);
              }
          });
      });
  }

  // --- Movement verbs and stamina (spec Section 2) ---

  // Spend from a bird's pool. While gliding, the spend is halved (the
  // glide discount of Section 2.6) and the glide ends on any verb.
  // Returns false and spends nothing when the pool cannot pay.
  public spendStamina(state: MovementState, baseCost: number): boolean {
      const cost = state.gliding ? baseCost / 2 : baseCost;
      if (state.stamina < cost) return false;
      state.stamina -= cost;
      state.lastSpendAt = Date.now();
      return true;
  }

  // Flick Dash request (spec Section 2.2): direction is a screen-space
  // unit vector. Spends synchronously so refusal is immediate; the
  // renderer applies the motion while now < dashUntil.
  public requestDash(state: MovementState, dirX: number, dirY: number): boolean {
      const len = Math.hypot(dirX, dirY);
      if (len < 1e-6) return false;
      if (!this.spendStamina(state, STAMINA.dashCost)) return false;
      const now = Date.now();
      state.dashDirX = dirX / len;
      state.dashDirY = dirY / len;
      state.dashUntil = now + STAMINA.dashMs;
      state.gliding = false;
      state.straightTime = 0;
      return true;
  }

  // Air Roll request (spec Section 2.3): the lateral direction depends
  // on the bird's live heading, which only the renderer knows, so the
  // spend happens there when it consumes the request (same frame in
  // practice). A provisional i-frame window covers the consume gap so
  // a roll pressed in good faith is never a free hit.
  public requestRoll(state: MovementState): void {
      if (Date.now() < state.rollUntil) return;
      state.rollRequestedAt = Date.now();
  }

  // Per-substep stamina regeneration, called by the renderer for each
  // bird it flies. 25 per second after the 0.6 s post-spend delay,
  // doubled while gliding (spec Sections 2.5 and 2.6).
  public tickMovement(state: MovementState, dtSeconds: number): void {
      if (state.stamina >= STAMINA.max) return;
      if (Date.now() - state.lastSpendAt < STAMINA.regenDelayMs) return;
      const rate = STAMINA.regenPerSecond * (state.gliding ? 2 : 1);
      state.stamina = Math.min(STAMINA.max, state.stamina + rate * dtSeconds);
  }

  // True while a bird cannot be hit: dash i-frames (dash plus 0.05 s),
  // roll i-frames (the whole roll), or the provisional roll window.
  public movementIframesActive(state: MovementState): boolean {
      const now = Date.now();
      if (now < state.dashUntil + STAMINA.dashIframeBonusMs) return true;
      if (now < state.rollUntil) return true;
      if (state.rollRequestedAt > 0 && now - state.rollRequestedAt < STAMINA.rollMs + 50) return true;
      return false;
  }

  public endGlide(state: MovementState): void {
      state.gliding = false;
      state.straightTime = 0;
  }

  // --- Local preferences (persisted on this device only) ---

  public setTouchOffsetEnabled(on: boolean) {
      this.touchOffsetEnabled.set(on);
      this.storage.setItem('phoenix_pref_touch_offset', on ? '1' : '0');
  }

  public setScreenShakeSetting(value: 'on' | 'reduced' | 'off') {
      this.screenShakeSetting.set(value);
      this.storage.setItem('phoenix_pref_screen_shake', value);
  }

  public setDamageNumbersEnabled(on: boolean) {
      this.damageNumbersEnabled.set(on);
      this.storage.setItem('phoenix_pref_damage_numbers', on ? '1' : '0');
  }

  // Touch steering offset (spec Section 2.1): on touch devices the
  // steering target sits about 8 percent of the min dimension above
  // the fingertip so the bird is not hidden under the thumb. Mouse
  // input is never offset, and neither is anything off the game
  // screen. Ability aiming uses the same adjusted point, so what the
  // player sees is what fires.
  public applyTouchOffset(x: number, y: number, isTouch: boolean): { x: number, y: number } {
      if (!isTouch || !this.touchOffsetEnabled() || this.activeScreen() !== 'game') return { x, y };
      return { x, y: y - 0.08 * Math.min(window.innerWidth, window.innerHeight) };
  }

  // Sync with DB User
  syncWithUser(user: User) {
      if (!user) return;
      // selectedSkinId is transient (see the guest restore): a server
      // record may still carry it; it is dropped silently, not applied.
      delete (user as any).selectedSkinId;
      this.level.set(user.level || 1);
      this.xp.set(user.xp || 0);
      this.trophies.set(user.trophies || []);
      this.coins.set(Math.floor(Number(user.coins !== undefined && user.coins !== null ? user.coins : 100)) || 100);
      this.gems.set(Math.floor(Number(user.gems)) || 0);
      if (user.acceptedLegalPolicies) this.acceptedLegalPolicies.set(true);
      if (user.hasRemoveAds !== undefined) this.hasRemoveAds.set(!!user.hasRemoveAds);
      if (user.reviveTokens !== undefined) this.reviveTokens.set(user.reviveTokens || 0);
      // Server-granted boost (verified ad reward or verified purchase)
      if (user.boostExpiresAt && user.boostExpiresAt > Date.now()) {
          const mult = user.boostMultiplier || 2;
          this.tempCoinMultiplier.set(mult);
          this.tempCoinMultiplierExpiresAt.set(user.boostExpiresAt);
          this.tempXpMultiplier.set(mult);
          this.tempXpMultiplierExpiresAt.set(user.boostExpiresAt);
      }
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
              if (upgrades[key as any].activeDoubleAbility === undefined) upgrades[key as any].activeDoubleAbility = null;
              if (upgrades[key as any].activeTripleAbility === undefined) upgrades[key as any].activeTripleAbility = null;

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
          // Deterministic-modifier migration for server saves (spec
          // Sections 3.5 and 7.3): recompute from levels only when
          // the record's version flag is absent.
          const serverHasVersion = typeof (user as any).modifiersVersion === 'number' && (user as any).modifiersVersion >= MODIFIERS_VERSION;
          this.migrateAbilityModifiers(upgrades, serverHasVersion);
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

  // Deterministic upgrades (spec Section 3.5): the modifiers for a
  // level are a pure function of the level, identical for every
  // player and for the Battle AI (which calls this same method, so
  // parity holds by construction). The old random cone-weighted roll
  // is gone; currentModifiers is accepted for call-site compatibility
  // and ignored.
  public generateAbilityUpgrade(abilityId: string, currentLevel: number, currentModifiers: Record<string, number>): Record<string, number> {
      return deterministicAbilityModifiers(abilityId, currentLevel);
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
          modifiersVersion: MODIFIERS_VERSION,
          hasPurchasedGems: this.hasPurchasedGems(),
          acceptedLegalPolicies: this.acceptedLegalPolicies(),
          reviveTokens: this.reviveTokens(),
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
        // Stack on the world's actual current value. (The old code reset
        // maxHealth and speed to BASE_STATS on every purchase, so repeat
        // purchases never accumulated.)
        let currentVal = currentWorldStats[type] as number;
        if (typeof currentVal !== 'number' || isNaN(currentVal)) {
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
