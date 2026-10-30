// Capped output log for the AI Autoplay tester. The bot knows the cap
// (OUTPUT_CAP_CHARS) and condenses instead of letting text be cut:
// repeated lines fold into counters, the oldest live log lines
// collapse into one summary line, and a slice of the budget is always
// reserved for the final report, which the report writer sizes to fit.

export const OUTPUT_CAP_CHARS = 50_000;
export const OUTPUT_MAX_ENTRIES = 1_500;
export const REPORT_RESERVE_CHARS = 20_000;

export interface OutputEntry { t: number; kind: string; text: string; count: number; }

export class CappedOutput {
  private entries: OutputEntry[] = [];
  private folded = 0;
  private report = '';
  constructor(
    public readonly capChars = OUTPUT_CAP_CHARS,
    public readonly maxEntries = OUTPUT_MAX_ENTRIES,
    public readonly reserveChars = REPORT_RESERVE_CHARS,
  ) {}

  get logBudget(): number { return this.capChars - this.reserveChars; }

  add(kind: string, text: string, t = Date.now()) {
    const clean = text.replace(/\u2014/g, '-');
    const last = this.entries[this.entries.length - 1];
    if (last && last.kind === kind && last.text === clean) { last.count++; last.t = t; return; }
    this.entries.push({ t, kind, text: clean, count: 1 });
    this.condense();
  }

  private lineOf(e: OutputEntry, t0: number): string {
    const s = Math.max(0, Math.round((e.t - t0) / 1000));
    const mm = Math.floor(s / 60), ss = s % 60;
    return `[${mm}:${String(ss).padStart(2, '0')}] ${e.text}${e.count > 1 ? ` (x${e.count})` : ''}`;
  }

  private logText(): string {
    if (!this.entries.length && !this.folded) return '';
    const t0 = this.startT ?? (this.entries[0]?.t || 0);
    const head = this.folded ? [`[...] ${this.folded} older log lines condensed to stay under the output cap.`] : [];
    return head.concat(this.entries.map(e => this.lineOf(e, t0))).join('\n');
  }

  private startT: number | null = null;
  setStart(t: number) { this.startT = t; }

  private condense() {
    while (this.entries.length > this.maxEntries || (this.entries.length > 1 && this.logText().length > this.logBudget)) {
      const drop = Math.max(1, Math.floor(this.entries.length * 0.1));
      this.entries.splice(0, drop);
      this.folded += drop;
    }
  }

  /** Report text must fit the space left; fitReport trims it by sections. */
  setReport(text: string) {
    const room = this.capChars - this.logText().length - 2;
    this.report = fitToBudget(text.replace(/\u2014/g, '-'), Math.max(1000, room));
    // If the log ate too much, fold the log further so both fit.
    while (this.text().length > this.capChars && this.entries.length > 1) {
      this.entries.splice(0, Math.max(1, Math.floor(this.entries.length * 0.2)));
      this.folded++;
    }
  }

  text(): string {
    const log = this.logText();
    return this.report ? (log ? log + '\n\n' + this.report : this.report) : log;
  }

  clear() { this.entries = []; this.folded = 0; this.report = ''; this.startT = null; }
  entryCount() { return this.entries.length; }
}

/**
 * Shrink a sectioned report (sections start with "## ") to a budget.
 * Bullet lists lose their tail items first, replaced by "(N more
 * similar items omitted)", longest list first, so every section
 * header and its first items always survive.
 */
export function fitToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const lines = text.split('\n');
  type Block = { start: number; items: number[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  lines.forEach((l, i) => {
    if (/^\s*- /.test(l)) { if (!cur) { cur = { start: i, items: [] }; blocks.push(cur); } cur.items.push(i); }
    else cur = null;
  });
  const removed = new Set<number>();
  const omitted = new Map<number, number>();
  const size = () => lines.reduce((n, l, i) => removed.has(i) ? n : n + l.length + 1, 0)
    + [...omitted.values()].reduce((n, c) => n + 40 + String(c).length, 0);
  let guard = 0;
  while (size() > budget && guard++ < 100000) {
    const live = blocks.map(b => ({ b, left: b.items.filter(i => !removed.has(i)) })).filter(x => x.left.length > 1);
    if (!live.length) break;
    live.sort((a, b) => b.left.length - a.left.length);
    const { b, left } = live[0];
    const idx = left[left.length - 1];
    removed.add(idx);
    omitted.set(b.start, (omitted.get(b.start) || 0) + 1);
  }
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (removed.has(i)) {
      const blk = blocks.find(b => b.items.includes(i))!;
      const lastLive = Math.max(...blk.items);
      if (i === lastLive) out.push(`- (${omitted.get(blk.start)} more similar items omitted to fit the output cap)`);
      return;
    }
    out.push(l);
  });
  let s = out.join('\n');
  if (s.length > budget) s = s.slice(0, Math.max(0, budget - 60)) + '\n(report condensed to fit the output cap)';
  return s;
}
