// Run feedback effects: screen shake, damage numbers, and the
// stamina arc rendering helpers. State stays on the game component
// (the template and the debug hooks read it there); this class owns
// the update logic and runs against that state through the host
// interface. Moved out of game.component.ts in the code organization
// pass (Oct 27, 2026); logic unchanged.
import { WritableSignal } from '@angular/core';
import { GameStateService, STAMINA } from '../../services/game-state.service';
import { phoenixSkinForWorld } from '../../components/particle-bg/particle-bg.component';

// The only shake triggers allowed to fire (spec Section 4); the
// harness asserts on the component's shake event log against this
// list. Moved with the FX logic in the organization pass.
import { SHAKE_ALLOWED_TRIGGERS, SHAKE_AMP, shakeAmplitude } from './shake';
export { SHAKE_ALLOWED_TRIGGERS, SHAKE_AMP, shakeAmplitude };
import { BossFight } from './boss-fight';

export interface FxHost {
  bossFight: BossFight;
  damageSprites: WritableSignal<Array<{ id: number, x: number, y: number, amount: number, born: number, size: number, color: string }>>;
  dmgPending: Map<string, { total: number, x: number, y: number, lastAdd: number, isBoss: boolean }>;
  dmgSpriteSeq: number;
  fxNow: WritableSignal<number>;
  gameState: GameStateService;
  shakeAmpPx: number;
  shakeDirX: number;
  shakeDirY: number;
  shakeDurMs: number;
  shakeEvents: Array<{ trigger: string, at: number }>;
  shakeStartPerf: number;
  shakeTransform: WritableSignal<string>;
  speedScale: number;
}

export class FxController {
  constructor(private host: FxHost) {}

  // Fire a screen shake. The trigger list in Section 4.3 is
  // exhaustive: boss death, an ultimate cast, the player taking a
  // boss-contact hit, and the two boss-stage set pieces (Phoenix King
  // False Rebirth and Eternal Phoenix Singularity, which land with
  // the boss stages and call this same method). Amplitude caps at 6
  // reference px, duration at 250 ms, linear decay, no rotation.
  // Reduced applies at the setting and automatically while the
  // Feather Brake is held.
triggerShake(trigger: string) {
    const amp = shakeAmplitude(trigger, this.host.gameState.screenShakeSetting(), !!this.host.gameState.playerMovement.braking,
      this.host.bossFight.bossTelegraphShowing(), this.host.speedScale);
    if (amp <= 0) return;
    // A light shake never cuts a stronger one short.
    if (this.host.shakeDurMs > 0 && amp < this.host.shakeAmpPx && performance.now() - this.host.shakeStartPerf < this.host.shakeDurMs) return;
    this.host.shakeAmpPx = amp;
    this.host.shakeDurMs = 250;
    this.host.shakeStartPerf = performance.now();
    const a = Math.random() * Math.PI * 2;
    this.host.shakeDirX = Math.cos(a);
    this.host.shakeDirY = Math.sin(a);
    this.host.shakeEvents.push({ trigger, at: Date.now() });
    if (this.host.shakeEvents.length > 200) this.host.shakeEvents.splice(0, this.host.shakeEvents.length - 200);
  }

  // Per-frame effects update, driven from the physics rAF: advances
  // the damage number merge window and sprite lifetimes, and the
  // shake decay.
updateFx(nowPerf: number) {
    this.host.fxNow.set(nowPerf);
    // Damage numbers: entries whose merge window (100 ms since the
    // last hit on that enemy) has closed become sprites.
    if (this.host.gameState.damageNumbersEnabled() && this.host.dmgPending.size > 0) {
      const now = Date.now();
      const sprites = [...this.host.damageSprites()];
      this.host.dmgPending.forEach((entry, key) => {
        if (now - entry.lastAdd < 100) return;
        this.host.dmgPending.delete(key);
        const amount = Math.max(1, Math.round(entry.total));
        // Pool cap 20: when full, the smallest pending number is
        // dropped, never the largest (spec Section 4.4).
        if (sprites.length >= 20) {
          let smallestIdx = -1;
          let smallestVal = amount;
          sprites.forEach((s, i) => { if (s.amount < smallestVal) { smallestVal = s.amount; smallestIdx = i; } });
          if (smallestIdx === -1) return; // the new number is the smallest: drop it
          sprites.splice(smallestIdx, 1);
        }
        const skin = phoenixSkinForWorld(this.host.gameState.selectedWorldIndex());
        const bright = skin.bright;
        const size = Math.round(Math.max(10, Math.min(18, 13 * this.host.speedScale)) * (entry.isBoss ? 1.3 : 1));
        sprites.push({
          id: ++this.host.dmgSpriteSeq, x: entry.x, y: entry.y, amount,
          born: nowPerf, size,
          color: `rgb(${Math.round(bright[0] * 255)}, ${Math.round(bright[1] * 255)}, ${Math.round(bright[2] * 255)})`
        });
      });
      this.host.damageSprites.set(sprites);
    } else if (this.host.dmgPending.size > 0) {
      this.host.dmgPending.clear();
    }
    // Sprite lifetimes: rise and fade over 0.6 s (positions computed
    // in the template helpers from the sprite's birth time).
    const live = this.host.damageSprites();
    if (live.length > 0 && nowPerf - live[0].born > 650) {
      this.host.damageSprites.set(live.filter(s => nowPerf - s.born <= 650));
    }
    // Shake decay.
    if (this.host.shakeDurMs > 0) {
      const p = (nowPerf - this.host.shakeStartPerf) / this.host.shakeDurMs;
      if (p >= 1) {
        this.host.shakeDurMs = 0;
        if (this.host.shakeTransform() !== '') this.host.shakeTransform.set('');
      } else {
        const mag = this.host.shakeAmpPx * (1 - p);
        this.host.shakeTransform.set(`translate(${ (this.host.shakeDirX * mag).toFixed(1) }px, ${ (this.host.shakeDirY * mag).toFixed(1) }px)`);
      }
    }
  }

damageSpriteTop(n: { y: number, born: number }): number {
    const age = Math.min(600, Math.max(0, this.host.fxNow() - n.born));
    return n.y - (age / 600) * 42 * this.host.speedScale;
  }

damageSpriteOpacity(n: { born: number }): number {
    const age = Math.min(600, Math.max(0, this.host.fxNow() - n.born));
    return 1 - (age / 600);
  }

  // Stamina arc background: a conic ring filled to the pool fraction
  // in the skin's mid color, shifting to the hostile color as the
  // pool drains (spec Section 2.5).
staminaArcBackground(): string {
    void this.host.fxNow();
    const frac = Math.max(0, Math.min(1, this.host.gameState.playerMovement.stamina / STAMINA.max));
    const skin = phoenixSkinForWorld(this.host.gameState.selectedWorldIndex());
    const mid = skin.mid;
    const midCss = `rgb(${Math.round(mid[0] * 255)}, ${Math.round(mid[1] * 255)}, ${Math.round(mid[2] * 255)})`;
    const color = frac > 0.35 ? midCss : 'rgb(255, 46, 107)';
    return `conic-gradient(${color} ${frac * 360}deg, rgba(255,255,255,0.12) 0deg)`;
  }

  // Record player-dealt damage for the number layer: totals merge per
  // enemy inside a 100 ms window (spec Section 4.4), which keeps Aura,
  // beams, and breath readable.
recordDamageNumber(enemyId: string, x: number, y: number, amount: number, isBoss: boolean) {
    if (!this.host.gameState.damageNumbersEnabled() || amount <= 0) return;
    // Spec Section 4.4 numbers the damage the PLAYER deals. In AI vs
    // AI there is no player at the controls, and the hits landing there
    // are the second AI's, so the layer stays silent in that mode.
    if (this.host.gameState.currentGameMode() === 'ai_vs_ai') return;
    const existing = this.host.dmgPending.get(enemyId);
    if (existing && Date.now() - existing.lastAdd < 100) {
      existing.total += amount;
      existing.x = x;
      existing.y = y;
      existing.lastAdd = Date.now();
    } else {
      this.host.dmgPending.set(enemyId, { total: amount, x, y, lastAdd: Date.now(), isBoss });
    }
  }
}
