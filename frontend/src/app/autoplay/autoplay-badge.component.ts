import { Component, inject } from '@angular/core';
import { AutoplayService } from './autoplay.service';

// In-game indicator while the AI Autoplay tester runs. data-ui keeps
// presses on it out of the game's input pipeline; data-ap-badge keeps
// them from counting as a manual takeover.
@Component({
  selector: 'app-autoplay-badge',
  standalone: true,
  template: `
    @if (ap.running()) {
      <div data-ui data-ap-badge class="fixed top-2 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 border border-orange-400/60 text-orange-200 text-xs font-bold shadow-lg pointer-events-auto">
        <span class="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
        <span>{{ ap.paused() ? 'AI playing, tap Stop' : 'AI Autoplay' }}</span>
        <button data-ap-badge (click)="ap.stop()" class="ml-1 px-2 py-0.5 rounded-full bg-red-600 text-white font-black">Stop</button>
      </div>
    }
  `,
})
export class AutoplayBadgeComponent { ap = inject(AutoplayService); }
