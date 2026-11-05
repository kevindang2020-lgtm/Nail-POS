// ai-business-technicians.service.ts — get_technician_performance (spec §16, §32, §47).
//
// This is the most safety-constrained tool. It reuses ReportsService.getTechnicians (topTechnicians), which models
// ONLY operational figures: completed services and attributed service revenue per technician. It deliberately:
//   • never exposes compensation, tips, or commission — those are not in this data and require payroll permission (§32);
//   • never ranks "performance" by hidden criteria — the only ordering is by completed-service VOLUME, disclosed (§16);
//   • flags every technician below the sample-size floor so a handful of appointments can't drive a conclusion (§16);
//   • makes no employment recommendation of any kind (§47).
// Utilization, rebooking, and schedule adherence are NOT modeled in the reports layer, so they are omitted, not faked.
import { type ReportsContext, type ReportFilters, type DatePreset, type TopTechnicianRevenue, ForbiddenError } from '@aipowersalon/reports';
import { getMetric, type FreshnessClass } from './ai-business-metrics';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';

export interface TechnicianSource {
  getTechnicians(ctx: ReportsContext, f?: ReportFilters): Promise<TopTechnicianRevenue[]>;
}

export interface TechnicianRow {
  technicianId: string;
  name: string;
  roleLabel: string;
  completedServices: number;
  serviceRevenueCents: number;                 // business revenue attributed to the tech — NOT their pay
  averageServiceRevenueCents: number | null;   // derived; null when no completed services
  volumeRank: number;                          // position by completed-service volume (disclosed criterion)
  limitedSample: boolean;                       // completedServices below the floor → treat cautiously
}

export interface TechnicianPerformance {
  preset: DatePreset;
  partialCurrentPeriod: boolean;
  minSampleSize: number;
  technicians: TechnicianRow[];
  technicianCount: number;
  anyLimitedSample: boolean;
  payrollIncluded: false;                       // always false — this tool never surfaces compensation
  performanceRanking: false;                    // ordering is operational volume only, not a performance verdict
  fairnessNotice: string;
  freshnessClass: FreshnessClass;
  drilldownRoute: string;
  notes: string[];
  modeledFields: string[];
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month'];
const MIN_TECH_SAMPLE = 5;
const FAIRNESS_NOTICE =
  'These are operational figures (completed services and attributed service revenue) for the selected period only. '
  + 'They do not account for scheduled hours, service mix, walk-in load, or customer demand, and must not be used as a '
  + 'standalone performance evaluation or basis for any employment decision. Review schedule and context before drawing conclusions.';
const rctx = (c: AiBusinessContext): ReportsContext => ({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions });

export class AiBusinessTechniciansService {
  constructor(private readonly reports: TechnicianSource) {}

  async getTechnicianPerformance(ctx: AiBusinessContext, presetInput?: string): Promise<TechnicianPerformance> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    if (presetInput != null && !VALID_PRESETS.includes(presetInput as DatePreset)) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
    }
    const preset = (presetInput as DatePreset) ?? 'month';

    let techs: TopTechnicianRevenue[];
    try {
      techs = await this.reports.getTechnicians(rctx(ctx), { preset });
    } catch (e) {
      if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message);
      throw e;
    }

    // Sort by completed-service volume (a disclosed, neutral operational criterion — not a hidden performance score).
    const sorted = [...techs].sort((a, b) => b.completedServices - a.completedServices);
    const rows: TechnicianRow[] = sorted.map((t, i) => ({
      technicianId: t.technicianId, name: t.name, roleLabel: t.roleLabel,
      completedServices: t.completedServices,
      serviceRevenueCents: t.revenueCents,
      averageServiceRevenueCents: t.completedServices > 0 ? Math.round(t.revenueCents / t.completedServices) : null,
      volumeRank: i + 1,
      limitedSample: t.completedServices < MIN_TECH_SAMPLE,
    }));

    const anyLimitedSample = rows.some((r) => r.limitedSample);
    const notes: string[] = [];
    if (preset === 'today') notes.push('Figures cover an incomplete current day and are partial.');
    if (anyLimitedSample) notes.push(`Some technicians have fewer than ${MIN_TECH_SAMPLE} completed services this period; their averages are unreliable.`);
    notes.push('Compensation, tips, and commission are not included and require payroll permission.');
    notes.push('Utilization, rebooking, and schedule adherence are not modeled here.');

    const m = getMetric('technician_utilization')!;
    return {
      preset, partialCurrentPeriod: preset === 'today', minSampleSize: MIN_TECH_SAMPLE,
      technicians: rows, technicianCount: rows.length, anyLimitedSample,
      payrollIncluded: false, performanceRanking: false, fairnessNotice: FAIRNESS_NOTICE,
      freshnessClass: m.freshness, drilldownRoute: m.drilldownRoute, notes,
      modeledFields: ['completedServices', 'serviceRevenueCents', 'averageServiceRevenueCents(derived)'],
    };
  }
}
