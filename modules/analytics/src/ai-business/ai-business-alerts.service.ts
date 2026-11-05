// ai-business-alerts.service.ts — CRUD + evaluate-now for business alerts (§34). Validates the bounded metric,
// operator, channel, and a positive threshold; tenant/branch/user come only from the trusted ctx.
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import {
  ALERT_METRICS, type AlertMetric, type AlertOperator, type BusinessAlert, type CreateAlertInput,
  type UpdateAlertInput, type AlertsRepositoryPort, type AlertContext,
} from './ai-business-alerts.repository';
import { AiBusinessAlertEvaluator, type AlertEvaluation } from './ai-business-alerts-evaluator';

const CHANNELS = ['in_app', 'email', 'sms'];
const FREQUENCIES = ['hourly', 'daily'];

export class AiBusinessAlertsService {
  constructor(private readonly repo: AlertsRepositoryPort, private readonly evaluator: AiBusinessAlertEvaluator) {}

  private actx(ctx: AiBusinessContext): AlertContext {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId };
  }

  list(ctx: AiBusinessContext): Promise<BusinessAlert[]> { return this.repo.list(this.actx(ctx)); }

  create(ctx: AiBusinessContext, input: CreateAlertInput): Promise<BusinessAlert> {
    const a = this.actx(ctx);
    const title = (input?.title ?? '').trim();
    if (!title) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'A title is required');
    if (!ALERT_METRICS.includes(input?.metricId as AlertMetric)) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unsupported alert metric');
    if (input?.operator !== 'lt' && input?.operator !== 'gt') throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Operator must be lt or gt');
    if (typeof input?.threshold !== 'number' || !Number.isFinite(input.threshold) || input.threshold < 0) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Threshold must be a non-negative number');
    if (input.channel && !CHANNELS.includes(input.channel)) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported channel');
    if (input.frequency && !FREQUENCIES.includes(input.frequency)) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported frequency');
    const minSampleSize = input.minSampleSize != null ? Math.max(0, Math.floor(input.minSampleSize)) : 5;
    return this.repo.create(a, { ...input, title, metricId: input.metricId as AlertMetric, operator: input.operator as AlertOperator, minSampleSize });
  }

  async update(ctx: AiBusinessContext, id: string, patch: UpdateAlertInput): Promise<BusinessAlert> {
    if (patch.threshold !== undefined && (!Number.isFinite(patch.threshold) || patch.threshold < 0)) {
      throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Threshold must be a non-negative number');
    }
    const row = await this.repo.update(this.actx(ctx), id, patch);
    if (!row) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Alert not found');
    return row;
  }

  async remove(ctx: AiBusinessContext, id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.repo.remove(this.actx(ctx), id);
    if (!deleted) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Alert not found');
    return { deleted: true };
  }

  /** Evaluate an existing alert against current data now, and record the check (storm-suppression bookkeeping). The
   *  metric fetch enforces the caller's own report permissions via the underlying tools. */
  async evaluateNow(ctx: AiBusinessContext, id: string): Promise<AlertEvaluation> {
    const a = this.actx(ctx);
    const alert = await this.repo.get(a, id);
    if (!alert) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Alert not found');
    const evalResult = await this.evaluator.evaluate(ctx, alert);
    await this.repo.markChecked(a, id, evalResult.triggered);
    return evalResult;
  }
}
