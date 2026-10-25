# Carter to-do

Complete these steps in order. Send Muse only public IDs and URLs. Never send passwords, secret keys, service account JSON, signing keys, or verification codes in chat.

## 1. Create the GitHub repo

1. In GitHub under `Carter-75`, create a public repository named exactly `phoenix-official`.
2. Do not add a README, .gitignore, or license. It must start empty so the local official history can be pushed cleanly.
3. Tell Muse in this chat: `phoenix-official repo created`.

Muse will then add the remote, fetch, check for divergence, and push `main`. The preserved `expo-prototype` branch is not the official release path.

## 2. Publish the two public policy pages

Publish these files as stable public web pages:

- `store/PRIVACY-POLICY.md`
- `store/ACCOUNT-DELETION.md`

Good final paths would be:

- `https://phoenixwebsites.ai/phoenix-fall/privacy`
- `https://phoenixwebsites.ai/phoenix-fall/delete-account`

Those URLs are examples, not live links yet. After the pages are live, send Muse the two actual URLs only. Play Console needs both URLs, and the account deletion URL is required because the app allows account creation.

## 3. Prepare the production backend

Use the existing Render service for `phoenix-fall.onrender.com`, or deploy the backend from the official repo if you replace that service. If the backend URL changes, tell Muse the new public URL before the release build because the Android app has the API URL compiled in.

In Render, set these environment values yourself:

| Key | Value to enter |
| --- | --- |
| `MONGODB_URI` | Your MongoDB Atlas connection string for the production game database |
| `SESSION_SECRET` | A new random secret at least 32 characters long |
| `GOOGLE_CLIENT_ID` | The Google web OAuth client ID used by the game |
| `GOOGLE_CLIENT_SECRET` | The matching Google web OAuth client secret |
| `FRONTEND_URL` | The public site origin used for Google web sign-in redirects |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.phoenix.fall` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full Play service account JSON, pasted only into Render |
| `PRODUCTION` | `true` |

After saving, redeploy and open:

`https://phoenix-fall.onrender.com/api/health`

It should report `database: Connected`. If you used a different backend host, check the same path on that host.

## 4. Create and verify the Play developer account

1. Create or sign in to the Google Play Console developer account.
2. Pay the one-time developer fee if Google asks for it.
3. Complete identity and developer verification.
4. Create the app:
   - Name: Phoenix Fall
   - Default language: English (United States)
   - App or game: Game
   - Free or paid: Free
5. Confirm the package name is `com.phoenix.fall` when the first AAB is uploaded. A package name cannot be changed later.

## 5. Add the Play App Signing SHA-1 to Google sign-in

After the app record exists and Play App Signing is enabled:

1. In Play Console, open the app integrity or app signing page.
2. Copy the SHA-1 certificate fingerprint for the app signing key.
3. In Google Cloud Console, open the Android OAuth client for package `com.phoenix.fall`.
4. Confirm the package name is `com.phoenix.fall` and the SHA-1 is the Play app signing SHA-1.
5. If the existing Android OAuth client uses another certificate, create or update the client yourself and send Muse the public Android client ID only if it changes.

This step matters because a release signed by Play will not match an OAuth client that only contains a debug or old upload certificate fingerprint.

## 6. Create the Play service account for receipt verification

1. In Google Cloud Console, enable the Google Play Android Developer API.
2. Create a service account for Phoenix receipt verification.
3. Create a JSON key for that service account.
4. In Play Console, invite the service account email under Users and permissions.
5. Give it access to Phoenix Fall and the financial and order permissions Play requires to read purchase data.
6. Paste the JSON into Render as `GOOGLE_SERVICE_ACCOUNT_JSON`, following step 3.
7. Delete any downloaded JSON copy you no longer need after it is safely in Render. Do not commit it, email it to Muse, or send it in chat.

Without this step, paid purchases remain safe but cannot be granted by the production backend because verification returns `BILLING_NOT_CONFIGURED`.

## 7. Create every Play product

Create and activate every item in `store/PRODUCTS.md` with the exact IDs shown there.

Products:

- `com.phoenix.gems.tier1`, $1.99
- `com.phoenix.gems.tier2`, $9.99
- `com.phoenix.gems.tier3`, $49.99
- `com.phoenix.temp.multiplier.x2`, $0.99
- `com.phoenix.temp.multiplier.x10`, $4.99
- `com.phoenix.removeads`, $4.99

Subscription:

- `com.phoenix.sub.monthly`, Monthly Crate Pass, $2.99 per month

Do not create `com.phoenix.sub.premium` or `com.phoenix.gems.whale`.

## 8. Create the AdMob app and ad units

1. Create or sign in to AdMob.
2. Add an Android app named Phoenix Fall. Use the Google Play listing option that matches your release stage.
3. Create a rewarded ad unit named `Phoenix Rewarded`.
4. Create an interstitial ad unit named `Phoenix Interstitial`.
5. In the rewarded unit's server-side verification settings, set the callback URL to:

`https://phoenix-fall.onrender.com/api/ads/ssv`

If the production backend host changes, use `https://<that-host>/api/ads/ssv` instead.

6. Send Muse only these public values:
   - AdMob app ID
   - Rewarded ad unit ID
   - Interstitial ad unit ID

Muse will replace the Google test IDs in the Android manifest string and `frontend/src/app/config/monetization.config.ts`, rebuild, and sync Capacitor again.

## 9. Build and upload a signed closed test AAB

1. Open `frontend/android` in Android Studio.
2. Let Gradle sync finish.
3. Build an Android App Bundle from the release variant.
4. Enroll in Play App Signing.
5. Keep the upload key in secure storage outside the Git repo.
6. Upload the AAB to a Closed testing track in Play Console.
7. Add license testers in Play Console so test purchases do not charge real money.

Before uploading a final closed test build, complete step 8 so the build contains production AdMob IDs rather than Google test IDs.

## 10. Complete the Play Console declarations

Use the files in this folder:

- Listing text and assets: `LISTING.md`
- Privacy policy URL: the live URL from step 2
- Account deletion URL: the live URL from step 2
- Data safety: `DATA-SAFETY.md`
- Content rating and target audience: `CONTENT-RATING.md`
- Ads: Yes
- In-app purchases: Yes
- Target audience: 13 and older for this release plan

Upload at least 2 real phone screenshots from the signed release build. The prepared icon is `store/assets/play-icon-512.png`. A 1024 by 500 feature graphic is still needed.

## 11. Run the 14-day closed test

1. Add at least 12 testers and make sure each one opts in, installs the closed test build, and opens the game.
2. Keep the closed test running continuously for at least 14 days if Play Console shows that requirement for your personal developer account.
3. Ask testers to follow `TESTING.md` and report device model, Android version, and a screenshot or recording for any failure.
4. Use license test accounts for purchase tests.
5. Confirm one real test purchase verifies through the backend and one rewarded ad callback reaches the backend without granting twice.

## 12. Apply for production and release

1. After the closed test requirement is met, apply for production access if Play Console requires it.
2. Create the production release from the tested AAB or a newer AAB that has passed the same checks.
3. Review the final store listing, Data safety form, rating, price, ads declaration, and countries.
4. Roll out the release.
5. Only after Play Console shows the production release as available should Phoenix Fall be described as live on Google Play.
