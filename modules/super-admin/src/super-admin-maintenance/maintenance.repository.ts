import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { MaintenanceMode } from './maintenance-core';

export interface StateRow {
  active: boolean; mode: MaintenanceMode; message: string; expectedRestoration: string | null;
  allowedRoles: string[]; announcementBanner: string; activeEventId: string | null; enabledBy: string | null; enabledAt: string | null;
}
export interface MaintEvent {
  id: string; title: string; reason: string | null; status: string; scope: string; mode: string;
  startsAt: string | null; endsAt: string | null; durationMinutes: number | null; timezone: string | null;
  readOnly: boolean; affectedServices: string[]; createdBy: string | null; createdAt: string; completedAt: string | null;
}
export interface NewEvent { title: string; reason?: string | null; status: string; scope?: string; mode?: string; startsAt?: string | null; endsAt?: string | null; durationMinutes?: number | null; timezone?: string | null; readOnly?: boolean; affectedServices?: string[]; createdBy: string | null; }

export interface MaintenanceRepo {
  getState(): Promise<StateRow>;
  setState(patch: Partial<StateRow>): Promise<StateRow>;
  listEvents(limit: number): Promise<MaintEvent[]>;
  activeOrScheduled(): Promise<MaintEvent[]>;
  getEvent(id: string): Promise<MaintEvent | null>;
  insertEvent(e: NewEvent): Promise<MaintEvent>;
  updateEventStatus(id: string, status: string, completedAt?: string | null): Promise<MaintEvent | null>;
}

const DEFAULT_STATE: StateRow = { active: false, mode: 'full', message: '', expectedRestoration: null, allowedRoles: [], announcementBanner: '', activeEventId: null, enabledBy: null, enabledAt: null };
const iso = (x: any) => (x == null ? null : x instanceof Date ? x.toISOString() : String(x));
const arr = (x: any): string[] => { if (Array.isArray(x)) return x; try { const p = JSON.parse(x); return Array.isArray(p) ? p : []; } catch { return []; } };

function mapState(r: any): StateRow {
  return { active: !!r.active, mode: (r.mode || 'full'), message: r.message || '', expectedRestoration: iso(r.expected_restoration), allowedRoles: arr(r.allowed_roles), announcementBanner: r.announcement_banner || '', activeEventId: r.active_event_id ?? null, enabledBy: r.enabled_by ?? null, enabledAt: iso(r.enabled_at) };
}
function mapEvent(r: any): MaintEvent {
  return { id: r.id, title: r.title, reason: r.reason ?? null, status: r.status, scope: r.scope, mode: r.mode, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), durationMinutes: r.duration_minutes ?? null, timezone: r.timezone ?? null, readOnly: !!r.read_only, affectedServices: arr(r.affected_services), createdBy: r.created_by ?? null, createdAt: iso(r.created_at)!, completedAt: iso(r.completed_at) };
}

export class KyselyMaintenanceRepo implements MaintenanceRepo {
  constructor(private readonly db: Kysely<DB>) {}
  private get t() { return this.db as any; }
  async getState(): Promise<StateRow> { const r = await this.t.selectFrom('maintenance_state').selectAll().where('id', '=', 'singleton').executeTakeFirst(); return r ? mapState(r) : { ...DEFAULT_STATE }; }
  async setState(patch: Partial<StateRow>): Promise<StateRow> {
    const set: any = { updated_at: new Date() };
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.mode !== undefined) set.mode = patch.mode;
    if (patch.message !== undefined) set.message = patch.message;
    if (patch.expectedRestoration !== undefined) set.expected_restoration = patch.expectedRestoration ? new Date(patch.expectedRestoration) : null;
    if (patch.allowedRoles !== undefined) set.allowed_roles = JSON.stringify(patch.allowedRoles);
    if (patch.announcementBanner !== undefined) set.announcement_banner = patch.announcementBanner;
    if (patch.activeEventId !== undefined) set.active_event_id = patch.activeEventId;
    if (patch.enabledBy !== undefined) set.enabled_by = patch.enabledBy;
    if (patch.enabledAt !== undefined) set.enabled_at = patch.enabledAt ? new Date(patch.enabledAt) : null;
    const r = await this.t.updateTable('maintenance_state').set(set).where('id', '=', 'singleton').returningAll().executeTakeFirst();
    return r ? mapState(r) : this.getState();
  }
  async listEvents(limit: number): Promise<MaintEvent[]> { const rows = await this.t.selectFrom('maintenance_events').selectAll().orderBy('starts_at', 'desc').limit(limit).execute(); return rows.map(mapEvent); }
  async activeOrScheduled(): Promise<MaintEvent[]> { const rows = await this.t.selectFrom('maintenance_events').selectAll().where('status', 'in', ['scheduled', 'in_progress', 'extended']).execute(); return rows.map(mapEvent); }
  async getEvent(id: string): Promise<MaintEvent | null> { const r = await this.t.selectFrom('maintenance_events').selectAll().where('id', '=', id).executeTakeFirst(); return r ? mapEvent(r) : null; }
  async insertEvent(e: NewEvent): Promise<MaintEvent> {
    const r = await this.t.insertInto('maintenance_events').values({
      title: e.title, reason: e.reason ?? null, status: e.status, scope: e.scope || 'platform', mode: e.mode || 'full',
      starts_at: e.startsAt ? new Date(e.startsAt) : null, ends_at: e.endsAt ? new Date(e.endsAt) : null, duration_minutes: e.durationMinutes ?? null,
      timezone: e.timezone ?? null, read_only: !!e.readOnly, affected_services: JSON.stringify(e.affectedServices || []), created_by: e.createdBy, created_at: new Date(), updated_at: new Date(),
    }).returningAll().executeTakeFirst();
    return mapEvent(r);
  }
  async updateEventStatus(id: string, status: string, completedAt?: string | null): Promise<MaintEvent | null> {
    const set: any = { status, updated_at: new Date() };
    if (completedAt !== undefined) set.completed_at = completedAt ? new Date(completedAt) : null;
    const r = await this.t.updateTable('maintenance_events').set(set).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? mapEvent(r) : null;
  }
}

export class InMemoryMaintenanceRepo implements MaintenanceRepo {
  private state: StateRow = { ...DEFAULT_STATE };
  private events: MaintEvent[] = [];
  async getState() { return { ...this.state }; }
  async setState(patch: Partial<StateRow>) { this.state = { ...this.state, ...patch }; return { ...this.state }; }
  async listEvents(limit: number) { return this.events.slice().sort((a, b) => ((a.startsAt || '') < (b.startsAt || '') ? 1 : -1)).slice(0, limit); }
  async activeOrScheduled() { return this.events.filter((e) => ['scheduled', 'in_progress', 'extended'].includes(e.status)); }
  async getEvent(id: string) { return this.events.find((e) => e.id === id) || null; }
  async insertEvent(e: NewEvent) { const ev: MaintEvent = { id: 'me_' + (this.events.length + 1), title: e.title, reason: e.reason ?? null, status: e.status, scope: e.scope || 'platform', mode: e.mode || 'full', startsAt: e.startsAt ?? null, endsAt: e.endsAt ?? null, durationMinutes: e.durationMinutes ?? null, timezone: e.timezone ?? null, readOnly: !!e.readOnly, affectedServices: e.affectedServices || [], createdBy: e.createdBy, createdAt: new Date().toISOString(), completedAt: null }; this.events.push(ev); return ev; }
  async updateEventStatus(id: string, status: string, completedAt?: string | null) { const e = this.events.find((x) => x.id === id); if (!e) return null; e.status = status; if (completedAt !== undefined) e.completedAt = completedAt ?? null; return e; }
}
