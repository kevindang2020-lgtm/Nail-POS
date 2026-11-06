// ai-business-customers.service.ts — get_customer_growth / get_customer_retention (spec §15, §31).
// Reuses ReportsService.getCustomers (the authoritative CustomerInsights: new/returning/retention with trends). The
// reports layer does NOT model cohorts, visit frequency, or per-customer inactivity, so this tool exposes only the
// modeled figures and never labels customers "lost" without a defined threshold (§15). Active customers is a derived,
// clearly-labeled sum — not a new database metric.
import { type ReportsContext, type ReportFilters, type DatePreset, type CustomerInsights, ForbiddenError } from '@aipowersalon/reports';
import { getMetric, type FreshnessClass } from './ai-business-metrics';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext, presetAllowed, rangeFilters } from './ai-business.dto';

export interface CustomerSource {
  getCustomers(ctx: ReportsContext, f?: ReportFilters): Promise<CustomerInsights>;
}

export interface CustomerGrowth {
  preset: DatePreset;
  partialCurrentPeriod: boolean;
  newCustomers: number; newCustomersTrendPercent: number;
  returningCustomers: number; returningCustomersTrendPercent: number;
  activeCustomers: number;                 // derived = new + returning (labeled in modeledFields/notes)
  retentionRatePercent: number; retentionRateTrendPercent: number;
  limitedData: boolean;                    // true when the active-customer sample is below the floor (§16)
  freshnessClass: FreshnessClass;
  drilldownRoute: string;
  notes: string[];
  modeledFields: string[];                 // exactly what is modeled — the UI/assistant must not imply more
}

const VALID_PRESETS: DatePreset[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'last7', 'last30', 'last_month'];
const MIN_ACTIVE_SAMPLE = 5;
const rctx = (c: AiBusinessContext): ReportsContext => ({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions });

export class AiBusinessCustomersService {
  constructor(private readonly reports: CustomerSource) {}

  async getCustomerGrowth(ctx: AiBusinessContext, presetInput?: string): Promise<CustomerGrowth> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    if (!presetAllowed(ctx, presetInput, VALID_PRESETS)) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported reporting period');
    }
    const preset = (presetInput as DatePreset) ?? 'month';

    let ci: CustomerInsights;
    try {
      ci = await this.reports.getCustomers(rctx(ctx), { preset, ...rangeFilters(ctx, preset) });
    } catch (e) {
      if (e instanceof ForbiddenError) throw new AiBusinessForbiddenError(e.message);
      throw e;
    }

    const activeCustomers = ci.newCustomers + ci.returningCustomers;
    const limitedData = activeCustomers < MIN_ACTIVE_SAMPLE;

    const notes: string[] = [];
    if (preset === 'today') notes.push('Figures cover an incomplete current day and are partial.');
    if (limitedData) notes.push(`Only ${activeCustomers} active customer(s) in this period \u2014 read growth and retention percentages with caution.`);
    notes.push('Active customers is new + returning for the period. Cohort, visit-frequency, and inactivity analysis are not modeled here.');

    const newM = getMetric('new_customers')!;
    return {
      preset, partialCurrentPeriod: preset === 'today',
      newCustomers: ci.newCustomers, newCustomersTrendPercent: ci.newCustomersTrendPercent,
      returningCustomers: ci.returningCustomers, returningCustomersTrendPercent: ci.returningCustomersTrendPercent,
      activeCustomers,
      retentionRatePercent: ci.retentionRatePercent, retentionRateTrendPercent: ci.retentionRateTrendPercent,
      limitedData,
      freshnessClass: newM.freshness,
      drilldownRoute: newM.drilldownRoute,
      notes,
      modeledFields: ['newCustomers(+trend)', 'returningCustomers(+trend)', 'retentionRatePercent(+trend)', 'activeCustomers(derived)'],
    };
  }
}
