// Repository for master→tenant distribution. In-memory impl is stateful so idempotency and skip-existing are
// exercised without a database. Creating a tenant product here NEVER creates branch inventory quantities.

export interface DistributionRow {
  id: string; masterProductId: string; tenantId: string; status: string; tenantProductId: string | null;
  reason: string | null; detail: string | null; createdByUserId: string | null; createdAt: string; completedAt: string | null;
}

export interface DistributionRepo {
  masterExists(masterProductId: string): Promise<boolean>;
  alreadyDistributedTenants(masterProductId: string): Promise<Set<string>>;
  tenantsCarrying(masterProductId: string, tenantIds: string[]): Promise<Set<string>>;
  /** Create the distribution row + the tenant-owned product link. Returns the row (idempotent per master+tenant). */
  recordDistribution(input: { masterProductId: string; tenantId: string; status: 'distributed' | 'skipped_existing'; reason: string | null; createdByUserId: string | null }): Promise<DistributionRow>;
  listDistributions(scope: { masterProductId?: string; tenantId?: string; cap?: number }): Promise<DistributionRow[]>;
}

let DSEQ = 1, TPSEQ = 1;

export class InMemoryDistributionRepo implements DistributionRepo {
  private masters: Set<string>;
  private carrying: Map<string, Set<string>>;  // masterProductId -> tenantIds already carrying
  private rows: DistributionRow[] = [];

  constructor(opts?: { masters?: string[]; carrying?: Record<string, string[]> }) {
    this.masters = new Set(opts?.masters ?? ['PM-0001']);
    this.carrying = new Map(Object.entries(opts?.carrying ?? { 'PM-0001': ['t2'] }).map(([k, v]) => [k, new Set(v)]));
  }

  async masterExists(id: string): Promise<boolean> { return this.masters.has(id); }
  async alreadyDistributedTenants(masterProductId: string): Promise<Set<string>> {
    return new Set(this.rows.filter((r) => r.masterProductId === masterProductId).map((r) => r.tenantId));
  }
  async tenantsCarrying(masterProductId: string, tenantIds: string[]): Promise<Set<string>> {
    const set = this.carrying.get(masterProductId) ?? new Set();
    return new Set(tenantIds.filter((t) => set.has(t)));
  }
  async recordDistribution(input: { masterProductId: string; tenantId: string; status: 'distributed' | 'skipped_existing'; reason: string | null; createdByUserId: string | null }): Promise<DistributionRow> {
    const existing = this.rows.find((r) => r.masterProductId === input.masterProductId && r.tenantId === input.tenantId);
    if (existing) return existing; // idempotent at the row level
    const now = new Date().toISOString();
    const row: DistributionRow = {
      id: `PDIST-${String(DSEQ++).padStart(4, '0')}`, masterProductId: input.masterProductId, tenantId: input.tenantId,
      status: input.status, tenantProductId: input.status === 'distributed' ? `TPROD-${String(TPSEQ++).padStart(4, '0')}` : null,
      reason: input.reason, detail: null, createdByUserId: input.createdByUserId, createdAt: now, completedAt: now,
    };
    this.rows.push(row);
    return row;
  }
  async listDistributions(scope: { masterProductId?: string; tenantId?: string; cap?: number }): Promise<DistributionRow[]> {
    let r = [...this.rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (scope.masterProductId) r = r.filter((x) => x.masterProductId === scope.masterProductId);
    if (scope.tenantId) r = r.filter((x) => x.tenantId === scope.tenantId);
    return r.slice(0, scope.cap ?? 200);
  }
}
