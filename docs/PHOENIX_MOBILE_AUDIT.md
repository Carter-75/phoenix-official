# Phoenix-Fall — Mobile / Best-Practices Audit & Fixes (Phoenix 🐦‍🔥)

## Findings & fixes

### CRITICAL
1. **Tap/hold didn't move the Phoenix on touch.**
   `particle-bg.component.ts` only listened to `touchmove`, never `touchstart`. On APK a finger
   press-and-hold (no drag) never set the movement target → the bird only reacted to dragging.
   FIX: added `touchstart` listener (same handler as touchmove) so a tap/hold moves it instantly.

2. **Capacitor `webDir` pointed at the wrong folder.**
   Angular's application builder emits to `dist/frontend/browser/`, but `capacitor.config.ts`
   had `webDir: 'dist/frontend'`. `cap sync` failed ("must contain index.html") → the APK would
   ship stale/no web assets. FIX: `webDir: 'dist/frontend/browser'`. `cap sync android` now succeeds.

### Mobile UX / WebView
3. **No global touch CSS** → Android WebView allowed pull-to-refresh, rubber-band scroll, long-press
   text selection, tap highlight flashes, and pinch-zoom over the game. FIX (styles.css):
   - `html, body`: `overflow:hidden`, `position:fixed`, `overscroll-behavior:none`,
     `touch-action:none`, `user-select:none`, `-webkit-touch-callout:none`,
     `-webkit-tap-highlight-color:transparent`.
   - Opt scrollable panels back in (`.custom-scrollbar`, `.overflow-y-auto`, etc.):
     `touch-action:pan-y; overscroll-behavior:contain; -webkit-overflow-scrolling:touch`.
   - `button/a/input/...`: `touch-action:manipulation` (kills 300ms tap delay, keeps taps).
   - `.safe-area` helper using `env(safe-area-inset-*)` for notch-safe UI chrome.
   - Deliberately did NOT pad `app-root` — the Three.js canvas must map 1:1 to `window` coords
     the physics engine uses, or touch→physics mapping would drift.

4. **Listener leaks** in `particle-bg`: `removeEventListener(fn.bind(this))` created NEW refs each
   call, so listeners were never removed (duplicate listeners on component recreate). FIX: store
   bound handlers once (`boundResize/boundMouseMove/boundTouchMove`) and use them for add+remove.
   (game.component already used stored bound refs — OK.)

5. **In-game touchmove** now `preventDefault()`s only while `activeScreen==='game'` and when the
   event is cancelable, so menu scrolling/buttons still work.

### Verified OK (no change needed)
- `index.html` viewport already correct: `width=device-width, initial-scale=1, maximum-scale=1,
  user-scalable=no, viewport-fit=cover`.
- `screenScale` is a live getter; physics reads `window.innerWidth/Height` live → resize-safe.
- AndroidManifest handles `configChanges` (orientation/screenSize) so rotation won't restart.
- Layout uses Tailwind responsive (`md:` breakpoints), `h-full`/`inset-0`, not fragile `100vh`.

## Build/verify
- `ng build --configuration production` → success.
- `cap sync android` → Sync finished, 3 plugins.
