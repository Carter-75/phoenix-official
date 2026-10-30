// Owner-only AI Autoplay endpoints. Every route requires a valid JWT
// session AND the server-side owner check (config/owner.js). The
// OpenAI key is read from OPENAI_API_KEY on the server only; when it
// is missing or a call fails the routes answer { source: 'local' }
// and the client uses its offline parser / report writer instead.
const express = require('express');
const passport = require('passport');
const { isOwnerUser } = require('../config/owner');

const router = express.Router();
const MODEL = () => process.env.OPENAI_MODEL || 'gpt-5-nano';
const hasKey = () => !!process.env.OPENAI_API_KEY;

// Simple in-memory per-user rate limit.
const WINDOW_MS = 60 * 1000;
const LIMITS = { plan: 6, report: 4, advise: 10 };
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

const PLAN_SYSTEM = `You convert a game tester's prompt for the mobile game Phoenix Fall into a strict JSON plan.
The game has 10 realms (1-based). Modes: "campaign" (Normal), "endless", "battle".
Return ONLY a JSON object with keys:
mode ("campaign"|"endless"|"battle"), goal ("clear_through"|"reach"|"survive"|"battle_wins"|"free_play"),
startRealm (1-10), targetRealm (1-10), scope ("single_run"|"cumulative"), maxDeaths (integer or null for unlimited),
retryPolicy ("restart_from_start"|"retry_realm"|"stop"), upgradeOnRetry (bool), allowGemRevives (bool),
timeLimitMinutes (number or null for infinite), surviveSec (number or null), battleWins (number or null),
report ({bugs,ui,balance,bosses,perf} booleans), interpretation (array of short plain sentences, no em dashes).
Rules: "one run", "in one go", "no deaths", "deathless" mean scope single_run with maxDeaths 0 and retryPolicy restart_from_start,
and any death fails the whole attempt. "all realms" means startRealm 1, targetRealm 10, goal clear_through.
Default upgradeOnRetry true, allowGemRevives false unless the prompt explicitly allows gem revives. Never plan real-money purchases or ads.`;

router.get('/flags', jwt, (req, res) => {
  const owner = isOwnerUser(req.user);
  res.json({ isOwner: owner, autoplay: owner, ai: owner && hasKey(), model: owner ? MODEL() : undefined });
});

router.post('/plan', jwt, requireOwner, async (req, res) => {
  const prompt = String(req.body?.prompt || '').slice(0, 2000);
  if (!hasKey()) return res.json({ source: 'local', reason: 'no_key', llmUsed: false, errorCode: 'no_key' });
  if (!rateOk(String(req.user._id), 'plan')) return res.status(429).json({ source: 'local', reason: 'rate_limited', llmUsed: false, errorCode: 'rate_limited' });
  try {
    const out = await chat({ system: PLAN_SYSTEM, user: `Current realm: ${Number(req.body?.currentRealm) || 1}\nPrompt: ${prompt}`, maxTokens: 500, json: true });
    const plan = JSON.parse(out);
    res.json({ source: 'openai', model: MODEL(), plan, llmUsed: true, errorCode: null });
  } catch (e) {
    const errorCode = e && e.code ? String(e.code) : (e && e.name === 'AbortError' ? 'timeout' : (e instanceof SyntaxError ? 'bad_json' : 'request_failed'));
    res.json({ source: 'local', reason: 'ai_failed', model: MODEL(), llmUsed: false, errorCode });
  }
});

router.post('/report', jwt, requireOwner, async (req, res) => {
  if (!hasKey()) return res.json({ source: 'local', reason: 'no_key' });
  if (!rateOk(String(req.user._id), 'report')) return res.status(429).json({ source: 'local', reason: 'rate_limited' });
  const cap = Math.max(2000, Math.min(20000, Number(req.body?.maxChars) || 15000));
  const telemetry = JSON.stringify(req.body?.telemetry || {}).slice(0, 60000);
  const plan = JSON.stringify(req.body?.plan || {}).slice(0, 4000);
  const prompt = String(req.body?.prompt || '').slice(0, 2000);
  try {
    const out = await chat({
      system: `You are a senior QA tester writing the final report of an automated play session of the mobile game Phoenix Fall. Use markdown with exactly these sections: "## Summary", "## Outcome vs goal", "## Attempts", "## Bugs" (each with repro steps), "## UI polish notes", "## Balance and boss notes" (flag bosses that need a remake and why), "## Stats". Be concrete, use only facts from the telemetry, never invent bugs. The whole report MUST be under ${cap} characters; condense lists rather than cut off. Never use em dashes.`,
      user: `Tester prompt: ${prompt}\nPlan: ${plan}\nTelemetry JSON: ${telemetry}`,
      maxTokens: Math.min(3500, Math.ceil(cap / 3.5)),
    });
    res.json({ source: 'openai', model: MODEL(), report: noDash(out).slice(0, cap) });
  } catch (e) {
    res.json({ source: 'local', reason: 'ai_failed' });
  }
});

router.post('/advise', jwt, requireOwner, async (req, res) => {
  if (!hasKey()) return res.json({ source: 'local', reason: 'no_key' });
  if (!rateOk(String(req.user._id), 'advise')) return res.status(429).json({ source: 'local', reason: 'rate_limited' });
  const summary = JSON.stringify(req.body?.summary || {}).slice(0, 8000);
  try {
    const out = await chat({
      system: `You advise an autoplay bot for Phoenix Fall between attempts. Return ONLY JSON: {"upgradePriority": array of stat keys from ["damage","attack-speed","homing","health","speed","aegis","magnet","range","aura"] best first, "aggression": number 0..1 (0 = keep distance and dodge, 1 = fight close), "note": short sentence, no em dashes}.`,
      user: summary, maxTokens: 200, json: true,
    });
    res.json({ source: 'openai', model: MODEL(), advice: JSON.parse(out) });
  } catch (e) {
    res.json({ source: 'local', reason: 'ai_failed' });
  }
});

module.exports = router;
module.exports._test = { rateOk, hits, requireOwner, isReasoningModel };
