// Campaign boss flow (per realm), Oct 30, 2026 rework.
//   1. SURVIVE: a 5:00 countdown, no boss, difficulty ramps.
//   2. At 0:00 the boss spawns and the timer becomes 3:00
//      (DEFEAT THE BOSS). Beating the boss advances the realm.
//   3. If 3:00 runs out the boss enters RAGE for 30 s.
//   4. If the 30 s run out the boss fires its final 360 degree
//      attack, which cannot be avoided and deals infinite damage.
// This module is pure (no Angular, no Matter) so it is unit tested.

export type BossPhase = 'survive' | 'boss' | 'rage' | 'final';

export const SURVIVE_PHASE_SEC = 300;
export const BOSS_PHASE_SEC = 180;
export const RAGE_PHASE_SEC = 30;
// Rage multipliers: incoming damage and boss chase speed.
export const RAGE_DAMAGE_MULT = 1.5;

export interface BossPhaseState {
  phase: BossPhase;
  remaining: number;
}

export type BossPhaseEvent = 'none' | 'spawn_boss' | 'enter_rage' | 'final_attack';

export function initialBossPhase(): BossPhaseState {
  return { phase: 'survive', remaining: SURVIVE_PHASE_SEC };
}

export function phaseDuration(phase: BossPhase): number {
  if (phase === 'survive') return SURVIVE_PHASE_SEC;
  if (phase === 'boss') return BOSS_PHASE_SEC;
  if (phase === 'rage') return RAGE_PHASE_SEC;
  return 0;
}

// One whole second of campaign time. Returns the next state and the
// transition event (if any) the caller must act on.
export function tickBossPhase(s: BossPhaseState): { state: BossPhaseState; event: BossPhaseEvent } {
  if (s.phase === 'final') return { state: s, event: 'none' };
  const remaining = Math.max(0, Math.floor(s.remaining - 1));
  if (remaining > 0) return { state: { phase: s.phase, remaining }, event: 'none' };
  if (s.phase === 'survive') return { state: { phase: 'boss', remaining: BOSS_PHASE_SEC }, event: 'spawn_boss' };
  if (s.phase === 'boss') return { state: { phase: 'rage', remaining: RAGE_PHASE_SEC }, event: 'enter_rage' };
  return { state: { phase: 'final', remaining: 0 }, event: 'final_attack' };
}

export function phaseLabel(phase: BossPhase): string {
  if (phase === 'survive') return 'SURVIVE';
  if (phase === 'boss') return 'DEFEAT THE BOSS';
  return 'RAGE';
}

export const FINAL_ATTACK_DEATH_REASON = "The boss's final attack can't be survived";
