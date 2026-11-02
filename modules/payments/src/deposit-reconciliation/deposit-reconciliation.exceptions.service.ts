// deposit-reconciliation.exceptions.service.ts — the exception workflow. Cases are created from reconciliation
// signals and moved through human review. RESOLUTION is a deliberate human step: it requires a note (evidence)
// and stamps the approving user + time. Nothing auto-resolves; the AI has no path to close a case here.
import {
  buildExceptionsState, validateCreateException, canTransition, suggestSeverity, EXCEPTION_SEVERITIES,
  type ExceptionsState, type ReconException, type ExceptionSeverity, type ExceptionStatus,
} from './deposit-reconciliation.exceptions';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { ExceptionsRepositoryPort, CreateExceptionInput } from './deposit-reconciliation.exceptions.repository';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ExceptionWorkflowService {
  constructor(private readonly repo: ExceptionsRepositoryPort) {}
  private auth(ctx: ReconContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated'); }

  async getState(ctx: ReconContext, status?: string): Promise<ExceptionsState> {
    this.auth(ctx); return buildExceptionsState(await this.repo.list(ctx, status));
  }

  async create(ctx: ReconContext, input: Partial<CreateExceptionInput>): Promise<ReconException> {
    this.auth(ctx);
    const v = validateCreateException(input);
    if (!v.ok) throw new ReconValidationError(v.error || 'Invalid exception');
    const amountCents = Math.round(Number(input.amountCents ?? 0));
    const severity: ExceptionSeverity = (input.severity && EXCEPTION_SEVERITIES.includes(input.severity)) ? input.severity : suggestSeverity(input.kind!, amountCents);
    return this.repo.create(ctx, { kind: input.kind!, severity, title: String(input.title).trim(), detail: input.detail ?? null, amountCents, currency: input.currency || 'USD', sourceRef: input.sourceRef ?? null, branchId: input.branchId ?? null });
  }

  async assign(ctx: ReconContext, id: string, assigneeUserId: string | null): Promise<ReconException> {
    this.auth(ctx);
    if (assigneeUserId != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(assigneeUserId))) {
      throw new ReconValidationError('Assignee must be a valid user id');
    }
    const cur = await this.repo.find(ctx, id); if (!cur) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    // assigning an open case moves it into review
    const status: ExceptionStatus | undefined = cur.status === 'open' ? 'in_review' : undefined;
    const updated = await this.repo.update(ctx, id, { assignedToUserId: assigneeUserId, status });
    if (!updated) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    return updated;
  }

  async transition(ctx: ReconContext, id: string, to: ExceptionStatus): Promise<ReconException> {
    this.auth(ctx);
    if (to === 'resolved') throw withCode(new ReconValidationError('Use the resolve action to close a case (a note is required)'), 'RESOLUTION_NOTE_REQUIRED');
    const cur = await this.repo.find(ctx, id); if (!cur) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    if (!canTransition(cur.status, to)) throw withCode(new ReconValidationError(`Cannot move a ${cur.status} case to ${to}`), 'RECON_CASE_STATE_INVALID');
    const updated = await this.repo.update(ctx, id, { status: to });
    if (!updated) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    return updated;
  }

  // Human approval step: resolve requires evidence (a note) and records who approved it and when.
  async resolve(ctx: ReconContext, id: string, note: string): Promise<ReconException> {
    this.auth(ctx);
    if (!note || !String(note).trim()) throw withCode(new ReconValidationError('A resolution note (evidence) is required to close a case'), 'RESOLUTION_NOTE_REQUIRED');
    const cur = await this.repo.find(ctx, id); if (!cur) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    if (!canTransition(cur.status, 'resolved')) throw withCode(new ReconValidationError(`A ${cur.status} case cannot be resolved`), 'RECON_CASE_STATE_INVALID');
    const updated = await this.repo.update(ctx, id, { status: 'resolved', resolutionNote: String(note).trim(), resolvedByUserId: ctx.userId, resolvedAt: new Date().toISOString() });
    if (!updated) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    return updated;
  }

  async reopen(ctx: ReconContext, id: string): Promise<ReconException> {
    this.auth(ctx);
    const cur = await this.repo.find(ctx, id); if (!cur) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    if (!canTransition(cur.status, 'reopened')) throw withCode(new ReconValidationError('Only a resolved case can be reopened'), 'RECON_CASE_STATE_INVALID');
    const updated = await this.repo.update(ctx, id, { status: 'reopened', resolvedByUserId: null, resolvedAt: null });
    if (!updated) throw withCode(new ReconValidationError('Exception not found'), 'RECON_CASE_NOT_FOUND');
    return updated;
  }
}
