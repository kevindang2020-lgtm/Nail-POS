// Repository port for the report-run generation engine. snapshotMetrics reads the REAL daily-summary tables; insertRun
// is idempotent via the unique key. In-memory mirrors the contract for tests.
export interface RunScope { scopeType: string; tenantId: string | null; branchId: string | null }
export interface MetricsSnapshotRow { revenueCents: number; refundsCents: number; bookings: number; completed: number; cancelled: number; noShow: number; newCustomers: number; returningCustomers: number; hasData: boolean }
export interface ReportRunRow {
  id: string; reportReference: string; reportKey: string; scopeType: string; tenantId: string | null; branchId: string | null;
  dateRangeStart: string; dateRangeEnd: string; generationSource: string; generationStatus: string; metricsSnapshot: Record<string, unknown>;
  durationMs: number | null; idempotencyKey: string; createdAt: string | null;
}
export interface InsertRunInput {
  reportReference: string; reportKey: string; scope: RunScope; dateRangeStart: string; dateRangeEnd: string; generationSource: string;
  generationStatus: string; metricsSnapshot: Record<string, unknown>; durationMs: number; idempotencyKey: string; requestedBy: string | null;
}

export interface ReportRunRepositoryPort {
  getRunByIdem(idempotencyKey: string): Promise<ReportRunRow | null>;
  snapshotMetrics(scope: RunScope, start: string, end: string): Promise<MetricsSnapshotRow>;
  insertRun(input: InsertRunInput): Promise<ReportRunRow>;
  getRun(id: string): Promise<ReportRunRow | null>;
}

export class InMemoryReportRunRepository implements ReportRunRepositoryPort {
  runs: ReportRunRow[] = [];
  metrics: MetricsSnapshotRow = { revenueCents: 128000, refundsCents: 2000, bookings: 42, completed: 38, cancelled: 3, noShow: 1, newCustomers: 12, returningCustomers: 26, hasData: true };
  private seq = 1;
  async getRunByIdem(k: string) { return this.runs.find((r) => r.idempotencyKey === k) || null; }
  async snapshotMetrics() { return this.metrics; }
  async insertRun(i: InsertRunInput): Promise<ReportRunRow> {
    const existing = await this.getRunByIdem(i.idempotencyKey);
    if (existing) return existing;
    const row: ReportRunRow = { id: `run${this.seq++}`, reportReference: i.reportReference, reportKey: i.reportKey, scopeType: i.scope.scopeType, tenantId: i.scope.tenantId, branchId: i.scope.branchId, dateRangeStart: i.dateRangeStart, dateRangeEnd: i.dateRangeEnd, generationSource: i.generationSource, generationStatus: i.generationStatus, metricsSnapshot: i.metricsSnapshot, durationMs: i.durationMs, idempotencyKey: i.idempotencyKey, createdAt: new Date().toISOString() };
    this.runs.push(row); return row;
  }
  async getRun(id: string) { return this.runs.find((r) => r.id === id) || null; }
}
