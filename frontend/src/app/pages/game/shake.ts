// Pure screen-shake rules shared by the FX controller and tests.
export const SHAKE_ALLOWED_TRIGGERS = ['boss_death', 'ultimate_cast', 'boss_contact', 'false_rebirth', 'singularity_detonation', 'player_hit', 'explosion'];
/** Peak amplitude (reference px) per trigger; light triggers stay subtle. */
export const SHAKE_AMP: Record<string, number> = { player_hit: 3, explosion: 4 };

/** Pure shake amplitude for a trigger and setting (0 = no shake). */
export function shakeAmplitude(trigger: string, setting: 'on' | 'reduced' | 'off', braking: boolean, telegraph: boolean, speedScale = 1): number {
  if (!SHAKE_ALLOWED_TRIGGERS.includes(trigger) || telegraph || setting === 'off') return 0;
  let amp = (SHAKE_AMP[trigger] ?? 6) * speedScale;
  if (setting === 'reduced') amp *= 0.4;
  if (braking) amp *= 0.4;
  return amp;
}
