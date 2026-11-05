// Repository port for emergency lockdowns + append-only history.
export interface LockdownRow { id: string; lockdownRef: string; scope: string; target: string | null; reason: string; status: string; stepUpVerified: boolean; affectedSessions: number | null; initiatedBy: string | null; confirmedBy: string | null; activatedAt: string | null; liftedAt: string | null; createdAt: string | null }
export interface LockdownActor { userId: string | null; role: string | null; name: string | null; ip: string | null; sessionId: string | null }
export interface TransitionFields { stepUpVerified?: boolean; confirmedBy?: string | null; affectedSessions?: number | null }

export interface LockdownRepositoryPort {
  insert(scope: string, target: string | null, reason: string, actor: LockdownActor): Promise<LockdownRow>;
  get(id: string): Promise<LockdownRow | null>;
  transition(id: string, toStatus: string, note: string | null, fields: TransitionFields, actor: LockdownActor): Promise<LockdownRow | null>;
  list(limit: number): Promise<LockdownRow[]>;
  countActive(): Promise<number>;
}

export class InMemoryLockdownRepository implements LockdownRepositoryPort {
  rows: LockdownRow[] = []; events: any[] = []; audits: any[] = []; private seq = 1;
  async insert(scope: string, target: string | null, reason: string, actor: LockdownActor): Promise<LockdownRow> {
    const ref = `LKD-${new Date().getUTCFullYear()}-${String(this.seq).padStart(3, '0')}`;
    const row: LockdownRow = { id: `lkd${this.seq++}`, lockdownRef: ref, scope, target, reason, status: 'proposed', stepUpVerified: false, affectedSessions: null, initiatedBy: actor.userId, confirmedBy: null, activatedAt: null, liftedAt: null, createdAt: new Date().toISOString() };
    this.rows.push(row); this.events.push({ lockdown: row.id, to: 'proposed', actor: actor.userId }); this.audits.push({ action: 'lockdown_proposed', ref, actor: actor.userId }); return row;
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async transition(id: string, toStatus: string, note: string | null, fields: TransitionFields, actor: LockdownActor) {
    const r = this.rows.find((x) => x.id === id); if (!r) return null;
    const from = r.status; r.status = toStatus; const now = new Date().toISOString();
    if (fields.stepUpVerified !== undefined) r.stepUpVerified = fields.stepUpVerified;
    if (fields.confirmedBy !== undefined) r.confirmedBy = fields.confirmedBy;
    if (fields.affectedSessions !== undefined) r.affectedSessions = fields.affectedSessions;
    if (toStatus === 'active') r.activatedAt = now; if (toStatus === 'lifted') r.liftedAt = now;
    this.events.push({ lockdown: id, from, to: toStatus, actor: actor.userId, note }); this.audits.push({ action: `lockdown_${toStatus}`, ref: r.lockdownRef, actor: actor.userId }); return r;
  }
  async list(limit: number) { return this.rows.slice(0, limit); }
  async countActive() { return this.rows.filter((r) => r.status === 'active').length; }
}
