// Local, offline intent parser for the AI Autoplay tester. Turns a
// natural-language prompt into a strict plan. Constraints (scope,
// allowed deaths, mode, target, retry policy) are parsed and later
// ENFORCED by the runner, never approximated: "finish all realms in
// one run" only counts when realms 1 to 10 are cleared in a single
// attempt with zero deaths; any death fails the attempt, the bot
// upgrades and restarts from the start realm.

export const REALM_COUNT = 10;

export type AutoplayMode = 'campaign' | 'endless' | 'battle';
export type AutoplayGoal = 'clear_through' | 'reach' | 'survive' | 'battle_wins' | 'free_play';
export type AutoplayScope = 'single_run' | 'cumulative';
export type RetryPolicy = 'restart_from_start' | 'retry_realm' | 'stop';

export interface ReportFocus { bugs: boolean; ui: boolean; balance: boolean; bosses: boolean; perf: boolean; }

export interface AutoplayPlan {
  mode: AutoplayMode;
  goal: AutoplayGoal;
  /** 1-based realm the attempt starts in. */
  startRealm: number;
  /** 1-based target realm (clear_through: clear it; reach: enter it). */
  targetRealm: number;
  scope: AutoplayScope;
  /** Deaths allowed per attempt (single_run) or overall (cumulative). null = unlimited. */
  maxDeaths: number | null;
  retryPolicy: RetryPolicy;
  upgradeOnRetry: boolean;
  allowGemRevives: boolean;
  /** Effective time limit in ms, null = infinite. */
  timeLimitMs: number | null;
  /** Endless survive target in seconds (survive goal). */
  surviveSec: number | null;
  /** Battle wins wanted (battle_wins goal). */
  battleWins: number | null;
  report: ReportFocus;
  /** Plain-language read-back of how the prompt was understood. */
  interpretation: string[];
  source: 'local' | 'openai';
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  once: 1, twice: 2, a: 1, an: 1, single: 1, last: 10, final: 10,
};
const NUM = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final)';

function num(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return NUM_WORDS[t] ?? null;
}

const clampRealm = (n: number) => Math.max(1, Math.min(REALM_COUNT, Math.round(n)));

/** Parse a duration phrase. Returns ms, null for infinite, undefined when absent. */
export function parseDuration(text: string): number | null | undefined {
  const t = text.toLowerCase();
  if (/\b(inf|infinite|infinity|forever|no time limit|unlimited time|as long as (it takes|needed|you need)|until (it'?s )?done|no limit)\b/.test(t)) return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?!\s*(deaths?|lives|realms?))/);
  if (!m) return undefined;
  const v = parseFloat(m[1]);
  const u = m[2];
  if (u.startsWith('h')) return Math.round(v * 3600_000);
  if (u.startsWith('s')) return Math.round(v * 1000);
  return Math.round(v * 60_000);
}

/** Combine the prompt's limit and the slider's limit: whichever ends first. */
export function effectiveLimit(promptMs: number | null | undefined, sliderMs: number | null): number | null {
  const vals = [promptMs, sliderMs].filter((v): v is number => typeof v === 'number' && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

export function parseIntent(prompt: string, sliderMs: number | null = null, currentRealm = 1): AutoplayPlan {
  const raw = (prompt || '').trim();
  const t = ' ' + raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
  const why: string[] = [];

  // Mode
  let mode: AutoplayMode = 'campaign';
  if (/\b(battle|pvp|versus|vs\.? ai|duel|rival)\b/.test(t)) mode = 'battle';
  else if (/\b(endless|survival mode|infinite mode|survive mode)\b/.test(t)) mode = 'endless';

  // Scope and deaths
  const oneRun = /\b(in one go|one go|in one run|one run|single run|one attempt|one sitting|in a row|back to back|straight through|without (stopping|a break))\b/.test(t);
  const noDeath = /\b(without (dying|dieing|a death|any deaths?|death|losing a life)|no deaths?|zero deaths?|deathless|flawless|never die|don'?t die|do not die|0 deaths?)\b/.test(t);
  let maxDeaths: number | null = null;
  const md = t.match(new RegExp(`\\b(?:at most|max(?:imum)?|no more than|up to|only)\\s+${NUM}\\s+(?:deaths?|lives|dies)\\b`))
    || t.match(new RegExp(`\\b${NUM}\\s+(?:deaths?|lives)\\s+(?:max|allowed|at most)\\b`))
    || t.match(new RegExp(`\\b(?:with|in)\\s+${NUM}\\s+(?:deaths?|lives)\\b`));
  if (noDeath) maxDeaths = 0;
  else if (md) maxDeaths = num(md[1]);
  else if (oneRun) maxDeaths = 0;
  const scope: AutoplayScope = (oneRun || noDeath || md) ? 'single_run' : 'cumulative';

  // Target
  let goal: AutoplayGoal = 'free_play';
  let startRealm = clampRealm(currentRealm);
  let targetRealm = startRealm;
  const range = t.match(new RegExp(`\\brealms?\\s+${NUM}\\s*(?:-|to|through|thru|until)\\s*(?:realm\\s+)?${NUM}\\b`));
  const fromM = t.match(new RegExp(`\\b(?:from|starting (?:at|in|from)|start (?:at|in|from))\\s+(?:realm|world|level)\\s+${NUM}\\b`));
  const reachM = t.match(new RegExp(`\\b(?:get to|reach|make it to|arrive at|unlock|go to|get into)\\s+(?:the\\s+)?(?:realm|world|level)\\s+${NUM}\\b`))
    || t.match(new RegExp(`\\b(?:get to|reach|make it to)\\s+(?:the\\s+)?${NUM}(?:st|nd|rd|th)?\\s+(?:realm|world|level)\\b`));
  const clearM = t.match(new RegExp(`\\b(?:beat|clear|finish|complete|pass|win|defeat|kill)\\s+(?:the\\s+)?(?:boss (?:of|in)\\s+)?(?:realm|world|level)\\s+${NUM}\\b`))
    || t.match(new RegExp(`\\b(?:beat|clear|finish|complete|pass)\\s+(?:the\\s+)?${NUM}(?:st|nd|rd|th)?\\s+(?:realm|world|level)\\b`));
  const allM = /\b(all (the )?(realms|worlds|levels)|every (realm|world|level)|(beat|finish|complete|clear) the (whole )?game|whole game|entire game|all 10|all ten)\b/.test(t);
  const surviveM = t.match(/\bsurvive\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|seconds?|secs?|s)\b/);
  const winsM = t.match(new RegExp(`\\bwin\\s+${NUM}\\s+(?:matches|battles|games|rounds|times)\\b`));

  let surviveSec: number | null = null;
  let battleWins: number | null = null;

  if (mode === 'battle') {
    if (winsM) { goal = 'battle_wins'; battleWins = num(winsM[1]); }
    else if (/\bwin\b/.test(t)) { goal = 'battle_wins'; battleWins = 1; }
    const br = t.match(new RegExp(`\\b(?:realm|world|arena)\\s+${NUM}\\b`));
    if (br) { startRealm = targetRealm = clampRealm(num(br[1]) || 1); }
  } else if (mode === 'endless' && surviveM) {
    goal = 'survive';
    const v = parseFloat(surviveM[1]);
    surviveSec = surviveM[2].startsWith('s') ? v : v * 60;
    const er = t.match(new RegExp(`\\b(?:realm|world)\\s+${NUM}\\b`));
    if (er) startRealm = targetRealm = clampRealm(num(er[1]) || 1);
  } else if (mode === 'endless') {
    const er = t.match(new RegExp(`\\b(?:realm|world)\\s+${NUM}\\b`));
    if (er) startRealm = targetRealm = clampRealm(num(er[1]) || 1);
  } else if (range) {
    goal = 'clear_through';
    startRealm = clampRealm(num(range[1]) || 1);
    targetRealm = clampRealm(num(range[2]) || REALM_COUNT);
  } else if (allM) {
    goal = 'clear_through'; startRealm = 1; targetRealm = REALM_COUNT;
  } else if (reachM) {
    goal = 'reach'; targetRealm = clampRealm(num(reachM[1]) || 1);
    startRealm = 1;
  } else if (clearM) {
    goal = 'clear_through'; targetRealm = clampRealm(num(clearM[1]) || 1);
    startRealm = scope === 'single_run' ? 1 : targetRealm;
  }
  if (fromM && mode === 'campaign') startRealm = clampRealm(num(fromM[1]) || 1);
  if (targetRealm < startRealm) targetRealm = startRealm;
  if (goal === 'reach' && targetRealm === startRealm) goal = 'clear_through';

  // Retry policy
  let retryPolicy: RetryPolicy = scope === 'single_run' ? 'restart_from_start' : 'retry_realm';
  if (/\b(stop (on|at|after|if) (the )?(first )?death|stop if (you|it) dies?|one (try|attempt) only|just once|don'?t retry|do not retry|no retries)\b/.test(t)) retryPolicy = 'stop';
  if (goal === 'free_play' && !/\b(retry|try again|keep (going|trying)|until)\b/.test(t)) retryPolicy = scope === 'single_run' ? 'restart_from_start' : 'retry_realm';
  const upgradeOnRetry = !/\b(no upgrades?|don'?t upgrade|do not upgrade|without upgrad(ing|es)|no shop(ping)?|don'?t (buy|spend)|do not (buy|spend))\b/.test(t);
  const allowGemRevives = /\b(use gems? (to|for) revive|revive with gems?|gem revives?|spend gems? (on|to|for) revives?)\b/.test(t);

  // Report focus: specific topics narrow it, otherwise everything.
  const focus: ReportFocus = {
    bugs: /\b(bugs?|errors?|crash(es)?|glitch(es)?|broken|issues?|exceptions?|softlocks?)\b/.test(t),
    ui: /\b(ui|ux|polish|layout|overlap|hud|menus?|buttons?|visual)\b/.test(t),
    balance: /\b(balance|difficulty|too hard|too easy|economy|upgrades? cost|tuning)\b/.test(t),
    bosses: /\b(boss(es)?|remake|redo|rework)\b/.test(t),
    perf: /\b(fps|frame ?rate|lag|performance|perf|stutter|jank|slow)\b/.test(t),
  };
  if (!Object.values(focus).some(Boolean)) { focus.bugs = focus.ui = focus.balance = focus.bosses = focus.perf = true; }

  const promptLimit = parseDuration(t.replace(surviveM ? surviveM[0] : '\u0000', ' '));
  const timeLimitMs = promptLimit === null && sliderMs === null ? null : effectiveLimit(promptLimit, sliderMs);

  // Read-back
  const modeName = mode === 'campaign' ? 'Normal' : mode === 'endless' ? 'Endless' : 'Battle';
  why.push(`Mode: ${modeName}.`);
  if (goal === 'clear_through') why.push(`Goal: clear realm ${startRealm === targetRealm ? targetRealm : `${startRealm} through ${targetRealm}`}.`);
  else if (goal === 'reach') why.push(`Goal: reach realm ${targetRealm} starting from realm ${startRealm}.`);
  else if (goal === 'survive') why.push(`Goal: survive ${Math.round(surviveSec || 0)} s in Endless realm ${startRealm}.`);
  else if (goal === 'battle_wins') why.push(`Goal: win ${battleWins} Battle match(es) in realm ${startRealm}.`);
  else why.push(`Goal: free play in realm ${startRealm} until the time limit, testing as it goes.`);
  if (scope === 'single_run') why.push(`Scope: one run. An attempt only counts with ${maxDeaths === 0 ? 'zero deaths' : `at most ${maxDeaths} death(s)`}; on failure it ${retryPolicy === 'stop' ? 'stops' : `upgrades${upgradeOnRetry ? '' : ' (disabled)'} and restarts from realm ${startRealm}`}.`);
  else why.push(`Scope: cumulative progress. ${maxDeaths === null ? 'Deaths allowed' : `Up to ${maxDeaths} death(s) overall`}; on death it ${retryPolicy === 'stop' ? 'stops' : `upgrades${upgradeOnRetry ? '' : ' (disabled)'} and retries the realm it died in`}.`);
  why.push(`Time limit: ${timeLimitMs === null ? 'infinite' : `${Math.round(timeLimitMs / 60000 * 10) / 10} min`} (ends at the limit or when the goal is done, whichever first).`);
  why.push(`Gem revives: ${allowGemRevives ? 'allowed' : 'never'}. Ads and real-money purchases: never.`);

  return {
    mode, goal, startRealm, targetRealm, scope, maxDeaths, retryPolicy, upgradeOnRetry, allowGemRevives,
    timeLimitMs, surviveSec, battleWins, report: focus, interpretation: why, source: 'local',
  };
}

/**
 * Validate a plan returned by the server's OpenAI planner. Every field
 * is type-checked and clamped; anything missing or invalid falls back
 * to the local parse, so a bad model answer can never loosen a
 * constraint the local parser found (deaths, scope) by accident.
 */
export function planFromRemote(raw: any, local: AutoplayPlan, sliderMs: number | null): AutoplayPlan {
  if (!raw || typeof raw !== 'object') return local;
  const pick = <T extends string>(v: any, ok: readonly T[], d: T): T => ok.includes(v) ? v : d;
  const realm = (v: any, d: number) => Number.isFinite(+v) ? Math.max(1, Math.min(REALM_COUNT, Math.round(+v))) : d;
  const scope = pick(raw.scope, ['single_run', 'cumulative'] as const, local.scope);
  let maxDeaths: number | null = raw.maxDeaths === null ? null : Number.isFinite(+raw.maxDeaths) ? Math.max(0, Math.round(+raw.maxDeaths)) : local.maxDeaths;
  // Stricter of the two readings wins for deaths.
  if (local.maxDeaths !== null && (maxDeaths === null || maxDeaths > local.maxDeaths)) maxDeaths = local.maxDeaths;
  const tl = raw.timeLimitMinutes === null ? null : Number.isFinite(+raw.timeLimitMinutes) && +raw.timeLimitMinutes > 0 ? Math.round(+raw.timeLimitMinutes * 60000) : undefined;
  const startRealm = realm(raw.startRealm, local.startRealm);
  const rf = raw.report && typeof raw.report === 'object' ? raw.report : {};
  const b = (v: any, d: boolean) => typeof v === 'boolean' ? v : d;
  const interp = Array.isArray(raw.interpretation) ? raw.interpretation.map((s: any) => String(s).replace(/\u2014|\u2013/g, '-').slice(0, 300)).slice(0, 12) : local.interpretation;
  return {
    mode: pick(raw.mode, ['campaign', 'endless', 'battle'] as const, local.mode),
    goal: pick(raw.goal, ['clear_through', 'reach', 'survive', 'battle_wins', 'free_play'] as const, local.goal),
    startRealm,
    targetRealm: Math.max(startRealm, realm(raw.targetRealm, local.targetRealm)),
    scope: local.scope === 'single_run' ? 'single_run' : scope,
    maxDeaths,
    retryPolicy: pick(raw.retryPolicy, ['restart_from_start', 'retry_realm', 'stop'] as const, local.retryPolicy),
    upgradeOnRetry: b(raw.upgradeOnRetry, local.upgradeOnRetry),
    allowGemRevives: local.allowGemRevives && b(raw.allowGemRevives, true),
    timeLimitMs: effectiveLimit(tl === undefined ? local.timeLimitMs : tl, sliderMs),
    surviveSec: Number.isFinite(+raw.surviveSec) && +raw.surviveSec > 0 ? +raw.surviveSec : local.surviveSec,
    battleWins: Number.isFinite(+raw.battleWins) && +raw.battleWins > 0 ? Math.round(+raw.battleWins) : local.battleWins,
    report: { bugs: b(rf.bugs, local.report.bugs), ui: b(rf.ui, local.report.ui), balance: b(rf.balance, local.report.balance), bosses: b(rf.bosses, local.report.bosses), perf: b(rf.perf, local.report.perf) },
    interpretation: interp.length ? interp : local.interpretation,
    source: 'openai',
  };
}

/** Settings slider stops. ms null = Infinite. */
export const AUTOPLAY_DURATIONS: { label: string; ms: number | null }[] = [
  { label: '1 min', ms: 60_000 }, { label: '2 min', ms: 120_000 }, { label: '5 min', ms: 300_000 },
  { label: '10 min', ms: 600_000 }, { label: '15 min', ms: 900_000 }, { label: '30 min', ms: 1_800_000 },
  { label: '60 min', ms: 3_600_000 }, { label: 'Infinite', ms: null },
];
