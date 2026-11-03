// ai-money-protection-investigations.service.ts — the human-review workflow. Enforces the spec's hard rules:
//  • permission-gated at every step;
//  • notes are append-only;
//  • status changes follow the allowed transition map;
//  • SENSITIVE resolutions (EMPLOYEE_MISUSE_CONFIRMED, ACCOUNT_COMPROMISE) require an elevated permission and are
//    only ever recorded by a human — no rule/AI can set them;
//  • SEGREGATION OF DUTIES: a user cannot resolve/close an investigation that involves their own activity.
import type { MoneyProtectionContext } from './ai-money-protection.dto';
import { assertTransition, InvalidStateTransitionError } from '@aipowersalon/database';
import { MONEY_PROTECTION_INVESTIGATION } from '../ai-lifecycles';
import type { MoneyProtectionRepositoryPort } from './ai-money-protection.repository';
import { MoneyProtectionForbiddenError, MoneyProtectionValidationError } from './ai-money-protection.service';
import type {
  MoneyProtectionInvestigationRepositoryPort, InvestigationFilters,
} from './ai-money-protection-investigations.repository';
import {
  type Investigation, type InvestigationNote, type InvestigationStatus, type ResolutionType,
  type CreateInvestigationInput, SENSITIVE_RESOLUTIONS, ALL_RESOLUTIONS, STATUS_TRANSITIONS,
} from './ai-money-protection-investigations.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
/** money_protection_investigations.severity CHECK (migration 324) */
export const INVESTIGATION_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type InvestigationEventSink = (ctx: MoneyProtectionContext, e: { investigationId: string; branchId?: string | null; action: string; from?: string | null; to?: string | null; detail?: Record<string, unknown> }) => Promise<void>;

export class InvestigationService {
  constructor(
    private readonly repo: MoneyProtectionInvestigationRepositoryPort,
    private readonly alerts: MoneyProtectionRepositoryPort,
    /** Money Protection guides (Nov 3 2026): every create / assign / status move / resolution is recorded (who, from → to) */
    private readonly events: InvestigationEventSink | null = null,
  ) {}
  private async log(ctx: MoneyProtectionContext, e: Parameters<InvestigationEventSink>[1]) { if (this.events) await this.events(ctx, e); }

  private need(ctx: MoneyProtectionContext, perm: string) {
    if (!ctx?.tenantId) throw new MoneyProtectionValidationError('Missing tenant context');
    if (!(ctx.permissions || []).includes(perm)) throw new MoneyProtectionForbiddenError();
  }

  async list(ctx: MoneyProtectionContext, f: InvestigationFilters): Promise<Investigation[]> {
    this.need(ctx, 'ai_money_protection.view');
    return this.repo.list(ctx, f);
  }

  async get(ctx: MoneyProtectionContext, id: string): Promise<{ investigation: Investigation; notes: InvestigationNote[] }> {
    this.need(ctx, 'ai_money_protection.view');
    const investigation = await this.repo.get(ctx, id);
    if (!investigation) throw new MoneyProtectionValidationError('INVESTIGATION_NOT_FOUND');
    return { investigation, notes: await this.repo.listNotes(ctx, id) };
  }

  async create(ctx: MoneyProtectionContext, input: CreateInvestigationInput): Promise<Investigation> {
    this.need(ctx, 'ai_money_protection.investigate');
    if (!input.title?.trim()) throw withCode(new MoneyProtectionValidationError('Title is required'), 'TITLE_REQUIRED');
    // §163 run 3 (Oct 27 2026): the severity is the table's CHECK vocabulary — an unknown one was a 500 (check violation)
    if (input.severity != null && !(INVESTIGATION_SEVERITIES as readonly string[]).includes(input.severity)) throw new MoneyProtectionValidationError(`Severity must be one of ${INVESTIGATION_SEVERITIES.join(', ')}.`);
    const alertIds = [...new Set(input.alertIds ?? [])];
    const linked = alertIds.length ? await this.alerts.getAlertsByIds(ctx, alertIds) : [];
    // snapshot value + related entities from the linked alerts (tenant-scoped by getAlertsByIds)
    const valueUnderReviewCents = linked.reduce((s, a) => s + (a.amountCents || 0), 0);
    const userIds = [...new Set(linked.flatMap((a) => a.related.userIds ?? []))];
    const ticketIds = [...new Set(linked.flatMap((a) => a.related.ticketIds ?? []))];
    const transactionIds = [...new Set(linked.flatMap((a) => a.related.transactionIds ?? []))];
    const severity = input.severity ?? (linked.some((a) => a.severity === 'CRITICAL') ? 'CRITICAL' : linked.some((a) => a.severity === 'HIGH') ? 'HIGH' : 'MEDIUM');
    const inv = await this.repo.create(ctx, {
      title: input.title.trim(), category: input.category ?? 'general', severity,
      branchId: input.branchId ?? linked[0]?.branchId ?? null,
      valueUnderReviewCents, related: { alertIds: linked.map((a) => a.id), userIds, ticketIds, transactionIds },
      createdByUserId: ctx.userId,
    });
    if (linked.length) await this.alerts.attachInvestigation(ctx, linked.map((a) => a.id), inv.id);
    await this.log(ctx, { investigationId: inv.id, branchId: inv.branchId ?? null, action: 'opened', to: inv.status, detail: { alerts: linked.length } });
    return inv;
  }

  async addNote(ctx: MoneyProtectionContext, investigationId: string, body: string): Promise<InvestigationNote> {
    this.need(ctx, 'ai_money_protection.investigate');
    if (!body?.trim()) throw withCode(new MoneyProtectionValidationError('Note body is required'), 'NOTE_REQUIRED');
    const inv = await this.repo.get(ctx, investigationId);
    if (!inv) throw new MoneyProtectionValidationError('INVESTIGATION_NOT_FOUND');
    return this.repo.addNote(ctx, investigationId, ctx.userId, body.trim());
  }

  async assign(ctx: MoneyProtectionContext, investigationId: string, assigneeUserId: string): Promise<Investigation> {
    this.need(ctx, 'ai_money_protection.investigate');
    const inv = await this.repo.get(ctx, investigationId);
    if (!inv) throw new MoneyProtectionValidationError('INVESTIGATION_NOT_FOUND');
    const out = (await this.repo.update(ctx, investigationId, { assignedUserId: assigneeUserId }))!;
    await this.log(ctx, { investigationId, branchId: inv.branchId ?? null, action: 'assigned', from: inv.assignedUserId ?? null, to: assigneeUserId });
    return out;
  }

  async updateStatus(ctx: MoneyProtectionContext, investigationId: string, to: InvestigationStatus): Promise<Investigation> {
    this.need(ctx, 'ai_money_protection.investigate');
    const inv = await this.repo.get(ctx, investigationId);
    if (!inv) throw new MoneyProtectionValidationError('INVESTIGATION_NOT_FOUND');
    if (to === 'ESCALATED') this.need(ctx, 'ai_money_protection.escalate');
    if (!STATUS_TRANSITIONS[inv.status]?.includes(to)) {
      throw withCode(new MoneyProtectionValidationError(`Invalid transition ${inv.status} → ${to}`), 'INVESTIGATION_STATE_INVALID');
    }
    if (to === 'CLOSED') this.assertNotOwnActivity(ctx, inv);
    const patch: any = { status: to, fromStatus: inv.status };
    if (to === 'CLOSED') patch.closedAt = new Date().toISOString();
    const out = await this.repo.update(ctx, investigationId, patch);
    if (!out) throw new InvalidStateTransitionError(MONEY_PROTECTION_INVESTIGATION, inv.status, to, 'concurrent');
    await this.log(ctx, { investigationId, branchId: inv.branchId ?? null, action: 'status_changed', from: inv.status, to });
    return out;
  }

  async recordResolution(
    ctx: MoneyProtectionContext, investigationId: string, resolution: ResolutionType, recoveryAmountCents = 0,
  ): Promise<Investigation> {
    this.need(ctx, 'ai_money_protection.resolve');
    if (!ALL_RESOLUTIONS.has(resolution)) throw new MoneyProtectionValidationError('Unknown resolution');
    const inv = await this.repo.get(ctx, investigationId);
    if (!inv) throw new MoneyProtectionValidationError('INVESTIGATION_NOT_FOUND');
    // Sensitive resolutions require an elevated permission and a human (this path is never called by a rule/AI).
    if (SENSITIVE_RESOLUTIONS.has(resolution)) this.need(ctx, 'ai_money_protection.escalate');
    // Segregation of duties: cannot resolve an investigation involving your own activity.
    this.assertNotOwnActivity(ctx, inv);
    if (recoveryAmountCents < 0) throw withCode(new MoneyProtectionValidationError('recoveryAmountCents must be >= 0'), 'RECOVERY_AMOUNT_INVALID');
    // Phase 12 (#27): resolving is a move on the machine — a RESOLVED investigation is not resolved again (its recovery
    // amount overwritten) and a CLOSED one is not revived; both answer 409 INVALID_STATE_TRANSITION
    assertTransition(MONEY_PROTECTION_INVESTIGATION, inv.status, 'RESOLVED');
    const out = await this.repo.update(ctx, investigationId, { status: 'RESOLVED', fromStatus: inv.status, resolution, recoveryAmountCents });
    if (!out) throw new InvalidStateTransitionError(MONEY_PROTECTION_INVESTIGATION, inv.status, 'RESOLVED', 'concurrent');
    await this.log(ctx, { investigationId, branchId: inv.branchId ?? null, action: 'resolved', from: inv.status, to: 'RESOLVED', detail: { resolution, recoveryAmountCents } });
    return out;
  }

  private assertNotOwnActivity(ctx: MoneyProtectionContext, inv: Investigation) {
    if ((inv.related.userIds ?? []).includes(ctx.userId)) {
      throw withCode(new MoneyProtectionValidationError('SEGREGATION_OF_DUTIES: cannot resolve/close an investigation involving your own activity'), 'SEGREGATION_OF_DUTIES');
    }
  }
}
