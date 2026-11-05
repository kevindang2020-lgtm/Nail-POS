// loyalty-actions.service.ts — read-only export actions for the Super Admin Loyalty Programs dashboard. Composes the
// dashboard aggregates into audited CSV / XLSX cross-tenant loyalty reports (performance + liability). No tenant points,
// balances, tiers, or redemptions are ever mutated here — this module writes only an audit row. Formula-injection-guarded.
import { sql, type Kysely } from 'kysely';
import ExcelJS from 'exceljs';
import type { LoyaltyDashboardService, AdminCtx } from './loyalty-dashboard.service';
import type { OverviewScope } from '@aipowersalon/database';

const guard = (v: unknown): string => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
const dollars = (cents: number) => (cents / 100).toFixed(2);

export class LoyaltyActionsService {
  constructor(private readonly db: Kysely<any> | null, private readonly dashboard: LoyaltyDashboardService) {}

  private async audit(ctx: AdminCtx, action: string, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${null}, ${null}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'loyalty', ${null}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* best-effort */ }
  }

  private cols() {
    return [
      { h: 'Tenant', f: (t: any) => t.tenantName ?? '' }, { h: 'Active Programs', f: (t: any) => t.activePrograms },
      { h: 'Members', f: (t: any) => t.members }, { h: 'Engagement %', f: (t: any) => t.engagementPct },
      { h: 'Redemption Rate %', f: (t: any) => t.redemptionRatePct }, { h: 'Liability (USD)', f: (t: any) => dollars(t.liabilityCents) },
      { h: 'Status', f: (t: any) => t.status },
    ];
  }

  async exportCsv(ctx: AdminCtx, q: { scope?: OverviewScope; centsPerPoint?: number }) {
    const d = await this.dashboard.getDashboard(ctx, q);
    const cols = this.cols();
    const csvCell = (v: unknown) => { const s = guard(String(v ?? '')); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines: string[] = [];
    lines.push(`# Loyalty platform summary`);
    lines.push(`Members,${d.kpis.loyaltyMembers}`);
    lines.push(`Points Issued,${d.kpis.pointsIssued}`);
    lines.push(`Points Redeemed,${d.kpis.pointsRedeemed}`);
    lines.push(`Outstanding Liability (USD),${dollars(d.kpis.liabilityCents)}`);
    lines.push(`Active Programs,${d.kpis.activePrograms}`);
    lines.push('');
    lines.push('# Program performance by tenant');
    lines.push(cols.map((c) => csvCell(c.h)).join(','));
    for (const t of d.tenantPerformance) lines.push(cols.map((c) => csvCell(c.f(t))).join(','));
    await this.audit(ctx, 'loyalty.export', { format: 'csv', tenants: d.tenantPerformance.length, scope: q.scope?.tenantId ? 'tenant' : 'platform' });
    return { filename: `loyalty-report-${new Date().toISOString().slice(0, 10)}.csv`, contentType: 'text/csv;charset=utf-8', body: lines.join('\n') };
  }

  async exportXlsx(ctx: AdminCtx, q: { scope?: OverviewScope; centsPerPoint?: number }) {
    const d = await this.dashboard.getDashboard(ctx, q);
    const cols = this.cols();
    const wb = new ExcelJS.Workbook(); wb.creator = 'AI PowerSalon — Loyalty Programs'; wb.created = new Date();
    const sum = wb.addWorksheet('Summary');
    sum.addRows([['Members', d.kpis.loyaltyMembers], ['Points Issued', d.kpis.pointsIssued], ['Points Redeemed', d.kpis.pointsRedeemed], ['Outstanding Liability (USD)', dollars(d.kpis.liabilityCents)], ['Active Programs', d.kpis.activePrograms], ['Engagement %', d.kpis.engagementPct], ['Avg Redemption Rate %', d.kpis.avgRedemptionRatePct]]);
    const ws = wb.addWorksheet('By Tenant', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.h, key: c.h, width: 18 }));
    ws.getRow(1).font = { bold: true };
    for (const t of d.tenantPerformance) ws.addRow(cols.map((c) => (typeof c.f(t) === 'number' ? c.f(t) : guard(String(c.f(t))))));
    const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    await this.audit(ctx, 'loyalty.export', { format: 'xlsx', tenants: d.tenantPerformance.length, scope: q.scope?.tenantId ? 'tenant' : 'platform' });
    return { filename: `loyalty-report-${new Date().toISOString().slice(0, 10)}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
  }
}
