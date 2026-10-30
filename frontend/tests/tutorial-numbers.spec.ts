// Tutorial numbers must come from the game's constants, never literals.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TUTORIAL_STEPS } from '../src/app/tutorial/tutorial-steps';
import { STAMINA_RULES_FOR_COPY as S, TUTORIAL_STAMINA } from '../src/app/tutorial/tutorial-copy-numbers';
import { STAMINA, DROP_RULES, INPUT_RULES, TOUCH_DRAG_SCALE, LEVEL_HP_BONUS, TAP_CHAIN_RESOLVE_MS } from '../src/app/data/balance.constants';
import { HOLD_ARM_MS } from '../src/app/pages/game/hold-still';
import { WORLDS } from '../src/app/constants/game.constants';
import { tapsFor } from '../src/app/input/gesture-core';

const src = (p: string) => readFileSync(resolve(__dirname, '../src/app', p), 'utf8');
const step = (id: string) => TUTORIAL_STEPS.find(s => s.id === id)!;

describe('tutorial copy numbers come from constants', () => {
  it('copy table equals the game constants', () => {
    expect(TUTORIAL_STAMINA).toBe(STAMINA);
    expect(S.dashCost).toBe(STAMINA.dashCost);
    expect(S.rollCost).toBe(STAMINA.rollCost);
    expect(S.max).toBe(STAMINA.max);
    expect(S.regen).toBe(STAMINA.regenPerSecond);
    expect(S.regenDelayS).toBe(STAMINA.regenDelayMs / 1000);
    expect(S.sparkCell).toBe(DROP_RULES.sparkCellStamina);
    expect(S.dragScale).toBe(TOUCH_DRAG_SCALE);
    expect(S.holdArmS).toBe(HOLD_ARM_MS / 1000);
    expect(S.holdChargeS).toBe(INPUT_RULES.holdChargeMs / 1000);
    expect(S.flickMs).toBe(INPUT_RULES.flickMaxMs);
    expect(S.flickPct).toBe(Math.round(INPUT_RULES.flickMinFraction * 100));
    expect(S.rollTapMs).toBe(INPUT_RULES.rollTapMaxMs);
    expect(S.brakePct).toBe(Math.round(INPUT_RULES.brakeSpeedFactor * 100));
    expect(S.hpPerLevel).toBe(LEVEL_HP_BONUS.perLevel);
    expect(S.realms).toBe(WORLDS.length);
    expect(S.tapChainMs).toBe(TAP_CHAIN_RESOLVE_MS);
  });
  it('step text quotes those numbers', () => {
    expect(step('dash').body).toContain(`${S.dashCost} stamina`);
    expect(step('dash').body).toContain(`${S.flickMs} ms`);
    expect(step('hold').body).toContain(`${S.holdChargeS} s`);
    expect(step('brake').body).toContain(`${S.brakePct}%`);
    expect(TUTORIAL_STEPS.some(s => s.body.includes(`${S.sparkCell}`))).toBe(true);
  });
  it('tap counts in the copy match the game grammar (2 TAP, 3 DBL, 4 ULT)', () => {
    expect(tapsFor('tap')).toBe(2); expect(tapsFor('double')).toBe(3); expect(tapsFor('triple')).toBe(4);
    expect(step('slot-tap').finger).toBe('tap2');
    expect(step('slot-double').finger).toBe('tap3');
    expect(step('slot-triple').finger).toBe('tap4');
    expect(step('slot-tap').body).toMatch(/tap twice/i);
    expect(step('slot-double').body).toMatch(/three times/i);
    expect(step('slot-triple').body).toMatch(/four times/i);
    const all = TUTORIAL_STEPS.map(s => `${s.body} ${s.desktop}`).join(' ');
    expect(all).not.toMatch(/tap once|click once/i);
    expect(all).toMatch(/single tap does nothing/);
    expect(step('slot-tap').desktop).toContain('Q');
    expect(step('slot-double').desktop).toContain('W');
    expect(step('slot-triple').desktop).toContain('R');
    expect(all).toMatch(/Esc pauses/);
  });
  it('tutorial arena has no hardcoded gameplay numbers', () => {
    const c = src('pages/tutorial/tutorial.component.ts');
    expect(c).toContain('INPUT_RULES.brakeSpeedFactor');
    expect(c).toContain('DROP_RULES.sparkCellStamina');
    expect(c).not.toMatch(/stam\.add\(\d/);
    expect(c).not.toMatch(/'\+\d+'/);
    expect(c).toContain("'TAP (2 taps)'");
    expect(c).toContain("ABILITIES['burst']");
  });
  it('the game and tutorial both use the shared gesture parser', () => {
    expect(src('pages/game/game.component.ts')).toContain('new TapChainParser(');
    expect(src('tutorial/tutorial-input.ts')).toContain('TapChainParser');
  });
  it('no em dashes in tutorial copy', () => {
    const all = TUTORIAL_STEPS.map(s => `${s.title} ${s.body} ${s.desktop}`).join(' ');
    expect(all).not.toMatch(/\u2014/);
  });
});

import { TUTORIAL_STEPS as __STEPS } from '../src/app/tutorial/tutorial-steps';
import { DROP_RULES as __DR, STAMINA as __ST } from '../src/app/data/balance.constants';
describe('tutorial items are real', () => {
  const all = JSON.stringify(__STEPS);
  it('regen is slow so Spark Cells are the main refill', () => {
    expect(__ST.regenPerSecond).toBeGreaterThanOrEqual(3);
    expect(__ST.regenPerSecond).toBeLessThanOrEqual(5);
    expect(all).toMatch(/Spark Cells are your main refill/);
    expect(__DR.sparkCellBaseChance).toBeGreaterThan(0);
  });
  it('hearts are taught with the real heal value', () => {
    expect(all).toContain(`heals ${__DR.heartHealValue} HP`);
  });
});
