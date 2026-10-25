# Phoenix Fall, official game

This is the one official Phoenix Fall repository. It was rebuilt around the working Phoenix-Fall game core, with Temp-phoenix content ported in as data. The preserved `expo-prototype` branch is an earlier prototype and is not the release path.

## Game

- Android package: `com.phoenix.fall`
- Frontend: Angular 21, Capacitor 8, Three.js particles, and Matter.js physics
- Backend: Express and MongoDB with Mongoose
- Accounts: Optional email and password or Google sign-in, unique display names, cloud sync, leaderboards, and in-app account deletion
- Game modes: Campaign across 10 boss realms and Battle mode
- Monetization: Google AdMob rewarded and interstitial ads, Google Play products, Remove Ads, and one Monthly Crate Pass subscription
- Economy protection: Play purchases are verified by the backend, rewarded ad grants use AdMob server-side verification, and cloud sync cannot mint premium entitlements

The full design decision record is in `docs/DESIGN-LOCK.md`. The Google Play submission package is in `store/`, starting with `store/README.md` and `store/CARTER-TODO.md`.

## Repository layout

- `frontend/`: Angular and Capacitor app
- `frontend/android/`: Android project
- `backend/`: Express API, MongoDB models, auth, leaderboards, billing verification, and AdMob SSV callback
- `docs/`: design lock and source-game notes
- `store/`: Play listing, product setup, privacy and deletion pages, Data safety map, rating prep, testing record, and release checklist
- `scripts/`: asset and audio generation utilities inherited from the source project

## Local development

Install dependencies:

```bash
npm run postinstall
```

Run the local launcher:

```bash
npm run dev
```

Build the frontend:

```bash
cd frontend
npm run build
```

The production build must leave `frontend/dist/frontend/browser` in place because Capacitor uses it as `webDir`.

Sync Android after a frontend build:

```bash
cd frontend
npx cap sync android
```

## Backend configuration

Copy the names in `backend/.env.example` into the local or host environment. Never commit real values.

Required production values include:

- `MONGODB_URI`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `FRONTEND_URL`
- `GOOGLE_PLAY_PACKAGE_NAME=com.phoenix.fall`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

The backend fails closed for Play purchases when the service account is not configured.

## Verification status

Verified October 25, 2026:

- Angular production build passed.
- Capacitor Android sync passed and registered `@capacitor-community/admob`.
- Backend smoke test passed 24 checks against a disposable local MongoDB database, covering pending signup, username completion, login, sync caps, premium grant blocking, fail-closed billing, invalid AdMob SSV rejection, and account deletion.

Not yet verified:

- Native signed Android build. The current environment has no Java or Android build toolchain.
- Real Google Play purchase verification. This needs Carter's Play service account and a license tester.
- Real AdMob delivery and SSV callback. This needs Carter's AdMob app and ad units.
- Google Play availability. The game is not live on Google Play yet.

See `store/TESTING.md` for the exact test record and closed test script.
