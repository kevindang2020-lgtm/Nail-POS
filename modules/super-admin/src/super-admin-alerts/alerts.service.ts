// alerts.service.ts — orchestrates Super-Admin Alerts over the repo port; validates transitions + writes audit events.
import type { AlertsRepo } from './alerts.repository';
import { canSetStatus, type AlertStatus, type AlertsQuery } from './alerts-core';

export interface Actor { userId?: string; ip?: string }

export class SuperAdminAlertsService {
  constructor(private readonly repo: AlertsRepo) {}

  list(q: AlertsQuery) { return this.repo.list(q); }
  recent(limit = 5) { return this.repo.recent(Math.min(20, Math.max(1, limit))); }
  summary() { return this.repo.summary(); }
  get(id: string) { return this.repo.get(id); }
  unreadCount() { return this.repo.unreadCount(); }

  async setStatus(id: string, status: AlertStatus, actor: Actor = {}) {
    const cur = await this.repo.get(id);
    if (!cur) return { ok: false as const, error: 'Alert not found' };
    const t = canSetStatus(cur.status, status);
    if (!t.ok) return { ok: false as const, error: t.error! };
    const updated = await this.repo.setStatus(id, status, actor.userId);
    const action = status === 'read' ? 'alert_marked_read' : status === 'unread' ? 'alert_marked_unread' : status === 'resolved' ? 'alert_resolved' : 'alert_dismissed';
    await this.repo.writeAudit(action, id, { from: cur.status, to: status, source: 'super_admin_alerts' }, actor.userId);
    return { ok: true as const, alert: updated };
  }

  async addNote(id: string, note: string, actor: Actor = {}) {
    const text = (note || '').trim();
    if (!text) return { ok: false as const, error: 'Note text is required' };
    const n = await this.repo.addNote(id, text, actor.userId);
    if (!n) return { ok: false as const, error: 'Alert not found' };
    await this.repo.writeAudit('alert_note_added', id, { note: text, source: 'super_admin_alerts' }, actor.userId);
    return { ok: true as const, note: n };
  }

  async markAllRead(actor: Actor = {}) {
    const count = await this.repo.markAllRead(actor.userId);
    await this.repo.writeAudit('alerts_marked_all_read', 'all', { count, source: 'super_admin_alerts' }, actor.userId);
    return { ok: true as const, count };
  }

  /** Materialize actionable alerts from current real platform signals (idempotent). */
  async sync(actor: Actor = {}) {
    const created = await this.repo.syncFromSignals();
    await this.repo.writeAudit('alerts_synced', 'all', { created, source: 'super_admin_alerts' }, actor.userId);
    return { ok: true as const, created };
  }
}
