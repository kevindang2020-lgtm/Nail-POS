/**
 * ai-center.controller.ts — tenant POS AI Center aggregate (`/tenant/ai/center/*`).
 * Behind TenantAuthGuard (POS roles only). CROSS-TENANT-SAFE: scope is taken from req.ctx (session), never the client.
 */
import { Controller, Get, Post, Patch, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { COPILOT_ACTION_BODY, COPILOT_AVAILABILITY_BODY, COPILOT_HOLD_BODY, COPILOT_HOLD_RELEASE_BODY, COPILOT_CONFLICT_BODY, COPILOT_CONTEXT_BODY, COPILOT_DRAFT_MESSAGE_BODY, COPILOT_EXPLAIN_SERVICE_BODY, COPILOT_FEEDBACK_BODY, COPILOT_INTENT_BODY, COPILOT_LEARNING_APPROVE_BODY, COPILOT_LEARNING_DISMISS_BODY, COPILOT_NEXT_ACTIONS_BODY, COPILOT_PROMPT_BODY, COPILOT_RECOMMENDATION_BODY, COPILOT_SESSION_END_BODY, COPILOT_SESSION_START_BODY, COPILOT_SETTINGS_BODY, COPILOT_TAKE_OVER_BODY, COPILOT_TECHNICIANS_BODY } from '../request-schemas';
import { AiCenterService, type AiCenterCtx } from './ai-center.service';
import { AiAssistantService } from '../ai/ai-assistant.service';
import { ReceptionCopilotContextService, COPILOT_HOLD_PERMISSION } from './reception-copilot-context.service';
import { hasPermission } from '@aipowersalon/permissions';
import type { CopilotHoldRequest, CopilotHoldResult, CopilotHoldReleaseRequest, CopilotHoldReleaseResult } from '@aipowersalon/api-contracts/tenant';
import { ReceptionCopilotAssistService } from './reception-copilot-assist.service';
import { ReceptionCopilotSessionService } from './reception-copilot-session.service';
import { ReceptionCopilotFeedbackService, CopilotFeedbackError } from './reception-copilot-feedback.service';
import { ReceptionCopilotLearningService, CopilotLearningError } from './reception-copilot-learning.service';
import { ReceptionCopilotTakeoverService } from './reception-copilot-takeover.service';
import { ReceptionCopilotActionService, type CopilotAction } from './reception-copilot-action.service';
import { CopilotSettingsService } from './copilot-settings.service';

function ctxFrom(req: any): AiCenterCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard)
@Controller('tenant/ai/center')
export class AiCenterController {
  constructor(private readonly svc: AiCenterService, private readonly assistant: AiAssistantService, private readonly copilotContext: ReceptionCopilotContextService, private readonly copilotAction: ReceptionCopilotActionService, private readonly copilotSettings: CopilotSettingsService, private readonly copilotAssist: ReceptionCopilotAssistService, private readonly copilotSession: ReceptionCopilotSessionService, private readonly copilotFeedback: ReceptionCopilotFeedbackService, private readonly copilotLearning: ReceptionCopilotLearningService, private readonly copilotTakeover: ReceptionCopilotTakeoverService) {}

  private learnErr(e: any): never {
    if (e instanceof CopilotLearningError) throw new HttpException({ code: e.code, message: e.message }, e.code === 'PERMISSION_DENIED' ? HttpStatus.FORBIDDEN : e.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
    throw e;
  }
  @RequirePermission('ai.use') @Get('overview') overview(@Req() r: any) { return this.svc.overview(ctxFrom(r)); }

  /**
   * Reception Copilot read-only context (spec §8–10): resolves a caller (by phone) or open customer (by id) into a
   * safe, tenant-scoped summary by delegating to the existing CustomersService. Server-derived scope; caller ID is a
   * hint, so the result carries an explicit match state and the receptionist confirms. No mutation, no fabrication.
   */
  @RequirePermission('reception_copilot.view_customer_context') @Post('copilot/context') copilotCtx(@Req() r: any, @Body(ValidatedBody(COPILOT_CONTEXT_BODY)) b: any) {
    const ctx = ctxFrom(r);
    return this.copilotContext.customerContext(ctx as any, { phone: b?.phone, customerId: b?.customerId });
  }

  /** Reception Copilot live queue summary (spec §19) — read-only, delegates to QueueService, wait times are estimates. */
  @RequirePermission('ai.use') @Get('copilot/queue') copilotQueue(@Req() r: any) { return this.copilotContext.queueSummary(ctxFrom(r) as any); }

  /** Possible duplicate customers (spec §16/§22) — read-only, review-only; never merges. */
  @RequirePermission('ai.use') @Get('copilot/duplicates') copilotDuplicates(@Req() r: any) { return this.copilotContext.duplicateCandidates(ctxFrom(r) as any); }

  /** Availability recommendations (spec §14) — delegates to the real schedule-aware availability engine. Reading is a read;
   *  `hold: true` (Round 2 H) also holds the best option for the caller, which is a WRITE: it needs the booking-desk key
   *  (pos.booking.create) on top of the read key — refused with 403 otherwise, never silently ignored. */
  @RequirePermission('reception_copilot.view_recommendations') @Post('copilot/availability') copilotAvailability(@Req() r: any, @Body(ValidatedBody(COPILOT_AVAILABILITY_BODY)) b: any) {
    const ctx = ctxFrom(r);
    if (b?.hold === true && !hasPermission(ctx as any, COPILOT_HOLD_PERMISSION)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Holding a time needs ' + COPILOT_HOLD_PERMISSION }, HttpStatus.FORBIDDEN);
    return this.copilotContext.recommendAvailability(ctx as any, { date: b?.date, serviceIds: b?.serviceIds, technicianId: b?.technicianId, hold: b?.hold === true ? {} : null });
  }

  /** Round 2 H: "Hold this time" on a recommended slot — reserves that exact slot for the salon's hold time so nobody else
   *  is offered it while the receptionist confirms. A WRITE: the booking-desk key, pos.booking.create (decision: no new key). */
  @RequirePermission('pos.booking.create') @Post('copilot/hold') copilotHold(@Req() r: any, @Body(ValidatedBody(COPILOT_HOLD_BODY)) b: CopilotHoldRequest): Promise<CopilotHoldResult> {
    return this.copilotContext.holdSlot(ctxFrom(r) as any, { date: b?.date, startTime: b?.startTime, serviceIds: b?.serviceIds ?? [], technicianId: b?.technicianId ?? null, customerId: b?.customerId ?? null, holdToken: b?.holdToken ?? null });
  }
  /** Round 2 H: give a held time back (only the desk session that holds it). */
  @RequirePermission('pos.booking.create') @Post('copilot/hold/release') copilotHoldRelease(@Req() r: any, @Body(ValidatedBody(COPILOT_HOLD_RELEASE_BODY)) b: CopilotHoldReleaseRequest): Promise<CopilotHoldReleaseResult> {
    return this.copilotContext.releaseHold(ctxFrom(r) as any, { holdToken: String(b?.holdToken ?? '') });
  }

  /** Appointment conflict detection (spec §16) — read-only, delegates to the buffer-aware conflict checker. */
  @RequirePermission('reception_copilot.view_recommendations') @Post('copilot/conflict') copilotConflict(@Req() r: any, @Body(ValidatedBody(COPILOT_CONFLICT_BODY)) b: any) {
    return this.copilotContext.detectConflict(ctxFrom(r) as any, { technicianId: b?.technicianId, startTime: b?.startTime, endTime: b?.endTime, date: b?.date, appointmentId: b?.appointmentId });
  }

  /** Technician recommendations (spec §15) — read-only, ranks qualified techs by earliest availability. */
  @RequirePermission('reception_copilot.view_recommendations') @Post('copilot/technicians') copilotTechnicians(@Req() r: any, @Body(ValidatedBody(COPILOT_TECHNICIANS_BODY)) b: any) {
    return this.copilotContext.recommendTechnicians(ctxFrom(r) as any, { serviceIds: b?.serviceIds, date: b?.date, preferredTechnicianName: b?.preferredTechnicianName });
  }

  /** Draft a text message (spec §20) — read-only, deterministic templates enriched with the customer's real appointment. */
  @RequirePermission('reception_copilot.draft_messages') @Post('copilot/draft-message') copilotDraft(@Req() r: any, @Body(ValidatedBody(COPILOT_DRAFT_MESSAGE_BODY)) b: any) {
    return this.copilotContext.draftMessage(ctxFrom(r) as any, { kind: b?.kind, customerId: b?.customerId, phone: b?.phone });
  }

  /** Intent detection (spec §11) — deterministic routing of a free-text query to the right Copilot capability. */
  @RequirePermission('reception_copilot.use') @Post('copilot/intent') copilotIntent(@Req() r: any, @Body(ValidatedBody(COPILOT_INTENT_BODY)) b: any) { return this.copilotContext.detectIntent(ctxFrom(r) as any, { text: b?.text ?? '' }); }

  // Gap closers (spec §1): AI-phone activity display + takeover surface, service/policy explanation, waitlist, next actions.
  @RequirePermission('ai.use') @Get('copilot/ai-phone-activity') copilotAiPhone(@Req() r: any) { return this.copilotAssist.recentAiPhoneActivity(ctxFrom(r) as any, { limit: 10 }); }
  @RequirePermission('reception_copilot.explain_services') @Post('copilot/explain-service') copilotExplainService(@Req() r: any, @Body(ValidatedBody(COPILOT_EXPLAIN_SERVICE_BODY)) b: any) { return this.copilotAssist.explainService(ctxFrom(r) as any, { serviceId: b?.serviceId }); }
  @RequirePermission('ai.use') @Get('copilot/waitlist') copilotWaitlist(@Req() r: any) { return this.copilotAssist.recommendWaitlist(ctxFrom(r) as any); }
  @RequirePermission('reception_copilot.view_recommendations') @Post('copilot/next-actions') copilotNextActions(@Req() r: any, @Body(ValidatedBody(COPILOT_NEXT_ACTIONS_BODY)) b: any) { return this.copilotAssist.recommendNextActions({ intent: b?.intent, hasAvailability: b?.hasAvailability, duplicateFound: b?.duplicateFound, customerKnown: b?.customerKnown }); }

  // §37 session + recommendation persistence.
  @RequirePermission('reception_copilot.use') @Post('copilot/session/start') copilotSessionStart(@Req() r: any, @Body(ValidatedBody(COPILOT_SESSION_START_BODY)) b: any) { return this.copilotSession.startSession(ctxFrom(r) as any, { channel: b?.channel }); }
  @RequirePermission('reception_copilot.use') @Post('copilot/session/end') copilotSessionEnd(@Req() r: any, @Body(ValidatedBody(COPILOT_SESSION_END_BODY)) b: any) { return this.copilotSession.endSession(ctxFrom(r) as any, String(b?.sessionId || '')); }
  @RequirePermission('reception_copilot.use') @Post('copilot/recommendation') copilotRecordReco(@Req() r: any, @Body(ValidatedBody(COPILOT_RECOMMENDATION_BODY)) b: any) { return this.copilotSession.recordRecommendation(ctxFrom(r) as any, { sessionId: b?.sessionId, kind: b?.kind, payload: b?.payload }); }
  @RequirePermission('ai.use') @Get('copilot/recommendations') copilotListReco(@Req() r: any) { return this.copilotSession.listRecommendations(ctxFrom(r) as any, {}); }

  // §44 feedback.
  @RequirePermission('reception_copilot.give_feedback') @Post('copilot/feedback') async copilotFeedbackRecord(@Req() r: any, @Body(ValidatedBody(COPILOT_FEEDBACK_BODY)) b: any) {
    try { return await this.copilotFeedback.recordFeedback(ctxFrom(r) as any, { recommendationId: b?.recommendationId, sessionId: b?.sessionId, rating: b?.rating, reason: b?.reason }); }
    catch (e) { if (e instanceof CopilotFeedbackError) throw new HttpException({ code: e.code, message: e.message }, e.code === 'PERMISSION_DENIED' ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST); throw e; }
  }
  @RequirePermission('reception_copilot.view_usage') @Get('copilot/feedback/summary') async copilotFeedbackSummary(@Req() r: any) {
    try { return await this.copilotFeedback.summary(ctxFrom(r) as any, {}); }
    catch (e) { if (e instanceof CopilotFeedbackError) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.FORBIDDEN); throw e; }
  }

  // §36 learning loop + knowledge versioning.
  @RequirePermission('reception_copilot.view_learning') @Post('copilot/learning/generate') async copilotLearnGenerate(@Req() r: any) { try { return await this.copilotLearning.generateSuggestions(ctxFrom(r) as any, {}); } catch (e) { this.learnErr(e); } }
  @RequirePermission('reception_copilot.view_learning') @Get('copilot/learning/suggestions') async copilotLearnList(@Req() r: any) { try { return await this.copilotLearning.listSuggestions(ctxFrom(r) as any, {}); } catch (e) { this.learnErr(e); } }
  @RequirePermission('reception_copilot.approve_learning') @Post('copilot/learning/approve') async copilotLearnApprove(@Req() r: any, @Body(ValidatedBody(COPILOT_LEARNING_APPROVE_BODY)) b: any) { try { return await this.copilotLearning.approveSuggestion(ctxFrom(r) as any, String(b?.suggestionId || ''), b?.content); } catch (e) { this.learnErr(e); } }
  @RequirePermission('reception_copilot.approve_learning') @Post('copilot/learning/dismiss') async copilotLearnDismiss(@Req() r: any, @Body(ValidatedBody(COPILOT_LEARNING_DISMISS_BODY)) b: any) { try { return await this.copilotLearning.dismissSuggestion(ctxFrom(r) as any, String(b?.suggestionId || '')); } catch (e) { this.learnErr(e); } }
  @RequirePermission('reception_copilot.view_learning') @Get('copilot/learning/knowledge') async copilotLearnKnowledge(@Req() r: any) { try { return await this.copilotLearning.listKnowledgeVersions(ctxFrom(r) as any); } catch (e) { this.learnErr(e); } }

  // §24 human takeover of a live AI call. Advisory→action: permission + active/owned + provider all checked server-side.
  @RequirePermission('reception_copilot.take_over_calls') @Post('copilot/take-over-call') copilotTakeOver(@Req() r: any, @Body(ValidatedBody(COPILOT_TAKE_OVER_BODY)) b: any) {
    return this.copilotTakeover.takeOverCall(ctxFrom(r) as any, { providerCallId: b?.providerCallId, destination: b?.destination, destinationType: b?.destinationType });
  }

  /** Reception Copilot settings (spec §47) — effective per-tenant toggles that gate the action spine. */
  @RequirePermission('ai.use') @Get('copilot/settings') copilotGetSettings(@Req() r: any) { return this.copilotSettings.get(ctxFrom(r) as any); }
  @RequirePermission('ai.manage') @Patch('copilot/settings') copilotPatchSettings(@Req() r: any, @Body(ValidatedBody(COPILOT_SETTINGS_BODY)) b: any) { return this.copilotSettings.patch(ctxFrom(r) as any, b || {}, b?.level === 'branch' ? 'branch' : 'tenant'); }

  /**
   * Reception Copilot action spine (spec §25–29). Advisory by default: without confirm===true it returns
   * HUMAN_CONFIRMATION_REQUIRED and writes nothing. With confirmation it routes through the authorized domain service
   * (server-derived scope, permission + ownership enforced there) and audits. First action: cancel_appointment.
   */
  @RequirePermission('reception_copilot.use') @Post('copilot/action') copilotDoAction(@Req() r: any, @Body(ValidatedBody(COPILOT_ACTION_BODY)) b: any) {
    return this.copilotAction.execute(ctxFrom(r) as any, b as CopilotAction);
  }

  /**
   * Reception Copilot — a staff-facing chat surface over the EXISTING AiAssistantService (package
   * 'ai_reception_copilot'). Scope is server-derived from req.ctx (never the client), so the copilot only ever sees
   * the caller's tenant. Delegates all gating/gateway/billing to the assistant service; adds a `degraded` flag so the
   * UI can honestly say when no real AI provider is configured (mock fallback) instead of passing off a sample as real.
   */
  @RequirePermission('reception_copilot.use') @Post('copilot') async copilot(@Req() r: any, @Body(ValidatedBody(COPILOT_PROMPT_BODY)) b: any) {
    const ctx = ctxFrom(r);
    const res = await this.assistant.run({ tenantId: ctx.tenantId, userId: ctx.userId ?? null, packageCode: 'ai_reception_copilot', action: b?.action, prompt: String(b?.prompt ?? '') });
    return {
      ok: res.ok,
      text: res.text ?? null,
      degraded: res.usage?.provider === 'mock',   // no real AI provider configured → sample response, not real AI
      decision: res.decision,
      remainingUsage: res.remainingUsage ?? null,
      label: res.decision?.label ?? null,
    };
  }
}
