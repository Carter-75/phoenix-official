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

import { decide, boxedIn, wallPenalty, type Snapshot } from '../src/app/autoplay/autoplay-pilot';
const snap = (o: Partial<Snapshot>): Snapshot => ({ p: { x: 200, y: 400 }, v: { x: 0, y: 0 }, w: 400, h: 800, birdR: 18, threats: [], foes: [], pickups: [], stamina: 100, staminaMax: 100, dashCost: 25, rollCost: 15, telegraph: false, hpFrac: 1, ...o });

describe('pilot escape logic', () => {
  it('corners score worse than edges, edges worse than the middle', () => {
    const s = snap({});
    expect(wallPenalty({ x: 5, y: 5 }, s)).toBeGreaterThan(wallPenalty({ x: 5, y: 400 }, s));
    expect(wallPenalty({ x: 5, y: 400 }, s)).toBeGreaterThan(wallPenalty({ x: 200, y: 400 }, s));
  });
  it('a ring of foes is boxed in and triggers a dash out', () => {
    const foes = Array.from({ length: 12 }, (_, k) => ({ x: 200 + Math.cos(k / 12 * Math.PI * 2) * 100, y: 400 + Math.sin(k / 12 * Math.PI * 2) * 100, r: 20, boss: false, hp: 10 }));
    const s = snap({ foes });
    expect(boxedIn(s)).toBe(true);
    const d = decide(s, () => 0.5);
    expect(d.escape).toBe('boxed');
    expect(d.dash).not.toBeNull();
  });
  it('stuck (no movement while hit) escapes even in open space', () => {
    const d = decide(snap({ stuck: true }), () => 0.5);
    expect(d.escape).toBe('stuck');
    expect(d.dash).not.toBeNull();
  });
  it('trapped in a corner dashes toward the open middle', () => {
    const d = decide(snap({ p: { x: 10, y: 10 } }), () => 0.5);
    expect(['corner', 'boxed']).toContain(d.escape);
    expect(d.target.x + d.target.y).toBeGreaterThan(200);
  });
});
