import { Capacitor } from '@capacitor/core';

export const environment = {
  production: true,
  // Cloud device test build ONLY. This environment file is wired in
  // solely by the "cloudtest" Angular build configuration, which only
  // the cloud-test GitHub Actions workflow builds. It turns on the
  // scripted Test Lab scenario in src/app/cloudtest/ (auto-start a
  // World 1 run, invincible player, straight to the boss) so a Robo
  // crawl exercises a real boss fight. android-build.yml never uses
  // this configuration, so no build Carter installs contains an
  // active scenario.
  cloudTest: true,
  // Simulated/local purchase grants stay OFF here too: even the test
  // build may only grant purchases the server has verified.
  allowSimulatedPurchases: false,
  // Force the API to ALWAYS point to the standalone Render backend for both Web AND Native!
  apiUrl: 'https://phoenix-fall.onrender.com',

  googlePlay: {
    skuTier1: 'com.phoenix.gems.tier1',
    skuTier2: 'com.phoenix.gems.tier2',
    skuTier3: 'com.phoenix.gems.tier3',
    // One subscription only (audit design lock). The old premium tier and
    // the whale SKU are gone and must not be registered or sold.
    subMonthlyStandard: 'com.phoenix.sub.monthly',
    skuTempMultiplierX2: 'com.phoenix.temp.multiplier.x2',
    skuTempMultiplierX10: 'com.phoenix.temp.multiplier.x10',
    skuRemoveAds: 'com.phoenix.removeads'
  }
};
