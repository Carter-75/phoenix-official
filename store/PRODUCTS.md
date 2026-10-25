# Google Play products

Create these exact product IDs in Play Console. Product IDs cannot be changed after creation.

All prices below are the United States base prices in the game design. Let Google Play calculate local prices and taxes unless Carter chooses a different pricing template.

## One-time products

| Product ID | Console type | Display name | Price | Grant |
| --- | --- | --- | ---: | --- |
| `com.phoenix.gems.tier1` | Consumable | Pouch of Gems | $1.99 | 20 gems, or 40 gems on the player's first gem purchase |
| `com.phoenix.gems.tier2` | Consumable | Sack of Gems | $9.99 | 150 gems, or 300 gems on the player's first gem purchase |
| `com.phoenix.gems.tier3` | Consumable | Chest of Gems | $49.99 | 1,000 gems, or 2,000 gems on the player's first gem purchase |
| `com.phoenix.temp.multiplier.x2` | Consumable | 2x Boost, 1 Minute | $0.99 | 2x coins and XP for 1 minute |
| `com.phoenix.temp.multiplier.x10` | Consumable | 10x Boost, 5 Minutes | $4.99 | 10x coins and XP for 5 minutes |
| `com.phoenix.removeads` | Non-consumable | Remove Ads | $4.99 | Removes interstitial ads permanently. Optional rewarded ads remain available only when the player chooses them. |

## Subscription

Create one subscription only.

- Subscription ID: `com.phoenix.sub.monthly`
- Display name: Monthly Crate Pass
- Base plan: Monthly, auto-renewing
- Price: $2.99 per month
- Benefit: One Monthly Crate becomes available each month while the subscription is active, up to 3 pending crates. A crate grants 5,000 coins and 100 gems when opened in game.
- Cancellation: The player cancels in Google Play. Cancellation stops the next renewal.

Do not create the deleted premium subscription or whale pack. These old IDs must not be used:

- `com.phoenix.sub.premium`
- `com.phoenix.gems.whale`

## Activation checks

Before a production release:

1. Activate every product and the subscription base plan.
2. Add the products to the same closed test release used by license testers.
3. Confirm a license tester can see the correct local price for every item.
4. Confirm the backend returns a successful verification for a real test purchase after Carter configures the service account.
5. Confirm Remove Ads suppresses interstitials and the Monthly Crate Pass suppresses interstitials while active.
