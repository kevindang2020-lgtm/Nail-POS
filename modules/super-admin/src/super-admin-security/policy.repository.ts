// Repository port for versioned security policies. In-memory mirrors the contract; Kysely archives the prior active
// version and inserts the new active one in a transaction, then audits.
export interface PolicyRow { id: string; kind: string; version: number; status: string; config: Record<string, unknown>; compliant: boolean; activatedAt: string | null; createdAt: string | null }
export interface PolicyActor { userId: string | null; role: string | null; name: string | null; ip: string | null }

export interface PolicyRepositoryPort {
  getActive(kind: string): Promise<PolicyRow | null>;
  listVersions(kind: string): Promise<number[]>;
  insertActive(kind: string, version: number, config: Record<string, unknown>, compliant: boolean, actor: PolicyActor): Promise<PolicyRow>;
  history(kind: string, limit: number): Promise<PolicyRow[]>;
  activeCompliance(): Promise<{ session: boolean | null; password: boolean | null; mfa: boolean | null }>;
}

export class InMemoryPolicyRepository implements PolicyRepositoryPort {
  rows: PolicyRow[] = []; audits: any[] = []; private seq = 1;
  async getActive(kind: string) { return this.rows.find((r) => r.kind === kind && r.status === 'active') || null; }
  async listVersions(kind: string) { return this.rows.filter((r) => r.kind === kind).map((r) => r.version); }
  async insertActive(kind: string, version: number, config: Record<string, unknown>, compliant: boolean, actor: PolicyActor): Promise<PolicyRow> {
    this.rows.filter((r) => r.kind === kind && r.status === 'active').forEach((r) => { r.status = 'archived'; });
    const row: PolicyRow = { id: `pol${this.seq++}`, kind, version, status: 'active', config, compliant, activatedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    this.rows.push(row); this.audits.push({ action: `${kind}_policy_changed`, kind, version, compliant, actor: actor.userId }); return row;
  }
  async history(kind: string, limit: number) { return this.rows.filter((r) => r.kind === kind).slice(0, limit); }
  async activeCompliance() { const g = (k: string) => { const r = this.rows.find((x) => x.kind === k && x.status === 'active'); return r ? r.compliant : null; }; return { session: g('session'), password: g('password'), mfa: g('mfa') }; }
}
