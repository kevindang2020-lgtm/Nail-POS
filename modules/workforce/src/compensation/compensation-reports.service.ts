/**
 * compensation-reports.service.ts — owner + Super Admin compensation reports (§34). Reads the immutable snapshot via a
 * port and runs the pure report builders. Read-only. Returns empty reports (not errors) when no DB is wired.
 */
import { buildCommissionReport, buildSupplyReport, type CommissionReportRow } from './compensation-reports';
import { buildTipReport, type TipReportRow } from './compensation-tips';

export interface ReportsPort {
  reportRows(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<CommissionReportRow[]>;
  tipReport(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<TipReportRow[]>;
}

export class CompensationReportsService {
  constructor(private readonly port?: ReportsPort) {}

  async commission(tenantId: string, fromIso: string, toIso: string, branchId?: string | null) {
    if (!this.port) return null;
    return buildCommissionReport(await this.port.reportRows(tenantId, fromIso, toIso, branchId));
  }
  async supply(tenantId: string, fromIso: string, toIso: string, branchId?: string | null) {
    if (!this.port) return null;
    return buildSupplyReport(await this.port.reportRows(tenantId, fromIso, toIso, branchId));
  }
  async tips(tenantId: string, fromIso: string, toIso: string, branchId?: string | null) {
    if (!this.port) return null;
    return buildTipReport(await this.port.tipReport(tenantId, fromIso, toIso, branchId));
  }
}
