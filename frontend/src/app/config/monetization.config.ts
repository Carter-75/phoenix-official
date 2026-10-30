// Monetization configuration: the ONLY place ad IDs and ad rules live.
//
// Build split (debug vs release): one web bundle ships in both the debug
// APK and the release AAB, so the web code cannot tell them apart by
// itself. MainActivity.java appends "PhoenixBuild/release" or
// "PhoenixBuild/debug" to the WebView user agent from the APK debuggable flag.
// Only a native release build gets the production units with testMode
// off. Everything else (debug or sideloaded APKs, Test Lab, web) uses
// Google's official TEST units with testMode on, so the developer never
// taps a real ad (AdMob policy). The manifest app ID is split the same
// way by resValue in android/app/build.gradle.

const TEST_ADMOB = {
  appId: 'ca-app-pub-3940256099942544~3347511713',
  adUnits: {
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    banner: 'ca-app-pub-3940256099942544/6300978111'
  },
  testMode: true
};

const PROD_ADMOB = {
  appId: 'ca-app-pub-6226259217177847~9377545496',
  adUnits: {
    rewarded: 'ca-app-pub-6226259217177847/6481908517',
    interstitial: 'ca-app-pub-6226259217177847/6649429471',
    // No production banner unit exists; banners are not shown.
    banner: 'ca-app-pub-3940256099942544/6300978111'
  },
  testMode: false
};

export function isNativeReleaseBuild(): boolean {
  return typeof navigator !== 'undefined' && /PhoenixBuild\/release/.test(navigator.userAgent || '');
}

export const ADMOB_CONFIG = isNativeReleaseBuild() ? PROD_ADMOB : TEST_ADMOB;

// Interstitial rules (audit 6.3 and 7.4, Carter's confirmed model):
// natural breaks only, never mid-combat, never on the death screen, none in
// the first 3 finished runs (which also covers the first session), at most
// one per run and one per 3 minutes, and never for Remove Ads owners or
// subscribers.
export const INTERSTITIAL_RULES = {
  skipFirstRuns: 3,
  minIntervalMs: 3 * 60 * 1000
};

// Rewarded placements. Server-side verification kinds map to grants in
// backend/routes/ads.js: boost = 2x coins and XP for 5 minutes (never
// damage), upgrade = +1 revive token, revive and bubble are recorded by SSV
// while their rewards apply in the client flow.
export type RewardedKind = 'revive' | 'boost' | 'upgrade' | 'bubble';
