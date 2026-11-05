import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { ReportDeliveryRepositoryPort, DeliveryRow, InsertDeliveryInput, DeliveryCounts } from './report-delivery.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_REPORT_DELIVERY } from '../lifecycles';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const map = (r: any): DeliveryRow => ({ id: String(r.id), runId: String(r.run_id), recipientId: String(r.recipient_id), recipientType: r.recipient_type, recipientTenant: r.recipient_tenant ? String(r.recipient_tenant) : null, channel: r.channel, status: r.status, excludedReason: r.excluded_reason ?? null, failureCategory: r.failure_category ?? null, attemptCount: n(r.attempt_count), deliveredAt: iso(r.delivered_at) });

export class KyselyReportDeliveryRepository implements ReportDeliveryRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  async findByRunAndRecipient(runId: string, recipientId: string) { const r: any = await sql`select * from ai_report_deliveries where run_id = ${runId} and recipient_id = ${recipientId} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async insert(i: InsertDeliveryInput): Promise<DeliveryRow> {
    const r: any = await sql`
      insert into ai_report_deliveries (run_id, recipient_id, recipient_type, recipient_tenant, channel, status, excluded_reason)
      values (${i.runId}, ${i.recipientId}, ${i.recipientType}, ${i.recipientTenant}, ${i.channel}, ${i.status}, ${i.excludedReason})
      on conflict (run_id, recipient_id) do update set updated_at = now() returning *`.execute(this.db as any).then((x) => x.rows[0]);
    return map(r);
  }
  async get(id: string) { const r: any = await sql`select * from ai_report_deliveries where id = ${id} limit 1`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined); return r ? map(r) : null; }
  async updateStatus(id: string, status: string, opts: { failureCategory?: string | null; incrementAttempt?: boolean; delivered?: boolean } = {}) {
    const inc = opts.incrementAttempt ? sql`, attempt_count = attempt_count + 1` : sql``;
    const del = opts.delivered ? sql`, delivered_at = now()` : sql``;
    const fc = opts.failureCategory !== undefined ? sql`, failure_category = ${opts.failureCategory}` : sql``;
    const r: any = await sql`update ai_report_deliveries set status = ${status}${fc}${inc}${del}, updated_at = now() where id = ${id} and ${canMoveToSql(AI_REPORT_DELIVERY, status)} returning *`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return r ? map(r) : null;
  }
  async listByRun(runId: string) { const rows: any[] = await sql`select * from ai_report_deliveries where run_id = ${runId} order by created_at`.execute(this.db as any).then((x) => x.rows).catch(() => []); return rows.map(map); }
  async countsByRun(runId: string): Promise<DeliveryCounts> {
    const r: any = await sql`
      select count(*) filter (where status='delivered')::int delivered, count(*) filter (where status='failed')::int failed,
        count(*) filter (where status='bounced')::int bounced, count(*) filter (where status in ('pending','queued','in_progress'))::int pending,
        count(*) filter (where status='excluded')::int excluded, count(*) filter (where status <> 'excluded')::int total
      from ai_report_deliveries where run_id = ${runId}`.execute(this.db as any).then((x) => x.rows[0]).catch(() => undefined);
    return { delivered: n(r?.delivered), failed: n(r?.failed), bounced: n(r?.bounced), pending: n(r?.pending), excluded: n(r?.excluded), total: n(r?.total) };
  }
}
