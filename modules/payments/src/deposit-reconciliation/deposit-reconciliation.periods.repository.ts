// deposit-reconciliation.periods.repository.ts — accounting-period persistence. Tenant-scoped. In-memory for
// tests; Kysely raw sql for production against reconciliation_periods.
import { canMoveToSql } from '@aipowersalon/database';
import { RECONCILIATION_PERIOD } from '../payments-lifecycles';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { ReconPeriod, PeriodStatus } from './deposit-reconciliation.periods';

export interface CreatePeriodInput { label: string; periodStart: string; periodEnd: string; notes?: string | null }

export interface PeriodsRepositoryPort {
  list(ctx: ReconContext): Promise<ReconPeriod[]>;
  create(ctx: ReconContext, input: CreatePeriodInput): Promise<ReconPeriod>;
  find(ctx: ReconContext, id: string): Promise<ReconPeriod | null>;
  setStatus(ctx: ReconContext, id: string, status: PeriodStatus, closedByUserId: string | null, closedAt: string | null, notes?: string | null): Promise<ReconPeriod | null>;
}

const iso = (v: any): string => (v == null ? '' : (typeof v === 'string' ? v : new Date(v).toISOString()));
const dstr = (v: any): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const toDomain = (r: any): ReconPeriod => ({ id: String(r.id), label: String(r.label), periodStart: dstr(r.period_start), periodEnd: dstr(r.period_end), status: String(r.status) as PeriodStatus, closedByUserId: r.closed_by_user_id ? String(r.closed_by_user_id) : null, closedAt: r.closed_at ? iso(r.closed_at) : null, notes: r.notes ?? null, createdAt: iso(r.created_at) });

export class InMemoryPeriodsRepository implements PeriodsRepositoryPort {
  private rows: (ReconPeriod & { tenantId: string })[] = [];
  constructor(seed: (ReconPeriod & { tenantId: string })[] = []) { this.rows = seed.slice(); }
  async list(ctx: ReconContext): Promise<ReconPeriod[]> { return this.rows.filter((r) => r.tenantId === ctx.tenantId).map(({ tenantId, ...rest }) => rest); }
  async create(ctx: ReconContext, i: CreatePeriodInput): Promise<ReconPeriod> {
    const row = { tenantId: ctx.tenantId, id: 'per_' + (this.rows.length + 1), label: i.label, periodStart: i.periodStart, periodEnd: i.periodEnd, status: 'open' as PeriodStatus, closedByUserId: null, closedAt: null, notes: i.notes ?? null, createdAt: new Date().toISOString() };
    this.rows.push(row); const { tenantId, ...rest } = row; return rest;
  }
  async find(ctx: ReconContext, id: string): Promise<ReconPeriod | null> { const r = this.rows.find((x) => x.tenantId === ctx.tenantId && x.id === id); if (!r) return null; const { tenantId, ...rest } = r; return rest; }
  async setStatus(ctx: ReconContext, id: string, status: PeriodStatus, closedByUserId: string | null, closedAt: string | null, notes?: string | null): Promise<ReconPeriod | null> {
    const r = this.rows.find((x) => x.tenantId === ctx.tenantId && x.id === id); if (!r) return null;
    r.status = status; r.closedByUserId = closedByUserId; r.closedAt = closedAt; if (notes !== undefined) r.notes = notes;
    const { tenantId, ...rest } = r; return rest;
  }
}

export class KyselyPeriodsRepository implements PeriodsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async list(ctx: ReconContext): Promise<ReconPeriod[]> {
    const res: any = await sql`SELECT * FROM reconciliation_periods WHERE tenant_id = ${ctx.tenantId} ORDER BY period_end DESC LIMIT 500`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(toDomain);
  }
  async create(ctx: ReconContext, i: CreatePeriodInput): Promise<ReconPeriod> {
    const res: any = await sql`INSERT INTO reconciliation_periods (tenant_id, label, period_start, period_end, notes) VALUES (${ctx.tenantId}, ${i.label}, ${i.periodStart}, ${i.periodEnd}, ${i.notes ?? null}) RETURNING *`.execute(this.db as any);
    return toDomain(res.rows[0]);
  }
  async find(ctx: ReconContext, id: string): Promise<ReconPeriod | null> {
    const res: any = await sql`SELECT * FROM reconciliation_periods WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? toDomain(res.rows[0]) : null;
  }
  async setStatus(ctx: ReconContext, id: string, status: PeriodStatus, closedByUserId: string | null, closedAt: string | null, notes?: string | null): Promise<ReconPeriod | null> {
    const res: any = await sql`
      UPDATE reconciliation_periods SET status = ${status}, closed_by_user_id = ${closedByUserId}, closed_at = ${closedAt},
        notes = ${notes !== undefined ? notes : sql`notes`}, updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id} AND ${canMoveToSql(RECONCILIATION_PERIOD, status)} RETURNING *
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? toDomain(res.rows[0]) : null;
  }
}
