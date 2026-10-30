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
  it('blocks switching to a different realm or unlocking one', () => {
    const obs: any = { buttons: [], checklist: undefined };
    expect(railCheck({ action: 'start_run', mode: 'campaign', realm: 1 }, obs, 'survive in realm 2')).toMatch(/realm 2/);
    expect(railCheck({ action: 'start_run', mode: 'campaign', realm: 2 }, obs, 'survive in realm 2')).toBeNull();
  });
  it('the agent stops at once on a locked realm and counts it as success', async () => {
    const logs: string[] = [];
    let called = 0;
    const out = await runAgent('survive 1 minute in realm 5', async () => { called++; return { action: 'wait', seconds: 1 }; },
      { observe: () => ({ screen: 'menu', unlockedRealms: [1, 2, 3], buttons: [] }), execute: async () => ({ ok: true, note: '' }), log: (_k: string, m: string) => logs.push(m), now: () => 0 } as any,
      { deadline: null, reportMaxChars: 500, sleep: async () => {} } as any);
    expect(called).toBe(0);
    expect(out.success).toBe(true);
    expect(out.endReason).toBe('Success (correctly refused): Realm 5 is locked; unlocked: 1-3');
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

describe('gameplay goals play first', () => {
  it('blocks menu wandering before the first run', () => {
    const obs: any = { buttons: [], checklist: ck({ visited: ['menu'] }) };
    expect(railCheck({ action: 'navigate', page: 'shop' } as any, obs, 'clear all realms in one run with no deaths')).toMatch(/start_run \(realm 1\)/);
    expect(railCheck({ action: 'navigate', page: 'shop' } as any, obs, 'die on purpose, then buy an upgrade')).toBeNull();
  });
});
