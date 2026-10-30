// How to Play: an interactive practice arena (Oct 30, 2026).
//
// The player performs each gesture for real and the step advances
// when the gesture is detected. The arena runs its own tiny flight
// sim on a 2D canvas and NEVER touches the live run: no physics
// engine, no enemies that deal damage, no GameStateService writes,
// no ads, no coins or XP granted, no realm, loadout, purchase, or
// boss carryover state read for writing. The only thing it persists
// is the tutorial completion flag (tutorial-progress.ts).
//
// Gesture rules come from tutorial-input.ts, a pure mirror of the
// game component's touch grammar using the game's own constants.
import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameStateService } from '../../services/game-state.service';
import { StorageService } from '../../services/storage.service';
import { TutorialGestureParser, TutorialStamina, SlotFamily } from '../../tutorial/tutorial-input';
import { TUTORIAL_STEPS, TutorialStep, HudTarget } from '../../tutorial/tutorial-steps';
import { TUTORIAL_STAMINA } from '../../tutorial/tutorial-copy-numbers';
import { writeTutorialState } from '../../tutorial/tutorial-progress';
import { getPhoenixFrames, flapFrameIndex } from '../../components/particle-bg/phoenix-sprite';
import { phoenixSkinById } from '../../components/particle-bg/phoenix-skins';
import { TouchCompatGuard } from '../../components/particle-bg/touch-compat';
import { levelHpBonusFor } from '../../data/balance.constants';

// Practice cooldowns (seconds). Shortened on purpose so the sweep is
// visible without a long wait; the card says so.
const PRACTICE_CD: Record<'tap' | 'double' | 'triple' | 'hold', number> = { tap: 1.2, double: 2.5, triple: 4, hold: 3 };

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; ring?: boolean; }
interface Pickup { x: number; y: number; kind: 'spark' | 'coin' | 'xp'; taken: boolean; bob: number; }
interface Wisp { x: number; y: number; r: number; hit: number; phase: number; }

const FAMILY_LABEL: Record<SlotFamily, string> = { tap: 'TAP (2 taps)', double: 'DBL (3 taps)', triple: 'ULT (4 taps)' };

@Component({
  selector: 'app-tutorial',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div #root class="tut-root fixed inset-0 z-[60] overflow-hidden select-none touch-none"
       (contextmenu)="$event.preventDefault()">
    <canvas #canvas class="absolute inset-0 w-full h-full block"></canvas>

    <!-- Mock HUD rail: the same layout and styling as the game HUD. -->
    <div class="absolute bottom-0 inset-x-0 px-4 flex flex-col gap-2 pointer-events-none"
         style="padding-bottom: max(env(safe-area-inset-bottom), 16px)">
      <div class="flex items-center justify-center">
        <div class="flex items-center gap-3" data-tut="hp">
          <div class="hp-track relative h-3.5 border border-white/15 rounded-full overflow-hidden shrink-0" style="width: 38vw">
            <div class="hp-fill absolute inset-y-0 left-0 rounded-full" style="width: 100%"></div>
          </div>
          <span class="text-red-300 font-bold text-sm shrink-0">{{ maxHp() }} / {{ maxHp() }}</span>
          <span data-tut="level" class="shrink-0 px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/40 text-orange-300 font-black text-[11px] tracking-widest">LV {{ gameState.level() }}</span>
        </div>
      </div>
      <div class="flex items-end justify-between gap-3">
        <div class="flex items-center gap-2 pb-1">
          <div data-tut="stamina" class="relative w-9 h-9 rounded-full flex items-center justify-center transition-shadow duration-300 shrink-0"
               [style.background]="staminaBg()"
               [style.box-shadow]="gliding() ? '0 0 14px rgba(255,255,255,0.55)' : '0 0 6px rgba(0,0,0,0.5)'">
            <div class="w-6 h-6 rounded-full bg-black/70"></div>
            @if (staminaFlash()) {
              <span class="absolute -top-6 left-1/2 -translate-x-1/2 text-[11px] font-black whitespace-nowrap drop-shadow"
                    [class]="staminaFlash()!.startsWith('+') ? 'text-emerald-300' : 'text-orange-200'">{{ staminaFlash() }}</span>
            }
          </div>
          <div data-tut="pills" class="flex items-center gap-1.5 transition-opacity duration-300"
               [style.opacity]="step().id === 'gadgets' ? 1 : 0.0">
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-orange-400/20 border-orange-300/70 shadow-[0_0_12px_rgba(255,120,40,0.55)] animate-pulse">
              <span class="text-sm">🛡️</span><span class="text-[10px] font-black tracking-widest uppercase text-orange-200">Aegis</span>
            </div>
            <div class="hidden min-[380px]:flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-red-500/25 border-red-300/70 shadow-[0_0_12px_rgba(255,80,40,0.55)] animate-pulse">
              <span class="text-sm">⚡</span><span class="text-[10px] font-black tracking-widest uppercase text-red-200">Overcharge</span>
            </div>
          </div>
        </div>
        <div data-tut="slots" class="flex gap-2 md:gap-3">
          @for (s of slotDefs; track s.key) {
            <div [attr.data-tut]="'slot-' + s.key"
                 class="relative w-14 h-14 md:w-16 md:h-16 bg-zinc-950/70 backdrop-blur-md border border-white/15 rounded-2xl overflow-hidden flex items-center justify-center transition-transform duration-150"
                 [class.scale-110]="slotPulse() === s.key"
                 [class.ring-2]="s.key === 'hold' && holdProgress() > 0" [class.ring-orange-300]="s.key === 'hold' && holdProgress() > 0">
              <span class="text-3xl z-10" [class.opacity-50]="cooldownLeft(s.key) > 0">{{ s.icon }}</span>
              <span class="absolute bottom-1 inset-x-0 z-20 text-center text-[9px] font-bold text-white/50 uppercase tracking-wider">{{ s.label }}</span>
              @if (cooldownLeft(s.key) > 0) {
                <div class="absolute inset-0 z-[15]" [style.background]="sweep(s.key)"></div>
                <span class="absolute z-20 text-white font-bold drop-shadow-md">{{ cooldownLeft(s.key).toFixed(1) }}</span>
              }
              @if (s.key === 'hold' && holdProgress() > 0) {
                <div class="absolute bottom-0 left-0 w-full bg-orange-400/40" [style.height]="holdProgress() * 100 + '%'"></div>
              }
            </div>
          }
        </div>
      </div>
    </div>

    <!-- Hold charge ring at the finger, as in the game. -->
    @if (holdProgress() > 0) {
      <div class="fixed pointer-events-none z-40 -translate-x-1/2 -translate-y-1/2" [style.left.px]="pointer().x" [style.top.px]="pointer().y">
        <div class="w-24 h-24 rounded-full flex items-center justify-center"
             [style.background]="'conic-gradient(rgba(255,77,0,0.85) ' + (holdProgress()*360) + 'deg, rgba(255,255,255,0.08) 0deg)'">
          <div class="w-20 h-20 rounded-full bg-black/40 border border-orange-300/40 flex items-center justify-center">
            <span class="text-orange-100/80 text-xs font-bold">{{ (holdProgress()*100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    }

    <!-- Spotlight on the HUD element the step is about. -->
    @if (spot(); as r) {
      <div class="tut-spot pointer-events-none absolute z-40 rounded-2xl"
           [style.left.px]="r.x - 8" [style.top.px]="r.y - 8" [style.width.px]="r.w + 16" [style.height.px]="r.h + 16"></div>
    }

    <!-- Gesture demo finger. -->
    @if (showFinger()) {
      <div class="pointer-events-none absolute z-40 left-1/2 tut-finger-zone" [attr.data-anim]="step().finger">
        @switch (step().finger) {
          @case ('drag') { <div class="tut-finger tut-drag"></div> }
          @case ('glide') { <div class="tut-finger tut-glide"></div><div class="tut-trail-line"></div> }
          @case ('tap2') { <div class="tut-finger tut-tap tut-tap2"></div><div class="tut-ripple tut-tap2r"></div><span class="tut-count">x2</span> }
          @case ('tap3') { <div class="tut-finger tut-tap tut-tap3"></div><div class="tut-ripple tut-tap3r"></div><span class="tut-count">x3</span> }
          @case ('tap4') { <div class="tut-finger tut-tap tut-tap4"></div><div class="tut-ripple tut-tap4r"></div><span class="tut-count">x4</span> }
          @case ('hold') { <div class="tut-finger tut-press"></div><div class="tut-hold-ring"></div> }
          @case ('flick') { <div class="tut-finger tut-flick"></div><div class="tut-flick-trail"></div> }
          @case ('roll') { <div class="tut-finger tut-anchor"></div><div class="tut-finger tut-second tut-roll2"></div><div class="tut-ripple tut-roll2r"></div> }
          @case ('brake') { <div class="tut-finger tut-anchor"></div><div class="tut-finger tut-second tut-brake2"></div> }
        }
      </div>
    }

    <!-- Top bar: back, progress, skip. -->
    <div data-ui class="absolute top-0 inset-x-0 z-50 flex items-center gap-3 px-3"
         style="padding-top: max(env(safe-area-inset-top), 10px)">
      <button (click)="back()" [disabled]="index() === 0"
              class="press glass w-9 h-9 rounded-full text-white/80 font-black disabled:opacity-30 shrink-0" aria-label="Previous step">‹</button>
      <div class="flex-1 flex flex-col gap-1 min-w-0">
        <div class="flex justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-orange-200/80">
          <span class="truncate">{{ step().section }}</span><span>{{ index() + 1 }} / {{ steps.length }}</span>
        </div>
        <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-orange-400 to-red-500 transition-all duration-500" [style.width]="((index() + 1) / steps.length * 100) + '%'"></div>
        </div>
      </div>
      <button (click)="skipAll()" class="press glass px-3 h-9 rounded-full text-white/70 hover:text-white text-xs font-bold tracking-widest uppercase shrink-0">Skip</button>
    </div>

    <!-- Step card. -->
    <div data-ui class="absolute inset-x-0 z-50 flex justify-center px-3 pointer-events-none"
         style="top: calc(max(env(safe-area-inset-top), 10px) + 48px)">
      @for (k of [cardKey()]; track k) {
        <div class="tut-card pointer-events-auto w-full max-w-md rounded-3xl border border-orange-400/30 bg-zinc-950/80 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_30px_rgba(255,90,20,0.15)] p-4 sm:p-5">
          <div class="flex items-start gap-3">
            <div class="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-orange-500/30 to-red-600/30 border border-orange-300/40 flex items-center justify-center text-2xl">{{ step().icon }}</div>
            <div class="min-w-0 flex-1">
              <h2 class="text-lg sm:text-xl font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-orange-300 to-red-400 leading-tight">{{ step().title }}</h2>
              <p class="mt-1 text-[13px] sm:text-sm leading-snug text-white/85">{{ step().body }}</p>
              @if (!isTouch && step().desktop) {
                <p class="mt-1.5 text-[12px] text-orange-200/80"><span class="font-bold">Desktop:</span> {{ step().desktop }}</p>
              }
              @if (isSlotStep()) {
                <p class="mt-1.5 text-[11px] text-white/45">Practice cooldowns are shortened here.</p>
              }
            </div>
          </div>
          @if (feedback()) {
            <div class="mt-3 px-3 py-1.5 rounded-xl text-[12px] font-bold border tut-pop"
                 [class]="feedbackGood() ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200' : 'bg-red-500/15 border-red-400/40 text-red-200'">{{ feedback() }}</div>
          }
          @if (goalProgressText()) {
            <div class="mt-3 flex items-center gap-2">
              <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div class="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-300 transition-all duration-200" [style.width]="goalPct() + '%'"></div>
              </div>
              <span class="text-[11px] font-bold text-orange-200/80 whitespace-nowrap">{{ goalProgressText() }}</span>
            </div>
          }
          <div class="mt-3 flex items-center justify-end gap-2">
            @if (step().goal === 'info') {
              @if (isLast()) {
                <button (click)="finish()" class="press px-5 py-2 rounded-full font-black text-white bg-gradient-to-r from-orange-500 to-red-600 shadow-[0_0_20px_rgba(255,90,20,0.45)]">Back to menu</button>
              } @else {
                <button (click)="next()" class="press px-5 py-2 rounded-full font-black text-white bg-gradient-to-r from-orange-500 to-red-600 shadow-[0_0_20px_rgba(255,90,20,0.45)]">Next</button>
              }
            } @else {
              <button (click)="next()" class="press px-3 py-1.5 rounded-full text-[11px] font-bold text-white/45 hover:text-white/80 uppercase tracking-widest">Skip step</button>
            }
          </div>
        </div>
      }
    </div>

    @if (celebrate()) {
      <div class="pointer-events-none absolute inset-0 z-[55] flex items-center justify-center">
        <div class="tut-check w-24 h-24 rounded-full bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center text-5xl text-white font-black shadow-[0_0_60px_rgba(255,100,30,0.8)]">✓</div>
      </div>
    }
  </div>
  `,
  styles: [`
    .tut-root { background: radial-gradient(ellipse at 50% 40%, #2a0d05 0%, #120604 55%, #050202 100%); }
    .tut-card { animation: tutCardIn 0.38s cubic-bezier(.2,.9,.3,1.2) both; }
    @keyframes tutCardIn { from { opacity: 0; transform: translateY(-14px) scale(0.97); } to { opacity: 1; transform: none; } }
    .tut-pop { animation: tutPop 0.25s ease-out both; }
    @keyframes tutPop { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: none; } }
    .tut-check { animation: tutCheck 0.9s ease-out both; }
    @keyframes tutCheck { 0% { opacity: 0; transform: scale(0.3); } 30% { opacity: 1; transform: scale(1.1); } 60% { transform: scale(1); opacity: 1; } 100% { opacity: 0; transform: scale(1.25); } }
    .tut-spot { box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,170,60,0.95), 0 0 24px rgba(255,120,30,0.8); transition: all 0.35s ease; animation: tutSpot 1.6s ease-in-out infinite; }
    @keyframes tutSpot { 50% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.55), 0 0 0 3px rgba(255,200,90,1), 0 0 36px rgba(255,120,30,0.95); } }
    .tut-finger-zone { top: 58%; width: 0; height: 0; }
    .tut-finger { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 9999px;
      background: radial-gradient(circle at 40% 35%, rgba(255,255,255,0.95), rgba(255,220,190,0.75) 55%, rgba(255,150,80,0.35));
      box-shadow: 0 0 0 3px rgba(255,255,255,0.25), 0 6px 18px rgba(0,0,0,0.5), 0 0 22px rgba(255,140,60,0.6); }
    .tut-ripple { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 9999px; border: 3px solid rgba(255,190,110,0.9); opacity: 0; }
    .tut-count { position: absolute; left: 30px; top: -44px; font-weight: 900; font-size: 18px; color: #ffd8a8; text-shadow: 0 0 10px rgba(255,120,30,0.9); }
    .tut-drag { animation: tutDrag 2.6s ease-in-out infinite; }
    @keyframes tutDrag { 0% { transform: translate(-70px, 20px); } 30% { transform: translate(40px, -40px); } 60% { transform: translate(70px, 30px); } 100% { transform: translate(-70px, 20px); } }
    .tut-glide { animation: tutGlide 2.4s linear infinite; }
    @keyframes tutGlide { 0% { transform: translate(-110px, 0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translate(110px, 0); opacity: 0; } }
    .tut-trail-line { position: absolute; left: -110px; width: 220px; top: -1px; height: 2px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent); }
    .tut-tap2 { animation: tutTap2 1.6s ease-in-out infinite; } .tut-tap2r { animation: tutTap2r 1.6s ease-out infinite; }
    .tut-tap3 { animation: tutTap3 1.8s ease-in-out infinite; } .tut-tap3r { animation: tutTap3r 1.8s ease-out infinite; }
    .tut-tap4 { animation: tutTap4 2.0s ease-in-out infinite; } .tut-tap4r { animation: tutTap4r 2.0s ease-out infinite; }
    @keyframes tutTap2 { 0%,100% { transform: scale(1); } 8% { transform: scale(0.75); } 16% { transform: scale(1); } 24% { transform: scale(0.75); } 32% { transform: scale(1); } }
    @keyframes tutTap2r { 0%,7% { opacity: 0; transform: scale(0.6); } 9% { opacity: 1; } 20% { opacity: 0; transform: scale(1.8); } 23% { opacity: 0; transform: scale(0.6); } 25% { opacity: 1; } 40%,100% { opacity: 0; transform: scale(2); } }
    @keyframes tutTap3 { 0%,100% { transform: scale(1); } 7% { transform: scale(0.75); } 14% { transform: scale(1); } 21% { transform: scale(0.75); } 28% { transform: scale(1); } 35% { transform: scale(0.75); } 42% { transform: scale(1); } }
    @keyframes tutTap3r { 0%,6% { opacity: 0; transform: scale(0.6); } 8% { opacity: 1; } 17% { opacity: 0; transform: scale(1.8); } 20% { opacity: 0; transform: scale(0.6); } 22% { opacity: 1; } 31% { opacity: 0; transform: scale(1.8); } 34% { opacity: 0; transform: scale(0.6); } 36% { opacity: 1; } 50%,100% { opacity: 0; transform: scale(2); } }
    @keyframes tutTap4 { 0%,100% { transform: scale(1); } 6% { transform: scale(0.75); } 12% { transform: scale(1); } 18% { transform: scale(0.75); } 24% { transform: scale(1); } 30% { transform: scale(0.75); } 36% { transform: scale(1); } 42% { transform: scale(0.75); } 48% { transform: scale(1); } }
    @keyframes tutTap4r { 0%,5% { opacity: 0; transform: scale(0.6); } 7% { opacity: 1; } 15% { opacity: 0; transform: scale(1.8); } 17% { opacity: 0; transform: scale(0.6); } 19% { opacity: 1; } 27% { opacity: 0; transform: scale(1.8); } 29% { opacity: 0; transform: scale(0.6); } 31% { opacity: 1; } 39% { opacity: 0; transform: scale(1.8); } 41% { opacity: 0; transform: scale(0.6); } 43% { opacity: 1; } 58%,100% { opacity: 0; transform: scale(2.2); } }
    .tut-press { animation: tutPress 2.6s ease-in-out infinite; }
    @keyframes tutPress { 0% { transform: scale(1); } 10%,85% { transform: scale(0.8); } 100% { transform: scale(1); } }
    .tut-hold-ring { position: absolute; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 9999px; border: 4px solid rgba(255,120,40,0.9); animation: tutHoldRing 2.6s linear infinite; }
    @keyframes tutHoldRing { 0%,20% { clip-path: inset(100% 0 0 0); opacity: 0.4; } 85% { clip-path: inset(0 0 0 0); opacity: 1; } 100% { opacity: 0; transform: scale(1.3); } }
    .tut-flick { animation: tutFlick 1.6s cubic-bezier(.3,0,.1,1) infinite; }
    @keyframes tutFlick { 0%,20% { transform: translate(-40px, 40px) scale(0.85); opacity: 1; } 32% { transform: translate(60px, -70px) scale(1); opacity: 1; } 45%,100% { transform: translate(70px, -80px); opacity: 0; } }
    .tut-flick-trail { position: absolute; left: -40px; top: -40px; width: 150px; height: 4px; transform-origin: 0 50%; transform: rotate(-48deg); border-radius: 9999px; background: linear-gradient(90deg, rgba(255,160,60,0), rgba(255,200,120,0.95)); animation: tutFlickTrail 1.6s ease-out infinite; }
    @keyframes tutFlickTrail { 0%,22% { opacity: 0; } 30% { opacity: 1; } 50%,100% { opacity: 0; } }
    .tut-anchor { transform: translate(-55px, 0); animation: tutAnchor 2.4s ease-in-out infinite; }
    @keyframes tutAnchor { 0%,100% { transform: translate(-55px, 0); } 50% { transform: translate(-45px, -8px); } }
    .tut-second { left: 55px; }
    .tut-roll2 { animation: tutRoll2 1.4s ease-in-out infinite; }
    @keyframes tutRoll2 { 0%,30% { opacity: 0; transform: scale(1.3); } 40% { opacity: 1; transform: scale(0.75); } 50% { opacity: 1; transform: scale(1); } 60%,100% { opacity: 0; } }
    .tut-roll2r { left: 55px; animation: tutRoll2r 1.4s ease-out infinite; }
    @keyframes tutRoll2r { 0%,39% { opacity: 0; transform: scale(0.6); } 42% { opacity: 1; } 65%,100% { opacity: 0; transform: scale(2); } }
    .tut-brake2 { animation: tutBrake2 2.6s ease-in-out infinite; }
    @keyframes tutBrake2 { 0%,15% { opacity: 0; transform: scale(1.3); } 25%,80% { opacity: 1; transform: scale(0.78); } 90%,100% { opacity: 0; transform: scale(1.2); } }
    @media (prefers-reduced-motion: reduce) { .tut-card, .tut-check, .tut-spot { animation: none; } }
  `],
})
export class TutorialComponent implements AfterViewInit, OnDestroy {
  public gameState = inject(GameStateService);
  private storage = inject(StorageService);
  private zone = inject(NgZone);

  @ViewChild('root', { static: true }) rootRef!: ElementRef<HTMLDivElement>;
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly steps = TUTORIAL_STEPS;
  readonly isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);
  readonly slotDefs: { key: 'tap' | 'hold' | 'double' | 'triple'; icon: string; label: string }[] = [
    { key: 'tap', icon: '🔥', label: 'Tap' },
    { key: 'hold', icon: '🌀', label: 'Hold' },
    { key: 'double', icon: '✨', label: 'Dbl' },
    { key: 'triple', icon: '☄️', label: 'Ult' },
  ];

  index = signal(0);
  step = computed<TutorialStep>(() => this.steps[this.index()]);
  isLast = computed(() => this.index() === this.steps.length - 1);
  isSlotStep = computed(() => ['slot-tap', 'slot-double', 'slot-triple', 'hold'].includes(this.step().goal));
  cardKey = signal(0);
  feedback = signal<string>('');
  feedbackGood = signal(false);
  celebrate = signal(false);
  goalPct = signal(0);
  goalProgressText = signal('');
  stamina = signal(100);
  gliding = signal(false);
  staminaFlash = signal<string | null>(null);
  holdProgress = signal(0);
  pointer = signal({ x: 0, y: 0 });
  spot = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  slotPulse = signal<string | null>(null);
  interacting = signal(false);
  cooldowns = signal<Record<string, number>>({ tap: 0, hold: 0, double: 0, triple: 0 });
  maxHp = computed(() => 100 + levelHpBonusFor(this.gameState.level()));
  showFinger = computed(() => this.step().finger !== 'none' && !this.interacting() && !this.celebrate());

  private parser!: TutorialGestureParser;
  private stam = new TutorialStamina(TUTORIAL_STAMINA);
  private raf = 0;
  private lastFrame = 0;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0; private H = 0; private dpr = 1;
  private px = 0; private py = 0; private vx = 0; private vy = 0;
  private tx = 0; private ty = 0;
  private heading = -Math.PI / 2;
  private flap = 0;
  private dashUntil = 0; private dashX = 0; private dashY = 0;
  private rollUntil = 0; private rollSign = 1;
  private iframeUntil = 0;
  private braking = false;
  private particles: Particle[] = [];
  private pickups: Pickup[] = [];
  private wisps: Wisp[] = [];
  private trail: { x: number; y: number; life: number }[] = [];
  private cdEnd: Record<string, number> = { tap: 0, hold: 0, double: 0, triple: 0 };
  private progress = 0;
  private advancing = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private mouseMode = false;
  private touchCompat = new TouchCompatGuard();
  private mouseX = 0; private mouseY = 0;
  private lastSpotCheck = 0;
  private sprite: HTMLCanvasElement[] = [];
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions | undefined][] = [];

  constructor() {
    this.parser = new TutorialGestureParser({
      onSteer: (dx, dy) => this.onSteer(dx, dy),
      onSlot: (f) => this.onSlot(f),
      onDash: (dx, dy) => this.tryDash(dx, dy),
      onRoll: () => this.tryRoll(),
      onBrake: (held) => { this.braking = held; },
      onHoldFire: () => this.onHoldFire(),
    });
  }

  ngAfterViewInit(): void {
    try {
      const frames = getPhoenixFrames(phoenixSkinById('ember')).frames;
      this.sprite = frames.map(t => t.image as HTMLCanvasElement).filter(Boolean);
    } catch { this.sprite = []; }
    this.ctx = this.canvasRef.nativeElement.getContext('2d');
    this.resize();
    this.px = this.W / 2; this.py = this.H * 0.55; this.tx = this.px; this.ty = this.py;
    this.spawnWisps();
    this.enterStep();
    const root = this.rootRef.nativeElement;
    const on = (t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts); this.listeners.push([t, type, fn, opts]);
    };
    this.zone.runOutsideAngular(() => {
      on(root, 'touchstart', e => this.onTouchStart(e as TouchEvent), { passive: false });
      on(root, 'touchmove', e => this.onTouchMove(e as TouchEvent), { passive: false });
      on(root, 'touchend', e => this.onTouchEnd(e as TouchEvent), { passive: false });
      on(root, 'touchcancel', e => this.onTouchEnd(e as TouchEvent), { passive: false });
      on(root, 'mousedown', e => this.onMouseDown(e as MouseEvent));
      on(window, 'mousemove', e => this.onMouseMove(e as MouseEvent));
      on(window, 'mouseup', e => this.onMouseUp(e as MouseEvent));
      on(window, 'keydown', e => this.onKey(e as KeyboardEvent, true));
      on(window, 'keyup', e => this.onKey(e as KeyboardEvent, false));
      on(window, 'resize', () => this.resize());
      this.lastFrame = performance.now();
      const loop = (t: number) => { this.frame(t); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.parser.dispose();
    this.timers.forEach(clearTimeout);
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
  }

  // ---------- navigation ----------
  next(): void { this.go(this.index() + 1); }
  back(): void { if (this.index() > 0) this.go(this.index() - 1); }
  private go(i: number): void {
    if (i >= this.steps.length) { this.finish(); return; }
    this.index.set(Math.max(0, i));
    this.enterStep();
  }
  skipAll(): void {
    writeTutorialState(this.storage, this.isLast() ? 'done' : 'skipped');
    this.exit();
  }
  finish(): void {
    writeTutorialState(this.storage, 'done');
    this.exit();
  }
  private exit(): void { this.gameState.activeScreen.set('menu'); }

  private enterStep(): void {
    this.advancing = false;
    this.progress = 0;
    this.feedback.set('');
    this.cardKey.update(k => k + 1);
    this.pickups = [];
    const goal = this.step().goal;
    this.parser.holdReady = true;
    if (goal === 'dash' || goal === 'roll') this.stam.stamina = this.stam.rules.max;
    if (goal === 'spark') {
      this.stam.stamina = 30; // regen is held (sparkHold) until the cell is taken
      this.pickups.push({ x: this.W * 0.72, y: this.arenaMidY(), kind: 'spark', taken: false, bob: 0 });
    }
    if (goal === 'pickups') {
      const cy = this.arenaMidY();
      const pts: [number, number, 'coin' | 'xp'][] = [[0.2, -0.12, 'coin'], [0.35, 0.1, 'xp'], [0.5, -0.15, 'coin'], [0.65, 0.12, 'xp'], [0.8, -0.08, 'coin'], [0.5, 0.18, 'xp']];
      for (const [fx, fy, k] of pts) this.pickups.push({ x: this.W * fx, y: cy + this.H * fy, kind: k, taken: false, bob: Math.random() * 6 });
    }
    this.sparkHold = goal === 'spark';
    this.updateGoalText();
    this.spotTarget = this.step().highlight;
    this.measureSpot();
  }
  private sparkHold = false;
  private spotTarget: HudTarget = 'none';

  private arenaMidY(): number { return this.H * 0.56; }

  private succeed(msg: string): void {
    if (this.advancing) return;
    this.advancing = true;
    this.zone.run(() => {
      this.feedback.set(msg); this.feedbackGood.set(true);
      this.goalPct.set(100);
      this.celebrate.set(true);
    });
    this.timers.push(setTimeout(() => this.zone.run(() => { this.celebrate.set(false); this.next(); }), 950));
  }

  private warn(msg: string): void {
    this.zone.run(() => { this.feedback.set(msg); this.feedbackGood.set(false); });
  }

  private updateGoalText(): void {
    const g = this.step().goal;
    let pct = 0, txt = '';
    if (g === 'steer') { pct = Math.min(100, this.progress * 100); txt = 'Fly around'; }
    else if (g === 'brake') { pct = Math.min(100, this.progress / 0.8 * 100); txt = 'Hold the brake'; }
    else if (g === 'glide') { pct = Math.min(100, this.stam.straightTime / 1.2 * 100); txt = this.stam.gliding ? 'Gliding' : 'Straight flight'; }
    else if (g === 'pickups') { const n = this.pickups.filter(p => p.taken).length; pct = n / Math.max(1, this.pickups.length) * 100; txt = `${n} / ${this.pickups.length}`; }
    else if (g === 'hold') { pct = this.parser.holdProgress * 100; txt = 'Charge'; }
    this.goalPct.set(pct);
    this.goalProgressText.set(txt);
  }

  // ---------- gesture results ----------
  private onSteer(dx: number, dy: number): void {
    if (this.mouseMode) return;
    this.tx = this.clampX(this.tx + dx);
    this.ty = this.clampY(this.ty + dy);
  }

  private onSlot(f: SlotFamily): void {
    const want = this.step().goal;
    const map: Record<string, SlotFamily> = { 'slot-tap': 'tap', 'slot-double': 'double', 'slot-triple': 'triple' };
    if (performance.now() < this.cdEnd[f]) {
      if (map[want] === f) this.warn('That slot is still cooling down. Wait for the sweep to finish.');
      return;
    }
    this.castSlot(f);
    if (map[want]) {
      if (map[want] === f) this.succeed(`${FAMILY_LABEL[f].split(' ')[0]} cast. Nice!`);
      else this.warn(`That was ${FAMILY_LABEL[f]}. Try ${FAMILY_LABEL[map[want]]}, all within a quick burst.`);
    }
  }

  private castSlot(f: SlotFamily | 'hold'): void {
    const now = performance.now();
    this.cdEnd[f] = now + PRACTICE_CD[f] * 1000;
    this.zone.run(() => { this.slotPulse.set(f); });
    this.timers.push(setTimeout(() => this.zone.run(() => this.slotPulse.set(null)), 180));
    const hx = Math.cos(this.heading), hy = Math.sin(this.heading);
    if (f === 'tap') {
      for (let i = -1; i <= 1; i++) {
        const a = this.heading + i * 0.18;
        this.particles.push({ x: this.px + hx * 30, y: this.py + hy * 30, vx: Math.cos(a) * 700, vy: Math.sin(a) * 700, life: 0.9, max: 0.9, size: 9, color: '255,140,40' });
      }
    } else if (f === 'double') {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.particles.push({ x: this.px, y: this.py, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: 1.0, max: 1.0, size: 6, color: '255,220,120' });
      }
    } else if (f === 'triple') {
      this.particles.push({ x: this.px, y: this.py, vx: 0, vy: 0, life: 1.1, max: 1.1, size: Math.min(this.W, this.H) * 0.55, color: '255,90,30', ring: true });
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2, s = 200 + Math.random() * 500;
        this.particles.push({ x: this.px, y: this.py, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.2, max: 1.2, size: 7, color: '255,180,60' });
      }
    } else {
      this.particles.push({ x: this.px, y: this.py, vx: 0, vy: 0, life: 1.4, max: 1.4, size: 170, color: '255,120,40', ring: true });
    }
  }

  private onHoldFire(): void {
    this.castSlot('hold');
    this.parser.holdReady = false;
    if (this.step().goal === 'hold') this.succeed('Hold cast. Nice!');
  }

  private tryDash(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const now = performance.now();
    const cost = this.stam.costOf(TUTORIAL_STAMINA.dashCost);
    if (!this.stam.spend(TUTORIAL_STAMINA.dashCost, now)) { this.warn('Not enough stamina. Let the ring refill.'); return; }
    this.flashStamina(`-${cost}`);
    this.dashX = dx / len; this.dashY = dy / len;
    this.dashUntil = now + TUTORIAL_STAMINA.dashMs;
    this.iframeUntil = now + TUTORIAL_STAMINA.dashMs + 50;
    if (this.step().goal === 'dash') this.succeed('Dash! Invulnerable for a moment.');
  }

  private tryRoll(): void {
    const now = performance.now();
    if (now < this.rollUntil) return;
    const cost = this.stam.costOf(TUTORIAL_STAMINA.rollCost);
    if (!this.stam.spend(TUTORIAL_STAMINA.rollCost, now)) { this.warn('Not enough stamina. Let the ring refill.'); return; }
    this.flashStamina(`-${cost}`);
    this.rollSign = -this.rollSign;
    this.rollUntil = now + TUTORIAL_STAMINA.rollMs;
    this.iframeUntil = this.rollUntil;
    if (this.step().goal === 'roll') this.succeed('Air Roll! Untouchable while rolling.');
  }

  private flashStamina(txt: string): void {
    this.zone.run(() => this.staminaFlash.set(txt));
    this.timers.push(setTimeout(() => this.zone.run(() => this.staminaFlash.set(null)), 900));
  }

  // ---------- raw input ----------
  private isUi(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && typeof t.closest === 'function' && !!t.closest('button, a, input, [data-ui] .tut-card');
  }

  private onTouchStart(e: TouchEvent): void {
    this.touchCompat.markTouch(Date.now());
    if (this.isUi(e)) return;
    e.preventDefault();
    this.mouseMode = false;
    if (e.touches.length >= 2) { this.parser.secondDown(); return; }
    const t = e.touches[0];
    if (!t) return;
    this.parser.down(t.clientX, t.clientY);
    this.setPointer(t.clientX, t.clientY);
    this.zone.run(() => this.interacting.set(true));
  }
  private onTouchMove(e: TouchEvent): void {
    this.touchCompat.markTouch(Date.now());
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    this.parser.move(t.clientX, t.clientY);
    this.setPointer(t.clientX, t.clientY);
  }
  private onTouchEnd(e: TouchEvent): void {
    this.touchCompat.markTouch(Date.now());
    if (e.touches.length === 1) { this.parser.secondUp(); return; }
    if (e.touches.length === 0 && this.parser.pointerDown) {
      const t = e.changedTouches[0];
      this.parser.up(t ? t.clientX : 0, t ? t.clientY : 0);
      this.zone.run(() => this.interacting.set(false));
    }
  }
  private onMouseDown(e: MouseEvent): void {
    if (this.isUi(e)) return;
    if (this.touchCompat.isSynthesizedMouse(e as any, Date.now())) return;
    this.mouseMode = true;
    if (e.button === 2) { this.parser.setBrake(true); return; }
    if (e.button !== 0) return;
    this.parser.down(e.clientX, e.clientY);
    this.setPointer(e.clientX, e.clientY);
    this.zone.run(() => this.interacting.set(true));
  }
  private onMouseMove(e: MouseEvent): void {
    if (this.touchCompat.isSynthesizedMouse(e as any, Date.now())) return;
    this.mouseX = e.clientX; this.mouseY = e.clientY;
    if (!this.mouseMode && !this.isTouch) this.mouseMode = true;
    if (this.mouseMode) {
      // Desktop steering: the phoenix flies toward the pointer, as in the game.
      if (!this.isUi(e)) { this.tx = this.clampX(e.clientX); this.ty = this.clampY(e.clientY); }
      if (this.parser.pointerDown) { this.parser.move(e.clientX, e.clientY); this.setPointer(e.clientX, e.clientY); }
    }
  }
  private onMouseUp(e: MouseEvent): void {
    if (this.touchCompat.isSynthesizedMouse(e as any, Date.now())) return;
    if (!this.mouseMode) return;
    if (e.button === 2) { this.parser.setBrake(false); return; }
    if (e.button !== 0 || !this.parser.pointerDown) return;
    this.parser.up(e.clientX, e.clientY);
    this.zone.run(() => this.interacting.set(false));
  }
  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code === 'Space') { e.preventDefault(); this.parser.setBrake(down); return; }
    if (!down || e.repeat) return;
    if (e.code === 'Escape') { this.zone.run(() => this.skipAll()); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      const dx = this.mouseX - this.px, dy = this.mouseY - this.py;
      if (Math.hypot(dx, dy) > 10) this.tryDash(dx, dy);
    } else if (e.code === 'KeyE') this.tryRoll();
    else if (e.code === 'KeyQ') this.onSlot('tap');
    else if (e.code === 'KeyW') this.onSlot('double');
    else if (e.code === 'KeyR') this.onSlot('triple');
  }
  private setPointer(x: number, y: number): void { this.zone.run(() => this.pointer.set({ x, y })); }

  // ---------- sim and render ----------
  private resize(): void {
    const c = this.canvasRef.nativeElement;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth; this.H = window.innerHeight;
    c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.tx = this.clampX(this.tx); this.ty = this.clampY(this.ty);
    this.spawnWisps();
    this.measureSpot();
  }
  private clampX(x: number): number { return Math.max(30, Math.min(this.W - 30, x)); }
  private clampY(y: number): number { return Math.max(this.H * 0.3, Math.min(this.H - 150, y)); }

  private spawnWisps(): void {
    if (!this.W) return;
    this.wisps = [0.18, 0.5, 0.82].map((f, i) => ({ x: this.W * f, y: this.H * (0.36 + (i % 2) * 0.06), r: 16, hit: 0, phase: i * 2 }));
  }

  private measureSpot(): void {
    const t = this.spotTarget;
    if (!t || t === 'none' || t === 'arena') { if (this.spot()) this.zone.run(() => this.spot.set(null)); return; }
    const el = this.rootRef?.nativeElement.querySelector(`[data-tut="${t}"]`) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cur = this.spot();
    if (!cur || Math.abs(cur.x - r.left) > 0.5 || Math.abs(cur.y - r.top) > 0.5 || Math.abs(cur.w - r.width) > 0.5 || Math.abs(cur.h - r.height) > 0.5) {
      this.zone.run(() => this.spot.set({ x: r.left, y: r.top, w: r.width, h: r.height }));
    }
  }

  private frame(t: number): void {
    const dt = Math.min(0.05, Math.max(0, (t - this.lastFrame) / 1000));
    this.lastFrame = t;
    const now = performance.now();
    const minDim = Math.min(this.W, this.H);

    // Flight.
    const maxSpeed = minDim * 1.1 * (this.braking ? 0.4 : 1);
    let dvx = (this.tx - this.px) * 4.5, dvy = (this.ty - this.py) * 4.5;
    const dl = Math.hypot(dvx, dvy);
    if (dl > maxSpeed) { dvx *= maxSpeed / dl; dvy *= maxSpeed / dl; }
    const k = Math.min(1, dt * 7);
    this.vx += (dvx - this.vx) * k; this.vy += (dvy - this.vy) * k;
    if (now < this.dashUntil) { this.vx = this.dashX * minDim * 2.6; this.vy = this.dashY * minDim * 2.6; }
    let rx = 0, ry = 0;
    if (now < this.rollUntil) {
      const s = minDim * 1.3 * this.rollSign;
      rx = -Math.sin(this.heading) * s; ry = Math.cos(this.heading) * s;
    }
    this.px = this.clampX(this.px + (this.vx + rx) * dt);
    this.py = this.clampY(this.py + (this.vy + ry) * dt);
    if (now < this.dashUntil || now < this.rollUntil) { this.tx = this.px; this.ty = this.py; }
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 25) this.heading = Math.atan2(this.vy, this.vx);
    this.flap += dt * (this.braking ? 5 : 9);

    // Stamina and glide (glide only builds while actually flying).
    if (speed < 60 && !this.stam.gliding) this.stam.straightTime = 0;
    if (this.sparkHold) this.stam.lastSpendAt = now;
    this.stam.tick(dt, now, this.heading);
    if (speed < 60 && !this.stam.gliding) this.stam.straightTime = 0;

    const goal = this.step().goal;
    if (!this.advancing) {
      if (goal === 'steer' && this.parser.pointerDown || goal === 'steer' && this.mouseMode) this.progress += speed * dt / (minDim * 2.2);
      if (goal === 'steer' && this.progress >= 1) this.succeed('You are flying!');
      if (goal === 'brake' && this.braking) this.progress += dt;
      if (goal === 'brake' && this.progress >= 0.8) this.succeed('Feather Brake. Smooth.');
      if (goal === 'glide' && this.stam.gliding) this.succeed('Gliding! The ring glows white.');
    }

    // Hold charge.
    if (this.cdEnd['hold'] <= now) this.parser.holdReady = true;
    const hp = this.parser.tick();

    // Pickups.
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.bob += dt * 3;
      const d = Math.hypot(p.x - this.px, p.y - this.py);
      const magnet = p.kind === 'xp' ? 200 : p.kind === 'coin' ? 110 : 0;
      if (magnet && d < magnet) { p.x += (this.px - p.x) * Math.min(1, dt * 6); p.y += (this.py - p.y) * Math.min(1, dt * 6); }
      if (d < 34) {
        p.taken = true;
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2;
          this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 0.5, max: 0.5, size: 4, color: p.kind === 'spark' ? '120,230,255' : p.kind === 'coin' ? '255,215,80' : '150,255,170' });
        }
        if (p.kind === 'spark') {
          this.sparkHold = false;
          this.stam.add(50);
          this.stam.lastSpendAt = -Infinity;
          this.flashStamina('+50');
          if (goal === 'spark') this.succeed('Spark Cell: +50 stamina.');
        }
      }
    }
    if (goal === 'pickups' && !this.advancing && this.pickups.length && this.pickups.every(p => p.taken)) this.succeed('All collected.');

    // Particles and practice wisps.
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const w of this.wisps) {
      w.phase += dt; if (w.hit > 0) w.hit -= dt;
      for (const p of this.particles) {
        const reach = p.ring ? p.size * (1 - p.life / p.max) : 0;
        const d = Math.hypot(p.x - w.x, p.y - w.y);
        if ((p.ring && Math.abs(d - reach) < 26) || (!p.ring && d < w.r + p.size)) w.hit = 0.35;
      }
    }
    this.trail.push({ x: this.px, y: this.py, life: 0.5 });
    for (const tr of this.trail) tr.life -= dt;
    this.trail = this.trail.filter(tr => tr.life > 0);

    // Push UI state (only when changed, to keep change detection light).
    const st = Math.round(this.stam.stamina);
    const cds: Record<string, number> = {};
    let cdChanged = false;
    const prev = this.cooldowns();
    for (const key of ['tap', 'hold', 'double', 'triple']) {
      cds[key] = Math.max(0, (this.cdEnd[key] - now) / 1000);
      if (Math.abs(cds[key] - prev[key]) > 0.04 || (cds[key] === 0) !== (prev[key] === 0)) cdChanged = true;
    }
    if (st !== this.stamina() || this.stam.gliding !== this.gliding() || Math.abs(hp - this.holdProgress()) > 0.005 || cdChanged || ['steer', 'brake', 'glide', 'pickups', 'hold'].includes(goal)) {
      this.zone.run(() => {
        this.stamina.set(st);
        this.gliding.set(this.stam.gliding);
        this.holdProgress.set(hp);
        if (cdChanged) this.cooldowns.set(cds);
        if (!this.advancing) this.updateGoalText();
      });
    }
    if (t - this.lastSpotCheck > 300) { this.lastSpotCheck = t; this.measureSpot(); }

    this.draw(now);
  }

  private draw(now: number): void {
    const c = this.ctx; if (!c) return;
    c.clearRect(0, 0, this.W, this.H);
    // Drifting embers backdrop.
    const time = now / 1000;
    for (let i = 0; i < 40; i++) {
      const x = (i * 97.3 + time * (8 + (i % 5) * 4)) % (this.W + 40) - 20;
      const y = this.H - ((i * 53.7 + time * (20 + (i % 7) * 6)) % (this.H + 40));
      c.fillStyle = `rgba(255,${120 + (i % 4) * 25},40,${0.15 + (i % 3) * 0.08})`;
      c.beginPath(); c.arc(x, y, 1.2 + (i % 3), 0, Math.PI * 2); c.fill();
    }
    // Practice wisps (harmless targets).
    for (const w of this.wisps) {
      const y = w.y + Math.sin(w.phase * 1.6) * 8;
      const g = c.createRadialGradient(w.x, y, 2, w.x, y, w.r * 2.2);
      const a = w.hit > 0 ? 0.95 : 0.55;
      g.addColorStop(0, `rgba(255,${w.hit > 0 ? 255 : 200},${w.hit > 0 ? 220 : 160},${a})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(w.x, y, w.r * 2.2, 0, Math.PI * 2); c.fill();
    }
    // Pickups.
    for (const p of this.pickups) {
      if (p.taken) continue;
      const y = p.y + Math.sin(p.bob) * 5;
      const col = p.kind === 'spark' ? '120,230,255' : p.kind === 'coin' ? '255,205,60' : '120,255,150';
      const g = c.createRadialGradient(p.x, y, 1, p.x, y, 26);
      g.addColorStop(0, `rgba(${col},0.95)`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(p.x, y, 26, 0, Math.PI * 2); c.fill();
      c.font = p.kind === 'spark' ? '22px sans-serif' : '16px sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(p.kind === 'spark' ? '🔋' : p.kind === 'coin' ? '🪙' : '✦', p.x, y);
    }
    // Steering target ghost while dragging.
    if (this.parser.pointerDown && !this.mouseMode) {
      c.strokeStyle = 'rgba(255,190,120,0.35)'; c.setLineDash([4, 6]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(this.px, this.py); c.lineTo(this.tx, this.ty); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(this.tx, this.ty, 6, 0, Math.PI * 2); c.stroke();
    }
    // Trail.
    for (const tr of this.trail) {
      const a = tr.life / 0.5;
      c.fillStyle = this.stam.gliding ? `rgba(255,255,255,${a * 0.35})` : `rgba(255,${90 + a * 90},30,${a * 0.45})`;
      c.beginPath(); c.arc(tr.x, tr.y, 3 + a * 7, 0, Math.PI * 2); c.fill();
    }
    // Particles.
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.ring) {
        const r = p.size * (1 - a) + 10;
        c.strokeStyle = `rgba(${p.color},${a})`; c.lineWidth = 6 * a + 1;
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
      } else {
        c.fillStyle = `rgba(${p.color},${a})`;
        c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); c.fill();
      }
    }
    // Phoenix.
    const inv = now < this.iframeUntil;
    c.save();
    c.translate(this.px, this.py);
    const glow = c.createRadialGradient(0, 0, 4, 0, 0, 70);
    glow.addColorStop(0, inv ? 'rgba(200,230,255,0.55)' : 'rgba(255,140,40,0.45)');
    glow.addColorStop(1, 'rgba(255,80,20,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0, 0, 70, 0, Math.PI * 2); c.fill();
    c.rotate(this.heading + Math.PI / 2);
    if (now < this.rollUntil) {
      const p = 1 - (this.rollUntil - now) / TUTORIAL_STAMINA.rollMs;
      c.scale(Math.cos(p * Math.PI * 2), 1);
    }
    if (inv) c.globalAlpha = 0.75 + 0.25 * Math.sin(now / 30);
    const img = this.sprite.length ? this.sprite[flapFrameIndex(this.flap)] : null;
    if (img && img.width) {
      const h = Math.min(120, Math.max(80, Math.min(this.W, this.H) * 0.2));
      const w = h * img.width / img.height;
      c.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      c.fillStyle = '#ff8a2a';
      c.beginPath(); c.moveTo(0, -26); c.lineTo(22, 16); c.lineTo(0, 6); c.lineTo(-22, 16); c.closePath(); c.fill();
    }
    c.restore();
  }

  // ---------- template helpers ----------
  staminaBg(): string {
    const frac = this.stamina() / TUTORIAL_STAMINA.max;
    const deg = frac * 360;
    const col = frac > 0.35 ? 'rgba(255,140,40,0.95)' : 'rgba(255,60,40,0.95)';
    return `conic-gradient(${col} ${deg}deg, rgba(255,255,255,0.12) ${deg}deg)`;
  }
  cooldownLeft(key: string): number { return this.cooldowns()[key] || 0; }
  sweep(key: 'tap' | 'hold' | 'double' | 'triple'): string {
    const frac = this.cooldownLeft(key) / PRACTICE_CD[key];
    return `conic-gradient(rgba(0,0,0,0.65) ${frac * 360}deg, transparent ${frac * 360}deg)`;
  }
}
