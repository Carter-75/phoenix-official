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

import { TAP_CHAIN_RESOLVE_MS, TOUCH_DRAG_SCALE, TOUCH_DRAG_DEADZONE_PX } from '../data/balance.constants';
import { HoldStillTracker } from '../pages/game/hold-still';

// game.component.ts handleInputStart: a press within 300 ms of the
// previous press extends the tap chain.
export const TAP_CHAIN_WINDOW_MS = 300;
// game.component.ts evaluateFlick: release within 120 ms after at
// least 12 percent of the smaller screen dimension.
export const FLICK_MAX_MS = 120;
export const FLICK_MIN_FRACTION = 0.12;
// game.component.ts onTouchEnd: a second-finger tap under 250 ms is
// an Air Roll; held longer it was the Feather Brake.
export const ROLL_TAP_MAX_MS = 250;
// game.component.ts hold section: 1.5 s planted charge (no gadget).
export const HOLD_CHARGE_MS = 1500;
// bird-physics.ts glide tracking: heading change under 10 deg/s for
// 1.2 s builds Glide; a turn over 25 deg/s ends it.
export const GLIDE_BUILD_S = 1.2;
export const GLIDE_STRAIGHT_RATE = 0.1745;
export const GLIDE_BREAK_RATE = 0.436;

export { TAP_CHAIN_RESOLVE_MS, TOUCH_DRAG_SCALE, TOUCH_DRAG_DEADZONE_PX };

export type SlotFamily = 'tap' | 'double' | 'triple';

// Same values as STAMINA in game-state.service.ts (passed in by the
// component so this file stays Angular free; the spec checks them).
export interface StaminaRules {
  max: number;
  dashCost: number;
  rollCost: number;
  regenPerSecond: number;
  regenDelayMs: number;
  dashMs: number;
  rollMs: number;
}

export interface TutorialInputHandlers {
  onSteer?(dx: number, dy: number): void;
  onSlot?(family: SlotFamily): void;
  onDash?(dirX: number, dirY: number): void;
  onRoll?(): void;
  onBrake?(held: boolean): void;
  onHoldFire?(): void;
}

export interface TutorialClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: TutorialClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class TutorialGestureParser {
  private chainCount = 0;
  private chainLast = 0;
  private chainTimer: unknown = null;
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
  ) {}

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
    if (now - this.chainLast < TAP_CHAIN_WINDOW_MS) this.chainCount++;
    else this.chainCount = 1;
    this.chainLast = now;
    if (this.chainTimer) { this.clock.clearTimeout(this.chainTimer); this.chainTimer = null; }
    if (this.chainCount >= 4) {
      this.resolve(4);
    } else if (this.chainCount >= 2) {
      const count = this.chainCount;
      this.chainTimer = this.clock.setTimeout(() => { this.chainTimer = null; this.resolve(count); }, TAP_CHAIN_RESOLVE_MS);
    }
  }

  private resolve(count: number): void {
    if (this.chainTimer) { this.clock.clearTimeout(this.chainTimer); this.chainTimer = null; }
    this.chainCount = 0;
    if (count === 2) this.handlers.onSlot?.('tap');
    else if (count === 3) this.handlers.onSlot?.('double');
    else if (count >= 4) this.handlers.onSlot?.('triple');
  }

  // Relative drag: the steering target moves by the finger delta times
  // TOUCH_DRAG_SCALE once the finger has left the deadzone.
  move(x: number, y: number): void {
    if (!this.pointerDown) return;
    this.pointerX = x; this.pointerY = y;
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
    const minTravel = FLICK_MIN_FRACTION * Math.min(vp.w, vp.h);
    if (this.pressT > 0 && dt <= FLICK_MAX_MS && Math.hypot(dx, dy) >= minTravel) {
      this.handlers.onDash?.(dx, dy);
    }
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
    this.secondT = this.clock.now();
    this.setBrake(true);
  }

  secondUp(): void {
    if (this.secondT > 0 && this.clock.now() - this.secondT < ROLL_TAP_MAX_MS) this.handlers.onRoll?.();
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
    const step = this.holdStamp ? Math.min(100, Math.max(0, now - this.holdStamp)) : 0;
    this.holdStamp = now;
    if (this.hold.isStill(now)) this.holdTimer += step;
    else if (this.hold.movedBeyondBudget(now)) this.holdTimer = 0;
    this.holdProgress = Math.min(1, this.holdTimer / HOLD_CHARGE_MS);
    if (this.holdTimer >= HOLD_CHARGE_MS) {
      this.holdTimer = 0;
      this.holdStamp = 0;
      this.holdProgress = 0;
      this.handlers.onHoldFire?.();
    }
    return this.holdProgress;
  }

  dispose(): void {
    if (this.chainTimer) { this.clock.clearTimeout(this.chainTimer); this.chainTimer = null; }
  }
}

// Stamina and Glide, mirroring spendStamina / tickMovement /
// endGlide in game-state.service.ts and the glide tracker in
// bird-physics.ts.
export class TutorialStamina {
  stamina: number;
  lastSpendAt = -Infinity;
  gliding = false;
  straightTime = 0;
  private lastHeading: number | null = null;

  constructor(public rules: StaminaRules) {
    this.stamina = rules.max;
  }

  costOf(base: number): number { return this.gliding ? base / 2 : base; }

  spend(base: number, now: number): boolean {
    const cost = this.costOf(base);
    if (this.stamina < cost) return false;
    this.stamina -= cost;
    this.lastSpendAt = now;
    this.endGlide();
    return true;
  }

  add(amount: number): void { this.stamina = Math.min(this.rules.max, this.stamina + amount); }

  endGlide(): void { this.gliding = false; this.straightTime = 0; }

  tick(dtSeconds: number, now: number, heading: number): void {
    if (this.lastHeading !== null && dtSeconds > 0) {
      let dA = heading - this.lastHeading;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      const rate = Math.abs(dA) / dtSeconds;
      if (this.gliding) {
        if (rate > GLIDE_BREAK_RATE) this.endGlide();
      } else if (rate < GLIDE_STRAIGHT_RATE) {
        this.straightTime += dtSeconds;
        if (this.straightTime >= GLIDE_BUILD_S) this.gliding = true;
      } else {
        this.straightTime = 0;
      }
    }
    this.lastHeading = heading;
    if (this.stamina >= this.rules.max) return;
    if (now - this.lastSpendAt < this.rules.regenDelayMs) return;
    const rate = this.rules.regenPerSecond * (this.gliding ? 2 : 1);
    this.stamina = Math.min(this.rules.max, this.stamina + rate * dtSeconds);
  }
}
