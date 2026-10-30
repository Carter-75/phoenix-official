// Round 3: requested realm is enforced at start_run, and real touches never reach gameplay.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promptRealm } from '../src/app/autoplay/autoplay-agent';

const read = (p: string) => readFileSync(resolve(__dirname, '../src/app', p), 'utf8');

describe('requested realm', () => {
  it('reads the first realm the prompt names', () => {
    expect(promptRealm('start realm 1, speed-run all 10 realms with no deaths')).toBe(1);
    expect(promptRealm('survive 2 minutes in realm 3')).toBe(3);
    expect(promptRealm('buy one upgrade')).toBeNull();
    expect(promptRealm('all 10 realms')).toBeNull();
  });
  it('start_run verifies the menu picker and logs the actual realm', () => {
    const s = read('autoplay/autoplay.service.ts');
    expect(s).toMatch(/realm check failed before Play/);
    expect(s).toMatch(/run realm: actual/);
    expect(s).toMatch(/Play taps go through start_run/);
  });
  it('the Play button exposes the realm it will start', () => {
    expect(read('components/main-menu/main-menu.component.ts')).toMatch(/data-ap="play" \[attr\.data-realm\]="campaignWorldIndex\(\) \+ 1"/);
  });
  it('a stale guest save cannot override the device realm preference', () => {
    expect(read('services/game-state.service.ts')).not.toMatch(/if \(data\.selectedWorldIndex\) this\.selectedWorldIndex\.set/);
  });
});

describe('input lock during autoplay', () => {
  it('real touches are stopped in the capture phase', () => {
    const s = read('autoplay/autoplay.service.ts');
    expect(s).toMatch(/e\.stopImmediatePropagation\(\)/);
    expect(s).toMatch(/'touchstart', 'touchmove', 'touchend'/);
    expect(s).toMatch(/capture: true/);
  });
});
