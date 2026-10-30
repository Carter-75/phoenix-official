// The AI agent loop with a mocked LLM and a fake game environment.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAgent, railCheck, gemQuoteValid, parseAction, classifyCurrency, AgentAction, AgentEnv, LlmCall, LlmRequest, Observation, AgentApiError } from '../src/app/autoplay/autoplay-agent';

/** A tiny fake of the menu + shop: coins, gems, a per-realm damage level. */
class FakeGame implements AgentEnv {
  coins = 20000; gems = 50; screen = 'menu'; damage = 1; realm = 1; runs = 0; plays = 0; taps: string[] = [];
  logs: string[] = [];
  t = 0;
  observe(): Observation {
    const buttons = this.screen === 'menu'
      ? [{ id: 'open-shop', label: '+', enabled: true }, { id: 'play', label: 'Play', enabled: true }]
      : this.screen === 'shop'
        ? [{ id: 'buy-damage', label: `${100 * this.damage} 🪙 | Damage Lv ${this.damage}`, enabled: true, cost: 100 * this.damage, currency: 'coins' as const },
           { id: 'b-gem-pack', label: '💎 Buy 30 gems for 200 💎', enabled: true, currency: 'gems' as const },
           { id: 'b-remove-ads', label: 'Remove ads $2.99', enabled: true, currency: 'money' as const },
           { id: 'shop-close', label: 'Back', enabled: true }]
        : [{ id: 'revive-gems', label: 'Revive 💎 10', enabled: true, currency: 'gems' as const }, { id: 'give-up', label: 'Give up', enabled: true }];
    return { screen: this.screen, coins: this.coins, gems: this.gems, realm: this.realm, unlockedRealms: [1, 2], bossBeaten: [], loadout: { damage: this.damage }, run: null, buttons, events: [], secondsLeft: null };
  }
  async execute(a: AgentAction) {
    this.t += 1000;
    if (a.action === 'tap_button') {
      this.taps.push(a.id);
      const c0 = this.coins, l0 = this.damage;
      if (a.id === 'open-shop') { this.screen = 'shop'; return { ok: true, note: 'screen menu -> shop' }; }
      if (a.id === 'shop-close') { this.screen = 'menu'; return { ok: true, note: 'screen shop -> menu' }; }
      if (a.id === 'buy-damage') { this.coins -= 100 * this.damage; this.damage++; return { ok: true, note: `coins ${c0} -> ${this.coins}, realm 1 damage ${l0} -> ${this.damage}` }; }
      if (a.id === 'b-gem-pack') { this.gems -= 200; return { ok: true, note: 'gems spent' }; }
      if (a.id === 'revive-gems') { this.gems -= 10; return { ok: true, note: 'revived' }; }
      return { ok: false, note: 'no visible change' };
    }
    if (a.action === 'start_run') { this.runs++; this.screen = 'game'; return { ok: true, note: 'run started' }; }
    if (a.action === 'play') { this.plays++; this.screen = 'ko'; return { ok: true, note: `played ${a.seconds} s, ended: phoenix is down` }; }
    return { ok: true, note: 'ok' };
  }
  now() { return this.t; }
  log(k: string, t: string) { this.logs.push(`${k}: ${t}`); }
}

/** Mock LLM scripted by a function of what it sees. */
const mock = (fn: (r: LlmRequest, n: number) => unknown): { llm: LlmCall; calls: LlmRequest[] } => {
  const calls: LlmRequest[] = [];
  return { calls, llm: async (r) => { calls.push(JSON.parse(JSON.stringify(r))); return fn(r, calls.length); } };
};
const opts = { deadline: null, reportMaxChars: 2000 };

describe('AI agent loop (mocked LLM)', () => {
  it('"buy one thing once with coins": taps + once, buys once, never plays, balance verified', async () => {
    const g = new FakeGame();
    const { llm, calls } = mock((r) => {
      const o = r.observation;
      const bought = r.history.some(h => h.action === 'tap_button(buy-damage)' && h.ok);
      if (bought) return { action: 'finish', outcome: 'goal_met', report: `Bought damage once. ${r.history.at(-1)!.note}` };
      if (o.screen === 'menu') return { action: 'tap_button', id: 'open-shop' };
      return { action: 'tap_button', id: o.buttons.find(b => b.currency === 'coins' && b.enabled)!.id };
    });
    const out = await runAgent('buy one thing once with coins', llm, g, opts);
    expect(out.endReason).toBe('AI finished');
    expect(g.taps.filter(t => t.startsWith('buy-'))).toEqual(['buy-damage']);
    expect(g.coins).toBe(20000 - 100);
    expect(g.gems).toBe(50);
    expect(g.runs).toBe(0); expect(g.plays).toBe(0);
    expect(out.report).toContain('coins 20000 -> 19900');
    // The LLM saw the verified result of the buy before finishing.
    expect(calls.at(-1)!.history.at(-1)).toMatchObject({ ok: true, action: 'tap_button(buy-damage)' });
    expect(calls[0].observation.coins).toBe(20000);
  });

  it('gameplay prompts start a run and hand flight to the pilot', async () => {
    const g = new FakeGame();
    const { llm } = mock((r, n) => n === 1 ? { action: 'start_run', mode: 'campaign', realm: 1 }
      : n === 2 ? { action: 'play', seconds: 120, until: 'run_end' }
      : r.observation.screen === 'ko' && n === 3 ? { action: 'tap_button', id: 'give-up' }
      : { action: 'finish', outcome: 'goal_met', report: 'Played one run.' });
    const out = await runAgent('play realm 1 for 2 minutes', llm, g, opts);
    expect(g.runs).toBe(1); expect(g.plays).toBe(1);
    expect(g.gems).toBe(50);
    expect(out.report).toBe('Played one run.');
  });

  it('refuses gem spending without a quoted permission, and always refuses real money', async () => {
    const g = new FakeGame(); g.screen = 'shop';
    const { llm, calls } = mock((_r, n) => n === 1 ? { action: 'tap_button', id: 'b-gem-pack' }
      : n === 2 ? { action: 'tap_button', id: 'b-gem-pack', allowGems: true, gemQuote: 'you may spend gems' }
      : n === 3 ? { action: 'tap_button', id: 'b-remove-ads' }
      : { action: 'finish', outcome: 'goal_met', report: 'done' });
    await runAgent('buy some upgrades', llm, g, opts);
    expect(g.gems).toBe(50);
    expect(g.taps).toEqual([]);
    expect(calls[3].history.map(h => h.note)).toEqual([
      expect.stringContaining('BLOCKED: gem spending needs explicit permission'),
      expect.stringContaining('BLOCKED: gemQuote is not a gem permission'),
      expect.stringContaining('BLOCKED: real-money purchases are never allowed'),
    ]);
  });

  it('allows gems only when the quote really is in the prompt', async () => {
    const g = new FakeGame(); g.screen = 'ko';
    const prompt = 'Clear realm 2. You can use gems to revive.';
    const { llm } = mock((_r, n) => n === 1 ? { action: 'tap_button', id: 'revive-gems', allowGems: true, gemQuote: 'you can use gems to revive' } : { action: 'finish', outcome: 'goal_met', report: 'ok' });
    await runAgent(prompt, llm, g, opts);
    expect(g.gems).toBe(40);
  });

  it('API failure stops with a clear error and no fallback actions', async () => {
    const g = new FakeGame();
    const llm: LlmCall = async () => { throw new AgentApiError('no_key'); };
    const out = await runAgent('buy one thing once with coins', llm, g, opts);
    expect(out.error).toBe('no_key');
    expect(out.report).toBeNull();
    expect(g.taps).toEqual([]);
    expect(g.logs.join('\n')).toMatch(/AI planner unavailable \(no_key\).*no offline fallback/);
  });

  it('time limit forces a final finish call', async () => {
    const g = new FakeGame();
    const { llm, calls } = mock((r) => r.history.some(h => h.action === 'time limit') ? { action: 'finish', outcome: 'goal_met', report: 'out of time' } : { action: 'wait', seconds: 1 });
    const out = await runAgent('just wait', llm, g, { deadline: 3000, reportMaxChars: 100 });
    expect(out.report).toBe('out of time');
    expect(calls.length).toBeLessThan(10);
  });

  it('report is capped and em dashes removed', async () => {
    const g = new FakeGame();
    const out = await runAgent('x', async () => ({ action: 'finish', outcome: 'goal_met', report: 'a \u2014 b ' + 'z'.repeat(5000) }), g, { deadline: null, reportMaxChars: 300 });
    expect(out.report!.length).toBe(300);
    expect(out.report).not.toContain('\u2014');
  });
});

describe('agent rails and parsing', () => {
  it('gem quote must mention gems and appear in the prompt', () => {
    expect(gemQuoteValid('use gems', 'feel free to use gems')).toBe(true);
    expect(gemQuoteValid('feel free', 'feel free to use gems')).toBe(false);
    expect(gemQuoteValid('spend gems', 'do not spend coins')).toBe(false);
  });
  it('classifies currencies', () => {
    expect(classifyCurrency('Remove Ads $2.99', '')).toBe('money');
    expect(classifyCurrency('Watch ad for 2x', '')).toBe('ad');
    expect(classifyCurrency('Revive 💎 10', 'revive-gems')).toBe('gems');
    expect(classifyCurrency('120 🪙', 'buy-damage')).toBe('coins');
  });
  it('rejects unknown or malformed actions', () => {
    expect(parseAction({ action: 'spend_all' })).toBeNull();
    expect(parseAction({ action: 'tap_button' })).toBeNull();
    expect(parseAction({ action: 'play', seconds: 99999 })).toMatchObject({ seconds: 600 });
  });
  it('disabled or missing buttons are blocked', () => {
    const o: Observation = { screen: 'shop', coins: 0, gems: 0, realm: 1, unlockedRealms: [1], bossBeaten: [], loadout: {}, run: null, buttons: [{ id: 'buy-damage', label: '100', enabled: false }], events: [], secondsLeft: null };
    expect(railCheck({ action: 'tap_button', id: 'buy-damage' }, o, '')).toMatch(/disabled/);
    expect(railCheck({ action: 'tap_button', id: 'nope' }, o, '')).toMatch(/no visible button/);
  });
});

describe('no local decision making remains', () => {
  const app = (p: string) => resolve(__dirname, '../src/app', p);
  it('intent parser and local report writer are gone', () => {
    const intent = readFileSync(app('autoplay/autoplay-intent.ts'), 'utf8');
    expect(intent).not.toMatch(/parseIntent|planFromRemote/);
    const svc = readFileSync(app('autoplay/autoplay.service.ts'), 'utf8');
    expect(svc).not.toMatch(/parseIntent|buildReport|local parser|\/plan`|\/report`|\/advise`/);
    expect(svc).toContain('/step');
    expect(readFileSync(app('autoplay/autoplay-report.ts'), 'utf8')).not.toMatch(/export function buildReport/);
    expect(existsSync(app('autoplay/autoplay-agent.ts'))).toBe(true);
  });
});

import { stepCapFor, MAX_STEPS, RATE_LIMIT_BACKOFF_MS } from '../src/app/autoplay/autoplay-agent';
import { pickupWeight } from '../src/app/autoplay/autoplay-pilot';

describe('step cap scales with the chosen duration', () => {
  it('maps duration to a cap; Infinite has none', () => {
    expect(stepCapFor(null)).toBe(Infinity);
    expect(stepCapFor(60_000)).toBe(MAX_STEPS);
    expect(stepCapFor(10 * 60_000)).toBe(400);
    expect(stepCapFor(60 * 60_000)).toBe(2400);
  });
  it('infinite sessions run past the old 80-step cap until stopped', async () => {
    const g = new FakeGame();
    let n = 0;
    const out = await runAgent('wait around', async () => { n++; return { action: 'wait', seconds: 0 }; }, g,
      { ...opts, maxSteps: stepCapFor(null), shouldStop: () => n >= 200 });
    expect(out.endReason).toBe('Stopped by tester');
    expect(out.steps).toBeGreaterThan(MAX_STEPS);
  });
  it('a finite cap still stops the run', async () => {
    const g = new FakeGame();
    const out = await runAgent('wait', async () => ({ action: 'wait', seconds: 0 }), g, { ...opts, maxSteps: 5 });
    expect(out.endReason).not.toBe('AI finished');
    expect(out.steps).toBeLessThanOrEqual(5);
  });
  it('rate_limited backs off and retries without using a step', async () => {
    const g = new FakeGame();
    const waits: number[] = [];
    let n = 0;
    const out = await runAgent('x', async () => { n++; if (n <= 2) throw new AgentApiError('rate_limited'); return { action: 'finish', outcome: 'goal_met', report: 'ok' }; }, g,
      { ...opts, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([RATE_LIMIT_BACKOFF_MS, RATE_LIMIT_BACKOFF_MS]);
    expect(out.endReason).toBe('AI finished');
    expect(out.steps).toBe(1);
  });
});

describe('pilot item priorities', () => {
  it('wants Spark Cells most when stamina is low and hearts when hurt', () => {
    expect(pickupWeight('spark_cell', 0.1, 1)).toBeGreaterThan(pickupWeight('spark_cell', 0.9, 1));
    expect(pickupWeight('spark_cell', 0.1, 1)).toBeGreaterThan(pickupWeight('coin', 0.1, 1));
    expect(pickupWeight('heart', 1, 0.3)).toBeGreaterThan(pickupWeight('heart', 1, 1));
    expect(pickupWeight('overcharge', 1, 1)).toBeGreaterThan(pickupWeight('coin', 1, 1));
  });
});
