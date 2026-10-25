# Testing record and closed test plan

## Verified locally on October 25, 2026

### Frontend build

Command: `npm run build` in `frontend/`

Result: Passed. Angular application bundle generation completed and `dist/frontend/browser/index.html` remained present after the postbuild step. This verifies the Capacitor webDir fix.

### Capacitor sync

Command: `npx cap sync android` in `frontend/`

Result: Passed. Capacitor found `@capacitor-community/admob@8.2.1`, copied the web assets, and registered the Android plugin.

Not verified: A native Gradle or APK build was not run in this environment because no Java or Android build toolchain is installed here. Carter's release build still needs Android Studio or an equivalent signed build environment.

### Backend smoke test

The backend was run against a disposable local MongoDB database. All 24 checks passed:

- Health endpoint reported the database connected.
- Register returned a pending token and did not create the user yet.
- A pending signup record existed server-side.
- Login before username completion failed.
- Complete signup created the user and consumed the pending record.
- A duplicate username was rejected case-insensitively.
- Login returned a user and token, and the token worked on the user endpoint.
- Sync capped a coin increase at 5,000,000 and a gem increase at 1,000.
- Sync did not grant Remove Ads, a gem-gated cosmetic without a gem spend, or additional revive tokens.
- Sync filtered an invalid world ID.
- Billing verification returned `503 BILLING_NOT_CONFIGURED` when no Play service account was configured.
- AdMob SSV rejected an invalid signature with 403.
- A test entitlement was inserted, then account deletion removed both the user and the entitlement.
- The deleted user's token no longer worked.

This smoke test does not verify a real Google Play purchase or a real AdMob callback. Both require Carter's production accounts, a signed Android build, and the deployed backend.

## Closed test script for testers

Ask each tester to report device model, Android version, and screenshots or a screen recording for any failure.

### First session

1. Install from the closed test link and open the game.
2. Read and accept the policies.
3. Play as a guest and finish World 0.
4. Confirm coins, XP, and the next world unlock are still present after closing and reopening the app.
5. Confirm no interstitial appears during the first 3 finished runs.

### Account flow

1. Register with email and password.
2. Pick a username and confirm the account opens.
3. Log out, log back in, and confirm progress syncs.
4. Try Google sign-in on a second device or after clearing app data.
5. Try a duplicate username and confirm it is rejected clearly.
6. Delete the test account from the profile and confirm the user can no longer log in.

### Gameplay

1. Play Worlds 0 and 1 through the boss and confirm enemies and a boss spawn in both.
2. Confirm ascension or the results flow completes after the boss, even if a dropped gem leaves the screen.
3. Buy two Agility upgrades and confirm the level and real flight speed both increase.
4. Die and confirm ad revive is offered no more than twice in one run.
5. Use a revive token if available and confirm the count decreases by one.
6. Open the codex and confirm all 10 realms and the 75-entry Classic Move Archive are visible.

### Ads and purchases

Use license testers and production AdMob test devices until the production ad units are ready for the closed test.

1. Use Watch Ad for the 2x boost and confirm the boost is for coins and XP only and shows as active for 5 minutes.
2. Use a shop rewarded ad and confirm the selected upgrade is granted only after completion.
3. Finish runs and confirm interstitials occur only after a run, no more than once per run, and no more than once in 3 minutes.
4. Buy each consumable as a license tester and confirm the server grants it once.
5. Buy Remove Ads and confirm interstitials stop.
6. Subscribe to Monthly Crate Pass and confirm the subscription state, crate eligibility, and interstitial exemption.
7. Cancel the test subscription in Google Play.

## Google Play closed test requirement

For a newer personal developer account, plan on at least 12 testers opting in for 14 consecutive days before applying for production access. Confirm the exact requirement shown in Carter's Play Console because eligibility and policy details are account-specific.
