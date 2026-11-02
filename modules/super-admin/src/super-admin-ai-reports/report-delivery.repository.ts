// Repository port for report deliveries (port + in-memory + Kysely). One row per (run, recipient); idempotent insert.
export interface DeliveryRow { id: string; runId: string; recipientId: string; recipientType: string; recipientTenant: string | null; channel: string; status: string; excludedReason: string | null; failureCategory: string | null; attemptCount: number; deliveredAt: string | null }
export interface InsertDeliveryInput { runId: string; recipientId: string; recipientType: string; recipientTenant: string | null; channel: string; status: string; excludedReason: string | null }
export interface DeliveryCounts { delivered: number; failed: number; bounced: number; pending: number; excluded: number; total: number }

export interface ReportDeliveryRepositoryPort {
  findByRunAndRecipient(runId: string, recipientId: string): Promise<DeliveryRow | null>;
  insert(input: InsertDeliveryInput): Promise<DeliveryRow>;
  get(id: string): Promise<DeliveryRow | null>;
  updateStatus(id: string, status: string, opts?: { failureCategory?: string | null; incrementAttempt?: boolean; delivered?: boolean }): Promise<DeliveryRow | null>;
  listByRun(runId: string): Promise<DeliveryRow[]>;
  countsByRun(runId: string): Promise<DeliveryCounts>;
}

export class InMemoryReportDeliveryRepository implements ReportDeliveryRepositoryPort {
  rows: DeliveryRow[] = [];
  private seq = 1;
  async findByRunAndRecipient(runId: string, recipientId: string) { return this.rows.find((r) => r.runId === runId && r.recipientId === recipientId) || null; }
  async insert(i: InsertDeliveryInput): Promise<DeliveryRow> {
    const existing = await this.findByRunAndRecipient(i.runId, i.recipientId);
    if (existing) return existing;
    const row: DeliveryRow = { id: `d${this.seq++}`, runId: i.runId, recipientId: i.recipientId, recipientType: i.recipientType, recipientTenant: i.recipientTenant, channel: i.channel, status: i.status, excludedReason: i.excludedReason, failureCategory: null, attemptCount: 0, deliveredAt: null };
    this.rows.push(row); return row;
  }
  async get(id: string) { return this.rows.find((r) => r.id === id) || null; }
  async updateStatus(id: string, status: string, opts: { failureCategory?: string | null; incrementAttempt?: boolean; delivered?: boolean } = {}) {
    const r = this.rows.find((x) => x.id === id); if (!r) return null;
    r.status = status; if (opts.failureCategory !== undefined) r.failureCategory = opts.failureCategory; if (opts.incrementAttempt) r.attemptCount += 1; if (opts.delivered) r.deliveredAt = new Date().toISOString();
    return r;
  }
  async listByRun(runId: string) { return this.rows.filter((r) => r.runId === runId); }
  async countsByRun(runId: string): Promise<DeliveryCounts> {
    const rs = this.rows.filter((r) => r.runId === runId);
    const c = (s: string) => rs.filter((r) => r.status === s).length;
    return { delivered: c('delivered'), failed: c('failed'), bounced: c('bounced'), pending: c('pending') + c('queued') + c('in_progress'), excluded: c('excluded'), total: rs.filter((r) => r.status !== 'excluded').length };
  }
}
