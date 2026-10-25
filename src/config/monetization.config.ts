// Monetization config. This is the ONLY file to edit when Carter's real
// AdMob and Play Console accounts exist. Until then everything uses Google's
// official TEST ad units and simulated purchases off-device.

export const MONETIZATION_CONFIG = {
  // Flip to true only after pasting real AdMob IDs below and creating the
  // products in Play Console with the exact IDs in PRODUCTS.
  useRealAds: false,
  useRealBilling: false,

  admob: {
    // Google's public test app ID (already wired in app.json too).
    appIdAndroid: 'ca-app-pub-3940256099942544~3347511713',
    appIdIos: 'ca-app-pub-3940256099942544~1458002511',
    // Test ad units:
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
  },

  interstitial: {
    // Market research (audit Section 7.4): non-payers only, natural breaks
    // only, generous gaps. Never in the first 3 finished runs.
    minIntervalMs: 240_000,
    skipFirstRuns: 3,
  },

  boost: {
    multiplier: 2,
    durationMs: 5 * 60_000, // rewarded 2x boost lasts 5 minutes
  },
};

export interface Product {
  id: string; // Play Console product ID
  kind: 'consumable' | 'non-consumable' | 'subscription';
  name: string;
  description: string;
  priceLabel: string; // display only; real price comes from Play
  coins?: number;
  gems?: number;
}

export const PRODUCTS: Product[] = [
  { id: 'coins_small', kind: 'consumable', name: 'Pile of Coins', description: '1,000 coins', priceLabel: '$0.99', coins: 1000 },
  { id: 'coins_medium', kind: 'consumable', name: 'Chest of Coins', description: '5,500 coins', priceLabel: '$4.99', coins: 5500 },
  { id: 'coins_large', kind: 'consumable', name: 'Vault of Coins', description: '12,000 coins', priceLabel: '$9.99', coins: 12000 },
  { id: 'coins_mega', kind: 'consumable', name: 'Phoenix Hoard', description: '30,000 coins', priceLabel: '$19.99', coins: 30000 },
  { id: 'gems_small', kind: 'consumable', name: 'Handful of Gems', description: '20 gems', priceLabel: '$1.99', gems: 20 },
  { id: 'gems_medium', kind: 'consumable', name: 'Pouch of Gems', description: '60 gems', priceLabel: '$4.99', gems: 60 },
  { id: 'gems_large', kind: 'consumable', name: 'Crown of Gems', description: '150 gems', priceLabel: '$9.99', gems: 150 },
  { id: 'move_pack_all', kind: 'non-consumable', name: 'Full Arsenal Pack', description: 'Unlock all 75 moves instantly', priceLabel: '$9.99' },
  { id: 'skin_pack_all', kind: 'non-consumable', name: 'Every Skin Pack', description: 'Unlock every phoenix skin', priceLabel: '$4.99' },
  { id: 'remove_ads', kind: 'non-consumable', name: 'Remove Ads', description: 'No more interstitial ads. Rewarded ads stay available.', priceLabel: '$4.99' },
  { id: 'phoenix_pass', kind: 'subscription', name: 'Phoenix Pass', description: 'Monthly: 100 gems, permanent 2x boost while active, Celestial skin', priceLabel: '$4.99/mo' },
];

export const PRODUCT_BY_ID: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
