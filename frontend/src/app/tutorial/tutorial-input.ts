// Tutorial input model (How to Play, Oct 30, 2026).
//
// A pure, framework-free mirror of the live game's touch grammar in
// game.component.ts, so the practice arena teaches exactly what the
// real run does. Every threshold below is either imported from the
// game's own constants or copied from the game code it names. If a
// rule changes in the game, change it here too (the unit tests in
// frontend/tests/tutorial-input.spec.ts pin the numbers).
//
// The tutorial never touches GameStateService progress, ads, or
// rewards: this file has no Angular dependencies at all.

import { TAP_CHAIN_RESOLVE_MS, TOUCH_DRAG_SCALE, TOUCH_DRAG_DEADZONE_PX, INPUT_RULES, GLIDE_RULES, STAMINA } from '../data/balance.constants';
import { HoldStillTracker } from '../pages/game/hold-still';
import {
  SlotFamily, TapChainParser, isFlick, isRollTap, holdChargeStep, holdChargeMsFor,
  spendStaminaCore, regenStaminaCore, endGlideCore, trackGlide, staminaCostOf, GestureClock, realClock,
} from '../input/gesture-core';

// Oct 30, 2026: the arena no longer mirrors the game by copy. Tap
// chain, flick, roll, hold charge, stamina, and glide all run through
// input/gesture-core.ts, the same code the live game calls. These
// names stay exported for the copy and the specs; they ARE the game
// constants.
export const TAP_CHAIN_WINDOW_MS = TAP_CHAIN_RESOLVE_MS;
export const FLICK_MAX_MS = INPUT_RULES.flickMaxMs;
export const FLICK_MIN_FRACTION = INPUT_RULES.flickMinFraction;
export const ROLL_TAP_MAX_MS = INPUT_RULES.rollTapMaxMs;
export const HOLD_CHARGE_MS = INPUT_RULES.holdChargeMs;
export const GLIDE_BUILD_S = GLIDE_RULES.buildS;
export const GLIDE_STRAIGHT_RATE = GLIDE_RULES.straightRate;
export const GLIDE_BREAK_RATE = GLIDE_RULES.breakRate;

export { TAP_CHAIN_RESOLVE_MS, TOUCH_DRAG_SCALE, TOUCH_DRAG_DEADZONE_PX };
export type { SlotFamily };

export type StaminaRules = typeof STAMINA;

export interface TutorialInputHandlers {
  onSteer?(dx: number, dy: number): void;
  onSlot?(family: SlotFamily): void;
  onDash?(dirX: number, dirY: number): void;
  onRoll?(): void;
  onBrake?(held: boolean): void;
  onHoldFire?(): void;
}

export type TutorialClock = GestureClock;

export class TutorialGestureParser {
  private chain: TapChainParser;
  private pressX = 0;
  private pressY = 0;
  private pressT = 0;
  private lastX = 0;
  private lastY = 0;
  private dragArmed = false;
  private secondT = 0;
  private hold = new HoldStillTracker();
  private holdTimer = 0;
  private holdStamp = 0;
  private pointerX = 0;
  private pointerY = 0;
  pointerDown = false;
  brakeHeld = false;
  holdProgress = 0;
  // The arena turns the hold charge off while a hold cooldown runs,
  // exactly like the game (no ready hold move, no session).
  holdReady = true;

  constructor(
    private handlers: TutorialInputHandlers,
    private clock: TutorialClock = realClock,
    private viewport: () => { w: number; h: number } = () => ({ w: window.innerWidth, h: window.innerHeight }),
    private focusCharm = false,
  ) {
    this.chain = new TapChainParser((f) => this.handlers.onSlot?.(f), clock);
  }

  // First finger (or left mouse button) lands.
  down(x: number, y: number): void {
    const now = this.clock.now();
    this.pointerDown = true;
    this.pressX = x; this.pressY = y; this.pressT = now;
    this.lastX = x; this.lastY = y; this.dragArmed = false;
    this.pointerX = x; this.pointerY = y;
    this.hold.press(now, x, y);
    this.holdTimer = 0;
    this.holdStamp = 0;
    this.chain.press(x, y);
  }

  // Relative drag: the steering target moves by the finger delta times
  // TOUCH_DRAG_SCALE once the finger has left the deadzone.
  move(x: number, y: number): void {
    if (!this.pointerDown) return;
    this.pointerX = x; this.pointerY = y;
    this.chain.move(x, y);
    this.hold.sample(this.clock.now(), x, y);
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    if (!this.dragArmed) {
      if (Math.hypot(dx, dy) < TOUCH_DRAG_DEADZONE_PX) return;
      this.dragArmed = true;
    }
    this.lastX = x; this.lastY = y;
    this.handlers.onSteer?.(dx * TOUCH_DRAG_SCALE, dy * TOUCH_DRAG_SCALE);
  }

  up(x: number, y: number): void {
    const now = this.clock.now();
    const dt = now - this.pressT;
    const dx = x - this.pressX;
    const dy = y - this.pressY;
    const vp = this.viewport();
    if (this.pressT > 0 && isFlick(dt, dx, dy, vp.w, vp.h)) {
      this.handlers.onDash?.(dx, dy);
    }
    this.chain.release(x, y);
    this.pressT = 0;
    this.pointerDown = false;
    this.dragArmed = false;
    this.secondT = 0;
    this.setBrake(false);
    this.hold.release();
    this.holdTimer = 0;
    this.holdStamp = 0;
    this.holdProgress = 0;
  }

  secondDown(): void {
    this.chain.invalidate();
    this.secondT = this.clock.now();
    this.setBrake(true);
  }

  secondUp(): void {
    if (this.secondT > 0 && isRollTap(this.clock.now() - this.secondT)) this.handlers.onRoll?.();
    this.secondT = 0;
    this.setBrake(false);
  }

  setBrake(held: boolean): void {
    if (this.brakeHeld === held) return;
    this.brakeHeld = held;
    this.handlers.onBrake?.(held);
  }

  // Per-frame hold charge, the same rules as the game: accrual only
  // while planted (0.5 s arming window), any movement past the budget
  // clears it, the brake blocks a charge that has not started.
  tick(): number {
    const now = this.clock.now();
    if (!this.pointerDown || !this.holdReady || (this.brakeHeld && this.holdTimer <= 0)) {
      this.holdTimer = 0;
      this.holdStamp = 0;
      this.holdProgress = 0;
      return 0;
    }
    this.hold.sample(now, this.pointerX, this.pointerY);
    const chargeMs = holdChargeMsFor(this.focusCharm);
    const st = { timer: this.holdTimer, stamp: this.holdStamp };
    const done = holdChargeStep(st, now, this.hold, chargeMs);
    this.holdTimer = st.timer; this.holdStamp = st.stamp;
    this.holdProgress = done ? 0 : Math.min(1, this.holdTimer / chargeMs);
    if (done) this.handlers.onHoldFire?.();
    return this.holdProgress;
  }

  dispose(): void {
    this.chain.cancel();
  }
}

// Stamina and Glide through the game's own functions (gesture-core:
// spendStaminaCore, regenStaminaCore, trackGlide), called in the same
// order as bird-physics.ts (regen, then glide tracking).
export class TutorialStamina {
  stamina: number;
  lastSpendAt = -Infinity;
  gliding = false;
  straightTime = 0;
  lastHeading: number | null = null;

  constructor(public rules: StaminaRules = STAMINA) {
    this.stamina = rules.max;
  }

  costOf(base: number): number { return staminaCostOf(this, base); }

  spend(base: number, now: number): boolean {
    if (!spendStaminaCore(this, base, now)) return false;
    this.endGlide();
    return true;
  }

  add(amount: number): void { this.stamina = Math.min(this.rules.max, this.stamina + amount); }

  endGlide(): void { endGlideCore(this); }

  tick(dtSeconds: number, now: number, heading: number): void {
    regenStaminaCore(this, dtSeconds, now);
    trackGlide(this, heading, dtSeconds);
  }
}
