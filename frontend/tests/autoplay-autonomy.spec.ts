// Autonomy rails: manifest, forgiving actions, loop detection, no asking, pause never ends.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gemsAllowedByPrompt, runAgent, parseAction, type AgentEnv, type Observation, type AgentAction } from '../src/app/autoplay/autoplay-agent';
import { buildManifest, validActionsFor, CONTROL_HELP } from '../src/app/autoplay/screen-manifest';

const svc = readFileSync(resolve(__dirname, '../src/app/autoplay/autoplay.service.ts'), 'utf8');
const obs = (screen = 'menu'): Observation => ({ screen, coins: 0, gems: 0, realm: 1, unlockedRealms: [1], bossBeaten: [], loadout: {}, run: null, buttons: [], events: [], secondsLeft: null, guide: buildManifest(screen, 1, []) });
function env(over: Partial<AgentEnv> = {}, logs: string[] = []): AgentEnv {
  return { observe: () => obs(), execute: async () => ({ ok: true, note: 'ok' }), now: () => 0, log: (k, t) => logs.push(`${k}: ${t}`), stateKey: () => 'same', ...over };
}
const script = (acts: any[]) => { let i = 0; const seen: any[] = []; const f = async (r: any) => { seen.push(r); return acts[Math.min(i++, acts.length - 1)]; }; return Object.assign(f, { seen }); };

describe('screen manifest', () => {
  it('lists valid actions per screen and describes real controls', () => {
    expect(validActionsFor('menu')).toContain('start_run');
    expect(validActionsFor('shop')).toContain('select_realm');
    expect(validActionsFor('menu')).not.toContain('play');
    const m = buildManifest('shop', 2, ['buy-damage', 'shop-close', 'b-unknown']);
    expect(Object.keys(m.controls)).toEqual(['buy-damage', 'shop-close']);
    expect(m.howTo).toMatch(/switch realm/);
    expect(JSON.stringify(m).length).toBeLessThan(1200);
  });
  it('every documented control tag exists in a template', () => {
    const all = ['components/main-menu/main-menu.component.ts', 'pages/shop/shop.component.ts', 'pages/game/game.component.ts']
      .map(p => readFileSync(resolve(__dirname, '../src/app', p), 'utf8')).join('\n');
    for (const t of Object.keys(CONTROL_HELP)) expect(all, t).toContain(`data-ap="${t}"`);
  });
  it('the observation carries the guide', () => expect(svc).toMatch(/guide: buildManifest\(/));
});

describe('forgiving actions', () => {
  it('navigate to the current screen is a no-progress no-op', () => expect(svc).toMatch(/already on \$\{a\.page\}, do something else/));
  it('start_run auto-navigates to the menu and selects the realm', () => {
    const body = svc.slice(svc.indexOf("case 'start_run'"), svc.indexOf("case 'play':"));
    expect(body).toMatch(/navigate', page: 'menu'/);
    expect(body).toMatch(/select_realm', realm: a\.realm/);
    expect(body).not.toMatch(/start_run needs the menu screen/);
  });
  it('select_realm works from the shop', () => expect(svc).toMatch(/fromShop/));
});

describe('loop detection', () => {
  it('warns after 3 identical no-change actions, then on no progress', async () => {
    const llm = script([{ action: 'navigate', page: 'shop' }]);
    const logs: string[] = [];
    await runAgent('p', llm, env({}, logs), { deadline: null, reportMaxChars: 500, maxSteps: 8 });
    expect(logs.some(l => /LOOP: navigate\(shop\) repeated 3x/.test(l))).toBe(true);
    const last = llm.seen[llm.seen.length - 1].history.map((h: any) => h.note).join(' ');
    expect(last).toMatch(/Do something else\. Valid on menu: select_realm, start_run/);
  });
  it('no warning while state changes', async () => {
    let n = 0; const logs: string[] = [];
    await runAgent('p', script([{ action: 'wait', seconds: 1 }]), env({ stateKey: () => String(n++) }, logs), { deadline: null, reportMaxChars: 500, maxSteps: 8 });
    expect(logs.some(l => /LOOP|NO PROGRESS/.test(l))).toBe(false);
  });
});

describe('never asks the user', () => {
  it('rejects a finish without goal_met/impossible and keeps going', async () => {
    const llm = script([{ action: 'finish', report: 'What would you like me to do?' }, { action: 'wait', seconds: 1 }, { action: 'finish', outcome: 'goal_met', report: 'done' }]);
    const out = await runAgent('p', llm, env(), { deadline: null, reportMaxChars: 500, maxSteps: 10 });
    expect(out.endReason).toBe('AI finished');
    expect(out.report).toBe('done');
    expect(llm.seen[1].history.at(-1).note).toMatch(/never ask the tester/);
  });
  it('accepts impossible with a reason', async () => {
    const out = await runAgent('p', script([{ action: 'finish', outcome: 'impossible', reason: 'realm locked', report: 'r' }]), env(), { deadline: null, reportMaxChars: 500, maxSteps: 3 });
    expect(out.endReason).toBe('AI finished');
  });
  it('parses outcome and reason', () => {
    const a = parseAction({ action: 'finish', outcome: 'goal_met', reason: 'x', report: 'y' }) as Extract<AgentAction, { action: 'finish' }>;
    expect(a.outcome).toBe('goal_met'); expect(a.reason).toBe('x');
  });
});

describe('manual touch pause', () => {
  it('waits while paused and resumes; a pause never ends the session', async () => {
    let paused = true, t = 0; const logs: string[] = [];
    const sleep = async () => { t++; if (t > 5) paused = false; };
    const llm = script([{ action: 'finish', outcome: 'goal_met', report: 'ok' }]);
    const out = await runAgent('p', llm, env({ isPaused: () => paused }, logs), { deadline: null, reportMaxChars: 500, maxSteps: 3, sleep });
    expect(t).toBeGreaterThan(5);
    expect(llm.seen.length).toBe(1);
    expect(out.endReason).toBe('AI finished');
  });
  it('resumes after a few seconds without touch', () => expect(svc).toMatch(/this\.paused\.set\(false\); this\.log\('safety', 'Resuming AI play\.'\)/));
});

import { singlePurchasePrompt, railCheck } from '../src/app/autoplay/autoplay-agent';
describe('single purchase prompts', () => {
  it('detects "buy one" prompts', () => {
    for (const p of ['buy one upgrade with coins', 'buy one thing with coins', 'Buy 1 item', 'buy a single upgrade']) expect(singlePurchasePrompt(p), p).toBe(true);
    for (const p of ['buy upgrades until broke', 'speed-run all 10 realms, upgrade on death']) expect(singlePurchasePrompt(p), p).toBe(false);
  });
  it('blocks a second buy after one verified purchase', () => {
    const o = { ...obs('shop'), buttons: [{ id: 'buy-health', label: 'x', enabled: true, currency: 'coins' as const }] };
    expect(railCheck({ action: 'tap_button', id: 'buy-health' }, o, 'buy one upgrade')).toBeNull();
    expect(railCheck({ action: 'tap_button', id: 'buy-health' }, { ...o, progress: ['- buy-damage: coins 500 -> 250 (verified by code)'] }, 'buy one upgrade')).toMatch(/already done/);
  });
});

import { prematureGoal } from '../src/app/autoplay/autoplay-agent';
describe('premature goal_met', () => {
  const live = { ...obs('game'), run: { mode: 'campaign', hp: 0, maxHp: 100, stamina: 0, timeLeft: 100, phase: 'survive', dead: true, ended: false, won: false } };
  it('rejects goal_met in a live run for gameplay prompts', () => {
    expect(prematureGoal({ outcome: 'goal_met' }, live, 'survive 2 minutes in realm 3')).toBe(true);
    expect(prematureGoal({ outcome: 'goal_met' }, live, 'switch to realm 1 and start a run')).toBe(false);
    expect(prematureGoal({ outcome: 'impossible' }, live, 'survive 2 minutes')).toBe(false);
    expect(prematureGoal({ outcome: 'goal_met' }, { ...live, run: { ...live.run, ended: true } }, 'survive 2 minutes')).toBe(false);
  });
  it('gem icon buttons are classified as gems', () => expect(svc).toMatch(/img\[src\*="gem"\]/));
  it('wait in a live run flies instead of standing still', () => expect(svc).toMatch(/wait flies with the pilot/));
  it('prompt-level gem permission is honored, negations are not', () => {
    expect(gemsAllowedByPrompt('buy one upgrade. you may spend gems if coins are short')).toBe(true);
    expect(gemsAllowedByPrompt('buy an upgrade, do not spend gems')).toBe(false);
    expect(gemsAllowedByPrompt('buy an upgrade')).toBe(false);
  });
  it('goal_met before any run is premature for gameplay prompts', () => {
    expect(prematureGoal({ outcome: 'goal_met' }, { ...live, run: undefined } as any, 'die on purpose, then retry', false)).toBe(true);
    expect(prematureGoal({ outcome: 'goal_met' }, { ...live, run: undefined } as any, 'buy one upgrade', false)).toBe(false);
  });
  it('a gameplay impossible is rejected once, then accepted', async () => {
    const logs: string[] = [];
    const imp = { action: 'finish', outcome: 'impossible', reason: 'KO', report: 'r' } as AgentAction;
    const out = await runAgent('survive 2 minutes', script([imp, imp]), env({}, logs), { deadline: null, reportMaxChars: 500, maxSteps: 5 });
    expect(logs.join('\n')).toMatch(/impossible; asking it to retry once/);
    expect(out.report).toBeTruthy();
  });
  it('start_run without a mode defaults to campaign', () => {
    expect(parseAction({ action: 'start_run', realm: 3 })).toMatchObject({ action: 'start_run', mode: 'campaign', realm: 3 });
  });
});
