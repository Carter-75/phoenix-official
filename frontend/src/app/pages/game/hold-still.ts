// Hold-charge stillness tracker (Bird Rebuild Round, Oct 28, 2026).
//
// Carter's final hold rule, replacing the Fix Round 1 Part 3 drift
// radius: a hold ability charges ONLY while a pointer touch is
// active on the steering surface AND its position is effectively
// stationary, and accrual begins only after 0.5 s of continuous
// stillness (the arming window). Any movement beyond the threshold
// clears the charge to zero (Fix Round 2, A2: Carter replaced the
// freeze-and-keep pause with a full reset), and resuming requires
// a fresh 0.5 s of stillness. Pointer lifted: no session, no
// accrual, and the charge clears.
//
// Stillness is measured as PATH LENGTH inside the trailing window,
// not endpoint distance from a fixed origin: a slow continuous drag
// moves in sub-pixel steps per input event, but its path over the
// window sums well past the threshold, so it can never charge;
// a planted finger's natural jitter sums to nearly nothing, so it
// always can. Positions are the game's adjusted steering
// coordinates, the same space the bird and
// the ability aim read.

export const HOLD_ARM_MS = 500;
export const HOLD_STILL_WINDOW_MS = 500;
export const HOLD_STILL_PATH_PX = 8;

interface HoldSample { t: number; x: number; y: number; }

export class HoldStillTracker {
  private samples: HoldSample[] = [];
  private pressT = 0;
  held = false;

  press(t: number, x: number, y: number): void {
    this.held = true;
    this.pressT = t;
    this.samples.length = 0;
    this.samples.push({ t, x, y });
  }

  release(): void {
    this.held = false;
    this.pressT = 0;
    this.samples.length = 0;
  }

  sample(t: number, x: number, y: number): void {
    if (!this.held) return;
    const last = this.samples[this.samples.length - 1];
    if (last && last.t === t && last.x === x && last.y === y) return;
    this.samples.push({ t, x, y });
    const cutoff = t - 1500;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }

  // Path length travelled inside the trailing window ending at now.
  // The last sample before the window seeds the chain, so movement
  // crossing the window edge still counts.
  private pathInWindow(now: number, windowMs: number): number {
    const from = now - windowMs;
    let path = 0;
    let prev: HoldSample | null = null;
    for (const s of this.samples) {
      if (s.t < from) { prev = s; continue; }
      if (prev) path += Math.hypot(s.x - prev.x, s.y - prev.y);
      prev = s;
    }
    return path;
  }

  isStill(now: number): boolean {
    if (!this.held) return false;
    if (now - this.pressT < HOLD_ARM_MS) return false;
    return this.pathInWindow(now, HOLD_STILL_WINDOW_MS) <= HOLD_STILL_PATH_PX;
  }

  // Fix Round 2 (A2, Carter's rule): true while the held pointer
  // has travelled past the stillness path budget inside the
  // trailing window. The game reads this to CLEAR an in-progress
  // charge the moment the player starts moving, replacing the
  // Bird Rebuild freeze-and-keep pause Carter rejected on his
  // phone. A later stop re-arms on its own, because isStill only
  // turns true again after a fresh full stillness window.
  movedBeyondBudget(now: number): boolean {
    if (!this.held) return false;
    return this.pathInWindow(now, HOLD_STILL_WINDOW_MS) > HOLD_STILL_PATH_PX;
  }
}
