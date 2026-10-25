// Monetization configuration: the ONLY place ad IDs and ad rules live.
// Until Carter creates his AdMob account, these are Google's official TEST
// ad units, which are safe to ship in development builds and never earn
// money. Swapping in the real IDs is a config-only change here plus the
// AdMob app ID in android/app/src/main/AndroidManifest.xml.

export const ADMOB_CONFIG = {
  // Test app ID (also set in AndroidManifest.xml for the plugin)
  appId: 'ca-app-pub-3940256099942544~3347511713',
  adUnits: {
    rewarded: 'ca-app-pub-3940256099942544/5224354917',     // TEST rewarded
    interstitial: 'ca-app-pub-3940256099942544/1033173712', // TEST interstitial
    banner: 'ca-app-pub-3940256099942544/6300978111'        // TEST banner
  },
  testMode: true
};

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
