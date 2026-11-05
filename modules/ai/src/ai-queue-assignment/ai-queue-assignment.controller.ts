// ai-queue-assignment.controller.ts — tenant routes. Guards: TenantAuthGuard + RolePermissionGuard (tenant/branch/
// role from req.ctx), same pattern as queue.controller. Staff-facing recommend / decide / panel / rotation / auto.
// BUILD_PLAN Phase 6: an accepted or overridden decision ASSIGNS through the queue's own action (a stale guest → 409);
// rotation-policy is JSON (audit bug 7); auto-config / kill / unkill go through the one settings source.
import { branchOrNull } from '@aipowersalon/tenant-context';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AQ_AUTO_CONFIG_BODY, AQ_DECISION_BODY, AQ_KILL_BODY, AQ_PLAN_DECISION_BODY, AQ_ROTATION_POLICY_BODY , AQ_FAIR_TURN_SIMULATE_BODY } from '../request-schemas';
import { Controller, Get, Post, Put, Param, Query, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { QueueExplanationService } from './ai-queue-assignment-explanation.service';
import { QueueAssignmentForbiddenError, QueueAssignmentValidationError, QueueAssignmentDisabledError, QueueAssignmentStaleError, type QueueAssignmentContext } from './ai-queue-assignment.dto';
import { ListQueries } from '@aipowersalon/database';
import type { PlanRecommendationView, PlanDecisionRequest, PlanDecisionResponse, TurnSimulationResponse } from '@aipowersalon/api-contracts/tenant';
import { QueueAssignmentControllerListQueries } from './ai-queue-assignment.list-queries';

export function ctxFrom(req: any): QueueAssignmentContext {
  const c = req?.ctx || {};
  // The queue is a branch's queue. With no branch on the session every technician failed "wrong_branch" and the
  // inserts wrote '' into UUID columns (a 500); say what is missing instead (Oct 6 2026).
  const branchId = branchOrNull(c.branchId);
  if (!branchId) throw new HttpException('Choose a location first — the queue belongs to one location.', HttpStatus.BAD_REQUEST);
  return { tenantId: c.tenantId, branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof QueueAssignmentStaleError) throw new HttpException({ statusCode: 409, code: e.code, message: e.message, currentTechnicianId: e.currentTechnicianId, ...(e.queueItemId ? { queueItemId: e.queueItemId } : {}), ...(e.serviceId ? { serviceId: e.serviceId } : {}) }, HttpStatus.CONFLICT);
    if (e instanceof QueueAssignmentForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof QueueAssignmentDisabledError) throw new HttpException(e.message, HttpStatus.PAYMENT_REQUIRED);
    if (e instanceof QueueAssignmentValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@ListQueries(QueueAssignmentControllerListQueries)
@Controller('pos/ai-queue-assignment')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class QueueAssignmentController {
  // BUILD_PLAN Phase 6: the alert / threshold routes moved to the ops controller (Agent C) with the rewritten alerts service.
  constructor(private readonly svc: QueueAssignmentService, private readonly explanations: QueueExplanationService) {}

  @Get('recommendations/:id/explanation')
  @RequirePermission('ai_queue_assignment.view')
  explain(@Req() r: any, @Param('id') id: string) { return run(() => this.explanations.explain(ctxFrom(r), id)); }

  @Post('entries/:queueEntryId/recommend')
  @RequirePermission('ai_queue_assignment.recommend')
  recommend(@Req() r: any, @Param('queueEntryId') id: string) {
    return run(() => this.svc.recommend(ctxFrom(r), id));
  }

  @Get('entries/:queueEntryId/recommendation')
  @RequirePermission('ai_queue_assignment.view')
  latest(@Req() r: any, @Param('queueEntryId') id: string) {
    return run(() => this.svc.latestForEntry(ctxFrom(r), id));
  }

  @Get('recommendations/:id')
  @RequirePermission('ai_queue_assignment.view')
  get(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.getRecommendation(ctxFrom(r), id));
  }

  @Post('recommendations/:id/decision')
  @RequirePermission('ai_queue_assignment.assign')
  decide(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AQ_DECISION_BODY)) b: any) {
    return run(() => this.svc.decide(ctxFrom(r), id, {
      decision: b?.decision, chosenTechnicianId: b?.chosenTechnicianId ?? null, reason: b?.reason ?? null,
      feedbackCode: b?.feedbackCode ?? null, idempotencyKey: b?.idempotencyKey ?? r?.headers?.['idempotency-key'] ?? null,
      overrideReasonCode: b?.overrideReasonCode ?? null,   // Fair Turn §69
    }));
  }

  // ── Fair Turn Engine §168: simulate the turn rules on hypothetical technicians (no production state changes) ──
  @Post('fair-turn/simulate')
  @RequirePermission('turn_queue.read')
  simulate(@Req() r: any, @Body(ValidatedBody(AQ_FAIR_TURN_SIMULATE_BODY)) b: any): Promise<TurnSimulationResponse> { return run(() => this.svc.simulateFairTurn(ctxFrom(r), b ?? {})); }

  // ── multi-technician routing: visit / party plans and their decision (contract §5) ──
  @Post('entries/:queueEntryId/plan')
  @RequirePermission('ai_queue_assignment.recommend')
  planVisit(@Req() r: any, @Param('queueEntryId') id: string): Promise<PlanRecommendationView> { return run(() => this.svc.planVisit(ctxFrom(r), id)); }

  @Post('groups/:groupId/plan')
  @RequirePermission('ai_queue_assignment.recommend')
  planParty(@Req() r: any, @Param('groupId') id: string): Promise<PlanRecommendationView> { return run(() => this.svc.planParty(ctxFrom(r), id)); }

  @Post('plans/:recommendationId/decision')
  @RequirePermission('ai_queue_assignment.assign')
  decidePlan(@Req() r: any, @Param('recommendationId') id: string, @Body(ValidatedBody(AQ_PLAN_DECISION_BODY)) b: PlanDecisionRequest): Promise<PlanDecisionResponse> {
    return run(() => this.svc.decidePlan(ctxFrom(r), id, {
      decision: b?.decision, lines: Array.isArray(b?.lines) ? b.lines : undefined, reason: b?.reason ?? null,
      feedbackCode: b?.feedbackCode ?? null, idempotencyKey: b?.idempotencyKey ?? r?.headers?.['idempotency-key'] ?? null,
    }));
  }

  /** The per-customer panel: the guest as the engine sees it, the latest suggestion, decisions, the lock. */
  @Get('entries/:queueEntryId/panel')
  @RequirePermission('ai_queue_assignment.view')
  panel(@Req() r: any, @Param('queueEntryId') id: string) {
    return run(() => this.svc.panel(ctxFrom(r), id));
  }

  @Get('entries/:queueEntryId/decisions')
  @RequirePermission('ai_queue_assignment.view')
  decisions(@Req() r: any, @Param('queueEntryId') id: string) {
    return run(() => this.svc.listDecisions(ctxFrom(r), id));
  }

  @Get('decisions')
  @RequirePermission('ai_queue_assignment.view')
  decisionHistory(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return run(() => this.svc.decisionHistory(ctxFrom(r), { from, to, limit: limit ? Number(limit) : undefined }));
  }

  @Get('decisions/analytics')
  @RequirePermission('ai_queue_assignment.view')
  decisionAnalytics(@Req() r: any, @Query('from') from?: string, @Query('to') to?: string) {
    return run(() => this.svc.decisionAnalytics(ctxFrom(r), { from, to }));
  }

  @Get('rotation-policy')
  @RequirePermission('ai_queue_assignment.view')
  getPolicy(@Req() r: any) {
    return run(() => this.svc.getRotationPolicy(ctxFrom(r)));
  }

  @Put('rotation-policy')
  @RequirePermission('ai_queue_assignment.manage_rules')
  setPolicy(@Req() r: any, @Body(ValidatedBody(AQ_ROTATION_POLICY_BODY)) b: any) {
    return run(() => this.svc.setRotationPolicy(ctxFrom(r), { policy: b?.policy, fixedOrder: b?.fixedOrder, expectedVersion: b?.expectedVersion, reason: b?.reason ?? null }));
  }

  @Get('auto-config')
  @RequirePermission('ai_queue_assignment.view')
  getAutoConfig(@Req() r: any) { return run(() => this.svc.getAutoConfig(ctxFrom(r))); }

  @Put('auto-config')
  @RequirePermission('ai_queue_assignment.manage_auto')
  setAutoConfig(@Req() r: any, @Body(ValidatedBody(AQ_AUTO_CONFIG_BODY)) b: any) { return run(() => this.svc.setAutoConfig(ctxFrom(r), b || {})); }

  @Post('auto/run')
  @RequirePermission('ai_queue_assignment.manage_auto')
  runAuto(@Req() r: any) { return run(() => this.svc.runAutoAssignment(ctxFrom(r))); }

  @Post('auto/kill')
  @RequirePermission('ai_queue_assignment.manage_auto')
  killAuto(@Req() r: any, @Body(ValidatedBody(AQ_KILL_BODY)) b: any) { return run(() => this.svc.killAutoAssignment(ctxFrom(r), { scope: b?.scope, reason: b?.reason })); }

  @Post('auto/unkill')
  @RequirePermission('ai_queue_assignment.manage_auto')
  unkillAuto(@Req() r: any, @Body(ValidatedBody(AQ_KILL_BODY)) b: any) { return run(() => this.svc.unkillAutoAssignment(ctxFrom(r), { scope: b?.scope, reason: b?.reason })); }
}
