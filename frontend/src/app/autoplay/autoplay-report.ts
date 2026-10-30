// Local report writer for the AI Autoplay tester: turns run telemetry
// into the final written report, sized to the output cap by
// CappedOutput.setReport / fitToBudget.
import { AutoplayPlan } from './autoplay-intent';

export interface AttemptRecord {
  n: number; startRealm: number; furthestRealm: number; deaths: number;
  result: 'success' | 'failed' | 'running' | 'stopped';
  causes: string[]; upgradesAfter: string[]; durationSec: number;
}
export interface BossRecord {
  realm: number; fights: number; kills: number; deaths: number;
  ttkSec: number[]; damageTaken: number; maxHp: number; reachedFinalAttack: number; rageReached: number;
}
export interface BugRecord { kind: string; text: string; context: string; count: number; }
export interface Telemetry {
  startedAt: number; endedAt: number; endReason: string;
  attempts: AttemptRecord[];
  bosses: Record<number, BossRecord>;
  bugs: BugRecord[]; ui: BugRecord[];
  frames: { samples: number; longFrames: number; worstMs: number; lowFpsSeconds: number; fpsMin: number; fpsAvg: number };
  moves: Record<string, number>;
  kills: number; pickups: number; coinsStart: number; coinsEnd: number; gemsStart: number; gemsEnd: number;
  realmsCleared: number[]; goalMet: boolean; goalNote: string;
  battle: { matches: number; wins: number; losses: number };
  manualPauses: number; account: string;
}

export function newTelemetry(now: number): Telemetry {
  return {
    startedAt: now, endedAt: now, endReason: '', attempts: [], bosses: {}, bugs: [], ui: [],
    frames: { samples: 0, longFrames: 0, worstMs: 0, lowFpsSeconds: 0, fpsMin: 999, fpsAvg: 0 },
    moves: {}, kills: 0, pickups: 0, coinsStart: 0, coinsEnd: 0, gemsStart: 0, gemsEnd: 0,
    realmsCleared: [], goalMet: false, goalNote: '', battle: { matches: 0, wins: 0, losses: 0 },
    manualPauses: 0, account: '',
  };
}

export function addFinding(list: BugRecord[], kind: string, text: string, context: string, max = 400) {
  const hit = list.find(b => b.kind === kind && b.text === text);
  if (hit) { hit.count++; return; }
  if (list.length < max) list.push({ kind, text: text.replace(/\u2014/g, '-').slice(0, 400), context: context.slice(0, 300), count: 1 });
}

const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

export function bossVerdict(b: BossRecord): string | null {
  const avgTtk = b.ttkSec.length ? b.ttkSec.reduce((a, c) => a + c, 0) / b.ttkSec.length : null;
  const reasons: string[] = [];
  if (b.fights >= 2 && b.kills === 0) reasons.push(`never killed in ${b.fights} fights`);
  if (b.deaths >= 2) reasons.push(`${b.deaths} deaths in the fight`);
  if (avgTtk !== null && avgTtk > 150) reasons.push(`slow kill (avg ${Math.round(avgTtk)} s)`);
  if (avgTtk !== null && avgTtk < 15) reasons.push(`trivial kill (avg ${Math.round(avgTtk)} s)`);
  if (b.reachedFinalAttack > 0) reasons.push(`final attack reached ${b.reachedFinalAttack}x`);
  if (b.fights > 0 && b.maxHp > 0 && b.damageTaken / b.fights > b.maxHp * 0.9) reasons.push('takes almost a full HP bar per fight');
  return reasons.length ? reasons.join(', ') : null;
}

export function buildReport(plan: AutoplayPlan, tm: Telemetry): string {
  const L: string[] = [];
  const dur = (tm.endedAt - tm.startedAt) / 1000;
  L.push('# AI Autoplay report');
  L.push('');
  L.push('## Summary');
  L.push(`- Ran ${fmtDur(dur)}; ended because: ${tm.endReason || 'unknown'}.`);
  L.push(`- Plan (local parser): ${plan.interpretation.join(' ')}`);
  L.push(`- Account: ${tm.account || 'signed-in owner'} (real save; progress and coin spending are kept).`);
  L.push(`- Attempts: ${tm.attempts.length}; kills ${tm.kills}; pickups ${tm.pickups}; coins ${tm.coinsStart} -> ${tm.coinsEnd}; gems ${tm.gemsStart} -> ${tm.gemsEnd}.`);
  const mv = Object.entries(tm.moves).map(([k, v]) => `${k} ${v}`).join(', ');
  if (mv) L.push(`- Moves used: ${mv}.`);
  if (tm.manualPauses) L.push(`- Paused ${tm.manualPauses}x for manual touches.`);
  L.push('');
  L.push('## Outcome vs goal');
  L.push(`- ${tm.goalMet ? 'GOAL MET' : 'GOAL NOT MET'}: ${tm.goalNote || 'no note'}`);
  if (tm.realmsCleared.length) L.push(`- Realms cleared this session (in order): ${tm.realmsCleared.join(', ')}.`);
  if (plan.mode === 'battle') L.push(`- Battle: ${tm.battle.matches} matches, ${tm.battle.wins} won, ${tm.battle.losses} lost.`);
  L.push('');
  L.push('## Attempts');
  if (!tm.attempts.length) L.push('- none');
  for (const a of tm.attempts) {
    L.push(`- #${a.n} ${a.result}: realm ${a.startRealm} -> furthest ${a.furthestRealm}, ${a.deaths} death(s), ${fmtDur(a.durationSec)}${a.causes.length ? `; died to: ${a.causes.join('; ')}` : ''}${a.upgradesAfter.length ? `; then bought: ${a.upgradesAfter.join(', ')}` : ''}`);
  }
  if (plan.report.bugs) {
    L.push('');
    L.push('## Bugs');
    if (!tm.bugs.length) L.push('- No console errors, exceptions, softlocks, or state mismatches seen.');
    for (const b of tm.bugs) L.push(`- [${b.kind}] ${b.text}${b.count > 1 ? ` (x${b.count})` : ''}. Context: ${b.context}`);
  }
  if (plan.report.ui) {
    L.push('');
    L.push('## UI polish notes');
    if (!tm.ui.length) L.push('- No offscreen, overlapping, or undersized controls detected.');
    for (const b of tm.ui) L.push(`- [${b.kind}] ${b.text}${b.count > 1 ? ` (x${b.count})` : ''}. Where: ${b.context}`);
  }
  if (plan.report.bosses || plan.report.balance) {
    L.push('');
    L.push('## Balance and boss notes');
    const bs = Object.values(tm.bosses).sort((a, b) => a.realm - b.realm);
    if (!bs.length) L.push('- No boss fights reached.');
    for (const b of bs) {
      const avg = b.ttkSec.length ? `${Math.round(b.ttkSec.reduce((a, c) => a + c, 0) / b.ttkSec.length)} s avg TTK` : 'no kills';
      const v = bossVerdict(b);
      L.push(`- Realm ${b.realm} boss: ${b.fights} fight(s), ${b.kills} kill(s), ${avg}, ${b.deaths} death(s), ${Math.round(b.damageTaken)} damage taken, rage reached ${b.rageReached}x.${v ? ` NEEDS A LOOK: ${v}.` : ''}`);
    }
    if (plan.report.balance) {
      const fails = tm.attempts.filter(a => a.result === 'failed');
      if (fails.length) {
        const byRealm: Record<number, number> = {};
        fails.forEach(a => byRealm[a.furthestRealm] = (byRealm[a.furthestRealm] || 0) + 1);
        L.push(`- Deaths by realm: ${Object.entries(byRealm).map(([r, c]) => `realm ${r}: ${c}`).join(', ')}.`);
      }
    }
  }
  if (plan.report.perf) {
    L.push('');
    L.push('## Performance');
    const f = tm.frames;
    L.push(`- ${f.samples} fps samples, avg ${Math.round(f.fpsAvg)} fps, min ${f.fpsMin === 999 ? 'n/a' : Math.round(f.fpsMin)} fps, ${f.lowFpsSeconds} s under 30 fps, ${f.longFrames} long frames (>50 ms), worst ${Math.round(f.worstMs)} ms.`);
  }
  L.push('');
  L.push('## Stats');
  L.push(`- Duration ${fmtDur(dur)}, attempts ${tm.attempts.length}, deaths ${tm.attempts.reduce((n, a) => n + a.deaths, 0)}, kills ${tm.kills}, bugs ${tm.bugs.length}, UI notes ${tm.ui.length}.`);
  return L.join('\n').replace(/\u2014/g, '-');
}
