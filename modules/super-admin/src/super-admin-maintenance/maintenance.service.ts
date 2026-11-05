import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MaintenanceRepo, MaintEvent } from './maintenance.repository';
import { validateSchedule, windowsOverlap, durationMinutes, formatDuration, canTransitionMaint, type MaintenanceState, type MaintStatus } from './maintenance-core';

export class MaintError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); this.name = 'MaintError'; } }
export interface AdminCtx { userId?: string; email?: string; role?: string; ip?: string }

export class MaintenanceService {
  private cache: { at: number; state: MaintenanceState } | null = null;
  constructor(private readonly repo: MaintenanceRepo, private readonly db?: Kysely<DB>) {}

  private async audit(ctx: AdminCtx, action: string, entityId: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs' as any).values({
      id: sql`gen_random_uuid()` as any, tenant_id: null as any, user_id: (ctx.userId || null) as any, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'maintenance', entity_id: entityId, metadata_json: JSON.stringify(meta || {}) as any,
    } as any).execute().catch(() => { /* auditing must not break the action */ });
  }

  private invalidate() { this.cache = null; }

  /** Short-TTL cached enforcement state read by the middleware (avoids a DB hit per request). */
  async cachedState(): Promise<MaintenanceState> {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.state;
    const s = await this.repo.getState();
    const state: MaintenanceState = { active: s.active, mode: s.mode, message: s.message, expectedRestoration: s.expectedRestoration, allowedRoles: s.allowedRoles };
    this.cache = { at: Date.now(), state };
    return state;
  }

  /** Full state for the panel + card. */
  async getState() {
    const s = await this.repo.getState();
    const act = await this.repo.activeOrScheduled();
    const next = act.filter((e) => e.status === 'scheduled' && e.startsAt).sort((a, b) => (a.startsAt! < b.startsAt! ? -1 : 1))[0] || null;
    return { active: s.active, mode: s.mode, message: s.message, expectedRestoration: s.expectedRestoration, allowedRoles: s.allowedRoles, announcementBanner: s.announcementBanner, enabledBy: s.enabledBy, enabledAt: s.enabledAt, nextScheduled: next ? { id: next.id, title: next.title, startsAt: next.startsAt, endsAt: next.endsAt } : null };
  }

  async enable(ctx: AdminCtx, input: { reason?: string; title?: string; message?: string; mode?: string; expectedRestoration?: string; allowedRoles?: string[] }) {
    if (!input?.reason || !String(input.reason).trim()) throw new MaintError('invalid', 'A reason is required to enable maintenance mode.');
    const mode = input.mode === 'read_only' ? 'read_only' : 'full';
    const ev = await this.repo.insertEvent({ title: input.title || 'Maintenance', reason: String(input.reason), status: 'in_progress', mode, startsAt: new Date().toISOString(), endsAt: input.expectedRestoration || null, readOnly: mode === 'read_only', createdBy: ctx.userId ?? ctx.email ?? null });
    await this.repo.setState({ active: true, mode, message: input.message || '', expectedRestoration: input.expectedRestoration || null, allowedRoles: Array.isArray(input.allowedRoles) ? input.allowedRoles : [], activeEventId: ev.id, enabledBy: ctx.userId ?? ctx.email ?? null, enabledAt: new Date().toISOString() });
    this.invalidate();
    await this.audit(ctx, 'maintenance_mode_enabled', ev.id, { mode, reason: input.reason });
    return this.getState();
  }

  /** Always reachable by SUPER_ADMIN even during maintenance (the middleware never blocks SUPER_ADMIN) — no lockout. */
  async disable(ctx: AdminCtx) {
    const s = await this.repo.getState();
    if (s.activeEventId) await this.repo.updateEventStatus(s.activeEventId, 'completed', new Date().toISOString());
    await this.repo.setState({ active: false, activeEventId: null });
    this.invalidate();
    await this.audit(ctx, 'maintenance_mode_disabled', s.activeEventId || '-', {});
    return this.getState();
  }

  async schedule(ctx: AdminCtx, input: { title?: string; reason?: string; startsAt?: string; endsAt?: string; timezone?: string; mode?: string; affectedServices?: string[] }) {
    if (!input?.reason || !String(input.reason).trim()) throw new MaintError('invalid', 'A reason is required to schedule maintenance.');
    if (!input?.startsAt || !input?.endsAt) throw new MaintError('invalid', 'Start and end times are required.');
    const err = validateSchedule({ startsAt: input.startsAt, endsAt: input.endsAt });
    if (err) throw new MaintError('invalid', err);
    for (const e of await this.repo.activeOrScheduled()) {
      if (e.startsAt && e.endsAt && windowsOverlap({ startsAt: input.startsAt, endsAt: input.endsAt }, { startsAt: e.startsAt, endsAt: e.endsAt })) throw new MaintError('conflict', 'This window overlaps an existing scheduled maintenance — duplicate/overlapping windows are not allowed.');
    }
    const dur = durationMinutes({ startsAt: input.startsAt, endsAt: input.endsAt });
    const ev = await this.repo.insertEvent({ title: input.title || 'Scheduled Maintenance', reason: String(input.reason), status: 'scheduled', mode: input.mode === 'read_only' ? 'read_only' : 'full', startsAt: input.startsAt, endsAt: input.endsAt, durationMinutes: dur, timezone: input.timezone || null, readOnly: input.mode === 'read_only', affectedServices: input.affectedServices || [], createdBy: ctx.userId ?? ctx.email ?? null });
    await this.audit(ctx, 'maintenance_scheduled', ev.id, { startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason });
    return ev;
  }

  async cancel(ctx: AdminCtx, eventId: string): Promise<MaintEvent> {
    const e = await this.repo.getEvent(eventId);
    if (!e) throw new MaintError('not_found', 'Maintenance event not found.');
    if (!canTransitionMaint(e.status as MaintStatus, 'cancelled')) throw new MaintError('conflict', `Cannot cancel a ${e.status} maintenance event.`);
    const r = await this.repo.updateEventStatus(eventId, 'cancelled');
    if (!r) throw new MaintError('conflict', 'Could not cancel.');
    await this.audit(ctx, 'maintenance_cancelled', eventId, {});
    return r;
  }

  async setBanner(ctx: AdminCtx, text: string) {
    await this.repo.setState({ announcementBanner: String(text || '') });
    this.invalidate();
    await this.audit(ctx, 'maintenance_banner_changed', '-', { hasBanner: !!text });
    return this.getState();
  }

  /** Scheduled Maintenance History table rows. */
  async history(limit = 20) {
    const rows = await this.repo.listEvents(Math.min(Math.max(limit, 1), 100));
    return rows.map((e) => ({ id: e.id, startsAt: e.startsAt, duration: formatDuration(e.durationMinutes), reason: e.reason || e.title, status: e.status, mode: e.mode }));
  }
}
