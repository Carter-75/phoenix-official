// The shop write path: one immutable per-realm bump shared by every buy route.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buyTagFor } from '../src/app/autoplay/purchase-highlight';

const src = (p: string) => readFileSync(resolve(__dirname, '../src/app', p), 'utf8');

describe('shop purchases', () => {
  const shop = src('pages/shop/shop.component.ts');
  it('every passive buy uses bumpWorldStat (no in-place mutation)', () => {
    expect(shop).not.toMatch(/u\[this\.gameState\.selectedWorldIndex\(\)\]\.\w+ (\+=|= )/);
    expect((shop.match(/bumpWorldStat\(/g) || []).length).toBe(27);
  });
  it('bumpWorldStat copies the selected realm record and records the purchase', () => {
    const gs = src('services/game-state.service.ts');
    const body = gs.slice(gs.indexOf('public bumpWorldStat('), gs.indexOf('public currentStats'));
    expect(body).toMatch(/this\.selectedWorldIndex\(\)/);
    expect(body).toMatch(/\{ \.\.\.all, \[w\]: \{ \.\.\.cur, \[stat\]: next \} \}/);
    expect(body).toMatch(/lastPurchase\.set/);
  });
  it('autoplay taps the same button a player taps, and flags spend without a level change', () => {
    const ap = src('autoplay/autoplay.service.ts');
    expect(ap).toMatch(/scrollIntoView/);
    expect(ap).toMatch(/balance dropped .* but the upgrade level did not change/);
    expect(ap).not.toMatch(/buyDamage|bumpWorldStat|worldUpgrades\.(set|update)/);
  });
  it('maps every stat to a real buy button tag', () => {
    for (const st of ['damage', 'attackSpeed', 'homingLevel', 'maxHealth', 'speed', 'magnetism', 'auraRadius', 'attackRange', 'aegisPlating']) {
      expect(shop).toContain(`data-ap="${buyTagFor(st)}"`);
    }
  });
});
