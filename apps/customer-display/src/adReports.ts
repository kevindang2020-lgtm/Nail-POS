// adReports.ts — 23-inch spec §108: the display tells the salon which of its ads were ON SCREEN and for how long.
// "Do not claim customer viewed the ad merely because it was rendered" — these are DISPLAYS: an ad slot that lasted at
// least a second. Batched (one request a minute, at most 100 per batch), and a batch keeps its id until the server has
// it, so a retry after a dropped connection is counted once (the server dedupes by batch id). Kept on the device while
// offline (bounded, and only the last day — the server refuses older ones). Only ad ids and times — no customer data.
import type { CustomerDisplayAdDisplayReport } from '@aipowersalon/api-contracts/customer';

export const REPORT_STORE_KEY = 'aps.customerDisplay.adReports.v1';
export const REPORT_FLUSH_MS = 60_000;
export const REPORT_MAX_BATCH = 100;
export const REPORT_MAX_QUEUE = 1_000;
/** A slot shorter than this (a playlist change, a checkout taking the panel) is not a display. */
export const MIN_DISPLAY_MS = 1_000;
const MAX_DISPLAY_MS = 120_000;
const MAX_AGE_MS = 23 * 3_600_000;   // the server takes a day back; keep a margin

export interface DisplayItem { adId: string; shownAt: string; durationMs: number }
interface Saved { pending: CustomerDisplayAdDisplayReport | null; queue: DisplayItem[] }
type KV = Pick<Storage, 'getItem' | 'setItem'>;

const randomId = () => {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
};

export class AdReportQueue {
  private queue: DisplayItem[] = [];
  private pending: CustomerDisplayAdDisplayReport | null = null;
  private sending = false;

  constructor(
    private readonly send: (r: CustomerDisplayAdDisplayReport) => Promise<unknown>,
    private readonly store: KV | null = null,
    private readonly now: () => number = () => Date.now(),
    private readonly newBatchId: () => string = randomId,
  ) { this.restore(); }

  /** One ad slot ended after `ms` on screen. */
  record(adId: string, ms: number): void {
    if (!adId || !Number.isFinite(ms) || ms < MIN_DISPLAY_MS) return;
    const d = Math.min(MAX_DISPLAY_MS, Math.round(ms));
    this.queue.push({ adId, shownAt: new Date(this.now() - d).toISOString(), durationMs: d });
    if (this.queue.length > REPORT_MAX_QUEUE) this.queue.splice(0, this.queue.length - REPORT_MAX_QUEUE);   // oldest go first
    this.persist();
  }

  size(): number { return this.queue.length + (this.pending?.displays.length ?? 0); }

  /** Send what is waiting. A failed batch is kept — with the SAME id — for the next try. Never throws. */
  async flush(): Promise<boolean> {
    if (this.sending) return false;
    this.dropStale();
    if (!this.pending) {
      if (this.queue.length === 0) return true;
      this.pending = { batchId: this.newBatchId(), displays: this.queue.splice(0, REPORT_MAX_BATCH) };
      this.persist();
    }
    this.sending = true;
    try {
      await this.send(this.pending);
      this.pending = null;
      this.persist();
      return true;
    } catch {
      return false;
    } finally {
      this.sending = false;
    }
  }

  private dropStale(): void {
    const cutoff = this.now() - MAX_AGE_MS;
    const fresh = (i: DisplayItem) => Date.parse(i.shownAt) >= cutoff;
    this.queue = this.queue.filter(fresh);
    if (this.pending) {
      const kept = this.pending.displays.filter(fresh);
      this.pending = kept.length ? { batchId: this.pending.batchId, displays: kept } : null;
    }
  }

  private persist(): void {
    if (!this.store) return;
    try { this.store.setItem(REPORT_STORE_KEY, JSON.stringify({ pending: this.pending, queue: this.queue } satisfies Saved)); } catch { /* storage full or blocked */ }
  }

  private restore(): void {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(REPORT_STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Saved>;
      const ok = (i: any): i is DisplayItem => i && typeof i.adId === 'string' && typeof i.shownAt === 'string' && Number.isFinite(i.durationMs);
      this.queue = Array.isArray(s.queue) ? s.queue.filter(ok).slice(-REPORT_MAX_QUEUE) : [];
      const p = s.pending;
      this.pending = p && typeof p.batchId === 'string' && Array.isArray(p.displays) ? { batchId: p.batchId, displays: p.displays.filter(ok) } : null;
    } catch { this.queue = []; this.pending = null; }
  }
}
