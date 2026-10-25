# Release checklist

Do not upload a production build until every required gate is checked from evidence in Play Console, the deployed backend, or a signed release build.

## Code and build

- [x] Angular production build passes.
- [x] `dist/frontend/browser` remains present after the build.
- [x] Capacitor Android sync passes and registers the AdMob plugin.
- [x] Backend smoke test passes against a disposable MongoDB database.
- [x] Native Android builds succeed in the chosen build environment (GitHub Actions, run #2, October 25, 2026: debug APK and unsigned release bundle artifacts verified).
- [ ] Release AAB uses package name `com.phoenix.fall` (compiled in from the Capacitor config; confirm again on the signed upload build).
- [ ] Release signing uses Play App Signing and the upload key is stored outside the repo.
- [ ] Version code is higher than every previously uploaded build.
- [ ] The release build is installed and played on a physical Android device.

## Backend

- [ ] Production MongoDB Atlas database is created and backed by Carter's account.
- [ ] Render backend is deployed from the official repo.
- [ ] `MONGODB_URI` is set in Render by Carter.
- [ ] `SESSION_SECRET` is set in Render by Carter and is at least 16 random characters.
- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in Render by Carter.
- [ ] `FRONTEND_URL` is set to the real public frontend or policy host used by the Google web flow.
- [ ] `GOOGLE_PLAY_PACKAGE_NAME` is `com.phoenix.fall`.
- [ ] `GOOGLE_SERVICE_ACCOUNT_JSON` is set in Render by Carter.
- [ ] `GET /api/health` on the deployed backend reports the database connected.
- [ ] The deployed frontend API URL in `frontend/src/environments/environment.ts` points to the deployed backend that will serve the release.

## Google Play

- [ ] Carter's Play developer identity is verified.
- [ ] App record uses package name `com.phoenix.fall`.
- [ ] All products in `PRODUCTS.md` are created and active.
- [ ] Monthly Crate Pass subscription and monthly base plan are active.
- [ ] License testers are configured.
- [ ] Privacy policy URL is live.
- [ ] Account deletion URL is live and entered in Play Console.
- [ ] Data safety form matches `DATA-SAFETY.md` and the final binary.
- [ ] Content rating questionnaire is complete.
- [ ] Target audience is set to 13 and older, unless Carter changes the release plan and the app is reviewed for a younger audience.
- [ ] Ads and in-app purchase declarations are complete.
- [ ] Store listing uses real screenshots from the release build.
- [ ] Closed test has at least 12 opted-in testers for 14 consecutive days if Play Console requires it for Carter's account.

## AdMob

- [ ] Carter creates the AdMob app for Phoenix Fall.
- [ ] Production rewarded and interstitial units are created.
- [ ] Production app ID replaces the test ID in `frontend/android/app/src/main/res/values/strings.xml`.
- [ ] Production ad unit IDs replace the test IDs in `frontend/src/app/config/monetization.config.ts`.
- [ ] Rewarded SSV callback URL points to `https://<deployed-backend>/api/ads/ssv`.
- [ ] AdMob SSV test succeeds from the AdMob console.
- [ ] A completed rewarded ad grants once, and replaying or retrying the callback does not grant twice.

## Final purchase verification

- [ ] A license tester buys a gem pack and receives the server-granted amount once.
- [ ] A license tester buys Remove Ads and interstitials stop.
- [ ] A license tester subscribes and receives Monthly Crate Pass state.
- [ ] A cancelled, refunded, or invalid purchase does not keep granting new rewards from the client.
- [ ] Account deletion removes the test account and its backend entitlement records.
