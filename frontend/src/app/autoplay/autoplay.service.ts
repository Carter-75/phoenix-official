// AI Autoplay tester (owner only). Drives the real game: menu buttons
// are clicked like a player would, and flight is synthesized touch
// input on the same window listeners a finger feeds. It enforces the
// parsed plan's constraints (scope, deaths, retry policy, target),
// keeps every ad suppressed through AdGuard while it runs, gathers
// bug, UI, balance, and perf telemetry, and writes a capped report.
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as Matter from 'matter-js';
import { environment } from '../../environments/environment';
import { GameStateService, STAMINA } from '../services/game-state.service';
import { AuthService } from '../services/auth.service';
import { AdGuard } from './ad-guard';
import { AutoplayPlan, parseIntent, planFromRemote } from './autoplay-intent';
import { CappedOutput, OUTPUT_CAP_CHARS, REPORT_RESERVE_CHARS } from './autoplay-output';
import { GestureStep, SlotFamily, synthTapChain, synthFlick, synthRoll, synthBrake, holdChargeMs, chainIsValid } from './autoplay-gestures';
import { decide, Snapshot, Threat, Foe, Pt } from './autoplay-pilot';
import { AttemptRecord, BossRecord, Telemetry, addFinding, buildReport, newTelemetry } from './autoplay-report';
import { autoplayAllowed, DevFlags } from './autoplay-gate';

const AD_REASON = 'autoplay';
const OUT_KEY = 'phoenix_autoplay_output';
const STAT_KEYS = ['damage', 'health', 'attack-speed', 'aegis', 'speed', 'range', 'homing', 'aura', 'magnet'];

@Injectable({ providedIn: 'root' })
export class AutoplayService {
  private gs = inject(GameStateService);
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private api = environment.apiUrl + '/autoplay';

  readonly running = signal(false);
  readonly paused = signal(false);
  readonly output = signal<string>(localStorage.getItem(OUT_KEY) || '');
  readonly status = signal('Idle');
  readonly flags = signal<DevFlags & { ai?: boolean; model?: string } | null>(null);

  private out = new CappedOutput(OUTPUT_CAP_CHARS);
  private plan: AutoplayPlan | null = null;
  private prompt = '';
  private tm: Telemetry = newTelemetry(Date.now());
  private game: any = null;
  private tickTimer: any = null;
  private pilotTimer: any = null;
  private rafId = 0;
  private deadline: number | null = null;
  private lastAction = 0;
  private finishing = false;
  private resumeTimer: any = null;
  private cleanup: (() => void)[] = [];
  private advice: { upgradePriority?: string[]; aggression?: number } | null = null;

  // Attempt bookkeeping
  private attempt: AttemptRecord | null = null;
  private attemptStartAt = 0;
  private needShop = false;
  private shopQueue: { realmIdx: number; budget: number }[] = [];
  private shopBought: string[] = [];
  private lastRealmIdx = -1;
  private clearedThisAttempt: number[] = [];
  private inGameAt = 0;
  private sawDead = false;
  private lastHp = 0;
  private lastHitCause = '';
  private bossFightStart = 0;
  private bossHpSeen = 0;
  private rageSeenThisFight = false;
  private finalSeenThisFight = false;

  // Input state
  private f1: Pt | null = null;
  private f2: Pt | null = null;
  private dragTarget: Pt = { x: 0, y: 0 };
  private busyUntil = 0;
  private lastPressAt = 0;
  private gestureQueue: Promise<void> = Promise.resolve();
  private nextAbilityAt = 0;
  private reactUntil = 0;
  private plannedTarget: Pt | null = null;
  private lastPos: Pt = { x: 0, y: 0 };
  private lastMoveAt = 0;
  private oobSince = 0;
  private lastUiScan = 0;
  private lastProgressAt = 0;
  private lastProgressKey = '';

  // ---------- gating ----------
  async refreshFlags(): Promise<boolean> {
    try {
      const f = await firstValueFrom(this.http.get<any>(`${this.api}/flags`));
      this.flags.set(f);
    } catch { this.flags.set({ isOwner: false, autoplay: false }); }
    return this.allowed();
  }
  allowed(): boolean { return autoplayAllowed(this.auth.currentUser() as any, this.flags()); }

  // ---------- game registration ----------
  attachGame(g: any) { this.game = g; this.inGameAt = Date.now(); this.lastHp = 0; }
  detachGame(g: any) { if (this.game === g) { this.releaseFingers(); this.game = null; } }

  // ---------- lifecycle ----------
  async start(prompt: string, sliderMs: number | null) {
    if (this.running()) return;
    if (!this.allowed()) { this.log('gate', 'Autoplay is owner only; refusing to start.'); return; }
    AdGuard.suppress(AD_REASON);
    this.out.clear();
    this.prompt = prompt;
    const local = parseIntent(prompt, sliderMs, this.gs.selectedWorldIndex() + 1);
    this.plan = local;
    this.running.set(true);
    this.paused.set(false);
    this.finishing = false;
    this.tm = newTelemetry(Date.now());
    this.out.setStart(this.tm.startedAt);
    const user: any = this.auth.currentUser();
    this.tm.account = user?.email || '';
    this.tm.coinsStart = this.gs.coins(); this.tm.gemsStart = this.gs.gems();
    this.log('safety', `Playing on ${this.tm.account}'s REAL save: coins spent and progress made are kept. Ads are blocked for the whole run. No real-money or gem purchases.`);
    this.status.set('Planning');
    try {
      const r = await firstValueFrom(this.http.post<any>(`${this.api}/plan`, { prompt, currentRealm: this.gs.selectedWorldIndex() + 1 }));
      if (r?.source === 'openai' && r.plan) {
        this.plan = planFromRemote(r.plan, local, sliderMs);
        this.log('plan', `Planner: OpenAI (${r.model}).`);
      } else this.log('plan', `Planner: local parser (${r?.errorCode || r?.reason || 'AI unavailable'}).`);
    } catch { this.log('plan', 'Planner: local parser (AI request failed).'); }
    if (!this.running()) return;
    const p = this.plan!;
    this.log('plan', p.interpretation.join(' '));
    this.deadline = p.timeLimitMs ? Date.now() + p.timeLimitMs : null;
    this.lastRealmIdx = -1;
    this.attempt = null;
    this.needShop = false;
    this.installWatchers();
    this.tickTimer = setInterval(() => this.safeTick(), 250);
    this.pilotTimer = setInterval(() => this.safePilot(), 60);
    this.status.set('Running');
  }

  stop(reason = 'Stopped by tester') { void this.finish(reason, false); }

  private async finish(reason: string, goalMet: boolean) {
    if (!this.running() || this.finishing) return;
    this.finishing = true;
    this.tm.endReason = reason;
    if (goalMet) this.tm.goalMet = true;
    clearInterval(this.tickTimer); clearInterval(this.pilotTimer);
    this.releaseFingers();
    if (this.attempt && this.attempt.result === 'running') this.closeAttempt(goalMet ? 'success' : 'stopped');
    this.leaveRunToMenu();
    this.tm.endedAt = Date.now();
    this.tm.coinsEnd = this.gs.coins(); this.tm.gemsEnd = this.gs.gems();
    this.status.set('Writing report');
    const plan = this.plan!;
    let report = buildReport(plan, this.tm);
    let src = 'local report writer';
    try {
      const r = await firstValueFrom(this.http.post<any>(`${this.api}/report`, { prompt: this.prompt, plan, telemetry: this.tm, maxChars: REPORT_RESERVE_CHARS - 200 }));
      if (r?.source === 'openai' && r.report) { report = r.report; src = `OpenAI (${r.model})`; }
    } catch { /* local fallback */ }
    this.out.setReport(`Report written by: ${src}\n\n${report}`);
    this.publish();
    this.cleanup.forEach(f => { try { f(); } catch { } }); this.cleanup = [];
    this.running.set(false); this.paused.set(false);
    this.status.set(`Done: ${reason}`);
    // Ads stay blocked until the bot has fully left the run.
    setTimeout(() => AdGuard.release(AD_REASON), 1500);
  }

  clearOutput() { this.out.clear(); this.output.set(''); localStorage.removeItem(OUT_KEY); }

  // ---------- logging ----------
  private log(kind: string, text: string) { this.out.add(kind, text); this.publish(); }
  private publish() {
    const t = this.out.text();
    this.output.set(t);
    try { localStorage.setItem(OUT_KEY, t); } catch { }
  }

  // ---------- watchers (bugs, perf, safety) ----------
  private installWatchers() {
    const onErr = (e: ErrorEvent) => addFinding(this.tm.bugs, 'error', String(e.message || e.error), this.where());
    const onRej = (e: PromiseRejectionEvent) => addFinding(this.tm.bugs, 'unhandled rejection', String((e.reason && (e.reason.message || e.reason)) || 'unknown'), this.where());
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    const origErr = console.error;
    console.error = (...a: any[]) => { try { addFinding(this.tm.bugs, 'console.error', a.map(x => x?.message || String(x)).join(' ').slice(0, 300), this.where()); } catch { } origErr.apply(console, a); };
    const onVis = () => { if (document.hidden) this.stop('App went to background'); };
    document.addEventListener('visibilitychange', onVis);
    const onManual = (e: Event) => {
      if (!e.isTrusted) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-ap-badge]')) return;
      this.manualPause();
    };
    window.addEventListener('touchstart', onManual, true);
    window.addEventListener('mousedown', onManual, true);
    let last = performance.now(), frames = 0, secStart = last, fpsSum = 0;
    const raf = (now: number) => {
      const dt = now - last; last = now; frames++;
      if (dt > 50 && this.gs.activeScreen() === 'game') { this.tm.frames.longFrames++; this.tm.frames.worstMs = Math.max(this.tm.frames.worstMs, dt); }
      if (now - secStart >= 1000) {
        const fps = frames * 1000 / (now - secStart);
        if (this.gs.activeScreen() === 'game' && !document.hidden) {
          const f = this.tm.frames; f.samples++; fpsSum += fps; f.fpsAvg = fpsSum / f.samples;
          f.fpsMin = Math.min(f.fpsMin, fps); if (fps < 30) f.lowFpsSeconds++;
        }
        frames = 0; secStart = now;
      }
      this.rafId = requestAnimationFrame(raf);
    };
    this.rafId = requestAnimationFrame(raf);
    this.cleanup.push(() => {
      window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej);
      console.error = origErr; document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('touchstart', onManual, true); window.removeEventListener('mousedown', onManual, true);
      cancelAnimationFrame(this.rafId);
    });
  }

  private manualPause() {
    if (!this.running()) return;
    if (!this.paused()) { this.tm.manualPauses++; this.log('safety', 'Manual touch detected: AI paused. Tap Stop to end, or wait to resume.'); }
    this.paused.set(true);
    this.releaseFingers();
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => { if (this.running()) { this.paused.set(false); this.log('safety', 'Resuming AI play.'); } }, 4000);
  }

  private where(): string {
    const g = this.game;
    return `screen ${this.gs.activeScreen()}, mode ${this.gs.currentGameMode()}, realm ${this.gs.selectedWorldIndex() + 1}` +
      (g ? `, phase ${g.bossPhase?.()}, t ${Math.round(g.timeRemaining?.() ?? 0)}s, hp ${Math.round(g.currentHealth?.() ?? 0)}` : '');
  }

  // ---------- DOM helpers ----------
  private btn(tag: string): HTMLButtonElement | null {
    const all = Array.from(document.querySelectorAll<HTMLButtonElement>(`[data-ap="${tag}"]`));
    return all.find(b => !b.disabled && b.offsetParent !== null && b.getBoundingClientRect().width > 0) || null;
  }
  private click(tag: string, note?: string): boolean {
    const b = this.btn(tag);
    if (!b) return false;
    const r = b.getBoundingClientRect();
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) addFinding(this.tm.ui, 'offscreen', `Button "${tag}" is off screen when needed`, this.where());
    this.ripple(r.left + r.width / 2, r.top + r.height / 2);
    b.click();
    this.lastAction = Date.now();
    if (note) this.log('menu', note);
    return true;
  }
  private ripple(x: number, y: number) {
    const d = document.createElement('div');
    d.setAttribute('data-ui', '');
    d.style.cssText = `position:fixed;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid #fb923c;pointer-events:none;z-index:99999;transition:all .4s ease-out;`;
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(2)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 450);
  }

  private scanUi() {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('button')).filter(b => b.offsetParent !== null);
    const rects = btns.map(b => ({ b, r: b.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.height > 0);
    const name = (b: HTMLElement) => (b.getAttribute('aria-label') || b.textContent || b.getAttribute('data-ap') || 'button').trim().replace(/\s+/g, ' ').slice(0, 40);
    for (const { b, r } of rects) {
      if (r.right > innerWidth + 2 || r.bottom > innerHeight + 2 || r.left < -2 || r.top < -2) {
        if (!b.closest('.overflow-y-auto, .overflow-auto, .overflow-x-auto')) addFinding(this.tm.ui, 'offscreen', `"${name(b)}" extends past the viewport`, `screen ${this.gs.activeScreen()}`);
      }
      if (Math.min(r.width, r.height) < 32 && name(b).length) addFinding(this.tm.ui, 'small target', `"${name(b)}" is ${Math.round(r.width)}x${Math.round(r.height)} px (under 32 px)`, `screen ${this.gs.activeScreen()}`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, c = rects[j].r;
      if (rects[i].b.contains(rects[j].b) || rects[j].b.contains(rects[i].b)) continue;
      const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (ox > 6 && oy > 6) {
        const top = document.elementFromPoint(Math.max(a.left, c.left) + ox / 2, Math.max(a.top, c.top) + oy / 2);
        if (top && (rects[i].b.contains(top) || rects[j].b.contains(top))) addFinding(this.tm.ui, 'overlap', `"${name(rects[i].b)}" overlaps "${name(rects[j].b)}"`, `screen ${this.gs.activeScreen()}`);
      }
    }
  }

  // ---------- main state machine ----------
  private safeTick() { try { this.tick(); } catch (e: any) { addFinding(this.tm.bugs, 'autoplay internal', String(e?.message || e), this.where()); } }

  private tick() {
    if (!this.running() || this.finishing) return;
    const now = Date.now();
    if (this.deadline && now >= this.deadline) { this.tm.goalNote ||= 'Time limit reached before the goal.'; void this.finish('Time limit reached', false); return; }
    if (now - this.lastUiScan > 6000) { this.lastUiScan = now; this.scanUi(); }
    this.checkStuck(now);
    if (this.paused()) return;
    const screen = this.gs.activeScreen();
    if (now - this.lastAction < 700) return;
    if (screen === 'menu') this.menuStep();
    else if (screen === 'shop') this.shopStep();
    else if (screen === 'game') this.gameStep(now);
    else if (screen === 'tutorial') { /* never auto-plays the tutorial */ this.lastAction = now; this.gs.activeScreen.set('menu'); }
    else { this.gs.activeScreen.set('menu'); this.lastAction = now; }
  }

  private checkStuck(now: number) {
    const g = this.game;
    const key = `${this.gs.activeScreen()}|${this.gs.selectedWorldIndex()}|${g?.timeRemaining?.() ?? ''}|${Math.round(g?.bossHealth?.() ?? 0)}|${this.gs.coins()}|${g?.isDead?.()}`;
    if (key !== this.lastProgressKey) { this.lastProgressKey = key; this.lastProgressAt = now; return; }
    if (now - this.lastProgressAt > 60000 && !this.paused()) {
      addFinding(this.tm.bugs, 'softlock', 'No game progress for 60 s (timer, boss HP, coins, realm all frozen)', this.where());
      this.lastProgressAt = now;
      if (this.gs.activeScreen() === 'game') { this.log('bug', 'Possible softlock; quitting the run to recover.'); this.leaveRunToMenu(); if (this.attempt) this.failAttempt('softlock'); }
    }
  }

  private desiredRealmIdx(): number {
    const p = this.plan!;
    if (this.shopQueue.length) return this.shopQueue[0].realmIdx;
    if (this.retryRealmIdx !== null) return this.retryRealmIdx;
    return p.startRealm - 1;
  }
  private retryRealmIdx: number | null = null;

  private menuStep() {
    const p = this.plan!;
    if (this.click('tutorial-decline', 'Declined the tutorial offer.')) return;
    // Mode
    if (p.mode === 'battle') {
      if (this.click('play-battle', 'Pressed Battle Play.')) { this.beginAttempt(); return; }
      if (this.click('mode-battle')) return;
      return;
    }
    // Realm selection with the real arrows
    const want = Math.min(this.desiredRealmIdx(), Math.max(...this.gs.unlockedWorlds()));
    const cur = this.gs.selectedWorldIndex();
    if (cur !== want) {
      if (!this.btn('world-next') && !this.btn('world-prev')) { this.click(p.mode === 'endless' ? 'mode-endless' : 'mode-normal'); return; }
      this.click(cur < want ? 'world-next' : 'world-prev');
      return;
    }
    if (this.shopQueue.length) {
      if (this.click('open-shop', `Opened the shop for realm ${want + 1}'s loadout.`)) return;
    }
    if (p.mode === 'endless' && !this.endlessPicked) { if (this.click('mode-endless')) { this.endlessPicked = true; return; } }
    if (p.mode === 'campaign' && !this.normalPicked) { if (this.click('mode-normal')) { this.normalPicked = true; return; } }
    if (this.click('play', `Pressed Play (${p.mode === 'endless' ? 'Endless' : 'Normal'}, realm ${cur + 1}).`)) {
      this.endlessPicked = this.normalPicked = false;
      if (!this.attempt || this.attempt.result !== 'running') this.beginAttempt();
    }
  }
  private endlessPicked = false; private normalPicked = false;

  private shopStep() {
    const q = this.shopQueue[0];
    if (!q) { this.click('shop-close'); return; }
    const order = (this.advice?.upgradePriority?.filter(k => STAT_KEYS.includes(k)) || []).concat(STAT_KEYS.filter(k => !this.advice?.upgradePriority?.includes(k)));
    const floor = this.gs.coins() - q.budget;
    if (q.budget > 0) {
      for (const k of order) {
        const before = this.gs.coins();
        if (before <= Math.max(0, floor)) break;
        if (this.click(`buy-${k}`)) {
          const spent = before - this.gs.coins();
          if (spent > 0) { q.budget -= spent; this.shopBought.push(`realm ${q.realmIdx + 1} ${k} (${spent}c)`); this.log('shop', `Bought ${k} for realm ${q.realmIdx + 1} (${spent} coins).`); return; }
        }
      }
    }
    this.shopQueue.shift();
    this.click('shop-close', 'Closed the shop.');
  }

  private gameStep(now: number) {
    const g = this.game;
    if (!g) return;
    const p = this.plan!;
    const realmIdx = this.gs.selectedWorldIndex();
    // Realm transitions inside a run (boss-win carryover) = realm cleared.
    if (this.lastRealmIdx >= 0 && realmIdx === this.lastRealmIdx + 1 && !g.isDead()) this.onRealmCleared(this.lastRealmIdx);
    this.lastRealmIdx = realmIdx;
    if (this.attempt) this.attempt.furthestRealm = Math.max(this.attempt.furthestRealm, realmIdx + 1);
    this.trackBoss(g, now);
    this.trackHp(g);
    this.checkState(g, now);

    // Goal checks
    if (p.goal === 'reach' && realmIdx + 1 >= p.targetRealm && this.validAttempt()) return this.goalDone(`Reached realm ${p.targetRealm}.`);
    if (p.goal === 'survive' && p.surviveSec && this.gs.sessionPlayTime() >= p.surviveSec && this.validAttempt()) return this.goalDone(`Survived ${p.surviveSec} s.`);

    if (g.gameEnded() && g.gameWon()) {
      if (p.mode === 'battle') { this.tm.battle.matches++; this.tm.battle.wins++; this.log('battle', 'Battle won.'); }
      else this.onRealmCleared(realmIdx);
      if (this.running() && !this.finishing) { this.closeAttempt('success'); if (p.mode === 'battle' && p.goal === 'battle_wins' && this.tm.battle.wins >= (p.battleWins || 1)) return this.goalDone(`${this.tm.battle.wins} battle wins.`); }
      if (!this.finishing) this.click('quit-game', 'Victory screen: Return to Menu.');
      return;
    }
    if (g.isDead() || g.koPanelOpen() || this.gs.playerDownPhase() !== 'none') {
      if (!this.sawDead) { this.sawDead = true; this.onDeath(); }
      if (this.finishing) return;
      if (p.allowGemRevives && this.attempt && (p.maxDeaths === null || this.attempt.deaths <= p.maxDeaths) && this.click('revive-gems', 'Revived with gems (allowed by prompt).')) { this.sawDead = false; return; }
      if (this.click('give-up') || this.click('quit-game')) { this.afterRunLost(); }
      return;
    }
    this.sawDead = false;
    if (this.gs.isPaused() && !this.finishing) this.click('pause-toggle', 'Game was paused; resumed.');
  }

  private validAttempt(): boolean {
    const p = this.plan!, a = this.attempt;
    if (!a) return false;
    if (p.maxDeaths !== null && a.deaths > p.maxDeaths) return false;
    if (p.scope === 'single_run' && a.startRealm !== p.startRealm) return false;
    return true;
  }

  private onRealmCleared(idx: number) {
    const p = this.plan!;
    if (this.clearedThisAttempt.includes(idx + 1)) return;
    this.clearedThisAttempt.push(idx + 1);
    this.tm.realmsCleared.push(idx + 1);
    this.log('progress', `Realm ${idx + 1} cleared (attempt ${this.attempt?.n ?? '?'}).`);
    if (p.goal === 'clear_through' && idx + 1 >= p.targetRealm) {
      if (p.scope === 'single_run') {
        const need = Array.from({ length: p.targetRealm - p.startRealm + 1 }, (_, i) => p.startRealm + i);
        if (this.validAttempt() && need.every(r => this.clearedThisAttempt.includes(r))) this.goalDone(`Cleared realms ${p.startRealm} to ${p.targetRealm} in one run with ${this.attempt!.deaths} death(s).`);
      } else {
        const all = new Set(this.tm.realmsCleared);
        if (Array.from({ length: p.targetRealm - p.startRealm + 1 }, (_, i) => p.startRealm + i).every(r => all.has(r))) this.goalDone(`Cleared through realm ${p.targetRealm}.`);
      }
    }
  }

  private goalDone(note: string) { this.tm.goalNote = note; this.log('goal', `GOAL MET: ${note}`); void this.finish('Goal complete', true); }

  private beginAttempt() {
    const n = this.tm.attempts.length + 1;
    this.attempt = { n, startRealm: this.gs.selectedWorldIndex() + 1, furthestRealm: this.gs.selectedWorldIndex() + 1, deaths: 0, result: 'running', causes: [], upgradesAfter: [], durationSec: 0 };
    this.tm.attempts.push(this.attempt);
    this.attemptStartAt = Date.now();
    this.clearedThisAttempt = [];
    this.lastRealmIdx = -1;
    this.retryRealmIdx = null;
    this.log('attempt', `Attempt #${n} started at realm ${this.attempt.startRealm}.`);
  }

  private closeAttempt(result: AttemptRecord['result']) {
    if (!this.attempt || this.attempt.result !== 'running') return;
    this.attempt.result = result;
    this.attempt.durationSec = (Date.now() - this.attemptStartAt) / 1000;
  }

  private onDeath() {
    const realm = this.gs.selectedWorldIndex() + 1;
    const g = this.game;
    const cause = `realm ${realm} ${g?.bossSpawned?.() ? `boss (${g.bossPhase()})` : 'survive phase'}: ${this.lastHitCause || 'unknown hit'}`;
    if (this.attempt) { this.attempt.deaths++; this.attempt.causes.push(cause); }
    if (g?.bossSpawned?.()) this.boss(realm).deaths++;
    this.log('death', `Died: ${cause}.`);
  }

  private failAttempt(why: string) {
    this.closeAttempt('failed');
    this.log('attempt', `Attempt #${this.attempt?.n} failed (${why}).`);
  }

  private afterRunLost() {
    const p = this.plan!;
    const a = this.attempt;
    const deathRealmIdx = this.gs.selectedWorldIndex();
    if (p.mode === 'battle') { this.tm.battle.matches++; this.tm.battle.losses++; }
    this.failAttempt(p.maxDeaths !== null && a && a.deaths > p.maxDeaths ? 'death limit exceeded' : 'run ended in death');
    if (p.retryPolicy === 'stop') { this.tm.goalNote = 'Stopped on first failed attempt as the prompt asked.'; void this.finish('Died; prompt said stop on death', false); return; }
    // Spend coins on the per-realm loadouts before retrying.
    this.shopQueue = [];
    if (p.upgradeOnRetry && p.mode !== 'battle') {
      const coins = this.gs.coins();
      const reserve = 0;
      const spend = Math.max(0, coins - reserve);
      if (p.retryPolicy === 'restart_from_start') {
        const startIdx = p.startRealm - 1;
        const realms: number[] = [];
        for (let i = startIdx; i <= deathRealmIdx; i++) realms.push(i);
        const dShare = realms.length > 1 ? 0.6 : 1;
        this.shopQueue.push({ realmIdx: deathRealmIdx, budget: Math.floor(spend * dShare) });
        const rest = realms.filter(r => r !== deathRealmIdx);
        rest.forEach(r => this.shopQueue.push({ realmIdx: r, budget: Math.floor(spend * (1 - dShare) / rest.length) }));
      } else this.shopQueue.push({ realmIdx: deathRealmIdx, budget: spend });
    }
    this.shopBought = [];
    const lastAttempt = a;
    // Attach purchases to the attempt that just failed once shopping ends.
    const watch = setInterval(() => {
      if (!this.running() || (!this.shopQueue.length && this.gs.activeScreen() !== 'shop')) {
        clearInterval(watch);
        if (lastAttempt) lastAttempt.upgradesAfter = [...this.shopBought];
      }
    }, 500);
    this.cleanup.push(() => clearInterval(watch));
    this.retryRealmIdx = p.retryPolicy === 'retry_realm' ? deathRealmIdx : null;
    void this.askAdvice();
  }

  private async askAdvice() {
    try {
      const summary = { plan: this.plan, attempts: this.tm.attempts.slice(-5), bosses: this.tm.bosses, coins: this.gs.coins() };
      const r = await firstValueFrom(this.http.post<any>(`${this.api}/advise`, { summary }));
      if (r?.source === 'openai' && r.advice) { this.advice = r.advice; this.log('advice', `OpenAI advice: ${String(r.advice.note || '').slice(0, 200)}`); }
    } catch { }
  }

  private leaveRunToMenu() {
    if (this.gs.activeScreen() === 'game' && this.game) {
      try { this.game.quitGame(); } catch (e: any) { addFinding(this.tm.bugs, 'quit failed', String(e?.message || e), this.where()); }
    } else if (this.gs.activeScreen() === 'shop') this.click('shop-close');
  }

  // ---------- state mismatch checks ----------
  private checkState(g: any, now: number) {
    const sel = this.gs.selectedWorldIndex();
    const stats: any = this.gs.currentStats();
    const raw: any = this.gs.worldUpgrades()[sel];
    if (raw && stats && raw.damage !== undefined && stats.damage !== raw.damage) addFinding(this.tm.bugs, 'loadout mismatch', `currentStats.damage ${stats.damage} != realm ${sel + 1} loadout ${raw.damage}`, this.where());
    const hasBossBody = (g.enemies || []).some((e: any) => e.plugin?.data?.type === 'boss');
    if (g.bossSpawned() && !hasBossBody && !g.gameEnded() && !g.isDead() && now - this.bossFightStart > 3000 && g.bossHealth() > 0) addFinding(this.tm.bugs, 'boss state', 'bossSpawned is true but no boss body exists', this.where());
    if (!g.bossSpawned() && g.bossPhase() !== 'survive' && !g.gameEnded()) addFinding(this.tm.bugs, 'HUD phase', `boss phase "${g.bossPhase()}" shown with no boss spawned`, this.where());
    const pos = this.gs.phoenixScreenPos();
    const out = pos.x < -80 || pos.y < -80 || pos.x > innerWidth + 80 || pos.y > innerHeight + 80;
    if (out && this.gs.playerDownPhase() === 'none' && !g.isDead()) { this.oobSince ||= now; if (now - this.oobSince > 2000) { addFinding(this.tm.bugs, 'out of bounds', `Phoenix at (${Math.round(pos.x)}, ${Math.round(pos.y)}) outside the screen for 2 s`, this.where()); this.oobSince = now; } }
    else this.oobSince = 0;
  }

  private boss(realm: number): BossRecord {
    return this.tm.bosses[realm] ||= { realm, fights: 0, kills: 0, deaths: 0, ttkSec: [], damageTaken: 0, maxHp: 0, reachedFinalAttack: 0, rageReached: 0 };
  }
  private bossActive = false;
  private trackBoss(g: any, now: number) {
    const realm = this.gs.selectedWorldIndex() + 1;
    const on = g.bossSpawned();
    if (on && !this.bossActive) { this.bossActive = true; this.bossFightStart = now; this.rageSeenThisFight = this.finalSeenThisFight = false; const b = this.boss(realm); b.fights++; b.maxHp = g.maxHealth(); this.bossHpSeen = g.bossHealth(); this.log('boss', `Realm ${realm} boss fight started.`); }
    if (on) {
      const ph = g.bossPhase();
      if (ph === 'rage' && !this.rageSeenThisFight) { this.rageSeenThisFight = true; this.boss(realm).rageReached++; }
      if (ph === 'final' && !this.finalSeenThisFight) { this.finalSeenThisFight = true; this.boss(realm).reachedFinalAttack++; }
      this.bossHpSeen = g.bossHealth();
    }
    if (!on && this.bossActive) {
      this.bossActive = false;
      if (!g.isDead() && this.bossHpSeen <= g.bossMaxHealth() * 0.05) { const t = (now - this.bossFightStart) / 1000; const b = this.boss(this.lastRealmIdx + 1 || realm); b.kills++; b.ttkSec.push(t); this.log('boss', `Boss down in ${Math.round(t)} s.`); }
    }
  }
  private trackHp(g: any) {
    const hp = g.currentHealth();
    if (this.lastHp && hp < this.lastHp) {
      const lost = this.lastHp - hp;
      if (g.bossSpawned()) this.boss(this.gs.selectedWorldIndex() + 1).damageTaken += lost;
      const pos = this.gs.phoenixScreenPos();
      let best = '', bd = 1e9;
      for (const b of this.bodies()) {
        const d = b.plugin?.data; if (!d || d.owner === 'player') continue;
        if (b.label === 'item' || d.type?.startsWith?.('projectile_player')) continue;
        const dist = Math.hypot(b.position.x - pos.x, b.position.y - pos.y);
        if (dist < bd) { bd = dist; best = d.type === 'projectile_enemy' ? 'enemy projectile' : d.type; }
      }
      this.lastHitCause = best ? `${best} (${Math.round(lost)} dmg)` : `unseen hit (${Math.round(lost)} dmg)`;
    }
    this.lastHp = hp;
  }
  private bodies(): any[] {
    const g = this.game;
    const w = g?.engine?.world;
    if (!w) return [];
    try { return Matter.Composite.allBodies(w); } catch { return w.bodies || []; }
  }

  // ---------- pilot ----------
  private safePilot() { try { this.pilot(); } catch (e: any) { addFinding(this.tm.bugs, 'autoplay pilot', String(e?.message || e), this.where()); } }

  private snapshot(): Snapshot | null {
    const g = this.game;
    if (!g?.playerBody) return null;
    const p = this.gs.phoenixScreenPos();
    const v = g.playerBody.velocity || { x: 0, y: 0 };
    const threats: Threat[] = [], foes: Foe[] = [], pickups: Pt[] = [];
    for (const b of this.bodies()) {
      if (b === g.playerBody) continue;
      const d = b.plugin?.data;
      if (b.label === 'item') { pickups.push({ x: b.position.x, y: b.position.y }); continue; }
      if (!d) continue;
      const vx = (b.velocity?.x || 0) * 60, vy = (b.velocity?.y || 0) * 60;
      const r = b.circleRadius || Math.max(10, ((b.bounds?.max.x - b.bounds?.min.x) || 20) / 2);
      if (d.owner === 'enemy' || d.type === 'projectile_enemy' || d.type === 'fire' || d.type === 'annihilation_fire') {
        threats.push({ x: b.position.x, y: b.position.y, vx, vy, r, dmg: d.burstDamage || 10 });
      }
    }
    for (const e of g.enemies || []) {
      const d = e.plugin?.data; if (!d) continue;
      const r = e.circleRadius || 20;
      foes.push({ x: e.position.x, y: e.position.y, r, boss: d.type === 'boss' || d.type === 'enemy_phoenix', hp: d.health });
      const vx = (e.velocity?.x || 0) * 60, vy = (e.velocity?.y || 0) * 60;
      threats.push({ x: e.position.x, y: e.position.y, vx, vy, r, dmg: 15 });
    }
    const mv: any = this.gs.playerMovement;
    return {
      p, v: { x: v.x * 60, y: v.y * 60 }, w: innerWidth, h: innerHeight, birdR: 18,
      threats, foes, pickups, stamina: mv?.stamina ?? 100, dashCost: STAMINA.dashCost, rollCost: STAMINA.rollCost,
      telegraph: !!g.bossTelegraphShowing?.(), hpFrac: g.currentHealth() / Math.max(1, g.maxHealth()),
    };
  }

  private pilot() {
    if (!this.running() || this.paused() || this.finishing) return;
    const g = this.game;
    if (!g || this.gs.activeScreen() !== 'game' || g.gameEnded() || g.isDead() || this.gs.isPaused() || this.gs.playerDownPhase() !== 'none' || g.koPanelOpen()) { this.releaseFingers(); return; }
    const now = Date.now();
    if (now < this.busyUntil) return;
    const s = this.snapshot(); if (!s) return;
    const d = decide(s);
    // Reaction delay: commit to a new target only every 120 to 180 ms.
    if (now >= this.reactUntil || d.timeToHit < 0.25) {
      this.plannedTarget = { x: d.target.x + (Math.random() - 0.5) * 8, y: d.target.y + (Math.random() - 0.5) * 8 };
      this.reactUntil = now + 120 + Math.random() * 60;
    }
    if (d.dash) { this.count('flick dash'); return this.runGesture(synthFlick(s.p.x, s.p.y, d.dash.x, d.dash.y, innerWidth, innerHeight), true); }
    if (d.roll && this.f1) { this.count('air roll'); return this.runGesture(synthRoll(Math.min(innerWidth - 20, s.p.x + 120), s.p.y), false); }
    if (d.brake && this.f1) { this.count('brake'); return this.runGesture(synthBrake(Math.min(innerWidth - 20, s.p.x + 120), s.p.y, 320), false); }
    // Abilities, off cooldown, only when no hit is imminent.
    if (d.aim && d.timeToHit > 0.6 && now >= this.nextAbilityAt && now - this.lastPressAt > 350) {
      const fam = this.pickAbility(g);
      if (fam) {
        const chain = synthTapChain(fam, d.aim.x, d.aim.y);
        if (chainIsValid(chain.steps, fam)) { this.count(`${fam} ability`); this.nextAbilityAt = now + chain.durationMs + chain.quietMs + 250; return this.runGesture(chain.steps, true, chain.quietMs); }
      }
    }
    if (d.safeForHold && g.holdCooldown() <= 0 && now >= this.nextAbilityAt && s.foes.length && now - this.lastPressAt > 400 && Math.random() < 0.02) {
      const ms = holdChargeMs(false);
      this.count('hold ability'); this.nextAbilityAt = now + ms + 600;
      return this.runGesture([{ at: 0, type: 'start', id: 1, x: s.p.x, y: s.p.y }, { at: ms, type: 'end', id: 1, x: s.p.x, y: s.p.y }], true, 120);
    }
    this.steer(this.plannedTarget || d.target);
  }

  private pickAbility(g: any): SlotFamily | null {
    const beaten = this.gs.isWorldBossBeaten(this.gs.selectedWorldIndex());
    if (beaten && g.tripleCooldown() <= 0) return 'triple';
    if (g.doubleCooldown() <= 0) return 'double';
    if (g.tapCooldown() <= 0) return 'tap';
    return null;
  }

  private count(k: string) { this.tm.moves[k] = (this.tm.moves[k] || 0) + 1; }

  /** Relative-drag steering: the finger moves by (target - dragTarget) / TOUCH_DRAG_SCALE. */
  private steer(target: Pt) {
    const SCALE = 2.5;
    if (!this.f1) {
      if (Date.now() - this.lastPressAt < 340) return; // never join a tap chain by accident
      const p = this.gs.phoenixScreenPos();
      const fx = Math.max(30, Math.min(innerWidth - 30, p.x)), fy = Math.max(30, Math.min(innerHeight - 30, p.y + 60));
      this.touch('start', 1, fx, fy);
      this.dragTarget = { ...p };
      this.lastPressAt = Date.now();
      return;
    }
    let dx = (target.x - this.dragTarget.x) / SCALE, dy = (target.y - this.dragTarget.y) / SCALE;
    const step = 22; const len = Math.hypot(dx, dy);
    if (len < 1) return;
    if (len > step) { dx = dx / len * step; dy = dy / len * step; }
    let nx = this.f1.x + dx, ny = this.f1.y + dy;
    // Finger near the screen edge: lift and re-plant (human thumb reset).
    if (nx < 8 || ny < 8 || nx > innerWidth - 8 || ny > innerHeight - 8) { this.touch('end', 1, this.f1.x, this.f1.y); return; }
    this.dragTarget = { x: Math.max(0, Math.min(innerWidth, this.dragTarget.x + dx * SCALE)), y: Math.max(0, Math.min(innerHeight, this.dragTarget.y + dy * SCALE)) };
    this.touch('move', 1, nx, ny);
  }

  private runGesture(steps: GestureStep[], needsFingerUp: boolean, quietMs = 0) {
    if (needsFingerUp && this.f1) this.touch('end', 1, this.f1.x, this.f1.y);
    const total = Math.max(...steps.map(s => s.at)) + quietMs + 20;
    this.busyUntil = Date.now() + total;
    const t0 = Date.now();
    for (const s of steps) {
      setTimeout(() => {
        if (!this.running() || this.paused()) return;
        if (s.type === 'start' && s.id === 1) { this.lastPressAt = Date.now(); this.dragTarget = { ...this.gs.phoenixScreenPos() }; }
        this.touch(s.type, s.id, s.x, s.y);
      }, Math.max(0, s.at - (Date.now() - t0)));
    }
  }

  private releaseFingers() {
    if (this.f2) this.touch('end', 2, this.f2.x, this.f2.y);
    if (this.f1) this.touch('end', 1, this.f1.x, this.f1.y);
  }

  /** Dispatch one synthesized touch on document.body so the game's window listeners run. */
  private touch(type: 'start' | 'move' | 'end', id: number, x: number, y: number) {
    if (type === 'start') { if (id === 1) this.f1 = { x, y }; else this.f2 = { x, y }; }
    else if (type === 'move') { if (id === 1 && this.f1) this.f1 = { x, y }; else if (id === 2 && this.f2) this.f2 = { x, y }; else return; }
    const target = document.body;
    const T: any = (window as any).Touch;
    if (typeof T === 'function' && typeof (window as any).TouchEvent === 'function') {
      const mk = (tid: number, p: Pt) => new T({ identifier: tid, target, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, radiusX: 8, radiusY: 8, force: 0.5 });
      const changed = mk(id, { x, y });
      if (type === 'end') { if (id === 1) this.f1 = null; else this.f2 = null; }
      const active: any[] = [];
      if (this.f1) active.push(mk(1, this.f1));
      if (this.f2) active.push(mk(2, this.f2));
      const ev = new TouchEvent(type === 'start' ? 'touchstart' : type === 'move' ? 'touchmove' : 'touchend', { bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [changed] });
      target.dispatchEvent(ev);
    } else {
      if (type === 'end') { if (id === 1) this.f1 = null; else this.f2 = null; }
      const btn = id === 2 ? 2 : 0;
      const ev = new MouseEvent(type === 'start' ? 'mousedown' : type === 'move' ? 'mousemove' : 'mouseup', { bubbles: true, clientX: x, clientY: y, button: btn });
      target.dispatchEvent(ev);
    }
  }
}
