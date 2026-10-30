import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initialBossPhase, tickBossPhase, BossPhaseState, SURVIVE_PHASE_SEC, BOSS_PHASE_SEC,
  RAGE_PHASE_SEC, phaseLabel, FINAL_ATTACK_DEATH_REASON,
} from '../src/app/data/boss-phase';
import { TUTORIAL_STEPS } from '../src/app/tutorial/tutorial-steps';

function run(s: BossPhaseState, n: number) {
  const events: string[] = [];
  for (let i = 0; i < n; i++) { const r = tickBossPhase(s); s = r.state; if (r.event !== 'none') events.push(r.event); }
  return { s, events };
}

const game = readFileSync(resolve(__dirname, '../src/app/pages/game/game.component.ts'), 'utf8');

describe('campaign boss phase flow', () => {
  it('uses 5:00, 3:00 and 30 s', () => {
    expect([SURVIVE_PHASE_SEC, BOSS_PHASE_SEC, RAGE_PHASE_SEC]).toEqual([300, 180, 30]);
    expect(initialBossPhase()).toEqual({ phase: 'survive', remaining: 300 });
  });
  it('spawns the boss at 0:00 and switches to 3:00, never back to 5:00', () => {
    const { s, events } = run(initialBossPhase(), 300);
    expect(events).toEqual(['spawn_boss']);
    expect(s).toEqual({ phase: 'boss', remaining: 180 });
    expect(run(s, 1).s.remaining).toBe(179);
  });
  it('enters rage after 3:00, then fires the final attack after 30 s', () => {
    let { s, events } = run(initialBossPhase(), 300 + 180);
    expect(events).toEqual(['spawn_boss', 'enter_rage']);
    expect(s).toEqual({ phase: 'rage', remaining: 30 });
    ({ s, events } = run(s, 30));
    expect(events).toEqual(['final_attack']);
    expect(s.phase).toBe('final');
    expect(run(s, 5).events).toEqual([]);
  });
  it('labels the timer per phase', () => {
    expect(['survive', 'boss', 'rage'].map(p => phaseLabel(p as any))).toEqual(['SURVIVE', 'DEFEAT THE BOSS', 'RAGE']);
  });
  it('removes the flashing banners and the old kill screen', () => {
    expect(game).not.toMatch(/RAGE MODE/);
    expect(game).not.toMatch(/Death in:/);
    expect(game).not.toMatch(/killScreenTimer|triggerRageMode|executeKillScreen|World Boss Approaching/);
  });
  it('final attack kills with infinite damage and disables revives', () => {
    expect(game).toMatch(/lastDeathDamage\.set\(Infinity\)/);
    for (const fn of ['reviveWithGems', 'reviveWithToken', 'reviveWithAd']) {
      const body = game.slice(game.indexOf(`${fn}() {`), game.indexOf(`${fn}() {`) + 200);
      expect(body).toContain('deathUnsurvivable()');
    }
    expect(FINAL_ATTACK_DEATH_REASON).toBe("The boss's final attack can't be survived");
  });
  it('resets the phase on init, realm switch, win and quit', () => {
    expect((game.match(/this\.resetBossPhase\(\)/g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it('tutorial realms copy matches the phase numbers', () => {
    const realms = TUTORIAL_STEPS.find(s => s.id === 'realms')!;
    expect(realms.body).toContain('5:00');
    expect(realms.body).toContain('3:00');
    expect(realms.body).toContain('RAGE for 30 s');
    expect(realms.body).not.toMatch(/\u2014/);
  });
});
