# Carter's To-Do - The Only Steps Only You Can Do

Everything else in this project is built. These steps need your accounts and your identity,
in this order. Do not skip ahead: the IDs from the early steps feed the later ones.

## 1. Create the GitHub repo (2 minutes)
The Muse GitHub App cannot create repos (it returned a 403, same as before).
- Go to github.com, create a new EMPTY public repo named exactly: phoenix-official
  (owner Carter-75, no README, no .gitignore, no license - it must be empty)
- Tell Muse "repo created" in the Phoenix chat and it will push everything.

## 2. MongoDB Atlas database (5 minutes)
The game backend needs its own database on your Atlas setup.
- In Atlas, the backend will use database name phoenix-official automatically from the connection string.
- Create a database user for the game (readWrite on phoenix-official only) if you do not want to reuse an existing user.
- Keep the full connection string for step 3. Never paste it in chat - put it directly into Render in step 3.

## 3. Deploy the backend on Render (10 minutes)
- Render - New Web Service - connect the phoenix-official repo (after step 1). render.yaml at the repo root pre-fills the setup (rootDir backend).
- Set environment variables in Render (values entered by you, in Render, never in chat):
  - MONGODB_URI: mongodb+srv://USER:PASSWORD@CLUSTER/phoenix-official?retryWrites=true&w=majority
  - JWT_SECRET: a long random string (a password manager can generate 48+ characters)
  - GOOGLE_CLIENT_IDS: filled after step 5, comma separated (web client ID, Android client ID)
  - CORS_ORIGINS: leave empty for the mobile app
- After deploy, note the backend URL (like https://phoenix-official-backend.onrender.com).
- The game build needs it as EXPO_PUBLIC_API_URL (https://YOUR-BACKEND/api) - give Muse the URL (URLs are fine in chat, secrets are not).

## 4. Google Play developer account ($25, identity)
- play.google.com/console - pay the one-time $25, complete identity verification as yourself.
- Create the app: name "Phoenix: Rise of the Flame", package com.phoenixwebsites.phoenix, Games - Action, Free.
- Create these products with these exact IDs (from src/config/monetization.config.ts):
  In-app products: coins_small, coins_medium, coins_large, coins_mega, gems_small, gems_medium, gems_large, move_pack_all, skin_pack_all, remove_ads
  Subscription: phoenix_pass (monthly, with a base plan)
  Prices are your call; the in-app labels currently show $0.99 to $19.99 and $4.99/mo for the pass - keep them in step or tell Muse the real prices to update labels.
- Upload the AAB Muse builds (eas build, production profile) to a test track first.
- Fill the store listing from store/LISTING.md, data safety from store/DATA-SAFETY-AND-RATING.md, and complete the content rating questionnaire honestly.
- Privacy policy URL: host store/privacy-policy.md somewhere public (phoenixwebsites.ai/phoenix-privacy works) and paste that URL into the console.
- Note: Google requires new personal developer accounts to run a closed test with 12+ testers for 14 days before production release. Plan for that window.

## 5. Google sign-in (OAuth clients) (10 minutes)
- Google Cloud Console - create (or reuse) a project - OAuth consent screen (External, app name Phoenix).
- Create credentials: a Web client and an Android client (package com.phoenixwebsites.phoenix + the SHA-1 from your Play app signing key / EAS keystore).
- Put the client IDs in two places:
  - Render env GOOGLE_CLIENT_IDS (step 3)
  - Build env EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID (give these to Muse - client IDs are not secrets)
- Email sign-in works without any of this. Google sign-in stays hidden in the app until these exist.

## 6. AdMob account (10 minutes)
- admob.com - create an account, add the app (it can be added before the Play listing is public using the package name).
- Create ad units: Banner, Interstitial, Rewarded. Note the app ID and the three unit IDs.
- Give Muse: the app ID and unit IDs (these are identifiers, not secrets). Muse swaps them into app.json and src/config/monetization.config.ts, flips useRealAds to true, and rebuilds.
- Until then the game ships with Google's official TEST ad units, which is what you want for testing anyway.

## 7. EAS (Expo) account for signed builds
- expo.dev - sign in (free). Muse has eas.json ready. First build: eas build -p android --profile production produces the signed AAB for step 4.
- Keystore: let EAS manage it (default). Never download or share keystore files in chat.
