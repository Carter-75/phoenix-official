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

/** Screens the checklist tracks (overlays count as screens). */
export const CHECK_SCREENS = ['menu', 'shop', 'settings', 'codex', 'leaderboard', 'tutorial', 'game', 'pause'];
export const NAV_PAGES = ['menu', 'shop', 'settings', 'tutorial', 'codex', 'leaderboard'] as const;
export type NavPage = typeof NAV_PAGES[number];

/** Code-tracked progress the AI must satisfy before goal_met is accepted. */
export interface Checklist {
  visited: string[]; notVisited: string[];
  deaths: number; buys: number;
  retriedAfterDeath: boolean; retriedAfterBuy: boolean;
  tutorialDone: boolean; tutorialPassed: number; tutorialSkipped: number;
  uiFindings: number; bugs: number;
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
  /** Per-screen manifest: valid actions, controls and how-tos. */
  guide?: import('./screen-manifest').ScreenManifest;
  /** Code-verified things done this session (purchases, runs). */
  progress?: string[];
  checklist?: Checklist;
}

export type AgentAction =
  | { action: 'tap_button'; id: string; why?: string; allowGems?: boolean; gemQuote?: string }
  | { action: 'select_realm'; realm: number; why?: string }
  | { action: 'navigate'; page: NavPage; why?: string }
  | { action: 'start_run'; mode: 'campaign' | 'endless' | 'battle'; realm?: number; why?: string }
  | { action: 'play'; seconds: number; until?: 'time' | 'death' | 'run_end'; aggression?: number; abilities?: boolean; why?: string }
  | { action: 'use_ability'; slot: 'tap' | 'double' | 'triple' | 'hold'; why?: string }
  | { action: 'wait'; seconds: number; why?: string }
  | { action: 'finish'; report: string; outcome?: 'goal_met' | 'impossible'; reason?: string };

export interface StepResult { ok: boolean; note: string; }

export interface AgentEnv {
  observe(): Observation;
  execute(a: AgentAction): Promise<StepResult>;
  now(): number;
  log(kind: string, text: string): void;
  /** True while a manual touch has the AI paused; the loop waits, it never ends. */
  isPaused?(): boolean;
  /** Compact state key (screen, realm, coins, loadout, run) for loop detection. */
  stateKey?(): string;
}

/** A finish that only asks the tester something is not a real finish. */
/** goal_met while a gameplay goal's run is still live is premature: keep playing. */
export const GAMEPLAY_RE = /surviv|speed|realms|\bdie\b|death|clear|beat|\bwin\b|\bplay\b|boss|minutes?/i;

export function prematureGoal(a: { outcome?: string }, obs: Observation, prompt: string, played = true): boolean {
  if (a.outcome !== 'goal_met') return false;
  if (!GAMEPLAY_RE.test(prompt)) return false;
  if (!played) return true;
  return !!obs.run && !obs.run.ended;
}

const MENU_SCREENS = ['menu', 'shop', 'settings', 'codex', 'leaderboard'];
/** Screens a prompt needs visited: "every menu" means all menu screens; a UI bug hunt means the named ones (or all menus). */
export function requiredScreens(prompt: string): string[] {
  const p = prompt.toLowerCase();
  const every = /\b(every|all)\b[^.]*\b(menus?|screens?|pages?)\b/.test(p);
  const hunt = /\bbugs?\b|\bui\b|layout|overlap/.test(p);
  if (every) return [...MENU_SCREENS];
  if (!hunt) return [];
  const named = MENU_SCREENS.filter(x => new RegExp(`\\b${x}\\b`).test(p));
  return named.length ? named : [...MENU_SCREENS];
}

/** Sub-goals of the prompt that code has not verified yet (empty: goal_met may stand). */
/** The realm a prompt names first ("start realm 1, ..."), 1-based, or null. */
export function promptRealm(prompt: string): number | null {
  const m = /\b(?:realm|world)\s*(\d{1,2})\b/i.exec(prompt) || /\b(\d{1,2})(?:st|nd|rd|th)\s+realm\b/i.exec(prompt);
  const n = m ? parseInt(m[1], 10) : NaN;
  return n >= 1 && n <= 10 ? n : null;
}

export function unmetSubgoals(prompt: string, c: Checklist | undefined): string[] {
  if (!c) return [];
  const p = prompt.toLowerCase(), out: string[] = [];
  const die = /\bdie\b|\bdeath\b|get killed|on purpose/.test(p) && !/no deaths?|without dying|don.t die|survive/.test(p);
  const buy = /\bbuy\b|\bpurchase\b/.test(p);
  const retry = /\bretry\b|try again|\bagain\b/.test(p);
  if (die && c.deaths < 1) out.push('die: no death recorded yet (start_run, then play until death with aggression 0 so the pilot stops dodging)');
  if (die && buy && c.buys < 1) out.push('buy: no verified purchase yet (navigate shop, tap a buy- button you can afford)');
  if (retry && !(buy ? c.retriedAfterBuy : c.retriedAfterDeath)) out.push(buy ? 'retry: no run started after the purchase yet (start_run)' : 'retry: no run started after the death yet (start_run)');
  if (/tutorial/.test(p) && !c.tutorialDone) out.push('tutorial: not completed (navigate tutorial, then play until it returns to the menu)');
  const need = requiredScreens(prompt).filter(x => !c.visited.includes(x));
  if (need.length) out.push(`screens not visited yet: ${need.join(', ')} (navigate each once)`);
  return out;
}

export function finishIsQuestion(a: { report: string; outcome?: string }): boolean {
  if (a.outcome === 'goal_met' || a.outcome === 'impossible') return false;
  return true;
}

/** Same action 3x with no state change, or 6 steps with no progress. */
export const LOOP_REPEAT = 3;
export const NO_PROGRESS_STEPS = 6;

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
    case 'navigate': return (NAV_PAGES as readonly string[]).includes(r.page) ? { action: 'navigate', page: r.page, why } : null;
    case 'start_run': return r.mode === undefined || ['campaign', 'endless', 'battle'].includes(r.mode) ? { action: 'start_run', mode: r.mode ?? 'campaign', realm: r.realm === undefined ? undefined : Math.round(num(r.realm, 1, 10, 1)), why } : null;
    case 'play': return { action: 'play', seconds: num(r.seconds, 1, MAX_PLAY_SECONDS, 60), until: ['time', 'death', 'run_end'].includes(r.until) ? r.until : 'run_end', aggression: num(r.aggression, 0, 1, 0.5), abilities: r.abilities !== false, why };
    case 'use_ability': return ['tap', 'double', 'triple', 'hold'].includes(r.slot) ? { action: 'use_ability', slot: r.slot, why } : null;
    case 'wait': return { action: 'wait', seconds: num(r.seconds, 0.2, 10, 1), why };
    case 'finish': return { action: 'finish', report: String(r.report ?? '').replace(/\u2014|\u2013/g, '-'),
      outcome: r.outcome === 'goal_met' || r.outcome === 'impossible' ? r.outcome : undefined,
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 300) : undefined };
  }
  return null;
}

/**
 * Hard safety rails, code only. Real money and ads are never allowed.
 * Gems only when the LLM explicitly claims permission AND cites a
 * quote that appears verbatim in the tester's prompt and mentions gems.
 */
/** "buy one thing", "buy 1 upgrade", "a single item": the prompt caps purchases at one. */
export function singlePurchasePrompt(prompt: string): boolean {
  return /\b(buy|purchase|get)\s+(only\s+)?(one|1|a single|a|an)\s+(\w+\s+)?(thing|upgrade|item|stat|level)\b/i.test(prompt) || /\bbuy\s+(one|1)\b/i.test(prompt);
}

export function railCheck(a: AgentAction, obs: Observation, prompt: string): string | null {
  if (a.action !== 'tap_button') return null;
  const tb = obs.buttons.find(x => x.id === a.id);
  const isBuy = a.id.startsWith('buy-') || tb?.currency === 'coins' || tb?.currency === 'gems';
  if (isBuy && singlePurchasePrompt(prompt) && (obs.progress || []).some(p => /^- (?!PROBLEM)/.test(p)))
  {
    const todo = unmetSubgoals(prompt, obs.checklist);
    return todo.length
      ? `the prompt asked for one purchase and it is already done; next: ${todo.join('; ')}`
      : 'the prompt asked for one purchase and it is already done (see progress): call finish goal_met now';
  }
  const b = obs.buttons.find(x => x.id === a.id);
  if (!b) return `no visible button "${a.id}"`;
  if (!b.enabled) return `button "${a.id}" is disabled`;
  if (b.currency === 'money') return 'real-money purchases are never allowed';
  if (b.currency === 'ad') return 'ads are never allowed during autoplay';
  if (b.currency === 'gems') {
    if (gemsAllowedByPrompt(prompt)) return null;
    if (!a.allowGems || !a.gemQuote) return 'gem spending needs explicit permission in the prompt (cite it in gemQuote)';
    if (!gemQuoteValid(a.gemQuote, prompt)) return 'gemQuote is not a gem permission found in the prompt';
  }
  return null;
}

/** The prompt itself grants gem spending (e.g. "you may spend gems"). */
export function gemsAllowedByPrompt(prompt: string): boolean {
  const p = prompt.toLowerCase();
  if (/\b(don'?t|do not|never|no)\b[^.]*\bgems?\b/.test(p)) return false;
  return /\b(may|can|allowed to|ok to|okay to|feel free to)\s+(spend|use)\s+(my\s+|the\s+|some\s+)?gems?\b/.test(p) || /\b(spend|use)\s+(my\s+|the\s+)?gems?\b/.test(p);
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
  let badReplies = 0, rateHits = 0, finalCall = false, step = 0, played = false, impossibleRejected = 0;
  let lastKey = env.stateKey?.() ?? '', lastLabel = '', repeat = 0, noProgress = 0;
  while (step < maxSteps) {
    step++;
    if (opt.shouldStop?.()) return { report: null, endReason: 'Stopped by tester', steps: step - 1 };
    // A manual touch only pauses: wait here, never end the session.
    if (env.isPaused?.()) {
      while (env.isPaused?.() && !opt.shouldStop?.()) await sleep(250);
      if (opt.shouldStop?.()) return { report: null, endReason: 'Stopped by tester', steps: step - 1 };
    }
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
    if (a.action === 'finish' && !finalCall && finishIsQuestion(a)) {
      env.log('safety', 'AI tried to finish without meeting the goal (asked the tester instead). Autoplay is autonomous; continuing.');
      history.push({ step, action: 'finish', ok: false, note: 'REJECTED: you are autonomous and must never ask the tester anything. Keep working toward the goal. Only finish with outcome "goal_met", or "impossible" plus a reason.' });
      continue;
    }
    if (a.action === 'finish' && !finalCall && impossibleRejected < 3 && a.outcome === 'impossible' && (GAMEPLAY_RE.test(prompt) || requiredScreens(prompt).some(x => !(obs.checklist?.visited || []).includes(x)))) {
      impossibleRejected++;
      env.log('safety', 'AI called a gameplay goal impossible; asking it to retry once (a death or empty wallet is not impossible).');
      history.push({ step, action: 'finish', ok: false, note: 'REJECTED once: a gameplay goal is not impossible just because of a KO, 0 coins, or an ended run. Runs earn coins. Tap give-up on KO, then start_run and play again. Only call impossible again if truly blocked.' });
      continue;
    }
    if (a.action === 'finish' && !finalCall && prematureGoal(a, obs, prompt, played)) {
      env.log('safety', 'AI claimed goal_met while the run is still live; continuing.');
      history.push({ step, action: 'finish', ok: false, note: 'REJECTED: the prompt is a gameplay goal and it is not done yet (no run played, or the run is still live). Use start_run and play. Use play (until run_end or death). If the phoenix is down, tap give-up, then shop/upgrade and start_run again as the prompt says.' });
      continue;
    }
    if (a.action === 'finish' && !finalCall && a.outcome === 'goal_met') {
      const unmet = unmetSubgoals(prompt, obs.checklist);
      if (unmet.length) {
        env.log('safety', `AI claimed goal_met but code has not verified: ${unmet.join('; ')}. Continuing.`);
        history.push({ step, action: 'finish', ok: false, note: `REJECTED: not verified by code yet: ${unmet.join('; ')}` });
        continue;
      }
    }
    if (a.action === 'finish') {
      env.log('ai', `AI finished the session (${a.outcome || 'time limit'}${a.reason ? `: ${a.reason}` : ''}).`);
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
    if (a.action === 'play') played = true;
    try { res = await env.execute(a); } catch (e: any) { res = { ok: false, note: `executor error: ${String(e?.message || e).slice(0, 160)}` }; }
    env.log(res.ok ? 'done' : 'failed', `${label} -> ${res.note}`);
    history.push({ step, action: label, ok: res.ok, note: res.note.slice(0, 300) });
    const key = env.stateKey?.() ?? '';
    const progressed = key !== lastKey;
    lastKey = key;
    if (progressed) { noProgress = 0; repeat = label === lastLabel ? 1 : 0; }
    else { noProgress++; repeat = label === lastLabel ? repeat + 1 : 1; }
    lastLabel = label;
    if (repeat >= LOOP_REPEAT) {
      const warn = `LOOP: ${label} repeated ${repeat}x with no state change. Do something else. Valid on ${obs.screen}: ${(obs.guide?.valid || []).join(', ')}.`;
      env.log('safety', warn); history.push({ step, action: 'loop warning', ok: false, note: warn }); repeat = 0;
    } else if (noProgress >= NO_PROGRESS_STEPS) {
      const warn = `NO PROGRESS for ${noProgress} steps. Re-read the observation guide.howTo and change approach.`;
      env.log('safety', warn); history.push({ step, action: 'no progress', ok: false, note: warn }); noProgress = 0;
    }
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
