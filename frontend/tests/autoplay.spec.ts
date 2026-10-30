import { describe, it, expect, beforeEach } from 'vitest';
import { parseIntent, parseDuration, effectiveLimit, planFromRemote } from '../src/app/autoplay/autoplay-intent';
import { autoplayAllowed, clientLooksLikeOwner } from '../src/app/autoplay/autoplay-gate';
import { CappedOutput, fitToBudget, OUTPUT_CAP_CHARS } from '../src/app/autoplay/autoplay-output';
import { synthTapChain, chainIsValid, pressesFor, synthFlick, FLICK_MAX_MS, CHAIN_GAP_MAX_MS } from '../src/app/autoplay/autoplay-gestures';
import { TAP_CHAIN_RESOLVE_MS } from '../src/app/data/balance.constants';
import { AdGuard } from '../src/app/autoplay/ad-guard';
import { decide, timeToHit } from '../src/app/autoplay/autoplay-pilot';

describe('autoplay intent parser', () => {
  it('one run, all realms, infinite = deathless single run 1..10 restarting from 1', () => {
    const p = parseIntent('finish all realms in one run, normal mode, infinite time', null);
    expect(p.mode).toBe('campaign');
    expect(p.goal).toBe('clear_through');
    expect(p.startRealm).toBe(1);
    expect(p.targetRealm).toBe(10);
    expect(p.scope).toBe('single_run');
    expect(p.maxDeaths).toBe(0);
    expect(p.retryPolicy).toBe('restart_from_start');
    expect(p.upgradeOnRetry).toBe(true);
    expect(p.allowGemRevives).toBe(false);
    expect(p.timeLimitMs).toBeNull();
  });
  it('durations and limits', () => {
    expect(parseDuration('play for 5 minutes')).toBe(300000);
    expect(parseDuration('forever')).toBeNull();
    expect(effectiveLimit(600000, 300000)).toBe(300000);
    expect(effectiveLimit(null, null)).toBeNull();
  });
  it('modes', () => {
    expect(parseIntent('play battle mode').mode).toBe('battle');
    expect(parseIntent('endless for 10 min').mode).toBe('endless');
  });
  it('remote plan cannot loosen local constraints', () => {
    const local = parseIntent('all realms in one run no deaths');
    const p = planFromRemote({ scope: 'cumulative', maxDeaths: 5, allowGemRevives: true, mode: 'campaign', goal: 'clear_through', startRealm: 1, targetRealm: 10 }, local, null);
    expect(p.scope).toBe('single_run');
    expect(p.maxDeaths).toBe(0);
    expect(p.allowGemRevives).toBe(false);
    expect(p.source).toBe('openai');
    expect(planFromRemote(null, local, null)).toBe(local);
  });
});

describe('autoplay gate', () => {
  it('needs owner email, non temp, and server flags', () => {
    const u = { email: 'hello@phoenixwebsites.ai' };
    expect(clientLooksLikeOwner(u)).toBe(true);
    expect(autoplayAllowed(u, { isOwner: true, autoplay: true })).toBe(true);
    expect(autoplayAllowed(u, { isOwner: false, autoplay: true })).toBe(false);
    expect(autoplayAllowed(u, null)).toBe(false);
    expect(autoplayAllowed({ email: 'x@y.com' }, { isOwner: true, autoplay: true })).toBe(false);
    expect(autoplayAllowed({ ...u, isTemp: true }, { isOwner: true, autoplay: true })).toBe(false);
  });
});

describe('autoplay output cap', () => {
  it('never exceeds the cap and keeps the report', () => {
    const o = new CappedOutput();
    for (let i = 0; i < 5000; i++) o.add('log', `line ${i} ${'x'.repeat(60)}`);
    o.add('log', 'same'); o.add('log', 'same');
    const report = '## Summary\n' + Array.from({ length: 2000 }, (_, i) => `- bug ${i} ${'y'.repeat(30)}`).join('\n') + '\n## Stats\n- done';
    o.setReport(report);
    const t = o.text();
    expect(t.length).toBeLessThanOrEqual(OUTPUT_CAP_CHARS);
    expect(t).toContain('## Stats');
    expect(t).toContain('more similar items omitted');
    expect(t).toContain('condensed');
  });
  it('fitToBudget is a no-op when small', () => { expect(fitToBudget('abc', 10)).toBe('abc'); });
});

describe('tap chain synthesis', () => {
  it('press counts and spacing match the game parser', () => {
    for (const f of ['tap', 'double', 'triple'] as const) {
      for (let k = 0; k < 50; k++) {
        const c = synthTapChain(f, 100, 100);
        expect(c.steps.filter(s => s.type === 'start').length).toBe(pressesFor(f));
        expect(chainIsValid(c.steps, f)).toBe(true);
        expect(c.quietMs).toBeGreaterThan(TAP_CHAIN_RESOLVE_MS);
        expect(c.quietMs).toBeGreaterThan(CHAIN_GAP_MAX_MS);
      }
    }
    expect(pressesFor('tap')).toBe(2); expect(pressesFor('double')).toBe(3); expect(pressesFor('triple')).toBe(4);
  });
  it('flick is fast and long enough', () => {
    const s = synthFlick(200, 200, 1, 0, 400, 800);
    const end = s[s.length - 1];
    expect(end.at).toBeLessThan(FLICK_MAX_MS);
    expect(end.x - 200).toBeGreaterThanOrEqual(0.12 * 400);
  });
});

describe('ad guard', () => {
  beforeEach(() => AdGuard.reset());
  it('suppresses while any reason is held', () => {
    expect(AdGuard.isSuppressed()).toBe(false);
    AdGuard.suppress('autoplay');
    expect(AdGuard.isSuppressed()).toBe(true);
    AdGuard.release('autoplay');
    expect(AdGuard.isSuppressed()).toBe(false);
  });
});

describe('pilot', () => {
  it('dodges a projectile on a collision course', () => {
    const th = { x: 200, y: 100, vx: 0, vy: 600, r: 8, dmg: 10 };
    expect(timeToHit({ x: 200, y: 300 }, th, 18)).toBeLessThan(0.5);
    const d = decide({ p: { x: 200, y: 300 }, v: { x: 0, y: 0 }, w: 400, h: 800, birdR: 18, threats: [th], foes: [], pickups: [], stamina: 100, dashCost: 35, rollCost: 50, telegraph: false, hpFrac: 1 }, () => 0.5);
    expect(timeToHit(d.target, th, 18)).toBe(Infinity);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('ad guard wiring', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../src/app', p), 'utf8');
  it('finishRunForAds no-ops under AdGuard', () => {
    const g = src('pages/game/game.component.ts');
    const body = g.slice(g.indexOf('finishRunForAds('), g.indexOf('finishRunForAds(') + 400);
    expect(body).toMatch(/AdGuard\.isSuppressed\(\)\)\s*return/);
  });
  it('every AdsService entry point checks the guard', () => {
    const a = src('services/ads.service.ts');
    for (const fn of ['ensureInit', 'showRewarded', 'onRunFinished', 'maybeShowInterstitial']) {
      const m = new RegExp(fn + '\\([^)]*\\)[^{]*\\{\\s*if \\(AdGuard\\.isSuppressed\\(\\)\\) return');
      expect(a).toMatch(m);
    }
  });
});
