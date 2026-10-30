// Gesture synthesis for the AI Autoplay tester. Every move the bot
// makes is a sequence of real touch events (start, move, end) on the
// same window listeners the player's finger feeds, timed to the
// game's own parser constants, so the game cannot tell a bot press
// from a human press except that the events are untrusted.
import { TAP_CHAIN_RESOLVE_MS, TOUCH_DRAG_DEADZONE_PX } from '../data/balance.constants';

/** The game's tap-chain window (handleInputStart: presses under 300 ms apart extend the chain). */
export const CHAIN_GAP_MAX_MS = 300;
export const FLICK_MAX_MS = 120;
export const FLICK_MIN_TRAVEL_FRAC = 0.12;
export const ROLL_TAP_MAX_MS = 250;
export const HOLD_ARM_MS = 500;
export const HOLD_CHARGE_MS = 1500;

export type SlotFamily = 'tap' | 'double' | 'triple';
export interface GestureStep { at: number; type: 'start' | 'move' | 'end'; id: number; x: number; y: number; }

export type Rng = () => number;
const jitter = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();

/**
 * Presses needed for a slot: the game fires the tap slot on a chain
 * of 2 presses, double on 3, triple on 4 (resolveTapChain).
 */
export function pressesFor(family: SlotFamily): number {
  return family === 'tap' ? 2 : family === 'double' ? 3 : 4;
}

/**
 * A tap chain aimed at (x, y). Each press is start, a sub-deadzone
 * move (so ability aim reads this point without steering), and end.
 * Press-to-press spacing stays well under the 300 ms chain window,
 * and the returned quietMs tells the caller how long to wait so the
 * chain resolves (TAP_CHAIN_RESOLVE_MS) before any next press.
 */
export function synthTapChain(family: SlotFamily, x: number, y: number, rng: Rng = Math.random, t0 = 0):
  { steps: GestureStep[]; durationMs: number; quietMs: number } {
  const n = pressesFor(family);
  const steps: GestureStep[] = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    const px = x + jitter(rng, -3, 3), py = y + jitter(rng, -3, 3);
    const down = Math.round(jitter(rng, 45, 75));
    steps.push({ at: t, type: 'start', id: 1, x: px, y: py });
    const mdx = Math.min(TOUCH_DRAG_DEADZONE_PX * 0.3, 1.5);
    steps.push({ at: t + Math.round(down / 2), type: 'move', id: 1, x: px + mdx, y: py });
    steps.push({ at: t + down, type: 'end', id: 1, x: px + mdx, y: py });
    if (i < n - 1) t += down + Math.round(jitter(rng, 60, 110));
    else t += down;
  }
  const quietMs = TAP_CHAIN_RESOLVE_MS + 60;
  return { steps, durationMs: t - t0, quietMs: Math.max(quietMs, CHAIN_GAP_MAX_MS + 30) };
}

/** Flick dash: release inside 120 ms with at least 12 percent of min(viewport) travel. */
export function synthFlick(x: number, y: number, dirX: number, dirY: number, viewW: number, viewH: number, rng: Rng = Math.random, t0 = 0): GestureStep[] {
  const len = Math.hypot(dirX, dirY) || 1;
  const travel = FLICK_MIN_TRAVEL_FRAC * Math.min(viewW, viewH) * jitter(rng, 1.35, 1.7);
  const ex = x + dirX / len * travel, ey = y + dirY / len * travel;
  const dur = Math.round(jitter(rng, 55, 85));
  const steps: GestureStep[] = [{ at: t0, type: 'start', id: 1, x, y }];
  for (let i = 1; i <= 3; i++) {
    const f = i / 3;
    steps.push({ at: t0 + Math.round(dur * f), type: 'move', id: 1, x: x + (ex - x) * f, y: y + (ey - y) * f });
  }
  steps.push({ at: t0 + dur + 5, type: 'end', id: 1, x: ex, y: ey });
  return steps;
}

/** Second-finger tap (Air Roll) while finger 1 is down at (x1, y1): under 250 ms. */
export function synthRoll(x2: number, y2: number, rng: Rng = Math.random, t0 = 0): GestureStep[] {
  const dur = Math.round(jitter(rng, 70, 140));
  return [{ at: t0, type: 'start', id: 2, x: x2, y: y2 }, { at: t0 + dur, type: 'end', id: 2, x: x2, y: y2 }];
}

/** Second-finger hold (Feather Brake) for ms. */
export function synthBrake(x2: number, y2: number, ms: number, t0 = 0): GestureStep[] {
  const dur = Math.max(ROLL_TAP_MAX_MS + 60, ms);
  return [{ at: t0, type: 'start', id: 2, x: x2, y: y2 }, { at: t0 + dur, type: 'end', id: 2, x: x2, y: y2 }];
}

/** Hold charge: a planted, still finger for arm + charge time plus a margin. */
export function holdChargeMs(focusCharm: boolean): number {
  return HOLD_ARM_MS + HOLD_CHARGE_MS * (focusCharm ? 0.75 : 1) + 250;
}

/** Validates a chain timeline against the game's parser rules (used by tests and a runtime self-check). */
export function chainIsValid(steps: GestureStep[], family: SlotFamily): boolean {
  const starts = steps.filter(s => s.type === 'start').map(s => s.at);
  if (starts.length !== pressesFor(family)) return false;
  for (let i = 1; i < starts.length; i++) if (starts[i] - starts[i - 1] >= CHAIN_GAP_MAX_MS) return false;
  return true;
}
