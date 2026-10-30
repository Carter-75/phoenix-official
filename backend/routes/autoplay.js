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

async function chat({ system, user, maxTokens, json }) {
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
          ? { max_completion_tokens: maxTokens + 2000, reasoning_effort: 'minimal' }
          : { max_tokens: maxTokens, temperature: 0.2 }),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
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
    return String(data?.choices?.[0]?.message?.content || '');
  } finally { clearTimeout(timer); }
}

const noDash = s => String(s).replace(/\u2014|\u2013/g, '-');

const STEP_SYSTEM = `You are the AI tester driving the mobile game Phoenix Fall on the owner's real save. Each turn you get the tester's prompt, a compact live observation (screen, coins, gems, selected realm, unlocked realms, per-realm loadout, run state, visible buttons with id/label/enabled/cost/currency, recent events) and your recent action history with verified results. Choose exactly ONE next action and return ONLY a JSON object, one of:
{"action":"tap_button","id":"<button id from observation>","why":"..."}  (add "allowGems":true,"gemQuote":"<exact words from the prompt allowing gems>" only when the prompt explicitly allows spending gems)
{"action":"select_realm","realm":N}   (menu only; changes which realm's loadout the shop edits)
{"action":"navigate","page":"menu"|"shop"}
{"action":"start_run","mode":"campaign"|"endless"|"battle","realm":N}
{"action":"play","seconds":N,"until":"time"|"death"|"run_end","abilities":true}  (hands flight to the skilled on-device pilot; max 600 s per call; returns when time is up, the phoenix is down, or the run ends)  (the pilot dodges, aims, and grabs pickups by need: Spark Cells refill stamina, which regenerates only slowly; hearts heal; Overcharge refunds the next cooldown)
{"action":"use_ability","slot":"tap"|"double"|"triple"|"hold"}  (the app performs the gesture for you: TAP slot = 2 quick taps, DBL = 3, ULT = 4, hold = charged shot; a single tap does nothing)
{"action":"wait","seconds":N}
{"action":"finish","report":"<markdown report>"}
Rules: do exactly what the prompt asks and nothing more. Never start or play a run unless the prompt asks for gameplay. Menu or shop tasks are done in menus only. Shop: realms have separate loadouts (select_realm first, then navigate shop); "buy-<stat>" buttons cost coins and level a stat. Check each result: a buy is only done if coins dropped and the stat level rose; if a step failed, retry differently or report the failure. Never spend gems unless the prompt explicitly says so; real-money purchases and ads are blocked anyway. On the KO screen choose give-up or quit unless gem revives are allowed. When the goal is met, impossible, or secondsLeft is near 0, call finish. The report must be honest, only use facts from results, list what was done, what failed and why, bugs or UI issues seen, and stay under the given reportMaxChars. Never use em dashes.`;

router.get('/flags', jwt, (req, res) => {
  const owner = isOwnerUser(req.user);
  res.json({ isOwner: owner, autoplay: owner, ai: owner && hasKey(), model: owner ? MODEL() : undefined });
});

router.post('/step', jwt, requireOwner, async (req, res) => {
  if (!hasKey()) return res.status(503).json({ source: 'none', errorCode: 'no_key' });
  if (!rateOk(String(req.user._id), 'step')) return res.status(429).json({ source: 'none', errorCode: 'rate_limited' });
  const prompt = String(req.body?.prompt || '').slice(0, 2000);
  const obs = JSON.stringify(req.body?.observation || {}).slice(0, 7000);
  const hist = JSON.stringify(req.body?.history || []).slice(0, 5000);
  const cap = Math.max(1000, Math.min(15000, Number(req.body?.reportMaxChars) || 12000));
  try {
    const out = await chat({
      system: STEP_SYSTEM,
      user: `Prompt: ${prompt}\nStep ${Number(req.body?.step) || 1} of max ${Number(req.body?.maxSteps) || 80}. reportMaxChars ${cap}.\nHistory: ${hist}\nObservation: ${obs}`,
      maxTokens: 1200, json: true,
    });
    const action = JSON.parse(out);
    if (action && typeof action.report === 'string') action.report = noDash(action.report).slice(0, cap);
    res.json({ source: 'openai', model: MODEL(), action });
  } catch (e) {
    const errorCode = e && e.code ? String(e.code) : (e && e.name === 'AbortError' ? 'timeout' : (e instanceof SyntaxError ? 'bad_json' : 'request_failed'));
    res.status(502).json({ source: 'none', model: MODEL(), errorCode });
  }
});

module.exports = router;
module.exports._test = { rateOk, hits, requireOwner, isReasoningModel };
