import { describe, it, expect } from 'vitest';
import { unmetSubgoals, runAgent, type Checklist } from '../src/app/autoplay/autoplay-agent';

const ck = (o: Partial<Checklist> = {}): Checklist => ({ visited: [], notVisited: [], deaths: 0, buys: 0, retriedAfterDeath: false, retriedAfterBuy: false, tutorialDone: false, tutorialPassed: 0, tutorialSkipped: 0, uiFindings: 0, bugs: 0, longestLifeSec: 0, realmsCleared: [], cleanSweep: false, ...o });

describe('goal verification', () => {
  it('survive 2 minutes needs one continuous life of 120 s', () => {
    expect(unmetSubgoals('survive 2 minutes in realm 3', ck({ longestLifeSec: 82 }))[0]).toMatch(/longest continuous life is 82 s, need 120 s/);
    expect(unmetSubgoals('survive 2 minutes in realm 3', ck({ longestLifeSec: 121 }))).toEqual([]);
  });
  it('die, buy, retry needs a death, a buy, and a run after the buy', () => {
    const u = unmetSubgoals('die on purpose, then buy an upgrade with the coins and retry', ck());
    expect(u.join(' ')).toMatch(/die/); expect(u.join(' ')).toMatch(/buy/); expect(u.join(' ')).toMatch(/retry/);
    expect(unmetSubgoals('die on purpose, then buy an upgrade with the coins and retry', ck({ deaths: 1, buys: 1, retriedAfterBuy: true }))).toEqual([]);
  });
  it('all 10 realms with no deaths needs a clean sweep', () => {
    const p = 'start realm 1, speed-run all 10 realms with no deaths';
    expect(unmetSubgoals(p, ck({ realmsCleared: [1, 2] })).join(' ')).toMatch(/not cleared yet: 3, 4/);
    expect(unmetSubgoals(p, ck({ realmsCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], deaths: 1 })).join(' ')).toMatch(/no deaths/);
    expect(unmetSubgoals(p, ck({ realmsCleared: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], cleanSweep: true }))).toEqual([]);
  });
});

describe('agent loop', () => {
  const env = (logs: string[]) => ({ observe: () => ({ screen: 'menu', coins: 0, gems: 0, realm: 1, unlockedRealms: [1], bossBeaten: [], buttons: [], checklist: ck({ visited: ['menu', 'shop', 'settings', 'codex', 'leaderboard', 'tutorial', 'game', 'pause'] }) } as any), execute: async () => ({ ok: true, note: '' }), log: (_k: string, m: string) => logs.push(m), now: () => 0 } as any);
  it('retries transient AI errors before stopping', async () => {
    let n = 0; const logs: string[] = [];
    const out = await runAgent('open every menu you can reach', async () => { if (n++ < 2) throw new Error('SyntaxError'); return { action: 'finish', report: 'ok', outcome: 'goal_met' }; }, env(logs), { deadline: null, reportMaxChars: 500, sleep: async () => {} } as any);
    expect(out.endReason).toBe('AI finished');
    expect(logs.filter(l => /retry \d of/.test(l)).length).toBe(2);
  });
  it('an impossible claim after every screen is visited becomes goal_met', async () => {
    const logs: string[] = [];
    const out = await runAgent('open every menu you can reach and check it works', async () => ({ action: 'finish', report: 'r', outcome: 'impossible', reason: 'no finish allowed' }), env(logs), { deadline: null, reportMaxChars: 500, sleep: async () => {} } as any);
    expect(out.endReason).toBe('AI finished');
    expect(logs.join(' ')).toMatch(/recording goal_met/);
  });
});

import { goalRealm, realmRefusal, railCheck } from '../src/app/autoplay/autoplay-agent';
describe('realm rules', () => {
  it('starts in the named realm, else realm 1 for an all-realms goal', () => {
    expect(goalRealm('survive 1 minute in realm 2')).toBe(2);
    expect(goalRealm('clear all realms in one run with no deaths')).toBe(1);
    expect(goalRealm('buy one upgrade')).toBeNull();
  });
  it('a locked realm is a code-verified refusal with a clear reason', () => {
    expect(realmRefusal('play realm 5', [1, 2, 3])).toBe('Realm 5 is locked; unlocked: 1-3');
    expect(realmRefusal('play realm 3', [1, 2, 3])).toBeNull();
  });
  it('leaves realm choice to the AI but never lets it buy or unlock a realm', () => {
    const obs: any = { buttons: [{ id: 'realm-unlock-5', enabled: true, currency: 'gems' }], checklist: undefined };
    expect(railCheck({ action: 'start_run', mode: 'campaign', realm: 1 }, obs, 'start at realm 1, clear realms 1-10')).toBeNull();
    expect(railCheck({ action: 'tap_button', id: 'realm-unlock-5' } as any, obs, 'start at realm 1, clear realms 1-10')).toMatch(/beating/);
  });
  const env = (unlocked: number[]) => ({ observe: () => ({ screen: 'menu', unlockedRealms: unlocked, buttons: [] }), execute: async () => ({ ok: true, note: '' }), log: () => {}, now: () => 0 } as any);
  const opts = { deadline: null, reportMaxChars: 500, sleep: async () => {} } as any;
  it('no hard pre-refusal: the AI is asked, and its impossible finish is verified by code', async () => {
    let called = 0;
    const out = await runAgent('start at realm 5', async () => { called++; return { action: 'finish', outcome: 'impossible', reason: 'locked', report: 'Realm 5 is locked.' } as any; }, env([1, 2, 3]), opts);
    expect(called).toBe(1);
    expect(out.success).toBe(true);
    expect(out.endReason).toBe('Success (correctly refused): Realm 5 is locked; unlocked: 1-3');
  });
  it('a progression goal starting in an unlocked realm is not refused', async () => {
    let called = 0;
    const out = await runAgent('Start at realm 1 keep going until in 1 run u do 1-10 all without dying', async () => { called++; return { action: 'finish', outcome: 'impossible', reason: 'x', report: 'x' } as any; }, env([1, 2, 3]), { ...opts, maxSteps: 3 });
    expect(called).toBeGreaterThan(0);
    expect(out.success).not.toBe(true);
  });
});

import { codeVerifiedMet } from '../src/app/autoplay/autoplay-agent';
describe('code-verified outcome', () => {
  it('a checkable goal met by code counts even if the AI said impossible', () => {
    expect(codeVerifiedMet('survive 1 minute in realm 3', ck({ longestLifeSec: 68, deaths: 1 }))).toBe(true);
    expect(codeVerifiedMet('survive 1 minute in realm 3', ck({ longestLifeSec: 40 }))).toBe(false);
    expect(codeVerifiedMet('buy one upgrade with coins', ck({ buys: 1 }))).toBe(false); // not code-checkable, the AI must finish
  });
});

describe('Carter prompt verification', () => {
  it('"do 1-10 all without dying" needs a clean sweep', () => {
    const p = 'Start at realm 1 keep going until in 1 run u do 1-10 all without dying, upgrade as you wish with coins.';
    expect(unmetSubgoals(p, ck({})).join(';')).toMatch(/not cleared yet: 1, 2/);
    expect(unmetSubgoals(p, ck({ realmsCleared: [1,2,3,4,5,6,7,8,9,10], cleanSweep: true }))).toEqual([]);
  });
});

import { upgradeNudge } from '../src/app/autoplay/autoplay-agent';
describe('upgradeNudge', () => {
  const ck = (deaths: number) => ({ visited: [], notVisited: [], deaths, buys: 0, retriedAfterDeath: false, retriedAfterBuy: false, tutorialDone: false, tutorialPassed: 0, tutorialSkipped: 0, uiFindings: 0, bugs: 0, longestLifeSec: 0, realmsCleared: [], cleanSweep: false });
  const obs = (deaths: number, coins: number, cost = 250): any => ({ coins, checklist: ck(deaths), shop: { coins, cheapest: 100, best: [{ id: 'buy-damage', cost, gain: '+1', why: '' }] } });
  const P = 'Start at realm 1 keep going until in 1 run u do 1-10 all without dying, upgrade as you wish with coins.';
  const run: any = { action: 'start_run', mode: 'campaign', realm: 1 };
  const fresh = () => ({ deathsSeen: 0, coinsAtDeath: 0, nudges: 0 });
  it('keeps nudging until about 70% of the coins are spent', () => {
    const st = fresh();
    expect(upgradeNudge(run, obs(0, 5000), P, st)).toBeNull();
    expect(upgradeNudge(run, obs(1, 5000), P, st)).toContain('spent only 0 of 5000');
    expect(upgradeNudge(run, obs(1, 4700), P, st)).toContain('spent only 300');
    expect(upgradeNudge(run, obs(1, 1400), P, st)).toBeNull();
  });
  it('stops when the best upgrade is unaffordable, upgrades are not allowed, or after 8 nudges', () => {
    let st = fresh(); upgradeNudge(run, obs(1, 5000), P, st);
    expect(upgradeNudge(run, obs(1, 200), P, st)).toBeNull();
    expect(upgradeNudge(run, obs(1, 5000), 'survive 1 minute in realm 3 without upgrades', fresh())).toBeNull();
    expect(upgradeNudge(run, obs(1, 5000), 'beat the realm 1 boss so realm 2 opens, then play realm 2', fresh())).toContain('REJECTED');
    st = fresh(); for (let i = 0; i < 8; i++) upgradeNudge(run, obs(1, 5000), P, st);
    expect(upgradeNudge(run, obs(1, 5000), P, st)).toBeNull();
  });
});

import { startRealmCheck } from '../src/app/autoplay/autoplay-agent';
describe('startRealmCheck', () => {
  const o = (cleared: number[]): any => ({ unlockedRealms: [1, 2, 3], checklist: { realmsCleared: cleared } });
  const T = 'beat the realm 1 boss so realm 2 opens, then play realm 2';
  it('sends a later-realm start back until the named realm is cleared', () => {
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 2 }, o([]), T)).toContain('start_run realm 1');
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 1 }, o([]), T)).toBeNull();
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 2 }, o([1]), T)).toBeNull();
  });
  it('progression goals start at realm 1 even with free wording, and advance only after the boss', () => {
    const P = 'progress through realms 1-10, starting wherever makes sense';
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 2 }, o([]), P)).toContain('start_run realm 1');
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 1 }, o([]), P)).toBeNull();
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 3 }, o([1]), P)).toContain('start_run realm 2');
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 2 }, o([1]), P)).toBeNull();
  });
  it('leaves free-choice prompts without a progression alone', () => {
    expect(startRealmCheck({ action: 'start_run', mode: 'campaign', realm: 2 }, o([]), 'survive 1 minute in any realm you choose')).toBeNull();
  });
});
