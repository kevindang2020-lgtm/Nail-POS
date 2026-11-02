// Repository port for data-retention rules + purge-run ledger. previewCount performs a SAFE count-only query for
// allowlisted, countable data classes (nothing deleted). In-memory mirrors the contract.
export interface RetentionRow { id: string; dataClass: string; version: number; status: string; retentionDays: number; action: string; scope: string; target: string | null; createdAt: string | null }
export interface RetentionActor { userId: string | null; role: string | null; name: string | null; ip: string | null }

export interface RetentionRepositoryPort {
  getActive(dataClass: string): Promise<RetentionRow | null>;
  listVersions(dataClass: string): Promise<number[]>;
  insertActive(dataClass: string, version: number, retentionDays: number, action: string, actor: RetentionActor): Promise<RetentionRow>;
  list(limit: number): Promise<RetentionRow[]>;
  previewCount(dataClass: string, cutoff: string): Promise<{ supported: boolean; count: number }>;
  recordPurgeRun(dataClass: string, mode: string, cutoff: string, eligible: number, net: number, actor: RetentionActor): Promise<void>;
}

export class InMemoryRetentionRepository implements RetentionRepositoryPort {
  rows: RetentionRow[] = []; runs: any[] = []; audits: any[] = []; counts: Record<string, number> = {}; private seq = 1;
  async getActive(dataClass: string) { return this.rows.find((r) => r.dataClass === dataClass && r.status === 'active') || null; }
  async listVersions(dataClass: string) { return this.rows.filter((r) => r.dataClass === dataClass).map((r) => r.version); }
  async insertActive(dataClass: string, version: number, retentionDays: number, action: string, actor: RetentionActor): Promise<RetentionRow> {
    this.rows.filter((r) => r.dataClass === dataClass && r.status === 'active').forEach((r) => { r.status = 'archived'; });
    const row: RetentionRow = { id: `ret${this.seq++}`, dataClass, version, status: 'active', retentionDays, action, scope: 'platform', target: null, createdAt: new Date().toISOString() };
    this.rows.push(row); this.audits.push({ action: 'retention_rule_changed', dataClass, version, retentionDays, actor: actor.userId }); return row;
  }
  async list(limit: number) { return this.rows.slice(0, limit); }
  async previewCount(dataClass: string, _cutoff: string) { return Object.prototype.hasOwnProperty.call(this.counts, dataClass) ? { supported: true, count: this.counts[dataClass] } : { supported: false, count: 0 }; }
  async recordPurgeRun(dataClass: string, mode: string, cutoff: string, eligible: number, net: number, actor: RetentionActor) { this.runs.push({ dataClass, mode, cutoff, eligible, net, actor: actor.userId }); this.audits.push({ action: 'retention_purge_preview', dataClass, net, actor: actor.userId }); }
}
