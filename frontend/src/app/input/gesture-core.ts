// Shared gesture and movement core (Oct 30, 2026).
//
// ONE implementation of the touch grammar and the stamina / glide
// rules, used by the live game (game.component.ts, bird-physics.ts,
// game-state.service.ts), the How to Play practice arena, and the
// autoplay tester's gesture timing. Pure TypeScript, no Angular, so
// the unit tests run it directly. Every number comes from
// data/balance.constants.ts.
import { INPUT_RULES, GLIDE_RULES, STAMINA, TAP_CHAIN_RESOLVE_MS } from '../data/balance.constants';

export type SlotFamily = 'tap' | 'double' | 'triple';

export interface GestureClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: GestureClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Quick taps needed for each slot: TAP 1, DBL 2, ULT 3. */
export function tapsFor(family: SlotFamily): number {
  return family === 'tap' ? 1 : family === 'double' ? 2 : 3;
}

export function familyForTaps(n: number): SlotFamily | null {
  if (n <= 0) return null;
  return n === 1 ? 'tap' : n === 2 ? 'double' : 'triple';
}

/**
 * Tap-chain parser. A tap is a press released within tapMaxMs that
 * travelled under tapMaxTravelPx (so drags, flicks, and hold charges
 * are never taps). Taps less than TAP_CHAIN_RESOLVE_MS apart chain;
 * the chain resolves to exactly one slot after that quiet window, or
 * at once on the third tap. A press that turns into a drag or a hold
 * resolves any taps before it right away.
 */
export class TapChainParser {
  private count = 0;
  private resolveTimer: unknown = null;
  private pressTimer: unknown = null;
  private pressT = 0;
  private pressX = 0;
  private pressY = 0;
  private pressValid = false;

  constructor(private onResolve: (family: SlotFamily) => void, private clock: GestureClock = realClock) {}

  press(x: number, y: number): void {
    this.clearResolve();
    this.clearPressTimer();
    this.pressT = this.clock.now();
    this.pressX = x; this.pressY = y;
    this.pressValid = true;
    this.pressTimer = this.clock.setTimeout(() => { this.pressTimer = null; this.invalidate(); }, INPUT_RULES.tapMaxMs + 1);
  }

  move(x: number, y: number): void {
    if (this.pressValid && Math.hypot(x - this.pressX, y - this.pressY) >= INPUT_RULES.tapMaxTravelPx) this.invalidate();
  }

  release(x: number, y: number): void {
    if (!this.pressValid) return;
    this.clearPressTimer();
    const dt = this.clock.now() - this.pressT;
    if (dt > INPUT_RULES.tapMaxMs || Math.hypot(x - this.pressX, y - this.pressY) >= INPUT_RULES.tapMaxTravelPx) {
      this.invalidate();
      return;
    }
    this.pressValid = false;
    this.count++;
    if (this.count >= 3) { this.flush(); return; }
    this.resolveTimer = this.clock.setTimeout(() => { this.resolveTimer = null; this.flush(); }, TAP_CHAIN_RESOLVE_MS);
  }

  /** The current press is not a tap (it became a drag or a hold). */
  invalidate(): void {
    this.clearPressTimer();
    this.pressValid = false;
    if (this.count > 0) this.flush();
  }

  /** Drop everything without firing (pause, death, run end). */
  cancel(): void {
    this.clearResolve(); this.clearPressTimer();
    this.count = 0; this.pressValid = false;
  }

  get pendingTaps(): number { return this.count; }

  private flush(): void {
    this.clearResolve();
    const fam = familyForTaps(this.count);
    this.count = 0;
    if (fam) this.onResolve(fam);
  }
  private clearResolve(): void { if (this.resolveTimer) { this.clock.clearTimeout(this.resolveTimer); this.resolveTimer = null; } }
  private clearPressTimer(): void { if (this.pressTimer) { this.clock.clearTimeout(this.pressTimer); this.pressTimer = null; } }
}

/** Flick Dash test: quick release with enough travel. */
export function isFlick(dtMs: number, dx: number, dy: number, viewW: number, viewH: number): boolean {
  return dtMs <= INPUT_RULES.flickMaxMs && Math.hypot(dx, dy) >= INPUT_RULES.flickMinFraction * Math.min(viewW, viewH);
}

/** Second-finger release: a quick tap is an Air Roll. */
export function isRollTap(heldMs: number): boolean {
  return heldMs > 0 && heldMs < INPUT_RULES.rollTapMaxMs;
}

export function holdChargeMsFor(focusCharm: boolean): number {
  return INPUT_RULES.holdChargeMs * (focusCharm ? INPUT_RULES.focusCharmHoldFactor : 1);
}

/** Minimal stillness source (HoldStillTracker satisfies it). */
export interface StillnessSource {
  isStill(now: number): boolean;
  movedBeyondBudget(now: number): boolean;
}

export interface HoldChargeState { timer: number; stamp: number; }

/**
 * One hold-charge accrual step: wall-clock time accrues only while
 * the finger is still (past the arming window), moving past the
 * stillness budget clears the charge. Returns true when the charge
 * completes (the caller fires the HOLD slot); the state resets then.
 */
export function holdChargeStep(st: HoldChargeState, now: number, still: StillnessSource, chargeMs: number): boolean {
  const stepMs = st.stamp ? Math.min(100, Math.max(0, now - st.stamp)) : 0;
  st.stamp = now;
  if (still.isStill(now)) st.timer += stepMs;
  else if (still.movedBeyondBudget(now)) st.timer = 0;
  if (st.timer >= chargeMs) { st.timer = 0; st.stamp = 0; return true; }
  return false;
}

/** The subset of MovementState the stamina and glide rules read. */
export interface StaminaGlideState {
  stamina: number;
  lastSpendAt: number;
  gliding: boolean;
  straightTime: number;
  lastHeading: number | null;
}

export function staminaCostOf(st: StaminaGlideState, baseCost: number): number {
  return st.gliding ? baseCost * GLIDE_RULES.costMult : baseCost;
}

export function spendStaminaCore(st: StaminaGlideState, baseCost: number, now: number): boolean {
  const cost = staminaCostOf(st, baseCost);
  if (st.stamina < cost) return false;
  st.stamina -= cost;
  st.lastSpendAt = now;
  return true;
}

export function regenStaminaCore(st: StaminaGlideState, dtSeconds: number, now: number): void {
  if (st.stamina >= STAMINA.max) return;
  if (now - st.lastSpendAt < STAMINA.regenDelayMs) return;
  const rate = STAMINA.regenPerSecond * (st.gliding ? GLIDE_RULES.regenMult : 1);
  st.stamina = Math.min(STAMINA.max, st.stamina + rate * dtSeconds);
}

export function endGlideCore(st: StaminaGlideState): void {
  st.gliding = false;
  st.straightTime = 0;
}

/** Glide tracking from the bird's heading, once per physics step. */
export function trackGlide(st: StaminaGlideState, heading: number, dtSeconds: number): void {
  if (st.lastHeading !== null && dtSeconds > 0) {
    let dA = heading - st.lastHeading;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    const rate = Math.abs(dA) / dtSeconds;
    if (st.gliding) {
      if (rate > GLIDE_RULES.breakRate) endGlideCore(st);
    } else if (rate < GLIDE_RULES.straightRate) {
      st.straightTime += dtSeconds;
      if (st.straightTime >= GLIDE_RULES.buildS) st.gliding = true;
    } else {
      st.straightTime = 0;
    }
  }
  st.lastHeading = heading;
}
