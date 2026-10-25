import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MONETIZATION_CONFIG, PRODUCT_BY_ID } from '../config/monetization.config';
import { useGame } from '../state/GameContext';

// ---------------------------------------------------------------------------
// AdMob: the real SDK is loaded only on native builds. On web (and anywhere
// the native module is missing) ads run in a clearly labeled TEST simulation
// so the game loop stays testable. Interstitial rules live here, in one place:
// at natural breaks only, 90s minimum gap, never when Remove Ads is owned.
// ---------------------------------------------------------------------------

let MobileAds: any = null;
let RewardedAd: any = null;
let InterstitialAd: any = null;
let RewardedAdEventType: any = null;
let AdEventType: any = null;
let TestIds: any = null;
let nativeAdsAvailable = false;

if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ads = require('react-native-google-mobile-ads');
    MobileAds = ads.default;
    RewardedAd = ads.RewardedAd;
    InterstitialAd = ads.InterstitialAd;
    RewardedAdEventType = ads.RewardedAdEventType;
    AdEventType = ads.AdEventType;
    TestIds = ads.TestIds;
    nativeAdsAvailable = !!MobileAds;
  } catch (e) {
    nativeAdsAvailable = false;
  }
}

const rewardedUnit = () =>
  MONETIZATION_CONFIG.useRealAds ? MONETIZATION_CONFIG.admob.rewarded : TestIds?.REWARDED ?? MONETIZATION_CONFIG.admob.rewarded;
const interstitialUnit = () =>
  MONETIZATION_CONFIG.useRealAds ? MONETIZATION_CONFIG.admob.interstitial : TestIds?.INTERSTITIAL ?? MONETIZATION_CONFIG.admob.interstitial;

// ---------------------------------------------------------------------------
// Billing: expo-iap on native when enabled in config. Off-device purchases
// are simulated grants (dev builds and web preview), labeled TEST in the UI.
// Real charges are impossible until useRealBilling is true AND the products
// exist in Play Console.
// ---------------------------------------------------------------------------

interface MonetizationValue {
  showRewarded: (reason: 'revive' | 'boost') => Promise<boolean>;
  maybeShowInterstitial: () => Promise<boolean>;
  purchase: (productId: string) => Promise<boolean>;
  restorePurchases: () => Promise<void>;
  adsReady: boolean;
  billingReady: boolean;
  testMode: boolean;
}

const Ctx = createContext<MonetizationValue | null>(null);

export function MonetizationProvider({ children }: { children: React.ReactNode }) {
  const game = useGame();
  const gameRef = useRef(game);
  gameRef.current = game;
  const lastInterstitialAt = useRef(0);
  const [simAd, setSimAd] = useState<{ kind: 'rewarded' | 'interstitial'; resolve: (v: boolean) => void } | null>(null);
  const [adsReady, setAdsReady] = useState(false);
  const [billingReady, setBillingReady] = useState(false);

  useEffect(() => {
    if (nativeAdsAvailable && MobileAds) {
      MobileAds()
        .initialize()
        .then(() => setAdsReady(true))
        .catch(() => setAdsReady(false));
    } else {
      setAdsReady(true); // simulation is always ready
    }
    setBillingReady(true);
  }, []);

  // Simulated ad: full-screen TEST modal. Rewarded only pays out on completion.
  const runSimAd = useCallback((kind: 'rewarded' | 'interstitial', seconds: number) => {
    return new Promise<boolean>((resolve) => {
      setSimAd({ kind, resolve });
      setTimeout(() => {
        setSimAd((cur) => {
          if (cur) cur.resolve(true);
          return null;
        });
      }, seconds * 1000);
    });
  }, []);

  const showRewardedNative = useCallback((unitId: string) => {
    return new Promise<boolean>((resolve) => {
      try {
        const ad = RewardedAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true });
        let earned = false;
        const unsubs = [
          ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show()),
          ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
            earned = true;
          }),
          ad.addAdEventListener(AdEventType.CLOSED, () => {
            unsubs.forEach((u: any) => u && u());
            resolve(earned);
          }),
          ad.addAdEventListener(AdEventType.ERROR, () => {
            unsubs.forEach((u: any) => u && u());
            resolve(false);
          }),
        ];
        ad.load();
        setTimeout(() => resolve(earned), 60_000);
      } catch (e) {
        resolve(false);
      }
    });
  }, []);

  const showInterstitialNative = useCallback((unitId: string) => {
    return new Promise<boolean>((resolve) => {
      try {
        const ad = InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: true });
        const unsubs = [
          ad.addAdEventListener(AdEventType.LOADED, () => ad.show()),
          ad.addAdEventListener(AdEventType.CLOSED, () => {
            unsubs.forEach((u: any) => u && u());
            resolve(true);
          }),
          ad.addAdEventListener(AdEventType.ERROR, () => {
            unsubs.forEach((u: any) => u && u());
            resolve(false);
          }),
        ];
        ad.load();
        setTimeout(() => resolve(false), 30_000);
      } catch (e) {
        resolve(false);
      }
    });
  }, []);

  const showRewarded = useCallback(
    async (_reason: 'revive' | 'boost') => {
      if (nativeAdsAvailable && MONETIZATION_CONFIG.useRealAds) {
        return showRewardedNative(rewardedUnit());
      }
      if (nativeAdsAvailable && !MONETIZATION_CONFIG.useRealAds) {
        // Native build with test units still uses the real SDK with Google test IDs.
        return showRewardedNative(rewardedUnit());
      }
      return runSimAd('rewarded', 3);
    },
    [runSimAd, showRewardedNative]
  );

  const maybeShowInterstitial = useCallback(async () => {
    const g = gameRef.current;
    if (g.progress.removeAds) return false;
    // Count finished runs; skip interstitials entirely for the first few.
    const raw = await AsyncStorage.getItem('phoenix.finishedRuns').catch(() => null);
    const runs = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
    AsyncStorage.setItem('phoenix.finishedRuns', String(runs)).catch(() => {});
    if (runs <= MONETIZATION_CONFIG.interstitial.skipFirstRuns) return false;
    const now = Date.now();
    if (now - lastInterstitialAt.current < MONETIZATION_CONFIG.interstitial.minIntervalMs) return false;
    lastInterstitialAt.current = now;
    if (nativeAdsAvailable) {
      return showInterstitialNative(interstitialUnit());
    }
    return runSimAd('interstitial', 2);
  }, [runSimAd, showInterstitialNative]);

  const grantProduct = useCallback(
    (productId: string) => {
      const g = gameRef.current;
      const product = PRODUCT_BY_ID[productId];
      if (!product) return;
      if (product.coins) g.addCoins(product.coins);
      if (product.gems) g.addGems(product.gems);
      if (productId === 'move_pack_all') g.applyEntitlement({ movePackAll: true });
      if (productId === 'skin_pack_all') g.applyEntitlement({ skinPackAll: true });
      if (productId === 'remove_ads') g.applyEntitlement({ removeAds: true });
      if (productId === 'phoenix_pass') {
        g.applyEntitlement({ phoenixPassUntil: Date.now() + 30 * 24 * 3600_000 });
        g.addGems(100);
      }
    },
    []
  );

  const purchase = useCallback(
    async (productId: string) => {
      if (MONETIZATION_CONFIG.useRealBilling && Platform.OS !== 'web') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const iap = require('expo-iap');
          await iap.initConnection();
          const products = await iap.fetchProducts({ skus: [productId] });
          if (!products || products.length === 0) return false;
          const result = await iap.requestPurchase({ request: { google: { skus: [productId] } } });
          if (result) {
            grantProduct(productId);
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      }
      // Simulated purchase (web preview / dev): grants immediately, no charge.
      grantProduct(productId);
      return true;
    },
    [grantProduct]
  );

  const restorePurchases = useCallback(async () => {
    if (MONETIZATION_CONFIG.useRealBilling && Platform.OS !== 'web') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const iap = require('expo-iap');
        await iap.initConnection();
        const purchases = await iap.getAvailablePurchases();
        for (const p of purchases || []) {
          const id = p.productId || p.id;
          if (id && PRODUCT_BY_ID[id] && PRODUCT_BY_ID[id].kind !== 'consumable') grantProduct(id);
        }
      } catch (e) {
        // Nothing to restore or store unavailable.
      }
    }
  }, [grantProduct]);

  const value: MonetizationValue = {
    showRewarded,
    maybeShowInterstitial,
    purchase,
    restorePurchases,
    adsReady,
    billingReady,
    testMode: !MONETIZATION_CONFIG.useRealAds || !MONETIZATION_CONFIG.useRealBilling,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal visible={!!simAd} transparent animationType="fade">
        <View style={styles.adBackdrop}>
          <View style={styles.adCard}>
            <Text style={styles.adLabel}>TEST AD {simAd?.kind === 'rewarded' ? '(Rewarded Video)' : '(Interstitial)'}</Text>
            <Text style={styles.adBody}>
              {simAd?.kind === 'rewarded'
                ? 'Your reward lands when this test ad finishes.'
                : 'This is where a full-screen ad plays at a natural break.'}
            </Text>
            <Text style={styles.adNote}>Real AdMob ads replace this once Carter adds his AdMob IDs in src/config/monetization.config.ts.</Text>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function useMonetization(): MonetizationValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMonetization must be used inside MonetizationProvider');
  return v;
}

const styles = StyleSheet.create({
  adBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  adCard: { backgroundColor: '#1a1030', borderColor: '#ff6a00', borderWidth: 2, borderRadius: 16, padding: 28, alignItems: 'center', maxWidth: 420, width: '100%' },
  adLabel: { color: '#ffb347', fontSize: 20, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  adBody: { color: '#fff', fontSize: 15, textAlign: 'center', marginBottom: 10 },
  adNote: { color: '#9a8fb5', fontSize: 12, textAlign: 'center' },
});
