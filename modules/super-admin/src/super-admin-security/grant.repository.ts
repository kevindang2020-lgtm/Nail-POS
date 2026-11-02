// Repository port for privileged-access grants + append-only review history.
export interface GrantRow { id: string; grantRef: string; userId: string; privilege: string; scope: string; target: string | null; reason: string; status: string; requestedBy: string | null; approvedBy: string | null; grantedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string | null }
export interface GrantActor { userId: string | null; role: string | null; name: string | null; ip: string | null }
export interface GrantFields { approvedBy?: string | null; grantedAt?: string | null; revokedAt?: string | null }

export interface GrantRepositoryPort {
  insert(input: { userId: string; privilege: string; scope: string; target: string | null; reason: string; expiresAt: string }, actor: GrantActor): Promise<GrantRow>;
  get(id: string): Promise<GrantRow | null>;
  transition(id: string, toStatus: string, note: string | null, fields: GrantFields, actor: GrantActor): Promise<GrantRow | null>;
  list(limit: number): Promise<GrantRow[]>;
  listActive(): Promise<GrantRow[]>;
  expireOverdue(actor: GrantActor): Promise<number>;
  countActive(): Promise<number>;
}

export class InMemoryGrantRepository implements GrantRepositoryPort {
  rows: GrantRow[] = []; events: any[] = []; audits: any[] = []; private seq = 1;
  async insert(i: { userId: string; privilege: string; scope: string; target: string | null; reason: string; expiresAt: string }, actor: GrantActor): Promise<GrantRow> {
    const ref = `PAG-${new Date().getUTCFullYear()}-${String(this.seq).padStart(3, '0')}`;
    const row: GrantRow = { id: `pag${this.seq++}`, grantRef: ref, userId: i.userId, privilege: i.privilege, scope: i.scope, target: i.target, reason: i.reason, status: 'pending', requestedBy: actor.userId, approvedBy: null, grantedAt: null, expiresAt: i.expiresAt, revokedAt: null, createdAt: new Date().toISOString() };
    this.rows.push(row); this.events.push({ grant: row.id, to: 'pending', actor: actor.userId }); this.audits.push({ action: 'privileged_access_requested', ref, actor: actor.userId }); return row;
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async transition(id: string, toStatus: string, note: string | null, fields: GrantFields, actor: GrantActor) {
    const r = this.rows.find((x) => x.id === id); if (!r) return null;
    const from = r.status; r.status = toStatus;
    if (fields.approvedBy !== undefined) r.approvedBy = fields.approvedBy;
    if (fields.grantedAt !== undefined) r.grantedAt = fields.grantedAt;
    if (fields.revokedAt !== undefined) r.revokedAt = fields.revokedAt;
    this.events.push({ grant: id, from, to: toStatus, actor: actor.userId, note }); this.audits.push({ action: `privileged_access_${toStatus}`, ref: r.grantRef, actor: actor.userId }); return r;
  }
  async list(limit: number) { return this.rows.slice(0, limit); }
  async listActive() { const now = Date.now(); return this.rows.filter((r) => r.status === 'active' && r.expiresAt && Date.parse(r.expiresAt) > now); }
  async expireOverdue(actor: GrantActor) { const now = Date.now(); let c = 0; this.rows.filter((r) => r.status === 'active' && (!r.expiresAt || Date.parse(r.expiresAt) <= now)).forEach((r) => { r.status = 'expired'; this.events.push({ grant: r.id, from: 'active', to: 'expired', actor: actor.userId, note: 'auto-expired' }); c++; }); return c; }
  async countActive() { return (await this.listActive()).length; }
}
