import { Capacitor } from '@capacitor/core';

export const environment = {
  production: false,
  // Development builds only: allow the simulated purchase flow and the
  // local grant fallback so purchases can be tested before Play billing
  // is configured. Never enable this in the production environment.
  allowSimulatedPurchases: true,
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
