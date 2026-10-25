# Phoenix: Rise of the Flame - Design Lock

The ONE official Phoenix game. Built Oct 24, 2026 from Carter's two earlier versions.
This document is the design lock: if code and this file disagree, this file wins until Carter changes it.

## Sources of truth

1. Temp-phoenix (Aug 2025, Expo / React Native): 10 worlds with named bosses, particle phoenix,
   3 attack types (hold / double tap / triple tap), a shop with 75 moves (3 starters + 72 shop),
   XP and level progression, world unlocks, per-world enemies and bosses, sound system,
   ad placements, Python + MongoDB backend for progress.
2. Phoenix-Fall (May to Jul 2026, TypeScript / Angular + Capacitor): battle mode vs AI phoenixes,
   touch controls, hold-charge abilities, 3 phoenix themes (Fire, Ice, Eclipse), MongoDB backend
   with email/password + Google auth, usernames, cloud sync, leaderboards, trophies, enemy codex,
   cosmetics, IAP service. Bug notes (PHOENIX_BUGFIX_NOTES.md, PHOENIX_MOBILE_AUDIT.md) confirm:
   physics ran un-gated during the battle entrance pause and killed the player before play started,
   battle spawns overlapped, touch press-and-hold did not move the bird, and only 2 of 10 worlds
   were actually playable (the rest were flagged Coming Soon).

## Stack decision

Fresh clean build on the Expo / React Native lineage (Expo SDK 53, React Native 0.79, TypeScript).

Why not continue Phoenix-Fall (Angular + Capacitor):
- Heavier stack (Angular + Three.js + Matter.js + Capacitor) with a couple hundred known bugs.
- Its worst bugs are architectural: two physics systems slaved together through screen signals.
- Only 2 playable worlds after months of work.

Why not continue Temp-phoenix directly:
- Emergent-generated code, single-file screens, no accounts in the client (backend was progress-only),
  no tests, no store or billing wiring. Cleaner to rebuild its design on a fresh scaffold.

Why Expo wins:
- Native Android target with EAS Build producing a signed AAB for Google Play.
- One codebase for Android release plus a web build for fast verification.
- Carter already ships Expo (Temp-phoenix) and the tooling is proven in his environment.

Borrowed from Phoenix-Fall (concepts, not code): battle mode vs an AI phoenix, the Fire / Ice /
Eclipse phoenix themes (as skins), hold-charge feel, usernames + leaderboards + trophies + codex,
the native Google sign-in pattern (ID token verified server-side).

Deliberately NOT carried over:
- Phoenix-Fall's register flow (it never saved the user; it parked a hashed password in a temp JWT).
- Two-physics-engine design. This game uses one simple loop with circle collision.
- Coming Soon worlds. All 10 worlds ship playable.

## Game design

- Vertical flying shooter. Drag anywhere to move the phoenix (touch start AND move both steer,
  fixing the Phoenix-Fall hold bug). Auto-fire basic shot.
- Attacks (Temp-phoenix system): equipped move per slot.
  - Hold slot: press and hold the HOLD button to channel the beam / charged ability.
  - Double slot: double-tap the screen (or the DOUBLE button) for a fast projectile move.
  - Triple slot: triple-tap the screen (or the TRIPLE button) for a heavy burst move.
  Buttons exist so every move is reachable without gesture guessing.
- Worlds (Temp-phoenix names and bosses, all playable):
  1. Ember Plains - Inferno Guardian (Fire)
  2. Shadow Realm - Shadow Lord (Dark)
  3. Crystal Caverns - Crystal Titan (Crystal)
  4. Storm Peaks - Storm Wyvern (Lightning)
  5. Void Nexus - Void Reaper (Void)
  6. Phoenix Sanctum - Phoenix King (Holy Fire)
  7. Frozen Wastes - Ice Empress (Ice)
  8. Dragon Throne - Dragon Emperor (Ancient)
  9. Chaos Dimension - Chaos Demon (Chaos)
  10. Eternal Flame - Eternal Phoenix (Divine)
- Each world: 3 enemy waves (chasers, shooters, tanks in world colors) then the named boss
  with a health bar and attack patterns that scale with world number.
- Battle mode: 1 vs 1 duel against an AI phoenix (Phoenix-Fall), separate leaderboard.
- Moves: the full 75-move catalog from Temp-phoenix (names, damage, cooldown, cost, descriptions),
  bought with coins in the shop, one equipped per slot.
- Progression (Temp-phoenix numbers): XP curve xpToNext = 100 * 1.2^(level-1), +10 max health
  per level, full heal on level up. Coins from kills and world clears. Gems are the premium currency.
- Skins: Ember (default), Frost, Eclipse, Solar, Verdant. Cosmetic only.
- Trophies: first boss kill, world clears, level milestones, battle wins, move collector.
- Codex: enemies and bosses you have defeated are recorded.
- Saves: local first (AsyncStorage) so the game works fully offline as a guest.
  Signed-in players sync to MongoDB (see Backend).

## Accounts and backend

Node + Express + Mongoose in backend/, database name phoenix-official on MongoDB Atlas.
MONGODB_URI and all secrets live only in environment variables (backend/.env.example lists names).

- Email + password: register with email, password, and a unique display name. bcrypt hashing.
  JWT session tokens (30 days). Login, logout, delete account (Play Store requirement).
- Google: native sign-in returns an ID token; the server verifies it with google-auth-library.
  New Google users pick a display name to finish signup. If the Google email matches an existing
  password account, the client is told to sign in with the password first, then link Google
  from Profile (no silent duplicates, no silent merges).
- Display names: 3 to 16 chars, letters / numbers / underscore, unique, checked live.
- Guest mode: play with no account, progress stays on device. Signing up later keeps local progress
  and uploads it (server keeps the better of local vs cloud per stat where that matters).
- Cloud sync: level, XP, coins, gems, owned and equipped moves, world progress, best scores,
  trophies, codex, battle stats, entitlements, settings. Server validates ranges like Phoenix-Fall did.
- Leaderboards (top 100 each): Global (level, then XP), Campaign Score (sum of world best scores),
  per-world best score, Battle (battle rating from wins). Public read, no auth needed to view.
- Score submission: finishing a world or a battle posts the score; the server keeps personal bests.

## Monetization (Carter's model)

Free game. All revenue wiring is behind src/services/monetization with a config file so real IDs
are a one-file change (src/config/monetization.config.ts).

- AdMob (react-native-google-mobile-ads), TEST ad units until Carter's AdMob account exists:
  - Rewarded video: revive on death (extra life, keep the run) and 2x coins+XP boost for 5 minutes.
  - Interstitial video: only at natural breaks (after a run ends, on world transitions),
    minimum 90 seconds apart, never mid-combat, never on the revive screen before the rewarded offer.
  - No banner during gameplay. A banner may appear on menu screens only.
  - Remove Ads purchase disables interstitials (and menu banners). Rewarded ads always stay available.
- Google Play Billing (expo-iap). Digital goods only through Play Billing, per Google policy.
  Products (create in Play Console with these exact IDs):
  - coins_small, coins_medium, coins_large, coins_mega (consumable coin packs)
  - gems_small, gems_medium, gems_large (consumable gem packs)
  - move_pack_all (non-consumable: unlocks every shop move)
  - skin_pack_all (non-consumable: unlocks every skin)
  - remove_ads (non-consumable)
  - phoenix_pass (subscription: monthly gems, permanent 2x boost while active, exclusive skin)
- Where native modules are unavailable (web preview, Expo Go), ads and purchases run in a clearly
  labeled TEST mode simulation so the full loop is testable. No real charge is possible in test mode.

## Play Store path

- EAS Build production profile produces a signed AAB (eas.json). Android package:
  com.phoenixwebsites.phoenix.
- Store assets live in store/: listing copy, privacy policy, data safety answers, content rating
  notes, screenshot plan, icon.
- Carter-only steps (cannot be automated): Play developer account ($25, identity verification),
  AdMob account, creating the products above in Play Console, pasting real AdMob + product IDs
  into the config, final submission. See store/CARTER-TODO.md for the exact ordered list.
