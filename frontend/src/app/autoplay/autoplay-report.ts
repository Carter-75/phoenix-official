// Telemetry the autoplay executor gathers while the AI plays. The AI
// reads it in play-step results and writes the report itself.

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
  blockedInputs?: number;
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

