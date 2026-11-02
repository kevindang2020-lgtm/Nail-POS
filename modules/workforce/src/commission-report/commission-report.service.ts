// commission-report.service.ts — per-technician commission + tips over a server-controlled period.
import { buildCommissionReport, presetRange, type CommissionReportContext, type CommissionReportState, type CommissionPreset } from './commission-report.dto';
import type { CommissionReportRepositoryPort } from './commission-report.repository';
import { utcDate } from '@aipowersalon/date-time';

export class CommissionReportForbiddenError extends Error {}

const PRESETS: CommissionPreset[] = ['today', 'week', 'month', 'quarter', 'year'];

export class CommissionReportService {
  constructor(private readonly repo: CommissionReportRepositoryPort, private readonly now: () => Date = () => new Date()) {}

  async getState(ctx: CommissionReportContext, presetInput?: string): Promise<CommissionReportState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new CommissionReportForbiddenError('Not authenticated');
    const preset: CommissionPreset = PRESETS.includes(presetInput as CommissionPreset) ? (presetInput as CommissionPreset) : 'month';
    // the presets are the SALON's days (the repository reads from/to as salon civil days) — never the UTC date
    const today = (await this.repo.salonToday?.(ctx).catch(() => null)) ?? utcDate(this.now());   // fallback only when the salon zone cannot be read
    const { from, to } = presetRange(preset, `${today}T12:00:00.000Z`);
    const src = await this.repo.load(ctx, from, to);
    const { kpis, rows } = buildCommissionReport(src.lines, src.tipsByTech, src.techNames, src.adjustments);
    return { preset, from, to, kpis, rows };
  }
}
