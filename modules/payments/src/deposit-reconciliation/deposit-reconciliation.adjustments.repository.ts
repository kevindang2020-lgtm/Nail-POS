// deposit-reconciliation.adjustments.repository.ts — READ-ONLY adapters over the existing payment_refunds,
// chargebacks, and compensation_adjustments tables. Tenant-scoped. Normalizes each into ReconAdjustment. The
// in-memory adapter is for tests; production reads the real tables via Kysely raw sql.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReconContext } from './deposit-reconciliation.dto';
import { refundResolved, chargebackResolved, adjustmentResolved, type ReconAdjustment } from './deposit-reconciliation.adjustments';

export interface AdjustmentsRepositoryPort {
  listAdjustments(ctx: ReconContext): Promise<ReconAdjustment[]>;
}

const iso = (v: any): string => (v == null ? '' : (typeof v === 'string' ? v : new Date(v).toISOString()));

export class InMemoryAdjustmentsRepository implements AdjustmentsRepositoryPort {
  constructor(private seed: (ReconAdjustment & { tenantId: string })[] = []) {}
  async listAdjustments(ctx: ReconContext): Promise<ReconAdjustment[]> {
    return this.seed.filter((r) => r.tenantId === ctx.tenantId).map(({ tenantId, ...rest }) => rest);
  }
}

export class KyselyAdjustmentsRepository implements AdjustmentsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async listAdjustments(ctx: ReconContext): Promise<ReconAdjustment[]> {
    const [refunds, chargebacks, adjustments] = await Promise.all([
      sql`SELECT id, branch_id, processor_type, amount_cents, reason, status, created_at FROM payment_refunds WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at DESC LIMIT 1000`.execute(this.db as any).catch(() => ({ rows: [] })),
      sql`SELECT id, branch_id, processor_type, amount_cents, reason, status, created_at FROM chargebacks WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at DESC LIMIT 1000`.execute(this.db as any).catch(() => ({ rows: [] })),
      sql`SELECT id, branch_id, amount_cents, reason, status, created_at FROM compensation_adjustments WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at DESC LIMIT 1000`.execute(this.db as any).catch(() => ({ rows: [] })),
    ]);
    const out: ReconAdjustment[] = [];
    for (const r of (refunds as any).rows ?? []) {
      const gross = Math.abs(Number(r.amount_cents || 0));
      out.push({ id: String(r.id), kind: 'refund', amountCents: -gross, grossAmountCents: gross, currency: 'USD', status: String(r.status || 'refunded'), reason: r.reason ?? null, processorType: r.processor_type ?? null, branchId: r.branch_id ? String(r.branch_id) : null, resolved: refundResolved(String(r.status || 'refunded')), createdAt: iso(r.created_at) });
    }
    for (const r of (chargebacks as any).rows ?? []) {
      const gross = Math.abs(Number(r.amount_cents || 0));
      out.push({ id: String(r.id), kind: 'chargeback', amountCents: -gross, grossAmountCents: gross, currency: 'USD', status: String(r.status || 'open'), reason: r.reason ?? null, processorType: r.processor_type ?? null, branchId: r.branch_id ? String(r.branch_id) : null, resolved: chargebackResolved(String(r.status || 'open')), createdAt: iso(r.created_at) });
    }
    for (const r of (adjustments as any).rows ?? []) {
      const signed = Number(r.amount_cents || 0);
      out.push({ id: String(r.id), kind: 'adjustment', amountCents: signed, grossAmountCents: Math.abs(signed), currency: 'USD', status: String(r.status || 'pending'), reason: r.reason ?? null, processorType: null, branchId: r.branch_id ? String(r.branch_id) : null, resolved: adjustmentResolved(String(r.status || 'pending')), createdAt: iso(r.created_at) });
    }
    return out;
  }
}
