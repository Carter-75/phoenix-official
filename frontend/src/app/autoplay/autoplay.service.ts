// AI Autoplay tester (owner only). The AI (backend /autoplay/step)
// decides every action through the agent loop in autoplay-agent.ts:
// menu taps, shop buys, starting runs, and when to hand flight to the
// on-device pilot. This service only observes the live screen,
// executes the chosen action, verifies it, and enforces the hard
// safety rails (no real money, no ads, gems only with a quoted
// permission from the prompt). Ads stay suppressed by AdGuard.
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import * as Matter from 'matter-js';
import { environment } from '../../environments/environment';
import { GameStateService, STAMINA } from '../services/game-state.service';
import { AuthService } from '../services/auth.service';
import { AdGuard } from './ad-guard';
import { CappedOutput, OUTPUT_CAP_CHARS, REPORT_RESERVE_CHARS } from './autoplay-output';
import { GestureStep, SlotFamily, synthTapChain, synthFlick, synthRoll, synthBrake, holdChargeMs, chainIsValid } from './autoplay-gestures';
import { decide, Snapshot, Threat, Foe, Pt } from './autoplay-pilot';
import { AttemptRecord, BossRecord, Telemetry, addFinding, newTelemetry } from './autoplay-report';
import { autoplayAllowed, DevFlags } from './autoplay-gate';
import { AgentAction, AgentApiError, AgentEnv, LlmRequest, ObsButton, Observation, StepResult, classifyCurrency, gemQuoteValid, parseCost, runAgent, stepCapFor } from './autoplay-agent';

const AD_REASON = 'autoplay';
const OUT_KEY = 'phoenix_autoplay_output';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

@Injectable({ providedIn: 'root' })
export class AutoplayService {
  private gs = inject(GameStateService);
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private api = environment.apiUrl + '/autoplay';

  readonly running = signal(false);
  readonly paused = signal(false);
  readonly output = signal<string>(localStorage.getItem(OUT_KEY) || '');
  readonly status = signal('Ready');
  /** Steps the AI has taken in the current or last run. */
  readonly steps = signal(0);
  readonly flags = signal<DevFlags & { ai?: boolean; model?: string } | null>(null);

  private out = new CappedOutput(OUTPUT_CAP_CHARS);
  private prompt = '';
  private tm: Telemetry = newTelemetry(Date.now());
  private game: any = null;
  private tickTimer: any = null;
  private pilotTimer: any = null;
  private rafId = 0;
  private deadline: number | null = null;
  private finishing = false;
  private stopRequested = false;
  private resumeTimer: any = null;
  private cleanup: (() => void)[] = [];
  private model = '';
  private events: string[] = [];
  private ledger: string[] = [];
  private btnMap = new Map<string, HTMLElement>();
  private gemPermitted = false;
  /** True only while the AI has handed flight to the pilot (play action). */
  private playing = false;
  private useAbilities = true;

  // Attempt bookkeeping (telemetry only; the AI decides what to do)
  private attempt: AttemptRecord | null = null;
  private attemptStartAt = 0;
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
  private nextAbilityAt = 0;
  private reactUntil = 0;
  private plannedTarget: Pt | null = null;
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
    this.running.set(true);
    this.paused.set(false);
    this.finishing = false;
    this.stopRequested = false;
    this.stopReason = '';
    this.playing = false;
    this.events = []; this.ledger = []; this.model = '';
    this.tm = newTelemetry(Date.now());
    this.out.setStart(this.tm.startedAt);
    const user: any = this.auth.currentUser();
    this.tm.account = user?.email || '';
    this.tm.coinsStart = this.gs.coins(); this.tm.gemsStart = this.gs.gems();
    this.log('safety', `Using ${this.tm.account}'s REAL save. The AI decides every step; code blocks real-money purchases and ads always, and gem spending unless your prompt allows it.`);
    this.deadline = sliderMs ? Date.now() + sliderMs : null;
    this.lastRealmIdx = -1;
    this.attempt = null;
    this.installWatchers();
    this.tickTimer = setInterval(() => this.safeTick(), 250);
    this.pilotTimer = setInterval(() => this.safePilot(), 60);
    this.status.set('Running (AI deciding)');
    this.steps.set(0);
    let outcome: { report: string | null; endReason: string; steps: number; error?: string };
    try {
      outcome = await runAgent(prompt, (req) => { this.steps.update(n => n + 1); return this.callLlm(req); }, this.env(), {
        deadline: this.deadline, maxSteps: stepCapFor(sliderMs ?? null), reportMaxChars: REPORT_RESERVE_CHARS - 400,
        shouldStop: () => this.stopRequested || !this.running(),
      });
    } catch (e: any) {
      // Never end silently: any crash in the loop still writes an output entry.
      outcome = { report: null, endReason: `internal error: ${String(e?.message || e).slice(0, 160)}`, steps: this.steps() };
    }
    if (outcome.error) {
      this.out.setReport(`AUTOPLAY STOPPED: the AI planner is unavailable (${outcome.error}).\nNothing was decided locally; fix the backend AI (OPENAI_API_KEY / OPENAI_MODEL, rate limit) and try again.\nSteps taken: ${outcome.steps}.`);
      await this.finish(`AI API error (${outcome.error})`, null, outcome.steps);
    } else await this.finish(this.stopReason || outcome.endReason, outcome.report, outcome.steps);
  }

  private stopReason = '';
  stop(reason = 'Stopped by tester') {
    if (!this.running() || this.finishing) return;
    this.stopReason = reason;
    this.stopRequested = true;
    this.playing = false;
    this.releaseFingers();
    this.log('safety', `${reason}.`);
  }

  private async callLlm(req: LlmRequest): Promise<unknown> {
    let r: any;
    try { r = await firstValueFrom(this.http.post<any>(`${this.api}/step`, req)); }
    catch (e: any) { throw new AgentApiError(e?.error?.errorCode || (e?.status ? `http_${e.status}` : 'network')); }
    if (r?.source !== 'openai' || !r.action) throw new AgentApiError(r?.errorCode || 'no_action');
    if (!this.model) { this.model = r.model || 'OpenAI'; this.log('plan', `Planner: OpenAI (${this.model}).`); }
    return r.action;
  }

  private async finish(reason: string, report: string | null, steps = this.steps()) {
    if (this.finishing) return;
    this.finishing = true;
    this.playing = false;
    this.tm.endReason = reason;
    clearInterval(this.tickTimer); clearInterval(this.pilotTimer);
    this.releaseFingers();
    if (this.attempt && this.attempt.result === 'running') this.closeAttempt('stopped');
    this.tm.endedAt = Date.now();
    this.tm.coinsEnd = this.gs.coins(); this.tm.gemsEnd = this.gs.gems();
    if (report !== null) {
      const facts = [`Verified by code: coins ${this.tm.coinsStart} -> ${this.tm.coinsEnd}, gems ${this.tm.gemsStart} -> ${this.tm.gemsEnd}.`, ...this.ledger.slice(-20)].join('\n');
      this.out.setReport(`Report written by: OpenAI (${this.model || 'unknown'})\n\n${report}\n\n## Code-verified ledger\nSteps taken: ${steps}.\n${facts}`);
    } else if (!this.out.text().includes('AUTOPLAY STOPPED')) {
      const secs = Math.round((this.tm.endedAt - this.tm.startedAt) / 1000);
      this.out.setReport(`Autoplay ended: ${reason}.\nSteps taken: ${steps}. Ran ${secs} s.\nVerified by code: coins ${this.tm.coinsStart} -> ${this.tm.coinsEnd}, gems ${this.tm.gemsStart} -> ${this.tm.gemsEnd}.${this.ledger.length ? '\n' + this.ledger.slice(-20).join('\n') : ''}\nThe AI did not write a report because the run ended before it called finish.`);
    }
    this.publish();
    this.cleanup.forEach(f => { try { f(); } catch { } }); this.cleanup = [];
    this.running.set(false); this.paused.set(false);
    this.status.set(`Done: ${reason} (${steps} steps)`);
    // Ads stay blocked until the bot has fully left the run.
    setTimeout(() => AdGuard.release(AD_REASON), 1500);
  }

  clearOutput() {
    if (this.running()) return;
    this.out.clear(); this.output.set(''); localStorage.removeItem(OUT_KEY);
    this.status.set('Ready');
  }

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
  private clickEl(b: HTMLElement) {
    const r = b.getBoundingClientRect();
    this.ripple(r.left + r.width / 2, r.top + r.height / 2);
    b.click();
  }
  private click(tag: string, note?: string): boolean {
    const b = this.btn(tag);
    if (!b) return false;
    const r = b.getBoundingClientRect();
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) addFinding(this.tm.ui, 'offscreen', `Button "${tag}" is off screen when needed`, this.where());
    this.clickEl(b);
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


  // ---------- observation ----------
  private event(text: string) { this.events.push(text); if (this.events.length > 10) this.events.shift(); }

  private visibleButtons(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('button')).filter(b => {
      if (b.closest('[data-ap-badge]') || b.offsetParent === null) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  private observe(): Observation {
    const clean = (t: string | null | undefined) => (t || '').replace(/\s+/g, ' ').trim();
    this.btnMap.clear();
    const buttons: ObsButton[] = [];
    const used = new Set<string>();
    for (const b of this.visibleButtons().slice(0, 45)) {
      const tag = b.getAttribute('data-ap');
      let label = clean(b.getAttribute('aria-label') || b.textContent).slice(0, 60);
      if (tag?.startsWith('buy-')) {
        const card = clean(b.parentElement?.parentElement?.textContent).slice(0, 90);
        if (card) label = `${label} | ${card}`;
      }
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'button';
      let id = tag || `b-${slug}`;
      for (let k = 2; used.has(id); k++) id = `${tag || 'b-' + slug}-${k}`;
      used.add(id);
      this.btnMap.set(id, b);
      const disabled = (b as HTMLButtonElement).disabled === true;
      const currency = classifyCurrency(clean(b.textContent) + ' ' + clean(b.getAttribute('aria-label')), tag || '');
      const ob: ObsButton = { id, label, enabled: !disabled };
      if (currency) ob.currency = currency;
      const cost = currency === 'coins' || currency === 'gems' ? parseCost(clean(b.textContent)) : undefined;
      if (cost !== undefined) ob.cost = cost;
      buttons.push(ob);
    }
    const sel = this.gs.selectedWorldIndex();
    const raw: any = this.gs.worldUpgrades()[sel] || {};
    const loadout: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(raw).slice(0, 18)) if (v === null || typeof v === 'number' || typeof v === 'string') loadout[k] = v as any;
    const g = this.game;
    const inGame = this.gs.activeScreen() === 'game' && g;
    const mv: any = this.gs.playerMovement;
    return {
      screen: String(this.gs.activeScreen()),
      coins: this.gs.coins(), gems: this.gs.gems(),
      realm: sel + 1,
      unlockedRealms: this.gs.unlockedWorlds().map((i: number) => i + 1),
      bossBeaten: this.gs.unlockedWorlds().filter((i: number) => this.gs.isWorldBossBeaten(i)).map((i: number) => i + 1),
      loadout,
      run: inGame ? {
        mode: String(this.gs.currentGameMode()), hp: Math.round(g.currentHealth?.() ?? 0), maxHp: Math.round(g.maxHealth?.() ?? 0),
        stamina: Math.round(mv?.stamina ?? 0), timeLeft: Math.round(g.timeRemaining?.() ?? 0), phase: String(g.bossPhase?.() ?? ''),
        dead: !!(g.isDead?.() || g.koPanelOpen?.()), ended: !!g.gameEnded?.(), won: !!g.gameWon?.(),
      } : null,
      buttons,
      events: [...this.events],
      secondsLeft: null,
    };
  }

  private fingerprint() {
    const sel = this.gs.selectedWorldIndex();
    return { coins: this.gs.coins(), gems: this.gs.gems(), screen: String(this.gs.activeScreen()), realm: sel + 1, loadout: JSON.stringify(this.gs.worldUpgrades()[sel] || {}), mode: String(this.gs.currentGameMode()), paused: this.gs.isPaused() };
  }

  private diff(a: ReturnType<AutoplayService['fingerprint']>, b: ReturnType<AutoplayService['fingerprint']>): string[] {
    const d: string[] = [];
    if (a.coins !== b.coins) d.push(`coins ${a.coins} -> ${b.coins}`);
    if (a.gems !== b.gems) d.push(`gems ${a.gems} -> ${b.gems}`);
    if (a.screen !== b.screen) d.push(`screen ${a.screen} -> ${b.screen}`);
    if (a.realm !== b.realm) d.push(`realm ${a.realm} -> ${b.realm}`);
    if (a.mode !== b.mode) d.push(`mode ${a.mode} -> ${b.mode}`);
    if (a.paused !== b.paused) d.push(b.paused ? 'game paused' : 'game resumed');
    if (a.loadout !== b.loadout && a.realm === b.realm) {
      try {
        const x = JSON.parse(a.loadout), y = JSON.parse(b.loadout);
        for (const k of Object.keys(y)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) d.push(`realm ${b.realm} ${k} ${JSON.stringify(x[k])} -> ${JSON.stringify(y[k])}`);
      } catch { d.push('loadout changed'); }
    }
    return d;
  }

  /** Gems dropped without a quoted permission: stop at once. */
  private gemGuard(before: number): string | null {
    const now = this.gs.gems();
    if (now < before && !this.gemPermitted) {
      this.stop('Gem balance dropped without permission; stopping');
      return `gems dropped ${before} -> ${now} without permission; session stopped`;
    }
    return null;
  }

  private env(): AgentEnv {
    return {
      observe: () => this.observe(),
      execute: (a) => this.execute(a),
      now: () => Date.now(),
      log: (k, t) => this.log(k, t),
    };
  }

  private async execute(a: AgentAction): Promise<StepResult> {
    const before = this.fingerprint();
    switch (a.action) {
      case 'tap_button': {
        const el = this.btnMap.get(a.id);
        if (!el || !el.isConnected) return { ok: false, note: `button ${a.id} is gone` };
        if (a.allowGems && a.gemQuote && gemQuoteValid(a.gemQuote, this.prompt)) this.gemPermitted = true;
        if (el.getAttribute('data-ap') === 'play' || el.getAttribute('data-ap') === 'play-battle') this.beginAttempt();
        this.clickEl(el);
        await sleep(700);
        const after = this.fingerprint();
        const g = this.gemGuard(before.gems);
        if (g) return { ok: false, note: g };
        const d = this.diff(before, after);
        if (d.length) {
          if (after.coins < before.coins || after.gems < before.gems) this.ledger.push(`- ${a.id}: ${d.join(', ')}`);
          return { ok: true, note: d.join(', ') };
        }
        return { ok: false, note: 'tapped, but no visible change (balances, loadout, screen all the same)' };
      }
      case 'select_realm': {
        if (this.gs.activeScreen() !== 'menu') return { ok: false, note: 'select_realm only works on the menu' };
        const want = a.realm - 1;
        if (!this.gs.unlockedWorlds().includes(want)) return { ok: false, note: `realm ${a.realm} is locked` };
        if (!this.btn('world-next') && !this.btn('world-prev')) { this.click('mode-normal'); await sleep(500); }
        for (let i = 0; i < 12 && this.gs.selectedWorldIndex() !== want; i++) {
          if (!this.click(this.gs.selectedWorldIndex() < want ? 'world-next' : 'world-prev')) break;
          await sleep(450);
        }
        const ok = this.gs.selectedWorldIndex() === want;
        return { ok, note: ok ? `realm ${a.realm} selected` : `could not select realm ${a.realm} (now ${this.gs.selectedWorldIndex() + 1})` };
      }
      case 'navigate': {
        const scr = this.gs.activeScreen();
        if (a.page === 'menu') {
          if (scr === 'shop') this.click('shop-close');
          else if (scr === 'game' && this.game) { try { this.game.quitGame(); } catch { } }
          else if (scr !== 'menu') this.gs.activeScreen.set('menu');
        } else {
          if (scr === 'game') return { ok: false, note: 'leave the run first (navigate menu)' };
          if (scr !== 'shop' && !this.click('open-shop')) { if (scr !== 'menu') this.gs.activeScreen.set('menu'); await sleep(500); this.click('open-shop'); }
        }
        await sleep(700);
        const ok = this.gs.activeScreen() === a.page;
        return { ok, note: ok ? `on ${a.page}` : `still on ${this.gs.activeScreen()}` };
      }
      case 'start_run': {
        if (this.gs.activeScreen() !== 'menu') return { ok: false, note: 'start_run needs the menu screen' };
        this.click('tutorial-decline'); await sleep(400);
        if (a.mode === 'battle') {
          if (!this.btn('play-battle')) { this.click('mode-battle'); await sleep(500); }
        } else {
          if (a.realm) { const r = await this.execute({ action: 'select_realm', realm: a.realm }); if (!r.ok) return r; }
          this.click(a.mode === 'endless' ? 'mode-endless' : 'mode-normal'); await sleep(400);
        }
        this.beginAttempt();
        if (!this.click(a.mode === 'battle' ? 'play-battle' : 'play')) return { ok: false, note: 'Play button not available' };
        for (let i = 0; i < 20 && this.gs.activeScreen() !== 'game'; i++) await sleep(200);
        const ok = this.gs.activeScreen() === 'game';
        return { ok, note: ok ? `run started: ${this.gs.currentGameMode()} realm ${this.gs.selectedWorldIndex() + 1}` : 'the run did not start' };
      }
      case 'play': return this.playFor(a.seconds, a.until || 'run_end', a.abilities !== false);
      case 'use_ability': {
        const g = this.game;
        if (!g || this.gs.activeScreen() !== 'game') return { ok: false, note: 'not in a run' };
        const c = g.enemies?.[0]?.position || { x: innerWidth / 2, y: innerHeight / 3 };
        this.releaseFingers();
        await sleep(400);
        const steps: GestureStep[] = a.slot === 'hold'
          ? [{ at: 0, type: 'start', id: 1, x: this.gs.phoenixScreenPos().x, y: this.gs.phoenixScreenPos().y }, { at: holdChargeMs(false), type: 'end', id: 1, x: this.gs.phoenixScreenPos().x, y: this.gs.phoenixScreenPos().y }]
          : synthTapChain(a.slot, c.x, c.y).steps;
        this.runGesture(steps, true);
        await sleep(Math.max(...steps.map(s => s.at)) + 600);
        this.count(`${a.slot} ability`);
        return { ok: true, note: `${a.slot} gesture sent` };
      }
      case 'wait': await sleep(a.seconds * 1000); return { ok: true, note: `waited ${a.seconds} s; ${this.diff(before, this.fingerprint()).join(', ') || 'no change'}` };
      case 'finish': return { ok: true, note: 'finish' };
    }
  }

  /** Hands flight to the on-device pilot until time, death, or the run ends. */
  private async playFor(seconds: number, until: 'time' | 'death' | 'run_end', abilities: boolean): Promise<StepResult> {
    if (this.gs.activeScreen() !== 'game' || !this.game) return { ok: false, note: 'not in a run; use start_run first' };
    const t0 = Date.now(), deaths0 = this.attempt?.deaths ?? 0, cleared0 = this.tm.realmsCleared.length, realm0 = this.gs.selectedWorldIndex() + 1;
    const coins0 = this.gs.coins(), gems0 = this.gs.gems();
    this.playing = true; this.useAbilities = abilities;
    let why = 'time up';
    while (true) {
      await sleep(250);
      const g = this.game;
      if (this.stopRequested || !this.running()) { why = 'stopped'; break; }
      if (this.deadline && Date.now() >= this.deadline) { why = 'session time limit'; break; }
      if (Date.now() - t0 >= seconds * 1000) { why = 'time up'; break; }
      if (this.gs.activeScreen() !== 'game' || !g) { why = 'left the run'; break; }
      if (g.isDead?.() || g.koPanelOpen?.() || this.gs.playerDownPhase() !== 'none') { if (until !== 'time' || g.koPanelOpen?.()) { why = 'phoenix is down (KO screen)'; break; } }
      if (g.gameEnded?.()) { why = g.gameWon?.() ? 'run won' : 'run ended'; break; }
      const gg = this.gemGuard(gems0); if (gg) return { ok: false, note: gg };
    }
    this.playing = false;
    this.releaseFingers();
    const parts = [`played ${Math.round((Date.now() - t0) / 1000)} s, ended: ${why}`, `realm ${realm0} -> ${this.gs.selectedWorldIndex() + 1}`,
      `deaths +${(this.attempt?.deaths ?? 0) - deaths0}`, `realms cleared +${this.tm.realmsCleared.length - cleared0}`, `coins ${coins0} -> ${this.gs.coins()}`];
    const g = this.game;
    if (g && this.gs.activeScreen() === 'game') parts.push(`hp ${Math.round(g.currentHealth?.() ?? 0)}/${Math.round(g.maxHealth?.() ?? 0)}, phase ${g.bossPhase?.()}`);
    if (this.lastHitCause) parts.push(`last hit: ${this.lastHitCause}`);
    return { ok: true, note: parts.join('; ') };
  }

  // ---------- telemetry tick ----------
  private safeTick() { try { this.tick(); } catch (e: any) { addFinding(this.tm.bugs, 'autoplay internal', String(e?.message || e), this.where()); } }

  private tick() {
    if (!this.running() || this.finishing) return;
    const now = Date.now();
    if (now - this.lastUiScan > 6000) { this.lastUiScan = now; this.scanUi(); }
    this.checkStuck(now);
    if (this.gs.activeScreen() === 'game') this.gameStep(now);
  }

  private checkStuck(now: number) {
    const g = this.game;
    const key = `${this.gs.activeScreen()}|${this.gs.selectedWorldIndex()}|${g?.timeRemaining?.() ?? ''}|${Math.round(g?.bossHealth?.() ?? 0)}|${this.gs.coins()}|${g?.isDead?.()}`;
    if (key !== this.lastProgressKey) { this.lastProgressKey = key; this.lastProgressAt = now; return; }
    if (this.playing && now - this.lastProgressAt > 60000 && !this.paused()) {
      addFinding(this.tm.bugs, 'softlock', 'No game progress for 60 s (timer, boss HP, coins, realm all frozen)', this.where());
      this.lastProgressAt = now;
      this.event('possible softlock: nothing changed for 60 s');
    }
  }

  private gameStep(now: number) {
    const g = this.game;
    if (!g) return;
    const realmIdx = this.gs.selectedWorldIndex();
    if (this.lastRealmIdx >= 0 && realmIdx === this.lastRealmIdx + 1 && !g.isDead()) this.onRealmCleared(this.lastRealmIdx);
    this.lastRealmIdx = realmIdx;
    if (this.attempt) this.attempt.furthestRealm = Math.max(this.attempt.furthestRealm, realmIdx + 1);
    this.trackBoss(g, now);
    this.trackHp(g);
    this.checkState(g, now);
    if (g.gameEnded() && g.gameWon()) {
      if (this.attempt?.result === 'running') {
        if (this.gs.currentGameMode() === 'battle') { this.tm.battle.matches++; this.tm.battle.wins++; this.event('battle won'); }
        else this.onRealmCleared(realmIdx);
        this.closeAttempt('success');
      }
      return;
    }
    if (g.isDead() || g.koPanelOpen() || this.gs.playerDownPhase() !== 'none') {
      if (!this.sawDead) { this.sawDead = true; this.onDeath(); }
      return;
    }
    this.sawDead = false;
    // Only while the AI handed over flight: a pause would stall the pilot.
    if (this.playing && this.gs.isPaused()) this.click('pause-toggle', 'Game was paused during play; resumed.');
  }

  private onRealmCleared(idx: number) {
    if (this.clearedThisAttempt.includes(idx + 1)) return;
    this.clearedThisAttempt.push(idx + 1);
    this.tm.realmsCleared.push(idx + 1);
    this.event(`realm ${idx + 1} cleared`);
    this.log('progress', `Realm ${idx + 1} cleared.`);
  }

  private beginAttempt() {
    const n = this.tm.attempts.length + 1;
    this.attempt = { n, startRealm: this.gs.selectedWorldIndex() + 1, furthestRealm: this.gs.selectedWorldIndex() + 1, deaths: 0, result: 'running', causes: [], upgradesAfter: [], durationSec: 0 };
    this.tm.attempts.push(this.attempt);
    this.attemptStartAt = Date.now();
    this.clearedThisAttempt = [];
    this.lastRealmIdx = -1;
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
    this.event(`died: ${cause}`);
    this.log('death', `Died: ${cause}.`);
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
    if (on && !this.bossActive) { this.bossActive = true; this.bossFightStart = now; this.rageSeenThisFight = this.finalSeenThisFight = false; const b = this.boss(realm); b.fights++; b.maxHp = g.maxHealth(); this.bossHpSeen = g.bossHealth(); this.event(`realm ${realm} boss fight started`); }
    if (on) {
      const ph = g.bossPhase();
      if (ph === 'rage' && !this.rageSeenThisFight) { this.rageSeenThisFight = true; this.boss(realm).rageReached++; }
      if (ph === 'final' && !this.finalSeenThisFight) { this.finalSeenThisFight = true; this.boss(realm).reachedFinalAttack++; }
      this.bossHpSeen = g.bossHealth();
    }
    if (!on && this.bossActive) {
      this.bossActive = false;
      if (!g.isDead() && this.bossHpSeen <= g.bossMaxHealth() * 0.05) { const t = (now - this.bossFightStart) / 1000; const b = this.boss(this.lastRealmIdx + 1 || realm); b.kills++; b.ttkSec.push(t); this.event(`boss down in ${Math.round(t)} s`); }
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
    const threats: Threat[] = [], foes: Foe[] = [], pickups: { x: number; y: number; kind?: string }[] = [];
    for (const b of this.bodies()) {
      if (b === g.playerBody) continue;
      const d = b.plugin?.data;
      if (b.label === 'item') { pickups.push({ x: b.position.x, y: b.position.y, kind: d?.type }); continue; }
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
      threats, foes, pickups, stamina: mv?.stamina ?? 100, staminaMax: STAMINA.max, dashCost: STAMINA.dashCost, rollCost: STAMINA.rollCost,
      telegraph: !!g.bossTelegraphShowing?.(), hpFrac: g.currentHealth() / Math.max(1, g.maxHealth()),
    };
  }

  private pilot() {
    if (!this.running() || this.paused() || this.finishing || !this.playing) return;
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
    if (this.useAbilities && d.aim && d.timeToHit > 0.6 && now >= this.nextAbilityAt && now - this.lastPressAt > 350) {
      const fam = this.pickAbility(g);
      if (fam) {
        const chain = synthTapChain(fam, d.aim.x, d.aim.y);
        if (chainIsValid(chain.steps, fam)) { this.count(`${fam} ability`); this.nextAbilityAt = now + chain.durationMs + chain.quietMs + 250; return this.runGesture(chain.steps, true, chain.quietMs); }
      }
    }
    if (this.useAbilities && d.safeForHold && g.holdCooldown() <= 0 && now >= this.nextAbilityAt && s.foes.length && now - this.lastPressAt > 400 && Math.random() < 0.02) {
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
