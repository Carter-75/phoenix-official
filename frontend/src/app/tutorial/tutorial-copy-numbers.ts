// Numbers quoted in the tutorial copy, each derived from the game's
// own constants so the text cannot drift from the code.
import { TOUCH_DRAG_SCALE, DROP_RULES, LEVEL_HP_BONUS, STAMINA, INPUT_RULES, TAP_CHAIN_RESOLVE_MS } from '../data/balance.constants';
import { HOLD_ARM_MS } from '../pages/game/hold-still';
import { FLICK_MAX_MS, FLICK_MIN_FRACTION, ROLL_TAP_MAX_MS, HOLD_CHARGE_MS, GLIDE_BUILD_S } from './tutorial-input';
import { WORLDS } from '../constants/game.constants';

// The game's own STAMINA object (balance.constants.ts), not a copy.
export const TUTORIAL_STAMINA = STAMINA;

export const STAMINA_RULES_FOR_COPY = {
  dragScale: TOUCH_DRAG_SCALE,
  holdArmS: HOLD_ARM_MS / 1000,
  holdChargeS: HOLD_CHARGE_MS / 1000,
  flickMs: FLICK_MAX_MS,
  flickPct: Math.round(FLICK_MIN_FRACTION * 100),
  rollTapMs: ROLL_TAP_MAX_MS,
  dashCost: TUTORIAL_STAMINA.dashCost,
  rollCost: TUTORIAL_STAMINA.rollCost,
  max: TUTORIAL_STAMINA.max,
  regen: TUTORIAL_STAMINA.regenPerSecond,
  regenDelayS: TUTORIAL_STAMINA.regenDelayMs / 1000,
  glideS: GLIDE_BUILD_S,
  sparkCell: DROP_RULES.sparkCellStamina,
  overchargeS: DROP_RULES.overchargeWindowMs / 1000,
  hpPerLevel: LEVEL_HP_BONUS.perLevel,
  hpCap: LEVEL_HP_BONUS.cap,
  realms: WORLDS.length,
  brakePct: Math.round(INPUT_RULES.brakeSpeedFactor * 100),
  focusCharmPct: Math.round((1 - INPUT_RULES.focusCharmHoldFactor) * 100),
  tapChainMs: TAP_CHAIN_RESOLVE_MS,
  heartHeal: DROP_RULES.heartHealValue,
  regenFull: Math.round(TUTORIAL_STAMINA.max / TUTORIAL_STAMINA.regenPerSecond),
};
