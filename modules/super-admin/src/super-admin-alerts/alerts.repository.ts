// alerts.repository.ts — data port for Super-Admin Alerts + an in-memory adapter (seedable; never fabricates data).
import { applyFilters, paginate, summarize, type AlertRow, type AlertsQuery, type AlertsSummary, type AlertStatus, type SignalSeed } from './alerts-core';

export interface AlertNote { id: string; alertId: string; actorUserId?: string; note: string; createdAt: string }

export interface AlertsRepo {
  list(q: AlertsQuery): Promise<{ rows: AlertRow[]; total: number }>;
  recent(limit: number): Promise<AlertRow[]>;
  summary(): Promise<AlertsSummary>;
  get(id: string): Promise<(AlertRow & { notes: AlertNote[] }) | null>;
  setStatus(id: string, status: AlertStatus, actorUserId?: string): Promise<AlertRow | null>;
  addNote(id: string, note: string, actorUserId?: string): Promise<AlertNote | null>;
  markAllRead(actorUserId?: string): Promise<number>;
  unreadCount(): Promise<number>;
  /** Idempotent: upsert alerts derived from real platform signals (by dedupeKey). Returns number created. */
  syncFromSignals(seeds?: SignalSeed[]): Promise<number>;
  writeAudit(action: string, alertId: string, meta: Record<string, unknown>, actorUserId?: string): Promise<void>;
}

const now = () => new Date().toISOString();
const uid = (p: string) => p + '_' + Math.random().toString(36).slice(2, 10);

export class InMemoryAlertsRepo implements AlertsRepo {
  alerts: AlertRow[];
  notes: AlertNote[] = [];
  audits: Array<{ action: string; alertId: string; meta: any; actorUserId?: string; at: string }> = [];
  constructor(seed: AlertRow[] = []) { this.alerts = seed.map((a) => ({ ...a })); }

  async list(q: AlertsQuery) { return paginate(applyFilters(this.alerts, q), q.page, q.limit); }
  async recent(limit: number) { return applyFilters(this.alerts, { status: undefined, sortBy: 'createdAt', sortDirection: 'desc' }).slice(0, limit); }
  async summary() { return summarize(this.alerts); }
  async get(id: string) { const a = this.alerts.find((x) => x.id === id); return a ? { ...a, notes: this.notes.filter((n) => n.alertId === id) } : null; }
  async setStatus(id: string, status: AlertStatus, actorUserId?: string) {
    const a = this.alerts.find((x) => x.id === id); if (!a) return null;
    a.status = status; a.updatedAt = now();
    if (status === 'read') a.readAt = now();
    if (status === 'resolved') a.resolvedAt = now();
    if (status === 'dismissed') a.dismissedAt = now();
    return { ...a };
  }
  async addNote(id: string, note: string, actorUserId?: string) {
    if (!this.alerts.find((x) => x.id === id)) return null;
    const n: AlertNote = { id: uid('note'), alertId: id, actorUserId, note, createdAt: now() };
    this.notes.unshift(n); return n;
  }
  async markAllRead(_actorUserId?: string) {
    let n = 0; for (const a of this.alerts) if (a.status === 'unread') { a.status = 'read'; a.readAt = now(); a.updatedAt = now(); n++; } return n;
  }
  async unreadCount() { return this.alerts.filter((a) => a.status === 'unread').length; }
  async syncFromSignals(seeds: SignalSeed[] = []) {
    let created = 0;
    for (const s of seeds) {
      if (this.alerts.some((a) => a.dedupeKey === s.dedupeKey && a.status !== 'dismissed')) continue;
      this.alerts.unshift({ id: uid('al'), ...s, status: 'unread', createdAt: now(), updatedAt: now() });
      created++;
    }
    return created;
  }
  async writeAudit(action: string, alertId: string, meta: Record<string, unknown>, actorUserId?: string) {
    this.audits.unshift({ action, alertId, meta, actorUserId, at: now() });
  }
}
