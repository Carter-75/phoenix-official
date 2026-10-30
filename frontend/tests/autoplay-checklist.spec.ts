// Round 2: code-verified checklist, sub-goal verifier, new navigate pages, tutorial play-through.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAction, requiredScreens, unmetSubgoals, runAgent, type Checklist, type AgentEnv, type Observation } from '../src/app/autoplay/autoplay-agent';

const read = (p: string) => readFileSync(resolve(__dirname, '../src/app', p), 'utf8');
const ck = (o: Partial<Checklist> = {}): Checklist => ({ visited: ['menu'], notVisited: [], deaths: 0, buys: 0, retriedAfterDeath: false, retriedAfterBuy: false, tutorialDone: false, tutorialPassed: 0, tutorialSkipped: 0, uiFindings: 0, bugs: 0, ...o });

describe('sub-goal verifier', () => {
  it('die, buy, retry each need code proof', () => {
    const p = 'die on purpose, then buy an upgrade with the coins and retry';
    expect(unmetSubgoals(p, ck()).length).toBe(3);
    expect(unmetSubgoals(p, ck({ deaths: 1 })).length).toBe(2);
    expect(unmetSubgoals(p, ck({ deaths: 1, buys: 1 })).length).toBe(1);
    expect(unmetSubgoals(p, ck({ deaths: 1, buys: 1, retriedAfterDeath: true })).length).toBe(1);
    expect(unmetSubgoals(p, ck({ deaths: 1, buys: 1, retriedAfterBuy: true }))).toEqual([]);
  });
  it('no deaths prompts do not require a death', () => {
    const u = unmetSubgoals('speed-run all 10 realms with no deaths, upgrade on death', ck());
    expect(u.some(x => /^die/.test(x))).toBe(false);
    expect(u.some(x => /^realms/.test(x))).toBe(true);
  });
  it('tutorial needs completion', () => {
    expect(unmetSubgoals('test the tutorial', ck()).length).toBe(1);
    expect(unmetSubgoals('test the tutorial', ck({ tutorialDone: true }))).toEqual([]);
  });
  it('every menu and bug hunts need screens visited', () => {
    expect(requiredScreens('open every menu you can reach and check it works')).toEqual(['menu', 'shop', 'settings', 'codex', 'leaderboard']);
    expect(requiredScreens('find UI bugs in the shop and menu and report them')).toEqual(['menu', 'shop']);
    expect(requiredScreens('buy one upgrade with coins')).toEqual([]);
    expect(unmetSubgoals('find UI bugs in the shop and menu', ck({ visited: ['shop'] }))[0]).toMatch(/menu/);
  });
  it('the loop rejects goal_met until verified, then accepts', async () => {
    let c = ck(); let n = 0;
    const o = (): Observation => ({ screen: 'menu', coins: 0, gems: 0, realm: 1, unlockedRealms: [1], bossBeaten: [], loadout: {}, run: null, buttons: [], events: [], secondsLeft: null, checklist: c });
    const env: AgentEnv = { observe: o, execute: async () => { c = ck({ tutorialDone: true }); return { ok: true, note: 'ok' }; }, now: () => 0, log: () => {}, stateKey: () => String(n) };
    const llm = async () => { n++; return n === 1 ? { action: 'finish', outcome: 'goal_met', report: 'x' } : n === 2 ? { action: 'wait', seconds: 1 } : { action: 'finish', outcome: 'goal_met', report: 'done' }; };
    const r = await runAgent('test the tutorial', llm as any, env, { maxSteps: 10, reportMaxChars: 500, sleep: async () => {} } as any);
    expect(r.report).toBe('done');
    expect(n).toBe(3);
  });
});

describe('navigate pages and tags', () => {
  it('parses the new pages', () => {
    for (const p of ['settings', 'tutorial', 'codex', 'leaderboard']) expect(parseAction({ action: 'navigate', page: p })).toMatchObject({ page: p });
    expect(parseAction({ action: 'navigate', page: 'profile' })).toBeNull();
  });
  it('menus carry the data-ap tags navigate uses', () => {
    const menu = read('components/main-menu/main-menu.component.ts');
    for (const t of ['open-settings', 'open-codex', 'open-leaderboard']) expect(menu).toContain(`data-ap="${t}"`);
    const st = read('pages/settings/settings.component.ts');
    expect(st).toContain('data-ap="replay-tutorial"'); expect(st).toContain('data-ap="settings-close"');
    const tut = read('pages/tutorial/tutorial.component.ts');
    for (const t of ['tut-next', 'tut-finish', 'tut-skip-step', 'tut-skip-all']) expect(tut).toContain(`data-ap="${t}"`);
    expect(tut).toContain('attachTutorial(this)');
  });
  it('die on purpose makes the pilot passive and the tutorial has a gesture driver', () => {
    const svc = read('autoplay/autoplay.service.ts');
    expect(svc).toMatch(/this\.passive = until === 'death' && aggression <= 0\.05/);
    expect(svc).toMatch(/!this\.playing \|\| this\.passive\) return/);
    for (const g of ['steer', 'slot-tap', 'hold', 'dash', 'roll', 'brake', 'glide', 'spark', 'pickups']) expect(svc).toContain(`case '${g}'`);
  });
  it('tutorial ability slots shrink below 380 px so all four fit', () => {
    const tut = read('pages/tutorial/tutorial.component.ts');
    expect(tut).toContain('w-12 h-12 min-[380px]:w-14');
  });
});
