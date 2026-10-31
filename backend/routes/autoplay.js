// Owner-only AI Autoplay endpoints. Every route requires a valid JWT
// session AND the server-side owner check (config/owner.js). The
// OpenAI key is read from OPENAI_API_KEY on the server only. /step is
// the whole brain of the agent loop: it returns the next action. When
// the key is missing or a call fails it answers with an errorCode and
// the client stops; there is no local fallback.
const express = require('express');
const passport = require('passport');
const { isOwnerUser } = require('../config/owner');

const router = express.Router();
const MODEL = () => process.env.OPENAI_MODEL || 'gpt-5-nano';
const hasKey = () => !!process.env.OPENAI_API_KEY;

// Simple in-memory per-user rate limit.
const WINDOW_MS = 60 * 1000;
const LIMITS = { step: 40 };
const hits = new Map();
function rateOk(userId, kind, now = Date.now()) {
  const key = `${userId}:${kind}`;
  const arr = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= (LIMITS[kind] || 5)) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}

function requireOwner(req, res, next) {
  if (!isOwnerUser(req.user)) return res.status(403).json({ error: 'forbidden' });
  next();
}

const jwt = passport.authenticate('jwt', { session: false });

function isReasoningModel(m) { return /^(gpt-5|o\d)/i.test(String(m)); }

async function chat({ system, user, maxTokens, json, extra = 2000, messages }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL(),
        // gpt-5 / o-series: no temperature, max_completion_tokens, and
        // reasoning tokens count against the budget, so add headroom.
        ...(isReasoningModel(MODEL())
          ? { max_completion_tokens: maxTokens + extra, reasoning_effort: 'minimal' }
          : { max_tokens: maxTokens, temperature: 0.2 }),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: messages || [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!r.ok) {
      let code = '';
      try { const j = await r.json(); code = j?.error?.code || j?.error?.type || ''; } catch { }
      const err = new Error(`openai ${r.status}`);
      err.code = `http_${r.status}${code ? '_' + String(code).slice(0, 40) : ''}`;
      throw err;
    }
    const data = await r.json();
    const u = data?.usage || {};
    const usage = { in: u.prompt_tokens || 0, cached: u.prompt_tokens_details?.cached_tokens || 0, out: u.completion_tokens || 0 };
    return { text: String(data?.choices?.[0]?.message?.content || ''), usage, finish: data?.choices?.[0]?.finish_reason || '' };
  } finally { clearTimeout(timer); }
}

const noDash = s => String(s).replace(/\u2014|\u2013/g, '-');

const STEP_SYSTEM = `You are the AI tester driving the mobile game Phoenix Fall on the owner's real save. Each turn you get the tester's prompt, a compact live observation (screen, coins, gems, selected realm, unlocked realms, per-realm loadout, run state, visible buttons with id/label/enabled/cost/currency, recent events) and your recent action history with verified results. Choose exactly ONE next action and return ONLY a JSON object, one of:
{"action":"tap_button","id":"<button id from observation>","why":"..."}  (add "allowGems":true,"gemQuote":"<exact words from the prompt allowing gems>" only when the prompt explicitly allows spending gems)
{"action":"select_realm","realm":N}   (menu only; changes which realm's loadout the shop edits)
{"action":"navigate","page":"menu"|"shop"|"settings"|"tutorial"|"codex"|"leaderboard"}  (tutorial opens Settings > Replay Tutorial; on the tutorial screen, play runs the tutorial step by step)
{"action":"start_run","mode":"campaign"|"endless"|"battle","realm":N}
{"action":"play","seconds":N,"until":"time"|"death"|"run_end","aggression":0..1,"abilities":true}  (until death with aggression 0 = die on purpose: the pilot stops dodging)  (hands flight to the skilled on-device pilot; max 600 s per call; returns when time is up, the phoenix is down, or the run ends)  (the pilot dodges, aims, and grabs pickups by need: Spark Cells refill stamina, which regenerates only slowly; hearts heal; Overcharge refunds the next cooldown)
{"action":"use_ability","slot":"tap"|"double"|"triple"|"hold"}  (the app performs the gesture for you: TAP slot = 2 quick taps, DBL = 3, ULT = 4, hold = charged shot; a single tap does nothing)
{"action":"wait","seconds":N}
{"action":"finish","outcome":"goal_met"|"impossible","reason":"...","report":"<markdown report>"}
Rules: do exactly what the prompt asks and nothing more. Realms (reason about intent): observation.unlockedRealms lists what is playable now. In a campaign run, beating a realm's boss unlocks and moves on to the next realm, so later realms become playable through progression. Start in the realm the prompt names (realm 2 means realm 2; "beat the realm 1 boss first" means start_run realm 1 even when later realms are already unlocked); if none is named, a goal covering all realms starts at realm 1. Any goal that walks the realms in order ("progress through realms 1-10", "all realms", "from realm 1") also starts in realm 1 this session even if the wording says wherever and later realms are unlocked from earlier saves, and moves to realm N+1 only after this session beat realm N's boss (observation.checklist.realmsCleared). Tell apart: "start at realm 5" or "play realm 5 for 30 seconds" when realm 5 is locked cannot be done now (playing realm 1 instead is wrong), so finish at once with outcome impossible and the reason (e.g. "Realm 5 is locked; unlocked: 1-3"); that is a correct refusal. But "start at realm 1 and keep going through realms 1-10" is doable over time: start in an unlocked realm and keep playing, since each boss beaten opens the next realm. Never buy or unlock a realm, and never swap to a different realm than the goal needs. For a goal like "clear realms 1-10 in one run without dying": start_run campaign in realm 1, play until run_end; if you die, that attempt failed, so (if upgrades are allowed) you MUST spend the coins before retrying: select_realm 1, navigate shop, and buy several upgrades using observation.shop (ranked best value first; damage and attack speed shorten boss fights, health survives them), keep buying while affordable and check coins dropped, then start_run again from realm 1. Retrying with a pile of unspent coins wastes the attempt. This holds after ANY death in any gameplay goal (beat a boss, survive, progress): before start_run again, select_realm the realm you will retry, navigate shop and spend most coins on buy-damage, buy-attack speed and buy-health (observation.shop ranks them), unless the prompt forbids buying or asked for just one purchase. Buy several in a row (tap buy- buttons back to back while coins last, aiming to spend most of them) before start_run, then call play right after start_run succeeds. Pacing: a campaign realm is about 5 minutes of survival, then a boss (up to 3 minutes); realmsCleared stays empty until that boss falls, so use long plays until run_end and never call the goal impossible just because nothing is cleared yet. Repeat until checklist shows the clean sweep or time runs out; the report lists each attempt (furthest realm, cause of death, upgrades bought). Gameplay goals: start a run early instead of browsing menus. Never start or play a run unless the prompt asks for gameplay. Menu or shop tasks are done in menus only. Shop: realms have separate loadouts (select_realm first, then navigate shop); "buy-<stat>" buttons cost coins and level a stat. Check each result: a buy is only done if coins dropped and the stat level rose; if a step failed, retry differently or report the failure. Never spend gems unless the prompt explicitly says so; real-money purchases and ads are blocked anyway. On the KO screen choose give-up or quit unless gem revives are allowed. You are fully autonomous: NEVER ask the tester a question or for clarification; pick the most sensible reading of the prompt and act. The observation has "guide": the valid actions for this screen, what each control does, and how-tos; follow it. Never repeat an action that returned no change. observation.checklist is code-verified progress (screens visited and not visited, deaths, buys, retries, tutorialDone, findings): goal_met is rejected until it proves every sub-goal of the prompt, so use it as your to-do list and never revisit a screen already visited. Only call finish with outcome "goal_met", or "impossible" plus a reason, or when secondsLeft is near 0; any other finish is rejected. The report must be honest, only use facts from results, list what was done, what failed and why, bugs or UI issues seen, and stay under the given reportMaxChars. Never use em dashes. Reply format: one line of minified JSON (no spaces or newlines outside strings), "why" at most 10 words, no optional fields you do not need; only finish carries a long report.`;

router.get('/flags', jwt, (req, res) => {
  const owner = isOwnerUser(req.user);
  res.json({ isOwner: owner, autoplay: owner, ai: owner && hasKey(), model: owner ? MODEL() : undefined });
});

// One planner step. Cost layout (Oct 30, 2026): the static STEP_SYSTEM comes first and the
// session prompt second, so OpenAI prompt caching reuses that identical prefix every step; only
// the step, history and observation message changes. The first try has a small output budget
// (a normal action is about 40 tokens); a cut-off reply (a long finish report) retries once
// with the full budget. usage sums both tries: in, cached (part of in), out.
async function step(body) {
  const prompt = String(body.prompt || '').slice(0, 2000);
  const obs = JSON.stringify(body.observation || {}).slice(0, 7000);
  const hist = JSON.stringify(body.history || []).slice(0, 5000);
  const cap = Math.max(1000, Math.min(15000, Number(body.reportMaxChars) || 12000));
  const messages = [
    { role: 'system', content: STEP_SYSTEM },
    { role: 'user', content: `Prompt: ${prompt}\nreportMaxChars ${cap}.` },
    { role: 'user', content: `Step ${Number(body.step) || 1} of max ${Number(body.maxSteps) || 80}.\nHistory: ${hist}\nObservation: ${obs}` },
  ];
  const usage = { in: 0, cached: 0, out: 0, calls: 0 };
  let out;
  for (const [maxTokens, extra] of [[300, 700], [1200, 2000]]) {
    out = await chat({ messages, maxTokens, extra, json: true });
    usage.in += out.usage.in; usage.cached += out.usage.cached; usage.out += out.usage.out; usage.calls++;
    if (out.finish !== 'length' && out.text) break;
  }
  const action = JSON.parse(out.text);
  if (action && typeof action.report === 'string') action.report = noDash(action.report).slice(0, cap);
  return { action, usage };
}

router.post('/step', jwt, requireOwner, async (req, res) => {
  if (!hasKey()) return res.status(503).json({ source: 'none', errorCode: 'no_key' });
  if (!rateOk(String(req.user._id), 'step')) return res.status(429).json({ source: 'none', errorCode: 'rate_limited' });
  try {
    const out = await step(req.body || {});
    res.json({ source: 'openai', model: MODEL(), action: out.action, usage: out.usage });
  } catch (e) {
    const errorCode = e && e.code ? String(e.code) : (e && e.name === 'AbortError' ? 'timeout' : (e instanceof SyntaxError ? 'bad_json' : 'request_failed'));
    res.status(502).json({ source: 'none', model: MODEL(), errorCode });
  }
});

module.exports = router;
module.exports._test = { rateOk, hits, requireOwner, isReasoningModel, chat, step, STEP_SYSTEM };
