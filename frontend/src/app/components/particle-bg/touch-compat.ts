// Compatibility mouse events (Carter bug report, Oct 30, 2026).
//
// Mobile browsers and the Android WebView synthesize mousemove,
// mousedown and mouseup at the finger's position after a tap that
// did not move. The particle background treats mousemove as desktop
// steering (absolute follow-the-pointer), so every ability tap pulled
// the phoenix to the tap point on the game screen, breaking relative
// drag. A mouse event is treated as synthesized when the browser says
// so (sourceCapabilities.firesTouchEvents) or when it arrives within
// TOUCH_COMPAT_WINDOW_MS of the last touch event.
export const TOUCH_COMPAT_WINDOW_MS = 1000;

export class TouchCompatGuard {
  private lastTouchAt = -Infinity;

  markTouch(now: number): void { this.lastTouchAt = now; }

  isSynthesizedMouse(event: { sourceCapabilities?: { firesTouchEvents?: boolean } | null } | null | undefined, now: number): boolean {
    if (event?.sourceCapabilities?.firesTouchEvents) return true;
    return now - this.lastTouchAt < TOUCH_COMPAT_WINDOW_MS;
  }
}
