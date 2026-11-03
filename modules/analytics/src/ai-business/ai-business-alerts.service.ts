// ai-business-alerts.service.ts — CRUD + evaluate-now for business alerts (§34). Validates the bounded metric,
// operator, channel, and a positive threshold; tenant/branch/user come only from the trusted ctx.
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import {
  ALERT_METRICS, ALERT_PRESETS, type AlertMetric, type AlertOperator, type BusinessAlert, type CreateAlertInput,
  type UpdateAlertInput, type AlertsRepositoryPort, type AlertContext,
} from './ai-business-alerts.repository';
import { AiBusinessAlertEvaluator, type AlertEvaluation } from './ai-business-alerts-evaluator';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const CHANNELS = ['in_app', 'email', 'sms'];
const FREQUENCIES = ['hourly', 'daily'];

export class AiBusinessAlertsService {
  constructor(private readonly repo: AlertsRepositoryPort, private readonly evaluator: AiBusinessAlertEvaluator) {}

  private actx(ctx: AiBusinessContext): AlertContext {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId };
  }

  list(ctx: AiBusinessContext): Promise<BusinessAlert[]> { return this.repo.list(this.actx(ctx)); }

  async create(ctx: AiBusinessContext, input: CreateAlertInput): Promise<BusinessAlert> {
    const a = this.actx(ctx);
    const title = (input?.title ?? '').trim();
    if (!title) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'A title is required'), 'TITLE_REQUIRED');
    if (!ALERT_METRICS.includes(input?.metricId as AlertMetric)) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unsupported alert metric');
    if (input?.operator !== 'lt' && input?.operator !== 'gt') throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Operator must be lt or gt');
    if (typeof input?.threshold !== 'number' || !Number.isFinite(input.threshold) || input.threshold < 0) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Threshold must be a non-negative number'), 'THRESHOLD_INVALID');
    if (input.channel && !CHANNELS.includes(input.channel)) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported channel');
    if (input.frequency && !FREQUENCIES.includes(input.frequency)) throw new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Unsupported frequency');
    // at least 1: with 0 an empty period (no tickets) passed the sample check and "fell below" on a fake $0 (Nov 3 audit)
    const minSampleSize = input.minSampleSize != null ? Math.max(1, Math.floor(input.minSampleSize)) : 5;
    // an unknown period used to be accepted and read as the last 7 days (Business Alerts guide, Nov 3 audit)
    if (input.preset != null && !(ALERT_PRESETS as readonly string[]).includes(String(input.preset))) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Choose one of the listed periods.'), 'VALIDATION_FAILED', { field: 'preset' });
    return this.repo.create(a, { ...input, title, metricId: input.metricId as AlertMetric, operator: input.operator as AlertOperator, minSampleSize });
  }

  async update(ctx: AiBusinessContext, id: string, patch: UpdateAlertInput): Promise<BusinessAlert> {
    if (patch.threshold !== undefined && (!Number.isFinite(patch.threshold) || patch.threshold < 0)) {
      throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Threshold must be a non-negative number'), 'THRESHOLD_INVALID');
    }
    // Edit (Business Alerts guide): name, threshold, period and minimum sample — validated like create
    if (patch.title !== undefined && !String(patch.title).trim()) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'A title is required'), 'TITLE_REQUIRED');
    if (patch.preset !== undefined && !(ALERT_PRESETS as readonly string[]).includes(String(patch.preset))) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Choose one of the listed periods.'), 'VALIDATION_FAILED', { field: 'preset' });
    if (patch.minSampleSize !== undefined && (!Number.isInteger(patch.minSampleSize) || patch.minSampleSize < 1)) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'The minimum sample must be a whole number of at least 1.'), 'VALIDATION_FAILED', { field: 'minSampleSize' });
    const row = await this.repo.update(this.actx(ctx), id, { ...patch, ...(patch.title !== undefined ? { title: String(patch.title).trim() } : {}) });
    if (!row) throw withCode(new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Alert not found'), 'ALERT_NOT_FOUND');
    return row;
  }

  async remove(ctx: AiBusinessContext, id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.repo.remove(this.actx(ctx), id);
    if (!deleted) throw withCode(new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Alert not found'), 'ALERT_NOT_FOUND');
    return { deleted: true };
  }

  /** Evaluate an existing alert against current data now, and record the check (storm-suppression bookkeeping). The
   *  metric fetch enforces the caller's own report permissions via the underlying tools. */
  async evaluateNow(ctx: AiBusinessContext, id: string): Promise<AlertEvaluation> {
    const a = this.actx(ctx);
    const alert = await this.repo.get(a, id);
    if (!alert) throw withCode(new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Alert not found'), 'ALERT_NOT_FOUND');
    // Nov 3 audit: the rule's own scope — a salon-wide owner evaluating a branch rule used to store salon-wide numbers as that branch's result
    const scope: AiBusinessContext = alert.branchId !== undefined ? { ...ctx, branchId: alert.branchId ?? '' } : ctx;
    const evalResult = await this.evaluator.evaluate(scope, alert);
    await this.repo.markChecked(a, id, evalResult.triggered);
    return evalResult;
  }
}
