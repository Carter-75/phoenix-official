// Per-screen manifest sent to the AI every step (Oct 30, 2026, Carter).
//
// Built from the live screen plus the data-ap tags the templates really
// render, so it always matches the code. Kept short for gpt-5-nano cost.

export type AgentActionName = 'tap_button' | 'select_realm' | 'navigate' | 'start_run' | 'play' | 'use_ability' | 'wait' | 'finish';

/** What each data-ap control does (tags exist in the component templates). */
export const CONTROL_HELP: Record<string, string> = {
  'open-shop': 'open the shop for the selected realm',
  'world-prev': 'select the previous realm', 'world-next': 'select the next realm',
  'mode-normal': 'campaign mode', 'mode-endless': 'endless mode', 'mode-battle': 'battle mode',
  'play': 'start a run in the selected realm and mode', 'play-battle': 'start a battle run',
  'tutorial-decline': 'dismiss the tutorial offer', 'tutorial-start': 'start the practice tutorial',
  'shop-close': 'leave the shop to the menu',
  'buy-damage': 'coins: +1 Firepower level', 'buy-attack-speed': 'coins: +1 Rapid Fire level',
  'buy-homing': 'coins: +1 Seeker level', 'buy-health': 'coins: +1 Vitality level',
  'buy-speed': 'coins: +1 Agility level', 'buy-magnet': 'coins: +1 Magnet level',
  'buy-aura': 'coins: +1 Aura level', 'buy-range': 'coins: +1 Range level', 'buy-aegis': 'coins: +1 Aegis level',
  'pause-toggle': 'pause or resume the run', 'quit-pause': 'quit the run from pause',
  'give-up': 'end the run from the KO screen', 'revive-gems': 'revive for gems (needs gem permission)',
  'quit-game': 'leave the finished run to the menu',
};

export interface ScreenManifest {
  screen: string;
  realm: number;
  valid: AgentActionName[];
  needs: string;
  controls: Record<string, string>;
  howTo: string;
}

const HOW_TO = 'When the prompt goal is reached, call finish goal_met at once. switch realm: select_realm N (works from menu or shop). buy upgrade: select_realm N, navigate shop, tap_button buy-<stat>. start run: start_run {mode, realm} from any screen (it goes to the menu and selects the realm). In a run use play until run_end; after a death go to the shop, buy, then start_run again. die on purpose: start_run, play until death with aggression 0. Explore or bug hunt: navigate each checklist.notVisited screen once. Tutorial: navigate tutorial, then play. goal_met needs checklist proof of every sub-goal.';

export function validActionsFor(screen: string): AgentActionName[] {
  switch (screen) {
    case 'menu': return ['select_realm', 'start_run', 'navigate', 'tap_button', 'wait', 'finish'];
    case 'shop': return ['tap_button', 'select_realm', 'start_run', 'navigate', 'wait', 'finish'];
    case 'settings': case 'codex': case 'leaderboard': return ['navigate', 'start_run', 'tap_button', 'wait', 'finish'];
    case 'tutorial': return ['play', 'navigate', 'tap_button', 'wait', 'finish'];
    case 'game': case 'pause': case 'ko': return ['play', 'start_run', 'use_ability', 'tap_button', 'navigate', 'wait', 'finish'];
    default: return ['navigate', 'start_run', 'tap_button', 'wait', 'finish'];
  }
}

export function buildManifest(screen: string, realm: number, tags: string[]): ScreenManifest {
  const controls: Record<string, string> = {};
  for (const t of tags) if (CONTROL_HELP[t]) controls[t] = CONTROL_HELP[t];
  const needs = screen === 'game' || screen === 'pause' || screen === 'ko'
    ? 'live run: use play until run_end. Do not quit a live run unless the goal is done or impossible. Shop is reachable only after the run ends. If play says the phoenix is down (KO), call start_run to retry (it gives up the KO run), or revive-gems if allowed: a death is never "impossible". To die on purpose: play until "death" with aggression 0 (the pilot stops dodging).'
    : screen === 'tutorial'
      ? 'tutorial: call play (seconds 240) and the app performs each step\'s gesture, taps Next on info steps and Back to menu at the end; it returns when the tutorial is done. Then report what worked and what was skipped.'
      : `navigate pages: menu, shop, settings, tutorial (opens Settings > Replay Tutorial), codex, leaderboard. navigate to "${screen}" is a no-op (you are already here). observation.checklist lists screens visited and not visited: to explore, navigate each notVisited screen once, never revisit. play and use_ability need a run (start_run).`;
  return { screen, realm, valid: validActionsFor(screen), needs, controls, howTo: HOW_TO };
}
