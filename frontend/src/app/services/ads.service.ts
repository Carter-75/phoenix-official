import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AdMob } from '@capacitor-community/admob';
import { ADMOB_CONFIG, INTERSTITIAL_RULES, RewardedKind } from '../config/monetization.config';
import { GameStateService } from './game-state.service';
import { AuthService } from './auth.service';
import { IapService } from './iap.service';

// Real AdMob ads via @capacitor-community/admob (audit 6.3/7.4). Before this
// service existed, every "ad" in the game was a 2-second timer that granted
// the reward for free: there was no SDK loaded at all (audit bugs 13/14).
//
// Rewarded: revive, the deliberate 2x boost, shop free upgrades, and the ad
// bubble. All rewarded requests carry SSV options (userId + customData) so
// Google calls the backend callback, which verifies the signature and
// grants server-side (backend/routes/ads.js). Client grants happen on the
// plugin's reward too, for instant UX; the server record is authoritative.
//
// Interstitials: see INTERSTITIAL_RULES in monetization.config. This service
// is the only place they can be shown from, and it refuses outside the rules.
//
// On web there is no AdMob: rewarded falls back to a clearly-labeled 2s
// simulated watch so the game stays testable, and interstitials never show.

const SSV_KIND: Record<RewardedKind, string> = {
  revive: 'revive',
  boost: 'boost',
  upgrade: 'revive_token',
  bubble: 'bubble'
};

const STATE_KEY = 'phoenix_ads_state_v1';

interface AdsState {
  runsCompleted: number;
  lastInterstitialAt: number;
  interstitialForRun: number; // runsCompleted value an interstitial was shown for
}

@Injectable({ providedIn: 'root' })
export class AdsService {
  private gameState = inject(GameStateService);
  private auth = inject(AuthService);
  private iap = inject(IapService);

  private initialized = false;
  private state: AdsState = this.loadState();

  private loadState(): AdsState {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { runsCompleted: 0, lastInterstitialAt: 0, interstitialForRun: -1 };
  }

  private saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(this.state)); } catch (e) { /* ignore */ }
  }

  private async ensureInit(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    if (this.initialized) return true;
    try {
      await AdMob.initialize({});
      this.initialized = true;
      return true;
    } catch (e) {
      console.error('AdMob initialize failed', e);
      return false;
    }
  }

  public async showRewarded(kind: RewardedKind): Promise<boolean> {
    this.gameState.audio.pauseAudioForAd();
    try {
      if (!Capacitor.isNativePlatform()) {
        console.warn(`[ADS SIMULATED] Rewarded ad (${kind}) on web: 2s simulated watch.`);
        await new Promise(r => setTimeout(r, 2000));
        return true;
      }
      if (!(await this.ensureInit())) return false;

      const user = this.auth.currentUser();
      const loggedIn = user && !user.isTemp && user._id;
      await AdMob.prepareRewardVideoAd({
        adId: ADMOB_CONFIG.adUnits.rewarded,
        ssv: loggedIn
          ? { userId: user._id, customData: SSV_KIND[kind] }
          : { customData: SSV_KIND[kind] }
      } as any);
      await AdMob.showRewardVideoAd();
      return true; // the promise resolves with the reward item when earned
    } catch (e) {
      console.warn(`Rewarded ad (${kind}) not completed`, e);
      return false;
    } finally {
      this.gameState.audio.resumeAudioAfterAd();
    }
  }

  // Call exactly once when a run ends (win or quit), before considering an
  // interstitial.
  public onRunFinished() {
    this.state.runsCompleted++;
    this.saveState();
  }

  public async maybeShowInterstitial(): Promise<boolean> {
    // Exemptions: Remove Ads owners and subscribers never see interstitials.
    if (this.gameState.hasRemoveAds()) return false;
    if (this.iap.isSubscribed() || this.auth.currentUser()?.hasActiveSub) return false;
    // None during the first runs (this also covers the first session).
    if (this.state.runsCompleted <= INTERSTITIAL_RULES.skipFirstRuns) return false;
    // Max one per run.
    if (this.state.interstitialForRun === this.state.runsCompleted) return false;
    // Frequency cap.
    if (Date.now() - this.state.lastInterstitialAt < INTERSTITIAL_RULES.minIntervalMs) return false;
    if (!Capacitor.isNativePlatform()) return false;
    if (!(await this.ensureInit())) return false;

    try {
      await AdMob.prepareInterstitial({ adId: ADMOB_CONFIG.adUnits.interstitial });
      await AdMob.showInterstitial();
      this.state.lastInterstitialAt = Date.now();
      this.state.interstitialForRun = this.state.runsCompleted;
      this.saveState();
      return true;
    } catch (e) {
      console.warn('Interstitial failed', e);
      return false;
    }
  }
}
