// commission-report.kysely.repository.ts — Kysely adapter over the IMMUTABLE compensation snapshot store (157).
// Tenant/branch scoping is server-derived from ctx. Same basis as payroll / Tech App: paid tickets only, engine
// per-line earnings, tips from engine allocations (merge Oct 12 2026 — Payroll mandate §155).
import type { Kysely } from 'kysely';
import { branchTimeZone, tenantTimeZone, type DB } from '@aipowersalon/database';
import { addDays, businessDate, localDateTimeToEpochMs } from '@aipowersalon/date-time';
import type { CommissionReportContext } from './commission-report.dto';
import type { CommissionReportRepositoryPort, CommissionSource, CommissionAdjustments } from './commission-report.repository';

export class KyselyCommissionReportRepository implements CommissionReportRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: CommissionReportContext, tenantCol: string, branchCol: string): any {
    let q = qb.where(tenantCol, '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(branchCol, '=', ctx.branchId), eb(branchCol, 'is', null)]));
    return q;
  }

  /** Snapshot-store read: PAID tickets only (a snapshot exists only once a ticket is paid), the engine's per-line
   *  technician earnings, and tips from the engine's per-technician allocations (card + cash) — never "tip to the
   *  primary tech". Window is half-open over the SALON's civil days [from 00:00, to+1 00:00) in the branch (else
   *  tenant) zone — Oct 13 2026 (FLOW D8): it was UTC midnights, which split a late evening across two days against
   *  payroll. Posted ledger adjustments in the window ride along so the report equals payroll / the Tech App. */
  private zone(ctx: CommissionReportContext): Promise<string> {
    return ctx.branchId ? branchTimeZone(this.db, ctx.tenantId, ctx.branchId).catch(() => 'UTC') : tenantTimeZone(this.db, ctx.tenantId).catch(() => 'UTC');
  }

  /** The salon's business date now — the presets ("Today", "This month") are the salon's days, not UTC's. */
  async salonToday(ctx: CommissionReportContext): Promise<string> { return businessDate(await this.zone(ctx), new Date()); }

  async load(ctx: CommissionReportContext, from: string, to: string): Promise<CommissionSource> {
    const tz = await this.zone(ctx);
    const civil = (ymd: string) => { const ms = localDateTimeToEpochMs(ymd, '00:00', tz); return Number.isFinite(ms) ? new Date(ms).toISOString() : `${ymd}T00:00:00.000Z`; };
    const fromIso = civil(from);
    const toExclusive = civil(addDays(to, 1));
    const rows: any[] = await this.scoped(this.db.selectFrom('ticket_compensation_snapshots'), ctx, 'tenant_id', 'branch_id')
      .where('snapshot_at', '>=', fromIso).where('snapshot_at', '<', toExclusive)
      .select(['technician_id', 'gross_price_cents', 'commissionable_cents', 'tech_service_earnings_cents', 'retail_commission_cents', 'card_tip_cents', 'cash_tip_cents', 'commission_type', 'commission_value'])
      .execute().catch(() => [] as any[]);

    const tipsByTech: Record<string, number> = {};
    const lines = rows.filter((r) => r.technician_id).map((r) => {
      const tid = String(r.technician_id);
      tipsByTech[tid] = (tipsByTech[tid] || 0) + Number(r.card_tip_cents || 0) + Number(r.cash_tip_cents || 0);
      return {
        technicianId: tid,
        lineTotalCents: Number(r.gross_price_cents || 0),
        commissionType: String(r.commission_type || 'percent'),
        commissionValue: Number(r.commission_value || 0),
        commissionCents: Number(r.tech_service_earnings_cents || 0) + Number(r.retail_commission_cents || 0),
      };
    });

    const adjustments: CommissionAdjustments = { commission: {}, tips: {} };
    const adj: any[] = await this.scoped(this.db.selectFrom('compensation_adjustments'), ctx, 'tenant_id', 'branch_id')
      .where('status', 'in', ['posted', 'approved', 'applied']).where('created_at', '>=', fromIso).where('created_at', '<', toExclusive)
      .select(['technician_id', 'category', 'amount_cents']).execute().catch(() => [] as any[]);
    for (const a of adj) {
      if (!a.technician_id) continue;
      const bucket = String(a.category) === 'tip_correction' ? adjustments.tips : adjustments.commission;
      bucket[String(a.technician_id)] = (bucket[String(a.technician_id)] || 0) + Number(a.amount_cents || 0);
    }

    const techIds = [...new Set([...lines.map((l) => l.technicianId), ...Object.keys(adjustments.commission), ...Object.keys(adjustments.tips)])];
    const techNames: Record<string, string> = {};
    if (techIds.length) {
      const named = await this.db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId)
        .where('id', 'in', techIds).select(['id', 'full_name']).execute().catch(() => [] as any[]);
      for (const r of named) techNames[String(r.id)] = r.full_name || '';
    }
    return { lines, tipsByTech, techNames, adjustments };
  }
}
