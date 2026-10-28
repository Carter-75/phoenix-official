import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { GameStateService } from './game-state.service';
import { Capacitor } from '@capacitor/core';

// cordova-plugin-purchase v13 types
declare let CdvPurchase: any;

@Injectable({
  providedIn: 'root'
})
export class IapService {
  public storeReady = signal<boolean>(false);
  public isProcessing = signal<boolean>(false);
  public isSubscribed = signal<boolean>(false);
  // Set when a purchase is attempted but cannot be granted because
  // billing is not configured. The shop surfaces this to the player
  // instead of silently granting (or silently eating) a purchase.
  public purchasesUnavailable = signal<boolean>(false);

  // Purchase safety gate (playtest round 1, Bug 3). The local grant
  // fallback and the web simulated checkout exist ONLY so the game
  // stays testable before Play billing is configured. They are allowed
  // in development builds (environment.development sets
  // allowSimulatedPurchases) or when a developer sets the localStorage
  // flag phoenix_dev_purchases=1 in their own browser. In a production
  // build they never grant anything: a purchase either verifies with
  // the server or grants nothing.
  private localFallbackAllowed(): boolean {
    if (environment.allowSimulatedPurchases) return true;
    if (!environment.production) return true;
    try { return localStorage.getItem('phoenix_dev_purchases') === '1'; } catch (e) { return false; }
  }

  // Can this build take a purchase at all right now? Native builds go
  // through Google Play. Web builds can only take (simulated) purchases
  // where the developer fallback is allowed; production web shows
  // purchases as unavailable until billing is configured.
  public purchasesEnabled(): boolean {
    return Capacitor.isNativePlatform() || this.localFallbackAllowed();
  }

  // Gems to grant for the in-flight gem-pack purchase (the amount the store
  // displayed, which already includes the first-purchase double bonus).
  private pendingRewardGems = 0;

  private http = inject(HttpClient);

  constructor(private gameState: GameStateService) {
    if (Capacitor.isNativePlatform()) {
      this.initStore();
    } else if (this.localFallbackAllowed()) {
      console.warn('IapService: Not running on native platform, Google Play billing is simulated (developer build).');
      this.storeReady.set(true);
    } else {
      console.warn('IapService: Not running on native platform; purchases are unavailable in this production web build until billing is configured.');
      this.storeReady.set(true);
    }
  }

  private initStore() {
    if (typeof CdvPurchase === 'undefined') {
      console.error('IapService: CdvPurchase plugin not found!');
      return;
    }

    const { store, ProductType, Platform, LogLevel, ErrorCode } = CdvPurchase;

    store.verbosity = LogLevel.INFO;

    // Register EVERY product the shop can sell (audit bug 11: the temp
    // multipliers were sellable but never registered). One subscription
    // only; the premium tier and whale SKU were deleted with the dark
    // patterns (audit bug 37).
    store.register([
      { id: environment.googlePlay.skuTier1, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY },
      { id: environment.googlePlay.skuTier2, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY },
      { id: environment.googlePlay.skuTier3, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY },
      { id: environment.googlePlay.skuTempMultiplierX2, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY },
      { id: environment.googlePlay.skuTempMultiplierX10, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY },
      { id: environment.googlePlay.skuRemoveAds, type: ProductType.NON_CONSUMABLE, platform: Platform.GOOGLE_PLAY },
      { id: environment.googlePlay.subMonthlyStandard, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.GOOGLE_PLAY },
    ]);

    store.when().approved((transaction: any) => {
      console.log('IAP Approved:', transaction);
      transaction.verify();
    });

    store.when().verified((receipt: any) => {
      console.log('IAP Verified:', receipt);
      receipt.finish();
    });

    store.when().finished(async (transaction: any) => {
      console.log('IAP Finished:', transaction);
      this.isProcessing.set(false);

      const productId = transaction.products[0]?.id;
      if (!productId) return;

      // Server-side receipt verification first (audit bug 19): the backend
      // checks the purchase with Google and grants the entitlement itself.
      const verified = await this.verifyWithServer(productId, transaction);
      if (verified === 'granted') {
        if (productId === environment.googlePlay.subMonthlyStandard) {
          this.isSubscribed.set(true);
          this.gameState.checkMonthlyCrateEligibility(true);
        }
        return; // server state was adopted in verifyWithServer
      }
      if (verified === 'rejected') {
        console.error('Purchase could not be verified by the server; nothing granted.');
        return;
      }
      // 'unconfigured': verification backend not set up yet (Carter's Play
      // service account step). Developer builds may fall back to the
      // local grant so the game stays testable. Production builds grant
      // NOTHING without server verification (Bug 3); /auth/sync cannot
      // mint these server-side either.
      if (this.localFallbackAllowed()) {
        this.applyLocalGrant(productId);
      } else {
        console.warn('Purchase finished but billing is not configured on the server; nothing granted in a production build.');
        this.purchasesUnavailable.set(true);
      }
    });

    // Check existing purchases on startup
    store.when().receiptUpdated((receipt: any) => {
       const isSubbed = store.get(environment.googlePlay.subMonthlyStandard)?.owned;
       if (isSubbed) {
           this.isSubscribed.set(true);
           this.gameState.checkMonthlyCrateEligibility(true);
       } else {
           this.isSubscribed.set(false);
       }
       const ownsRemoveAds = store.get(environment.googlePlay.skuRemoveAds)?.owned;
       if (ownsRemoveAds) this.gameState.hasRemoveAds.set(true);
    });

    // v13 API correction (black-screen root cause, Oct 27 2026): the
    // When interface in cordova-plugin-purchase 13.17.2 has NO
    // cancelled() and NO error() methods. The old when().cancelled()
    // registration threw "TypeError: store.when(...).cancelled is not
    // a function" on real devices during startup DI (this service is
    // constructed from the root view creation chain), which killed
    // bootstrap before the first frame. Error handling lives on the
    // store itself: store.error(cb). A user cancelling the Play
    // dialog surfaces there as an error whose code is
    // ErrorCode.PAYMENT_CANCELLED, and it resets the same in-flight
    // state the old cancelled handler reset.
    store.error((error: any) => {
      if (error?.code === ErrorCode.PAYMENT_CANCELLED) {
        console.log('IAP Cancelled');
      } else {
        console.error('IAP Error:', error);
      }
      this.isProcessing.set(false);
      this.pendingRewardGems = 0;
    });

    store.ready(() => {
      console.log('IAP Store is ready!');
      this.storeReady.set(true);
    });

    store.initialize([Platform.GOOGLE_PLAY]);
  }

  private extractPurchaseToken(transaction: any): string | null {
    if (!transaction) return null;
    if (transaction.purchaseToken) return transaction.purchaseToken;
    if (transaction.nativePurchase?.purchaseToken) return transaction.nativePurchase.purchaseToken;
    try {
      const receipt = typeof transaction.receipt === 'string' ? JSON.parse(transaction.receipt) : transaction.receipt;
      if (receipt?.purchaseToken) return receipt.purchaseToken;
    } catch (e) { /* not JSON */ }
    return transaction.transactionId || null;
  }

  // Returns 'granted' (server verified and state adopted), 'rejected'
  // (server checked and refused), or 'unconfigured' (no service account on
  // the backend yet, caller may fall back to a local grant for testing).
  private async verifyWithServer(productId: string, transaction: any): Promise<'granted' | 'rejected' | 'unconfigured'> {
    const token = localStorage.getItem('auth_token');
    if (!token) return 'unconfigured'; // guests: nothing server-side to grant to
    const purchaseToken = this.extractPurchaseToken(transaction);
    if (!purchaseToken) return 'rejected';
    try {
      const res: any = await firstValueFrom(this.http.post(
        environment.apiUrl + '/api/billing/verify',
        { productId, purchaseToken }
      ));
      if (res?.ok) {
        if (res.user) this.gameState.syncWithUser(res.user);
        return 'granted';
      }
      return 'rejected';
    } catch (err: any) {
      if (err?.error?.code === 'BILLING_NOT_CONFIGURED' || err?.status === 503) return 'unconfigured';
      console.error('Receipt verification failed', err);
      return 'rejected';
    }
  }

  private applyLocalGrant(productId: string) {
    if (productId === environment.googlePlay.subMonthlyStandard) {
       this.isSubscribed.set(true);
       this.gameState.checkMonthlyCrateEligibility(true);
    } else if (productId === environment.googlePlay.skuRemoveAds) {
       this.gameState.hasRemoveAds.set(true);
       this.gameState.syncProgressToServer();
    } else if (productId === environment.googlePlay.skuTempMultiplierX2) {
       this.gameState.grantTemporaryMultiplier('coin', 2, 1);
       this.gameState.grantTemporaryMultiplier('xp', 2, 1);
    } else if (productId === environment.googlePlay.skuTempMultiplierX10) {
       this.gameState.grantTemporaryMultiplier('coin', 10, 5);
       this.gameState.grantTemporaryMultiplier('xp', 10, 5);
    } else if (this.pendingRewardGems > 0) {
      this.grantGems(this.pendingRewardGems);
      this.pendingRewardGems = 0;
    }
  }

  public orderProduct(sku: string, gemsToReward: number = 0) {
    if (!Capacitor.isNativePlatform()) {
      if (!this.localFallbackAllowed()) {
        // Production web: purchases are unavailable until billing is
        // configured. Never grant without a payment (Bug 3).
        console.warn('Purchases are unavailable in this build until billing is configured.');
        this.purchasesUnavailable.set(true);
        return;
      }
      console.log(`[SIMULATED] Ordering SKU: ${sku} for ${gemsToReward} gems.`);
      this.isProcessing.set(true);
      setTimeout(() => {
        this.pendingRewardGems = gemsToReward;
        this.applyLocalGrant(sku);
        this.isProcessing.set(false);
      }, 1500);
      return;
    }

    if (typeof CdvPurchase === 'undefined' || !this.storeReady()) {
      console.error('IAP Store not ready or plugin missing');
      return;
    }

    this.pendingRewardGems = gemsToReward;
    this.isProcessing.set(true);

    const product = CdvPurchase.store.get(sku, CdvPurchase.Platform.GOOGLE_PLAY);
    if (!product) {
      console.error(`Product ${sku} not found!`);
      this.isProcessing.set(false);
      this.pendingRewardGems = 0;
      return;
    }

    CdvPurchase.store.order(product.getOffer());
  }

  public orderSubscription(sku: string) {
    if (!Capacitor.isNativePlatform()) {
      if (!this.localFallbackAllowed()) {
        console.warn('Purchases are unavailable in this build until billing is configured.');
        this.purchasesUnavailable.set(true);
        return;
      }
      console.log(`[SIMULATED] Ordering Subscription: ${sku}`);
      this.isProcessing.set(true);
      setTimeout(() => {
        this.isSubscribed.set(true);
        this.gameState.checkMonthlyCrateEligibility(true);
        this.isProcessing.set(false);
      }, 1500);
      return;
    }

    if (typeof CdvPurchase === 'undefined' || !this.storeReady()) return;

    this.isProcessing.set(true);
    const product = CdvPurchase.store.get(sku, CdvPurchase.Platform.GOOGLE_PLAY);
    if (product) CdvPurchase.store.order(product.getOffer());
  }

  private grantGems(amount: number) {
    // The amount is final: the store display already includes the
    // first-purchase double bonus, and the server applies the same rule on
    // verified purchases. No silent doubling here, and nothing in this path
    // may trigger a follow-up sales modal (the whale trap is deleted).
    this.gameState.gems.update(g => g + amount);
    this.gameState.hasPurchasedGems.set(true);
    console.log(`Successfully rewarded ${amount} Gems!`);
    this.gameState.syncProgressToServer();
  }
}
