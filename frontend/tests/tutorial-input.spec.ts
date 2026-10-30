import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TutorialGestureParser, TutorialStamina, TutorialClock, SlotFamily,
  TAP_CHAIN_RESOLVE_MS, TOUCH_DRAG_SCALE, TOUCH_DRAG_DEADZONE_PX,
  FLICK_MAX_MS, ROLL_TAP_MAX_MS, HOLD_CHARGE_MS, GLIDE_BUILD_S,
} from '../src/app/tutorial/tutorial-input';
import { TUTORIAL_STAMINA } from '../src/app/tutorial/tutorial-copy-numbers';
import { STAMINA } from '../src/app/data/balance.constants';
import { readTutorialState, writeTutorialState, shouldOfferTutorial, TUTORIAL_STATE_KEY } from '../src/app/tutorial/tutorial-progress';
import { TUTORIAL_STEPS } from '../src/app/tutorial/tutorial-steps';
import { TouchCompatGuard, TOUCH_COMPAT_WINDOW_MS } from '../src/app/components/particle-bg/touch-compat';
import { HOLD_ARM_MS } from '../src/app/pages/game/hold-still';

class FakeClock implements TutorialClock {
  t = 1000;
  private q: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.n; this.q.push({ at: this.t + ms, fn, id }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter(x => x.id !== h); }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift(); this.t = next.at; next.fn();
    }
    this.t = end;
  }
}

function setup() {
  const clock = new FakeClock();
  const log = { slots: [] as SlotFamily[], steer: [] as [number, number][], dash: 0, roll: 0, brake: [] as boolean[], hold: 0 };
  const p = new TutorialGestureParser({
    onSlot: f => log.slots.push(f), onSteer: (x, y) => log.steer.push([x, y]),
    onDash: () => log.dash++, onRoll: () => log.roll++, onBrake: h => log.brake.push(h), onHoldFire: () => log.hold++,
  }, clock, () => ({ w: 400, h: 800 }));
  const tap = () => { p.down(100, 100); clock.advance(40); p.up(100, 100); clock.advance(60); };
  return { clock, log, p, tap };
}

describe('tap chain mirrors the game (1 tap TAP, 2 DBL, 3 ULT)', () => {
  it('one quick tap fires TAP after the resolve window', () => {
    const { clock, log, tap } = setup(); tap();
    expect(log.slots).toEqual([]);
    clock.advance(TAP_CHAIN_RESOLVE_MS + 20); expect(log.slots).toEqual(['tap']);
  });
  it('two taps fire DBL only', () => {
    const { clock, log, tap } = setup(); tap(); tap(); clock.advance(500); expect(log.slots).toEqual(['double']);
  });
  it('three taps fire ULT at once', () => {
    const { log, tap } = setup(); tap(); tap(); tap(); expect(log.slots).toEqual(['triple']);
  });
  it('taps further apart than the resolve window fire separately', () => {
    const { clock, log, p } = setup();
    p.down(1, 1); p.up(1, 1); clock.advance(TAP_CHAIN_RESOLVE_MS + 120); p.down(1, 1); p.up(1, 1); clock.advance(1000);
    expect(log.slots).toEqual(['tap', 'tap']);
  });
  it('a long press or a drag is not a tap', () => {
    const { clock, log, p } = setup();
    p.down(1, 1); clock.advance(400); p.up(1, 1); clock.advance(1000);
    p.down(100, 100); p.move(160, 100); p.up(160, 100); clock.advance(1000);
    expect(log.slots).toEqual([]);
  });
});

describe('drag, flick, roll, brake, hold', () => {
  it('relative drag honors deadzone and scale', () => {
    const { log, p } = setup();
    p.down(100, 100); p.move(100 + TOUCH_DRAG_DEADZONE_PX - 1, 100);
    expect(log.steer).toEqual([]);
    p.move(110, 100); expect(log.steer[0]).toEqual([10 * TOUCH_DRAG_SCALE, 0]);
    p.move(112, 104); expect(log.steer[1]).toEqual([2 * TOUCH_DRAG_SCALE, 4 * TOUCH_DRAG_SCALE]);
  });
  it('a press never produces a steer (no absolute targeting)', () => {
    const { log, p, tap } = setup(); tap(); tap(); p.down(300, 700); p.up(300, 700);
    expect(log.steer).toEqual([]);
  });
  it('flick dashes only when fast and long enough', () => {
    const { clock, log, p } = setup();
    p.down(100, 400); clock.advance(FLICK_MAX_MS); p.up(100, 400 - 48); expect(log.dash).toBe(1); // 12% of 400
    clock.advance(500); p.down(100, 400); clock.advance(FLICK_MAX_MS + 10); p.up(100, 200); expect(log.dash).toBe(1);
    clock.advance(500); p.down(100, 400); clock.advance(50); p.up(100, 360); expect(log.dash).toBe(1);
  });
  it('quick second finger rolls, held one brakes', () => {
    const { clock, log, p } = setup();
    p.down(1, 1); p.secondDown(); clock.advance(ROLL_TAP_MAX_MS - 10); p.secondUp(); expect(log.roll).toBe(1);
    p.secondDown(); clock.advance(800); p.secondUp(); expect(log.roll).toBe(1);
    expect(log.brake).toEqual([true, false, true, false]);
  });
  it('hold arms after stillness then charges for the full charge time', () => {
    const { clock, log, p } = setup();
    p.down(50, 50);
    let fired = -1;
    for (let t = 0; t <= 4000; t += 16) { p.tick(); if (log.hold && fired < 0) fired = t; clock.advance(16); }
    expect(fired).toBeGreaterThanOrEqual(HOLD_CHARGE_MS);
    expect(fired).toBeLessThanOrEqual(HOLD_ARM_MS + HOLD_CHARGE_MS + 100);
  });
  it('moving clears the hold charge', () => {
    const { clock, log, p } = setup();
    p.down(50, 50);
    for (let t = 0; t < 1200; t += 16) { p.tick(); clock.advance(16); }
    p.move(120, 50); p.tick();
    expect(p.holdProgress).toBe(0); expect(log.hold).toBe(0);
  });
});

describe('stamina and glide', () => {
  it('is the game STAMINA object itself', () => {
    expect(TUTORIAL_STAMINA).toBe(STAMINA);
    const src = readFileSync(resolve(__dirname, '../src/app/pages/tutorial/tutorial.component.ts'), 'utf8');
    expect(src).not.toMatch(/new TutorialStamina\(\{/);
  });
  it('regen waits for the delay, glide halves cost and doubles regen', () => {
    const s = new TutorialStamina(TUTORIAL_STAMINA);
    expect(s.spend(TUTORIAL_STAMINA.dashCost, 0)).toBe(true);
    expect(s.stamina).toBe(65);
    s.tick(0.1, 500, 0); expect(s.stamina).toBe(65);
    s.tick(1, 1000, 0); expect(s.stamina).toBe(90);
    s.stamina = 20;
    for (let i = 0; i < Math.ceil(GLIDE_BUILD_S / 0.1) + 1; i++) s.tick(0.1, 2000 + i * 100, 0);
    expect(s.gliding).toBe(true);
    expect(s.costOf(TUTORIAL_STAMINA.rollCost)).toBe(25);
    s.stamina = 20; const before = s.stamina; s.tick(1, 9000, 0); expect(s.stamina - before).toBe(50);
    s.tick(0.1, 9100, 1); expect(s.gliding).toBe(false);
  });
});

describe('progress flag', () => {
  let store: Map<string, string>;
  const kv = () => ({ getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  beforeEach(() => { store = new Map(); });
  it('offers once, never in automation, never downgrades done', () => {
    expect(shouldOfferTutorial(kv(), false)).toBe(true);
    expect(shouldOfferTutorial(kv(), true)).toBe(false);
    writeTutorialState(kv(), 'done'); writeTutorialState(kv(), 'skipped');
    expect(readTutorialState(kv())).toBe('done');
    expect(store.get(TUTORIAL_STATE_KEY)).toBe('done');
    expect(shouldOfferTutorial(kv(), false)).toBe(false);
  });
  it('ignores junk values', () => { store.set(TUTORIAL_STATE_KEY, 'x'); expect(readTutorialState(kv())).toBeNull(); });
});

describe('steps copy', () => {
  it('has no em dashes and unique ids', () => {
    const ids = TUTORIAL_STEPS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of TUTORIAL_STEPS) expect(JSON.stringify(s)).not.toMatch(/\u2014/);
  });
});

describe('touch compat guard (tap must not pull the phoenix)', () => {
  it('treats mouse events right after a touch as synthesized', () => {
    const g = new TouchCompatGuard();
    expect(g.isSynthesizedMouse({}, 5000)).toBe(false);
    g.markTouch(5000);
    expect(g.isSynthesizedMouse({}, 5000 + 300)).toBe(true);
    expect(g.isSynthesizedMouse({}, 5000 + TOUCH_COMPAT_WINDOW_MS + 1)).toBe(false);
    expect(g.isSynthesizedMouse({ sourceCapabilities: { firesTouchEvents: true } }, 99999)).toBe(true);
  });
  it('particle background gates mousemove steering with the guard and keeps touch relative on the game screen', () => {
    const src = readFileSync(resolve(__dirname, '../src/app/components/particle-bg/particle-bg.component.ts'), 'utf8');
    const mm = src.slice(src.indexOf('private onMouseMove('), src.indexOf('private onTouchMove('));
    expect(mm).toMatch(/isSynthesizedMouse/);
    expect(src).toMatch(/if \(this\.gameState\.activeScreen\(\) === 'game'\) return;\s*\n\s*this\.updateMouseTarget/);
  });
});
