// deposit-reconciliation.fees.repository.ts — versioned fee-schedule storage. Tenant-scoped everywhere. Creating
// a schedule for an existing (tenant, processor) bumps version = max+1 so history is preserved (older versions
// still apply to older settlements via effective_from).
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { FeeSchedule } from './deposit-reconciliation.fees';

export interface CreateFeeScheduleInput {
  processorType: string; label: string; effectiveFrom: string;
  percentageBps?: number; perTransactionCents?: number; batchCents?: number; monthlyCents?: number; notes?: string | null;
}

export interface FeeScheduleRepositoryPort {
  listFeeSchedules(ctx: ReconContext): Promise<FeeSchedule[]>;
  createFeeSchedule(ctx: ReconContext, input: CreateFeeScheduleInput): Promise<FeeSchedule>;
}

const toDomain = (r: any): FeeSchedule => ({
  id: String(r.id), processorType: String(r.processor_type), label: String(r.label), version: Number(r.version || 1),
  effectiveFrom: r.effective_from instanceof Date ? r.effective_from.toISOString().slice(0, 10) : String(r.effective_from).slice(0, 10),
  percentageBps: Number(r.percentage_bps || 0), perTransactionCents: Number(r.per_transaction_cents || 0),
  batchCents: Number(r.batch_cents || 0), monthlyCents: Number(r.monthly_cents || 0), notes: r.notes ?? null,
});

export class InMemoryFeeScheduleRepository implements FeeScheduleRepositoryPort {
  private rows: (FeeSchedule & { tenantId: string })[] = [];
  constructor(seed: (FeeSchedule & { tenantId: string })[] = []) { this.rows = seed.slice(); }
  async listFeeSchedules(ctx: ReconContext): Promise<FeeSchedule[]> {
    return this.rows.filter((r) => r.tenantId === ctx.tenantId).map(({ tenantId, ...rest }) => rest);
  }
  async createFeeSchedule(ctx: ReconContext, i: CreateFeeScheduleInput): Promise<FeeSchedule> {
    const version = 1 + this.rows.filter((r) => r.tenantId === ctx.tenantId && r.processorType === i.processorType).reduce((m, r) => Math.max(m, r.version), 0);
    const row = { tenantId: ctx.tenantId, id: 'fee_' + (this.rows.length + 1), processorType: i.processorType, label: i.label, version, effectiveFrom: i.effectiveFrom, percentageBps: i.percentageBps ?? 0, perTransactionCents: i.perTransactionCents ?? 0, batchCents: i.batchCents ?? 0, monthlyCents: i.monthlyCents ?? 0, notes: i.notes ?? null };
    this.rows.push(row); const { tenantId, ...rest } = row; return rest;
  }
}

export class KyselyFeeScheduleRepository implements FeeScheduleRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async listFeeSchedules(ctx: ReconContext): Promise<FeeSchedule[]> {
    const res: any = await sql`
      SELECT id, processor_type, label, version, effective_from, percentage_bps, per_transaction_cents, batch_cents, monthly_cents, notes
      FROM fee_schedules WHERE tenant_id = ${ctx.tenantId}
      ORDER BY processor_type ASC, effective_from DESC, version DESC
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(toDomain);
  }
  async createFeeSchedule(ctx: ReconContext, i: CreateFeeScheduleInput): Promise<FeeSchedule> {
    const res: any = await sql`
      INSERT INTO fee_schedules (tenant_id, processor_type, label, version, effective_from, percentage_bps, per_transaction_cents, batch_cents, monthly_cents, notes)
      VALUES (
        ${ctx.tenantId}, ${i.processorType}, ${i.label},
        COALESCE((SELECT MAX(version) FROM fee_schedules WHERE tenant_id = ${ctx.tenantId} AND processor_type = ${i.processorType}), 0) + 1,
        ${i.effectiveFrom}, ${i.percentageBps ?? 0}, ${i.perTransactionCents ?? 0}, ${i.batchCents ?? 0}, ${i.monthlyCents ?? 0}, ${i.notes ?? null}
      )
      RETURNING id, processor_type, label, version, effective_from, percentage_bps, per_transaction_cents, batch_cents, monthly_cents, notes
    `.execute(this.db as any);
    return toDomain(res.rows[0]);
  }
}
