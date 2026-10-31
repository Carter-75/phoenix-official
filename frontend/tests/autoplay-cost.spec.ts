import { describe, it, expect } from 'vitest';
import { compactObservation, quietPlay } from '../src/app/autoplay/autoplay-agent';

describe('cost cuts', () => {
  const obs: any = { screen: 'game', guide: { screen: 'game', realm: 1, valid: ['play'], needs: [], controls: ['x'], howTo: 'long' } };
  it('sends controls and howTo only when the screen changes', () => {
    expect(compactObservation(obs, 'menu').guide).toEqual(obs.guide);
    const c: any = compactObservation(obs, 'game').guide;
    expect(c.howTo).toBeUndefined(); expect(c.controls).toBeUndefined(); expect(c.valid).toEqual(['play']);
  });
  it('re-issues only a play that just ran out of seconds', () => {
    const a: any = { action: 'play', seconds: 30, until: 'run_end' };
    const quiet = 'played 30 s, ended: time up; realm 1 -> 1; deaths +0; realms cleared +0; coins 1 -> 5';
    expect(quietPlay(a, { ok: true, note: quiet } as any)).toBe(true);
    expect(quietPlay(a, { ok: true, note: quiet.replace('deaths +0', 'deaths +1') } as any)).toBe(false);
    expect(quietPlay(a, { ok: true, note: quiet.replace('1 -> 1', '1 -> 2') } as any)).toBe(false);
    expect(quietPlay({ ...a, until: 'time' }, { ok: true, note: quiet } as any)).toBe(false);
  });
});
