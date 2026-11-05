// noshow-risk.service.ts — No-Show / Cancellation Risk domain. Scores UPCOMING appointments from operational signals via
// the transparent core. Appointment-level risk is restricted to authorized operational users (requires reports.view) and
// exposes only the minimum needed to act (appointment, customer name, time, risk, reasons, permitted actions) — never
// sensitive attributes. The result is an indicator, NOT a backtested accuracy claim, and only permitted actions are ever
// suggested. Marking false positives (feedback) is a later slice; this slice produces the risk view.
import { scoreNoShowRisk, type RiskFeatures, type RiskLevel } from './noshow-risk.core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext } from './ai-analytics-forecasting.dto';

export const NOSHOW_MODEL_VERSION = 'noshow-heuristic-v1';

export interface UpcomingAppointmentRisk {
  appointmentId: string;
  customerId: string;
  customerName: string | null;
  startTime: string;
  features: RiskFeatures;
}

export interface NoShowRiskSource {
  /** Upcoming appointments (next `days`) with derived operational features. MUST be tenant+branch scoped. */
  getUpcoming(ctx: AiForecastContext, days: number): Promise<UpcomingAppointmentRisk[]>;
}

export class InMemoryNoShowSource implements NoShowRiskSource {
  public lastCtx: AiForecastContext | null = null;
  constructor(private data: Record<string, Record<string, UpcomingAppointmentRisk[]>> = {}) {}
  seed(tenantId: string, branchId: string, rows: UpcomingAppointmentRisk[]) { (this.data[tenantId] ??= {})[branchId] = rows; }
  async getUpcoming(ctx: AiForecastContext, _days: number): Promise<UpcomingAppointmentRisk[]> {
    this.lastCtx = ctx;
    return (this.data[ctx.tenantId]?.[ctx.branchId] ?? []).map((r) => ({ ...r, features: { ...r.features } }));
  }
}

export interface AppointmentRisk {
  appointmentId: string;
  customerName: string | null;
  startTime: string;
  score: number;
  level: RiskLevel;
  confidence: string;
  reasons: { code: string; label: string; direction: string }[];
  permittedActions: string[];
}

const RANK: Record<RiskLevel, number> = { very_high: 4, high: 3, moderate: 2, insufficient_data: 1, low: 0 };

export class NoShowRiskService {
  constructor(private readonly source: NoShowRiskSource) {}

  async getUpcomingRisk(ctx: AiForecastContext, days = 7): Promise<{ branchId: string; days: number; modelVersion: string; items: AppointmentRisk[]; generatedAt: string; disclaimer: string }> {
    if (!ctx.permissions.includes('reports.view')) {
      throw new AiForecastError(AiForecastErrorCode.INSUFFICIENT_PERMISSION, 'Missing reports.view', 403);
    }
    if (days < 1 || days > 30) throw new AiForecastError(AiForecastErrorCode.INVALID_HORIZON, 'Days must be 1–30', 400);

    const rows = await this.source.getUpcoming(ctx, days);
    const items: AppointmentRisk[] = rows.map((r) => {
      const risk = scoreNoShowRisk(r.features);
      return {
        appointmentId: r.appointmentId, customerName: r.customerName, startTime: r.startTime,
        score: risk.score, level: risk.level, confidence: risk.confidence, reasons: risk.reasons, permittedActions: risk.permittedActions,
      };
    });
    items.sort((a, b) => RANK[b.level] - RANK[a.level] || b.score - a.score);
    return {
      branchId: ctx.branchId, days, modelVersion: NOSHOW_MODEL_VERSION, items,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Heuristic risk indicator from operational signals only (no sensitive attributes). Not a backtested prediction; suggested actions are non-punitive and follow tenant policy and communication consent.',
    };
  }
}
