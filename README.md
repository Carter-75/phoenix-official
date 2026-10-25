# Phoenix: Rise of the Flame

The ONE official Phoenix game. Free on Google Play, with ads and in-app purchases.

Fly the phoenix through 10 worlds, beat 10 named bosses, collect all 75 moves, duel an AI
phoenix in Battle Mode, and climb four leaderboards. Play as a guest instantly, or create an
account (email and password, or Google) to sync progress to the cloud.

Design lock and full reasoning: DESIGN.md

## Layout

- app/ and src/ - the game (Expo SDK 53, React Native, TypeScript)
  - src/data/catalog.ts - 10 worlds, the 75-move catalog, skins, trophies, codex
  - src/game/ - the game engine (single loop, waves, bosses, battle mode)
  - src/screens/ - menu, worlds, shop, skins, store, leaderboards, auth, profile, codex, trophies, settings
  - src/state/ - progress store, local saves, cloud sync, account session
  - src/services/ - backend API client, audio (generated WAV files), monetization (AdMob + Play Billing)
  - src/config/ - the only files to edit for real API URLs, Google client IDs, AdMob IDs, and product flags
- backend/ - Node + Express + Mongoose API (MongoDB)
  - Email/password and Google accounts, unique display names, JWT sessions
  - Cloud progress sync with server-side validation
  - Score submission and 4 leaderboards (global, campaign, per-world, battle)
  - Account deletion endpoint (Play Store requirement)
  - Test it: cd backend && npm install && npm run test:smoke (uses an in-memory MongoDB)
- store/ - Play Store listing copy, privacy policy, data safety answers, rating prep,
  screenshot plan, and CARTER-TODO.md (the exact steps only Carter can do)
- scripts/generate_audio.py - regenerates the sound effects and music in assets/audio
- render.yaml - one-click backend deploy on Render

## Run the game locally

```
npm install
npm run web        # web preview in the browser
npm run android    # Expo dev build on Android
npm run typecheck  # TypeScript check
```

The game is fully playable offline as a guest with no backend running. Accounts,
leaderboards, and cloud sync light up when the backend is reachable
(EXPO_PUBLIC_API_URL, see src/config/app.config.ts).

## Run the backend locally

```
cd backend
cp .env.example .env   # fill in MONGODB_URI and JWT_SECRET
npm install
npm start              # listens on port 4000
```

## Monetization

Free game. Revenue: AdMob rewarded ads (revive, 2x boost for 5 minutes), interstitial ads
at natural breaks only (90 second minimum gap, never mid-combat, killed by Remove Ads),
and Google Play Billing for coin and gem packs, the Full Arsenal and skin packs, Remove Ads,
and the Phoenix Pass subscription. Until Carter's own accounts exist, the game uses Google's
official TEST ad units and simulated purchases off-device. Real IDs are a config change in
src/config/monetization.config.ts and app.json. See store/CARTER-TODO.md.
