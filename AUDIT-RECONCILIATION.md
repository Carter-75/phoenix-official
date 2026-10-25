# Audit Reconciliation - How This Build Relates to the Main-Chat Audit

The full audit of both old repos landed at ~/workspace/phoenix-fall-audit/AUDIT.md while this
build was underway. This file records, honestly, where the build follows the audit, where it
diverges and why, and what is deliberately deferred. Read it before changing direction.

## The divergence, stated plainly

The audit recommends: ship Phoenix-Fall, port Temp-phoenix content in as data, do not restart
on Temp-phoenix. This build did the third option the mission allowed: a FRESH clean game on the
Expo lineage, with Temp-phoenix's content ported as data (exactly what the audit prescribes for
the content) and Phoenix-Fall's feature set rebuilt clean (accounts, battle mode, leaderboards,
codex, trophies, skins). It does not adopt Temp-phoenix's code (the audit proves that code is a
hollow shell: orphaned engine, unwinnable, unsavable) and it does not adopt Phoenix-Fall's code.

Why a fresh build won, from the audit's own evidence:
- Phoenix-Fall campaign completeness is 20 percent by the audit's own table: only world 0 has
  spawns, a boss, and music. Worlds 1 to 9 content (spawners, bosses, 9 music tracks) does not
  exist and would have to be authored either way.
- Its accounts are broken at the API contract level (audit bugs 4, 5, 17), its guest saves
  silently lose progression (bug 2), its ads are 100 percent mock with no interstitial path at
  all (bugs 13, 14), its IAP orders a wrong SKU (bug 10), sells unregistered SKUs (bug 11), and
  has a dead subscription (bug 12). Play packaging breaks under its own documented build command
  (bug 6). That is not a rescue of a nearly-done game; it is a rebuild inside a heavier stack
  (Angular + Three.js + Matter.js + Capacitor) that the audit itself suspects of mobile jank.
- The audit's Phase 1 and 2 roadmap (fix the 7 game-breakers, build worlds, fix auth, remove
  dark patterns, add tests, add account deletion, add real ads) is the same work list this fresh
  build completed by construction, verified by a backend smoke test and a successful bundle build.
- What the fresh build gives up, honestly: Phoenix-Fall's genuinely nice Three.js particle
  phoenix renderer and its heuristic battle AI personalities. The new battle AI is a simpler
  hunting rival. The new phoenix is layered-shape art, not 4,000-particle fluid birds. If Carter
  wants the particle phoenix back, it belongs in a later visual pass, not in the shipping core.

If Carter prefers the audit's path anyway, this repo still donates: the backend (clean auth,
sync, leaderboards, deletion) is stack-independent, and the catalog data file ports anywhere.

## Followed from the audit

- Temp-phoenix content ported as data only: 75 moves, 10 worlds and boss identities (Section 4).
- No dark patterns, anywhere (bug 37): no fake strikethrough pricing, no holiday inflation,
  no creeping upsell probability, no Whale Trap, no confirmshaming copy. Prices in the store
  are plain. This is a Play deceptive-behavior requirement, not a style choice.
- No global ML brain (bugs 15, 34): cut for v1, as the audit's roadmap suggests. The battle AI
  is local and heuristic.
- Rewarded boost is rewards-only: 2x coins and XP, never damage (Section 6.3), so boss tuning
  and the shop are not bypassed.
- Currency is kept on death (Section 7.2, Sky Force pattern): failed runs still pay out the
  coins and XP earned, at the boost multiplier if active.
- Revive at the moment of death, campaign bosses included, rewarded ad first (Section 7.2
  inverting Phoenix 2's restrictions). One revive per run here; the audit allows up to 2.
- Interstitials: natural breaks only (after a run ends), never mid-combat, never on the death
  or revive decision screen, none during the first 3 finished runs, minimum 4 minutes apart,
  removed forever by Remove Ads or an active Phoenix Pass (Sections 6.3 and 7.4).
- One subscription only (Section 6.3): Phoenix Pass. No registered-but-unsellable products:
  every product in the config has a working purchase path and a grant.
- Account deletion in app and via API (Play requirement, missing in both old repos).
- Remove Ads price $4.99 (Section 7.4 anchor band), Phoenix Pass $4.99/mo (Section 7.4 test band).
- Tests exist from day one (Section 8 Phase 1): backend smoke test covers register, login,
  sync, scores, all four leaderboards, and deletion.

## Deferred, deliberately (known limitations, not surprises)

- Server-side ad verification (SSV) and Play receipt verification: the audit is right that a
  client-asserted economy can be cheated (bug 19 pattern). This build validates ranges on sync
  like Phoenix-Fall did, which caps but does not eliminate cheating. Full hardening needs
  Carter's AdMob SSV setup and a Play Developer API service account, both post-account steps.
  Until then, treat leaderboards as friendly, not authoritative, and do not run paid contests.
- Medal objectives per stage, mid-run 1-of-3 blessings, multi-stage worlds, Hard and Nightmare
  difficulties, endless or tournament mode, daily stage (Section 7.2): strong v1.1 candidates,
  out of v1 scope so v1 actually ships.
- Coin packs are sold for cash (Carter's confirmed model: currency packs). The audit's market
  spec (Section 7.4) advises earned-only soft currency, selling only gems. Flagged here as a
  conscious difference, Carter's model wins unless he says otherwise.
- Rotating featured-move shelf (Section 7.2): the shop ships as the full 75-move list by type.
