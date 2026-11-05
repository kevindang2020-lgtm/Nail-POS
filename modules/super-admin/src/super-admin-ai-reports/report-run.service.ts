// Report-run generation engine — server-authoritative + idempotent. Builds a STRUCTURED metrics snapshot from the real
// daily-summary tables, validates it for grounding, and records an immutable run. No AI narrative and no invented
// numbers: every metric is a validated aggregate. A retry with the same request returns the original run.
import { buildRunIdempotencyKey, validateMetricsSnapshot, generateReportReference } from './report-run-core';
import type { ReportRunRepositoryPort, RunScope } from './report-run.repository';

export class ReportRunError extends Error { constructor(public code: 'invalid' | 'not_found', message: string) { super(message); } }

export interface GenerateInput { reportKey: string; scopeType?: string; tenantId?: string | null; branchId?: string | null; start: string; end: string; source?: 'on_demand' | 'scheduled'; idempotencyKey?: string }

export class ReportRunService {
  constructor(private readonly repo: ReportRunRepositoryPort) {}

  async generate(input: GenerateInput, requestedBy: string | null = null) {
    const reportKey = String(input.reportKey || '').trim();
    if (!reportKey) throw new ReportRunError('invalid', 'reportKey is required');
    const scope: RunScope = { scopeType: input.scopeType || (input.tenantId ? 'tenant' : 'platform'), tenantId: input.tenantId ?? null, branchId: input.branchId ?? null };
    const source = input.source || 'on_demand';
    // A caller (e.g. a schedule occurrence) may supply the idempotency key to guarantee one-run-per-occurrence;
    // otherwise it is derived from the report + scope + period + source.
    const idempotencyKey = String(input.idempotencyKey || '').trim() || buildRunIdempotencyKey({ reportKey, scopeType: scope.scopeType, tenantId: scope.tenantId, branchId: scope.branchId, start: input.start, end: input.end, source });

    // Idempotent short-circuit: identical request ⇒ return the original run, never a duplicate.
    const prior = await this.repo.getRunByIdem(idempotencyKey);
    if (prior) return { run: prior, idempotentReplay: true };

    const started = Date.now();
    const raw = await this.repo.snapshotMetrics(scope, input.start, input.end);
    const validated = validateMetricsSnapshot({
      start: input.start, end: input.end, hasData: raw.hasData,
      metrics: { revenueCents: raw.revenueCents, refundsCents: raw.refundsCents, bookings: raw.bookings, completed: raw.completed, cancelled: raw.cancelled, noShow: raw.noShow, newCustomers: raw.newCustomers, returningCustomers: raw.returningCustomers },
    });
    if (!validated.ok) throw new ReportRunError('invalid', validated.reason);

    const run = await this.repo.insertRun({
      reportReference: generateReportReference(reportKey, started), reportKey, scope, dateRangeStart: input.start, dateRangeEnd: input.end,
      generationSource: source, generationStatus: validated.status, metricsSnapshot: validated.metrics, durationMs: Math.max(1, Date.now() - started), idempotencyKey, requestedBy,
    });
    return { run, idempotentReplay: false };
  }

  async getRun(id: string) {
    const run = await this.repo.getRun(String(id || ''));
    if (!run) throw new ReportRunError('not_found', 'Report run not found');
    return run;
  }
}
