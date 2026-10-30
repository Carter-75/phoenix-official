import { Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';

export interface ActiveBoost { key: string; icon: string; label: string; mult: number; endsAt: number; remainingSec: number; }

// Active boost chips (rewarded 2x ad boost and bought temporary
// multipliers). Each chip shows its icon, multiplier, a live countdown,
// and the local clock time it ends. Used in the main menu and the
// in-game HUD so the player always knows what is running.
@Component({
  selector: 'app-boost-indicator',
  standalone: true,
  template: `
    @if (boosts().length) {
      <div class="flex flex-wrap gap-1.5 pointer-events-none" [class.justify-center]="compact()">
        @for (b of boosts(); track b.key) {
          <div class="flex items-center gap-1.5 rounded-full border border-orange-400/50 bg-zinc-950/70 backdrop-blur-md text-white font-bold shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
               [class.px-2.5]="compact()" [class.py-0.5]="compact()" [class.text-xs]="compact()"
               [class.px-3]="!compact()" [class.py-1]="!compact()" [class.text-sm]="!compact()"
               [attr.aria-label]="b.label + ' x' + b.mult + ' active, ends at ' + endLabel(b.endsAt)">
            <span>{{ b.icon }}</span>
            <span class="text-orange-300">x{{ b.mult }}</span>
            <span>{{ b.label }}</span>
            <span class="tabular-nums text-white/90">{{ fmt(b.remainingSec) }}</span>
            @if (!compact()) { <span class="text-white/50 font-normal">ends {{ endLabel(b.endsAt) }}</span> }
          </div>
        }
      </div>
    }
  `,
})
export class BoostIndicatorComponent implements OnDestroy {
  private gs = inject(GameStateService);
  compact = input<boolean>(false);
  private now = signal(Date.now());
  private timer = setInterval(() => this.now.set(Date.now()), 1000);

  boosts = computed(() => activeBoosts(this.gs, this.now()));

  fmt(s: number) { const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  endLabel(t: number) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  ngOnDestroy() { clearInterval(this.timer); }
}

// Coin and XP boosts granted together with the same multiplier and end
// time (the 2x ad boost) merge into one "Coins + XP" chip.
export function activeBoosts(gs: GameStateService, now: number): ActiveBoost[] {
  const out: ActiveBoost[] = [];
  const c = gs.tempCoinMultiplier(), ce = gs.tempCoinMultiplierExpiresAt();
  const x = gs.tempXpMultiplier(), xe = gs.tempXpMultiplierExpiresAt();
  const coinOn = c > 1 && ce > now, xpOn = x > 1 && xe > now;
  const rem = (e: number) => Math.max(0, Math.ceil((e - now) / 1000));
  if (coinOn && xpOn && c === x && Math.abs(ce - xe) < 2000) {
    out.push({ key: 'both', icon: '⚡', label: 'Coins + XP', mult: c, endsAt: ce, remainingSec: rem(ce) });
  } else {
    if (coinOn) out.push({ key: 'coin', icon: '🪙', label: 'Coins', mult: c, endsAt: ce, remainingSec: rem(ce) });
    if (xpOn) out.push({ key: 'xp', icon: '✨', label: 'XP', mult: x, endsAt: xe, remainingSec: rem(xe) });
  }
  return out;
}
