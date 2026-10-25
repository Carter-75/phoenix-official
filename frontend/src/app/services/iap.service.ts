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

  // Gems to grant for the in-flight gem-pack purchase (the amount the store
  // displayed, which already includes the first-purchase double bonus).
  private pendingRewardGems = 0;

  private http = inject(HttpClient);

  constructor(private gameState: GameStateService) {
    if (Capacitor.isNativePlatform()) {
      this.initStore();
    } else {
      console.warn('IapService: Not running on native platform, Google Play billing is simulated.');
      this.storeReady.set(true);
    }
  }

  private initStore() {
    if (typeof CdvPurchase === 'undefined') {
      console.error('IapService: CdvPurchase plugin not found!');
      return;
    }

    const { store, ProductType, Platform, LogLevel } = CdvPurchase;

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
      // service account step). Fall back to the local grant so the game
      // stays testable; /auth/sync still cannot mint these server-side.
      this.applyLocalGrant(productId);
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

    store.when().cancelled((transaction: any) => {
      console.log('IAP Cancelled');
      this.isProcessing.set(false);
      this.pendingRewardGems = 0;
    });

    store.when().error((error: any) => {
      console.error('IAP Error:', error);
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
