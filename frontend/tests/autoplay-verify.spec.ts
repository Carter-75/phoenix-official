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
