import { GameStateService } from '../services/game-state.service';

// Cloud device test scenario (Firebase Test Lab, cloud-test workflow
// leg 2). This module is started from app.ts ONLY when
// environment.cloudTest is true, and that flag is true only in the
// dedicated "cloudtest" Angular build configuration, which only the
// cloud-test workflow builds. In every other build this code never
// runs and nothing in the game reads it.
//
// The Robo crawler cannot play the game, so the scenario plays one
// scripted slice through the game's own real paths:
//   1. It enables the existing debug hooks gate (the same
//      localStorage flag the playtest harness sets), so the hooks the
//      harness uses attach when the run starts.
//   2. It starts a World 1 Normal (campaign) run with the same three
//      state writes MainMenuComponent.startGame('campaign') performs.
//   3. It makes the player invincible through the real damage path:
//      takeDamage returns early while Date.now() < immortalUntil, so
//      the scenario holds that existing window open and re-asserts it
//      (realm transitions and rebirth timers write nearer deadlines
//      into the same field).
//   4. It jumps the run to the boss phase through the production
//      spawner (real boss HP law, real health signals), the same
//      seeded route the harness TTK probes use via spawnBossNow.
//   5. It steers the bird onto the boss through the game's own
//      phoenix override position, so the bird and its hitbox (slaved
//      to the bird's screen position) stay in auto-fire range.
// Everything after that is the real fight: real boss, real shields
// and enrage, real outgoing damage, real kill and realm flow.
export function startCloudTestScenario(gameState: GameStateService): void {
  try {
    window.localStorage.setItem('phoenix_debug_hooks', '1');
  } catch {
    // Storage unavailable: the hooks stay off and the scenario cannot
    // proceed. Nothing else in the app is affected.
    return;
  }

  const bootDeadline = Date.now() + 60000;
  const bootTimer = window.setInterval(() => {
    try {
      const menuReady = !!document.querySelector('app-main-menu');
      if (!menuReady && Date.now() < bootDeadline) return;
      window.clearInterval(bootTimer);
      if (!menuReady) return;
      gameState.currentGameMode.set('campaign');
      gameState.selectedWorldIndex.set(0);
      gameState.activeScreen.set('game');
      waitForHooks(gameState);
    } catch {
      window.clearInterval(bootTimer);
    }
  }, 500);
}

function waitForHooks(gameState: GameStateService): void {
  const deadline = Date.now() + 90000;
  const timer = window.setInterval(() => {
    try {
      const hooks = (window as any).__phoenixS1;
      if (!hooks?.spawnBossNow) {
        if (Date.now() > deadline) window.clearInterval(timer);
        return;
      }
      window.clearInterval(timer);

      const holdImmortal = () => { gameState.immortalUntil = Number.MAX_SAFE_INTEGER; };
      holdImmortal();
      window.setInterval(() => { try { holdImmortal(); } catch { /* run ended */ } }, 1000);

      hooks.spawnBossNow();

      window.setInterval(() => {
        try {
          const fight = (window as any).__phoenixS1?.bossFight?.();
          if (fight?.bossPos) {
            gameState.phoenixOverridePosition.set({ x: fight.bossPos.x, y: fight.bossPos.y });
          }
        } catch { /* component gone; the crawl continues without steering */ }
      }, 250);
    } catch {
      window.clearInterval(timer);
    }
  }, 500);
}
