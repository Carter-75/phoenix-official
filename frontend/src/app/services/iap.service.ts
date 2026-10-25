import { Injectable, signal } from '@angular/core';
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
  
  // Keep track of pending reward amount so we know what to grant when approved
  private pendingRewardGems = 0;
  
  // Track subscription purchases
  private pendingSubscription = false;

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

    // Register our 4 fixed SKUs
    store.register([
      {
        id: environment.googlePlay.skuTier1,
        type: ProductType.CONSUMABLE,
        platform: Platform.GOOGLE_PLAY,
      },
      {
        id: environment.googlePlay.skuTier2,
        type: ProductType.CONSUMABLE,
        platform: Platform.GOOGLE_PLAY,
      },
      {
        id: environment.googlePlay.skuTier3,
        type: ProductType.CONSUMABLE,
        platform: Platform.GOOGLE_PLAY,
      },
      {
        id: environment.googlePlay.skuWhale,
        type: ProductType.CONSUMABLE,
        platform: Platform.GOOGLE_PLAY,
      },
      {
        id: environment.googlePlay.subMonthlyStandard,
        type: ProductType.PAID_SUBSCRIPTION,
        platform: Platform.GOOGLE_PLAY,
      },
      {
        id: environment.googlePlay.subMonthlyPremium,
        type: ProductType.PAID_SUBSCRIPTION,
        platform: Platform.GOOGLE_PLAY,
      }
    ]);

    // Setup Listeners
    store.when().approved((transaction: any) => {
      console.log('IAP Approved:', transaction);
      transaction.verify();
    });

    store.when().verified((receipt: any) => {
      console.log('IAP Verified:', receipt);
      receipt.finish();
    });

    store.when().finished((transaction: any) => {
      console.log('IAP Finished:', transaction);
      this.isProcessing.set(false);
      
      const productId = transaction.products[0]?.id;
      if (productId === environment.googlePlay.subMonthlyStandard || productId === environment.googlePlay.subMonthlyPremium) {
         this.isSubscribed.set(true);
         this.gameState.checkMonthlyCrateEligibility(true);
      } else if (productId === environment.googlePlay.skuWhale) {
         // Whale trap handled in component? Wait, we should give gems.
         this.grantGems(75);
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
    });

    // Check existing purchases on startup
    store.when().receiptUpdated((receipt: any) => {
       const isSubbed = store.get(environment.googlePlay.subMonthlyStandard)?.owned || store.get(environment.googlePlay.subMonthlyPremium)?.owned;
       if (isSubbed) {
           this.isSubscribed.set(true);
           this.gameState.checkMonthlyCrateEligibility(true);
       } else {
           this.isSubscribed.set(false);
       }
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

    // Initialize the store
    store.initialize([Platform.GOOGLE_PLAY]);
  }

  public orderProduct(sku: string, gemsToReward: number = 0) {
    if (!Capacitor.isNativePlatform()) {
      console.log(`[SIMULATED] Ordering SKU: ${sku} for ${gemsToReward} gems.`);
      this.isProcessing.set(true);
      setTimeout(() => {
        if (gemsToReward > 0) {
          this.grantGems(gemsToReward);
        } else if (sku === environment.googlePlay.skuWhale) {
          this.grantGems(75);
        } else if (sku === environment.googlePlay.skuTempMultiplierX2) {
          this.gameState.grantTemporaryMultiplier('coin', 2, 1);
          this.gameState.grantTemporaryMultiplier('xp', 2, 1);
        } else if (sku === environment.googlePlay.skuTempMultiplierX10) {
          this.gameState.grantTemporaryMultiplier('coin', 10, 5);
          this.gameState.grantTemporaryMultiplier('xp', 10, 5);
        }
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
    const finalAmount = this.gameState.hasPurchasedGems() ? amount : amount * 2;
    this.gameState.gems.update(g => g + finalAmount);
    this.gameState.hasPurchasedGems.set(true);
    
    console.log(`Successfully rewarded ${finalAmount} Gems!`);
    this.gameState.syncProgressToServer();

    // Trigger Whale Trap if applicable
    if (Math.random() < this.gameState.upsellChance()) {
        localStorage.setItem('phoenix_trigger_whale', 'true');
    } else {
        this.gameState.upsellChance.set(0);
    }
  }
}
