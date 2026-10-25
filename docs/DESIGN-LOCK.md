# Phoenix (Official) - Design Lock

Locked October 25, 2026, from the full audit at ~/workspace/phoenix-fall-audit/
(AUDIT.md + research-comparables.md). This repo is the ONE official Phoenix game.

## What this is

- Seeded from Phoenix-Fall's working core (Angular 21 + Capacitor 8 + Three.js
  particle phoenix + Matter.js physics + Express/MongoDB backend). App id stays
  com.phoenix.fall, targetSdk 36.
- Temp-phoenix contributes content as DATA only (75-move catalog, 10 world and
  boss identities), ported into this game's systems. Its code is not used: the
  audit proved its wired game cannot win, lose, earn, or save.
- One subscription only: Monthly Crate Pass, $2.99/mo. Remove Ads is a
  non-consumable purchase. No other subscription exists.

## Phase 1 (this build)

1. The 7 game-breaking fixes from the audit: menu world gating reads
   unlockedWorlds; guest save restore is unconditional (the dead else branch is
   gone); World 1 is fully playable (spawns, boss, music); signup and login
   actually work (pending-signup records server-side, {user, token} contract,
   no password hash in any token, no fallback JWT secret); the build keeps
   dist/frontend/browser so cap sync works; boss-loot ascension cannot
   soft-lock (escaped gems count, plus a timed fallback).
2. Major tier: speed upgrades raise real top speed (particle renderer no longer
   renormalizes velocity to base speed); Agility cost and level math uses the
   true base speed 2.0; Crazy Deal deleted (see below); temp multiplier SKUs
   registered with the store; premium subscription SKU deleted.
3. Dark patterns DELETED, non-negotiable (Play deceptive-behavior risk):
   fake inflated strikethrough prices, holiday price inflation, ghost deal,
   deal radar hype, the creeping upsellChance, and the Whale Trap
   confirmshaming modal. Prices in the store are the prices. The one honest
   bonus kept: first gem purchase grants double gems, labeled as a first
   purchase bonus with no fake countdown.
4. Economy hardening: /auth/sync can no longer mint premium state. Gems and
   coins have per-sync delta caps; hasRemoveAds and subscription status are
   granted only by the server after Play receipt verification
   (POST /api/billing/verify, Google Play Developer API when configured) or
   AdMob server-side verification (GET /api/ads/ssv). Receipt verification
   fails closed: unconfigured or invalid means no grant.
5. Global ML weights sync CUT for v1 (was unauthenticated read/write of a
   shared model). The battle AI keeps its local on-device learning only.
   Unauthenticated push trigger endpoint deleted.

## Monetization (audit sections 6.3 and 7.4, Carter's confirmed model)

- Rewarded video (AdMob, SSV-verified grants server-side):
  revive on death, capped at 2 ad revives per run (gem revive and revive
  tokens remain as the other options); deliberate 2x boost for 5 minutes,
  coins and XP only, never damage; free upgrade in the shop; ad bubble.
- Interstitials: natural breaks only (run results), never mid-combat, never on
  the death screen. None in the first session or the first 3 runs, max 1 per
  run and at most 1 per 3 minutes. Remove Ads owners and subscribers never
  see them.
- Play Billing (cordova-plugin-purchase): gem packs, temp multipliers,
  Remove Ads, Monthly Crate Pass. All grants flow through server receipt
  verification once Carter's Play service account is configured.
- Test ad units until Carter provides his AdMob IDs; swapping IDs is
  config-only (frontend/src/app/config/monetization.config.ts and
  backend env).

## Accounts

MongoDB accounts with email/password and Google sign-in, unique display
names (3-16 chars, letters, numbers, underscore), cloud sync, leaderboards
(campaign and battle), account deletion in app (Play requirement).

## Carter-only steps (cannot be automated)

Play developer account ($25, identity), AdMob account and real ad unit IDs,
Google Play service account for receipt verification, creating the empty
GitHub repo phoenix-official, production env values on Render (secrets never
pass through chat), and the 12-tester 14-day closed test. Full ordered list:
store/CARTER-TODO.md.
