// AI Autoplay agent loop (Oct 30, 2026, Carter: "pure AI").
//
// The LLM (backend /autoplay/step, OPENAI_MODEL) decides EVERY action:
// whether to play at all, what to buy or equip, which screens to
// open, retries, and the final report. Code only (1) builds a compact
// observation of the live screen, (2) executes the chosen action and
// verifies it happened, and (3) enforces hard safety rails. There is
// no local intent parser and no local fallback: when the API fails,
// the loop stops with a clear error.
//
// Pure TypeScript (no Angular): the service supplies the LLM call and
// the environment; unit tests supply mocks.

export interface ObsButton {
  id: string;
  label: string;
  enabled: boolean;
  /** Price parsed from the label when one is shown ("120" coins etc). */
  cost?: number;
  currency?: 'coins' | 'gems' | 'money' | 'ad';
}

export interface Observation {
  screen: string;
  coins: number;
  gems: number;
  realm: number;               // 1-based selected realm
  unlockedRealms: number[];
  bossBeaten: number[];
  loadout: Record<string, number | string | null>;
  run: null | { mode: string; hp: number; maxHp: number; stamina: number; timeLeft: number; phase: string; dead: boolean; ended: boolean; won: boolean };
  buttons: ObsButton[];
  events: string[];
  secondsLeft: number | null;
}

export type AgentAction =
  | { action: 'tap_button'; id: string; why?: string; allowGems?: boolean; gemQuote?: string }
  | { action: 'select_realm'; realm: number; why?: string }
  | { action: 'navigate'; page: 'menu' | 'shop'; why?: string }
  | { action: 'start_run'; mode: 'campaign' | 'endless' | 'battle'; realm?: number; why?: string }
  | { action: 'play'; seconds: number; until?: 'time' | 'death' | 'run_end'; aggression?: number; abilities?: boolean; why?: string }
  | { action: 'use_ability'; slot: 'tap' | 'double' | 'triple' | 'hold'; why?: string }
  | { action: 'wait'; seconds: number; why?: string }
  | { action: 'finish'; report: string };

export interface StepResult { ok: boolean; note: string; }

export interface AgentEnv {
  observe(): Observation;
  execute(a: AgentAction): Promise<StepResult>;
  now(): number;
  log(kind: string, text: string): void;
}

export interface HistoryItem { step: number; action: string; ok: boolean; note: string; }

export interface LlmRequest { prompt: string; observation: Observation; history: HistoryItem[]; step: number; maxSteps: number; reportMaxChars: number; }
export type LlmCall = (req: LlmRequest) => Promise<unknown>;

export const MAX_STEPS = 80;
export const HISTORY_KEEP = 14;
export const MAX_PLAY_SECONDS = 600;

export class AgentApiError extends Error {
  constructor(public code: string) { super(`AI planner unavailable (${code})`); }
}

const ACTIONS = ['tap_button', 'select_realm', 'navigate', 'start_run', 'play', 'use_ability', 'wait', 'finish'];

/** Shape-check one LLM reply into an AgentAction, or null. */
export function parseAction(raw: unknown): AgentAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r: any = raw;
  if (!ACTIONS.includes(r.action)) return null;
  const why = typeof r.why === 'string' ? r.why.slice(0, 200) : undefined;
  const num = (v: any, lo: number, hi: number, d: number) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d;
  switch (r.action) {
    case 'tap_button': return typeof r.id === 'string' && r.id ? { action: 'tap_button', id: r.id.slice(0, 80), why, allowGems: r.allowGems === true, gemQuote: typeof r.gemQuote === 'string' ? r.gemQuote.slice(0, 300) : undefined } : null;
    case 'select_realm': return { action: 'select_realm', realm: Math.round(num(r.realm, 1, 10, 1)), why };
    case 'navigate': return r.page === 'menu' || r.page === 'shop' ? { action: 'navigate', page: r.page, why } : null;
    case 'start_run': return ['campaign', 'endless', 'battle'].includes(r.mode) ? { action: 'start_run', mode: r.mode, realm: r.realm === undefined ? undefined : Math.round(num(r.realm, 1, 10, 1)), why } : null;
    case 'play': return { action: 'play', seconds: num(r.seconds, 1, MAX_PLAY_SECONDS, 60), until: ['time', 'death', 'run_end'].includes(r.until) ? r.until : 'run_end', aggression: num(r.aggression, 0, 1, 0.5), abilities: r.abilities !== false, why };
    case 'use_ability': return ['tap', 'double', 'triple', 'hold'].includes(r.slot) ? { action: 'use_ability', slot: r.slot, why } : null;
    case 'wait': return { action: 'wait', seconds: num(r.seconds, 0.2, 10, 1), why };
    case 'finish': return { action: 'finish', report: String(r.report ?? '').replace(/\u2014|\u2013/g, '-') };
  }
  return null;
}

/**
 * Hard safety rails, code only. Real money and ads are never allowed.
 * Gems only when the LLM explicitly claims permission AND cites a
 * quote that appears verbatim in the tester's prompt and mentions gems.
 */
export function railCheck(a: AgentAction, obs: Observation, prompt: string): string | null {
  if (a.action !== 'tap_button') return null;
  const b = obs.buttons.find(x => x.id === a.id);
  if (!b) return `no visible button "${a.id}"`;
  if (!b.enabled) return `button "${a.id}" is disabled`;
  if (b.currency === 'money') return 'real-money purchases are never allowed';
  if (b.currency === 'ad') return 'ads are never allowed during autoplay';
  if (b.currency === 'gems') {
    if (!a.allowGems || !a.gemQuote) return 'gem spending needs explicit permission in the prompt (cite it in gemQuote)';
    if (!gemQuoteValid(a.gemQuote, prompt)) return 'gemQuote is not a gem permission found in the prompt';
  }
  return null;
}

export function gemQuoteValid(quote: string, prompt: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  return q.length >= 4 && /\bgems?\b/.test(q) && norm(prompt).includes(q);
}

export function describeAction(a: AgentAction): string {
  switch (a.action) {
    case 'tap_button': return `tap_button(${a.id})`;
    case 'select_realm': return `select_realm(${a.realm})`;
    case 'navigate': return `navigate(${a.page})`;
    case 'start_run': return `start_run(${a.mode}${a.realm ? `, realm ${a.realm}` : ''})`;
    case 'play': return `play(${Math.round(a.seconds)} s, until ${a.until}, aggression ${a.aggression})`;
    case 'use_ability': return `use_ability(${a.slot})`;
    case 'wait': return `wait(${a.seconds} s)`;
    case 'finish': return 'finish';
  }
}

export interface AgentOutcome { report: string | null; endReason: string; steps: number; error?: string; }

export interface AgentOptions {
  deadline: number | null; reportMaxChars: number;
  /** Step cap; Infinity means no cap (still rate limited and stoppable). Defaults to stepCapFor(null deadline -> MAX_STEPS). */
  maxSteps?: number; shouldStop?: () => boolean;
  /** Wait helper used to back off on rate_limited; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/** Steps allowed per minute of session; matches the backend's 40/min rate limit. */
export const STEPS_PER_MINUTE = 40;
/** Wait before retrying after the backend says rate_limited. */
export const RATE_LIMIT_BACKOFF_MS = 15_000;
/** Consecutive rate_limited replies tolerated before giving up. */
export const RATE_LIMIT_RETRIES = 8;

/** Step cap for a chosen session length: scales with minutes, Infinite (null) has no cap. */
export function stepCapFor(durationMs: number | null): number {
  if (durationMs === null) return Infinity;
  return Math.max(MAX_STEPS, Math.ceil(durationMs / 60_000) * STEPS_PER_MINUTE);
}

/** The loop: observe, ask the LLM, rail-check, execute and verify, repeat. */
export async function runAgent(prompt: string, llm: LlmCall, env: AgentEnv, opt: AgentOptions): Promise<AgentOutcome> {
  const maxSteps = opt.maxSteps ?? MAX_STEPS;
  const sleep = opt.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const history: HistoryItem[] = [];
  let badReplies = 0, rateHits = 0, finalCall = false, step = 0;
  while (step < maxSteps) {
    step++;
    if (opt.shouldStop?.()) return { report: null, endReason: 'Stopped by tester', steps: step - 1 };
    const obs = env.observe();
    if (opt.deadline !== null) obs.secondsLeft = Math.max(0, Math.round((opt.deadline - env.now()) / 1000));
    let raw: unknown;
    try {
      raw = await llm({ prompt, observation: obs, history: history.slice(-HISTORY_KEEP), step,
        maxSteps: Number.isFinite(maxSteps) ? maxSteps : 0, reportMaxChars: opt.reportMaxChars });
      rateHits = 0;
    } catch (e: any) {
      const code = e instanceof AgentApiError ? e.code : String(e?.message || e || 'request_failed').slice(0, 80);
      if (code === 'rate_limited' && rateHits < RATE_LIMIT_RETRIES) {
        rateHits++; step--;
        env.log('wait', `AI rate limit reached; waiting ${RATE_LIMIT_BACKOFF_MS / 1000} s.`);
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      env.log('error', `AI planner unavailable (${code}). Autoplay stopped; there is no offline fallback.`);
      return { report: null, endReason: 'AI API error', steps: step - 1, error: code };
    }
    if (opt.shouldStop?.()) return { report: null, endReason: 'Stopped by tester', steps: step - 1 };
    const a = parseAction(raw);
    if (!a) {
      badReplies++;
      history.push({ step, action: 'invalid', ok: false, note: 'reply was not a valid action JSON' });
      if (badReplies >= 3) { env.log('error', 'AI returned 3 invalid actions; stopping.'); return { report: null, endReason: 'AI returned invalid actions', steps: step }; }
      continue;
    }
    if (a.action === 'finish') {
      env.log('ai', 'AI finished the session.');
      return { report: a.report.slice(0, opt.reportMaxChars), endReason: 'AI finished', steps: step };
    }
    if (finalCall) return { report: null, endReason: 'Time limit reached without finish', steps: step };
    const blocked = railCheck(a, obs, prompt);
    const label = describeAction(a);
    if (blocked) {
      env.log('safety', `Blocked ${label}: ${blocked}.`);
      history.push({ step, action: label, ok: false, note: `BLOCKED: ${blocked}` });
      continue;
    }
    env.log('ai', `${label}${a.why ? `: ${a.why}` : ''}`);
    let res: StepResult;
    try { res = await env.execute(a); } catch (e: any) { res = { ok: false, note: `executor error: ${String(e?.message || e).slice(0, 160)}` }; }
    env.log(res.ok ? 'done' : 'failed', `${label} -> ${res.note}`);
    history.push({ step, action: label, ok: res.ok, note: res.note.slice(0, 300) });
    if (opt.deadline !== null && env.now() >= opt.deadline) {
      // One last call so the AI still writes the report (allowed even past the step cap).
      opt = { ...opt, deadline: null };
      finalCall = true;
      history.push({ step, action: 'time limit', ok: false, note: 'Time limit reached: call finish now with your report.' });
      if (step >= maxSteps) step = maxSteps - 1;
    }
  }
  return { report: null, endReason: 'Step limit reached without finish', steps: step };
}

/** Tells apart coin, gem, real-money, and ad buttons from their text. */
export function classifyCurrency(text: string, id: string): ObsButton['currency'] | undefined {
  const t = `${text} ${id}`.toLowerCase();
  if (/\$|usd|€|£|subscribe|restore purchase|buy gems|gem pack|iap|remove ads/.test(t)) return 'money';
  if (/\bwatch\b|\bad\b|📺|rewarded/.test(t)) return 'ad';
  if (/💎|\bgems?\b|revive-gems/.test(t)) return 'gems';
  if (/🪙|coins?\b|buy-/.test(t)) return 'coins';
  return undefined;
}

export function parseCost(text: string): number | undefined {
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]) * (m[2]?.toLowerCase() === 'k' ? 1e3 : m[2]?.toLowerCase() === 'm' ? 1e6 : 1);
  return Number.isFinite(n) ? n : undefined;
}
