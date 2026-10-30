// Settings toggles must change gameplay output, and removed settings stay removed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shakeAmplitude, SHAKE_ALLOWED_TRIGGERS } from '../src/app/pages/game/shake';

const src = (p: string) => readFileSync(resolve(__dirname, '../src/app', p), 'utf8');

describe('Screen Shake setting', () => {
  it('on shakes for hits, explosions, and boss attacks; off never shakes', () => {
    for (const t of ['player_hit', 'explosion', 'boss_contact', 'boss_death', 'ultimate_cast']) {
      expect(shakeAmplitude(t, 'on', false, false)).toBeGreaterThan(0);
      expect(shakeAmplitude(t, 'off', false, false)).toBe(0);
      expect(shakeAmplitude(t, 'reduced', false, false)).toBeLessThan(shakeAmplitude(t, 'on', false, false));
    }
    expect(SHAKE_ALLOWED_TRIGGERS).toContain('player_hit');
    expect(shakeAmplitude('random', 'on', false, false)).toBe(0);
  });
  it('game wires player hits and explosions to the shake', () => {
    const g = src('pages/game/game.component.ts');
    expect(g).toMatch(/triggerShake\(source === 'boss_contact' \? 'boss_contact' : 'player_hit'\)/);
    expect(g).toMatch(/playSFX\('explosion'\); this\.triggerShake\('explosion'\)/);
    expect(g).toMatch(/\[style\.transform\]="shakeTransform\(\)"/);
  });
});

describe('Damage Numbers setting', () => {
  it('records and renders only when enabled', () => {
    const fx = src('pages/game/fx-controller.ts');
    expect(fx).toMatch(/recordDamageNumber[\s\S]{0,120}if \(!this\.host\.gameState\.damageNumbersEnabled\(\)/);
    expect(src('pages/game/game.component.ts')).toMatch(/@if \(gameState\.damageNumbersEnabled\(\)\)/);
  });
});

describe('removed controls', () => {
  it('Touch Offset is gone everywhere', () => {
    for (const p of ['pages/settings/settings.component.ts', 'services/game-state.service.ts', 'pages/game/game.component.ts', 'components/particle-bg/particle-bg.component.ts']) {
      expect(src(p)).not.toMatch(/touchOffset|applyTouchOffset|Touch Offset/);
    }
  });
  it('no ? help button; Settings > Replay Tutorial is the only entry', () => {
    const m = src('components/main-menu/main-menu.component.ts');
    expect(m).not.toMatch(/aria-label="How to play"/);
    expect(m).not.toMatch(/\? button/);
    expect(src('pages/settings/settings.component.ts')).toMatch(/Replay Tutorial/);
  });
});
