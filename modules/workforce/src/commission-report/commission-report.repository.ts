// commission-report.repository.ts — port + in-memory adapter (dev/offline/tests default).
import type { CommissionReportContext, CommissionLine } from './commission-report.dto';

export interface CommissionSource {
  lines: CommissionLine[];
  tipsByTech: Record<string, number>;
  techNames: Record<string, string>;
  /** Oct 13 2026 (FLOW D8): posted/approved ledger adjustments in the window — commission (refund reversals, corrections)
   *  and tip corrections — per technician. The report is the same money as payroll and the Tech App. */
  adjustments?: CommissionAdjustments;
}
export interface CommissionAdjustments { commission: Record<string, number>; tips: Record<string, number> }

export interface CommissionReportRepositoryPort {
  load(ctx: CommissionReportContext, from: string, to: string): Promise<CommissionSource>;
  /** The salon's business date now ('YYYY-MM-DD', branch else tenant zone); absent → the UTC date. */
  salonToday?(ctx: CommissionReportContext): Promise<string>;
}

export class InMemoryCommissionReportRepository implements CommissionReportRepositoryPort {
  constructor(private readonly seed: CommissionSource = { lines: [], tipsByTech: {}, techNames: {} }) {}
  async load(_ctx: CommissionReportContext, _from: string, _to: string): Promise<CommissionSource> {
    return { lines: this.seed.lines.slice(), tipsByTech: { ...this.seed.tipsByTech }, techNames: { ...this.seed.techNames }, adjustments: this.seed.adjustments ? { commission: { ...this.seed.adjustments.commission }, tips: { ...this.seed.adjustments.tips } } : undefined };
  }
}
