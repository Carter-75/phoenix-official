# Phoenix-Fall Bug Audit & Fixes (Phoenix 🐦‍🔥)

Repo: frontend/src/app

## Architecture
- Player Phoenix = Three.js bird in `particle-bg.component.ts`. Mouse → `mouseTarget` → bird physics → writes `phoenixScreenPos` signal.
- Matter.js `playerBody` (label 'player') is slaved to `phoenixScreenPos` every `beforeUpdate` (game.component.ts:935).
- AI Phoenix similarly slaved to `aiPhoenixScreenPos`.

## Bug #1 — Player not controllable on main menu load
Root cause: `particle-bg.component.ts updateBirdPhysics` wraps ALL movement integration in `if (this.gameState.activeScreen() === 'game')`. On menu, mouseTarget updates but bird never moves. Control only "turns on" after startGame() sets activeScreen='game'.
(This is intended-ish: bird is frozen on menu. If Carter wants menu mouse-follow, remove/relax that gate.)

## Bug #2 — Battle: pause-then-play, instant death, bad spawn
Root causes:
1. FREEZE: `initBattleMode` (game.component.ts:1460) sets `isPaused` SIGNAL true, runs 1500ms RAF entrance, then `setTimeout(...,1000)` standoff before unpausing → ~2.5s frozen feel.
2. INSTANT DEATH: `beforeUpdate` (line 920) and `collisionStart` (line 685) + `takeDamage` (line 2099) are NOT gated by `isPaused()`. `initBattleMode` never calls `Matter.Runner.stop()` — only the isPaused signal flips. So physics keeps stepping during the "paused" entrance: AI fires projectiles + bodies overlap (both spawn near vertical center, only ~300px apart) → player takes collision/projectile damage and dies before play starts.
3. SPAWN: player end Y = innerHeight/2+150, AI end Y = innerHeight/2-150 (only 300px apart, overlap on short screens). After entrance, override cleared; AI's aiMousePos was pinned to y=50 (top) not its landing center → AI jumps. Player reverts to phoenixScreenPos (bird/mouse default) → teleports.

## Bug #3 — AI vs AI very buggy
Same un-gated physics + same spawn overlap. Plus separation forces fight tight spawn.

## Fixes applied
- Gate `beforeUpdate`, `collisionStart`, `takeDamage` with isPaused so nothing damages/steps during entrance.
- Actually stop Matter Runner during entrance, restart on unpause.
- Spread spawn positions further apart (player bottom third, AI top third).
- Sync post-entrance AI target (aiMousePos) to its landing position so it doesn't jump to y=50.
