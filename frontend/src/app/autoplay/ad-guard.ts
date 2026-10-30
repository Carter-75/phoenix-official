// Central ad guard. While the owner-only AI Autoplay tester runs, no
// ad of any kind may show: interstitials, rewarded, banners, preloads,
// or the floating reward bubble. Every ad entry point checks this one
// flag (AdsService.ensureInit, showRewarded, maybeShowInterstitial,
// the game's finishRunForAds, and the ad bubble spawner).
let suppressedBy = new Set<string>();

export const AdGuard = {
  suppress(reason: string) { suppressedBy.add(reason); },
  release(reason: string) { suppressedBy.delete(reason); },
  isSuppressed(): boolean { return suppressedBy.size > 0; },
  /** Test helper. */
  reset() { suppressedBy = new Set<string>(); },
};
