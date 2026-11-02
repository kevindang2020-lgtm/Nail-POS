// queue.controller.ts — tenant POS Queue HTTP surface (`/pos/queue/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal routes (state/kpis/items/
// wait-estimate) and the bare items collection are declared so the `:queueItemId` param never shadows them.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ACCEPT_ALTERNATE_BODY, NOTIFY_BODY, Q_ASSIGN_BODY, Q_ASSIGN_PLAN_BODY, Q_AUTO_BALANCE_BODY, Q_CALL_NEXT_BODY, Q_CANCEL_BODY, Q_CREATE_BODY, Q_GROUP_BODY, Q_LOCK_BODY, Q_PRIORITY_BODY, Q_REMOVE_BODY, Q_REORDER_BODY, Q_REQUESTED_TECH_BODY, Q_SERVICES_BODY, Q_SERVICE_ASSIGNMENTS_BODY, Q_UNASSIGN_BODY, Q_UNLOCK_BODY, Q_UPDATE_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { recordConflict } from '@aipowersalon/observability';
import { Controller, Get, Post, Patch, Put, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { QueueService, ForbiddenError, ValidationError, QueueAssignmentConflict, QueueAssignmentLocked, QueueRuleError } from './queue.service';
import type { QueueContext } from './queue.repository';
import type { QueueFilters } from './queue.dto';
import type { AssignPlanRequest, AssignPlanResult, MoveGroupToTechQueueResult } from '@aipowersalon/api-contracts/tenant';
import { ListQueries } from '@aipowersalon/database';
import { QueueControllerListQueries } from './queue.list-queries';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';

function ctxFrom(req: any): QueueContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): QueueFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { search: q.search, status: q.status, source: q.source, technicianId: q.technicianId, serviceCategory: q.serviceCategory, priority: q.priority, station: q.station, waitMin: n(q.waitMin), waitMax: n(q.waitMax), page: n(q.page), pageSize: n(q.pageSize) }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof QueueAssignmentConflict) { recordConflict('queue', e.code); throw new HttpException({ message: e.message, code: e.code, currentTechnicianId: e.currentTechnicianId, currentVersion: e.currentVersion, ...(e.queueItemId ? { queueItemId: e.queueItemId } : {}), ...(e.serviceId ? { serviceId: e.serviceId } : {}), serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }   // spec §77 (+ the guest / line of a plan)
    // BUILD_PLAN Phase 6: a manager's lock pins the guest — 409 with the lock, so the screen can say who pinned it and why
    if (e instanceof QueueAssignmentLocked) { recordConflict('queue', e.code); throw new HttpException({ message: e.message, code: e.code, lock: e.lock, serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }
    // Customer Queue mandate (Oct 28 2026) §52/§55: `apiCode` is where withCode() puts the code — most queue refusals carry it
    // there (CANNOT_START_SERVICE, QUEUE_ITEM_NOT_FOUND, …) and run() read only `code`, so they answered a bare English 400.
    // A registered code answers with its registry status (404 for a missing guest, 409 for a stale state), as in Serving.
    const coded = e as { apiCode?: string; apiParams?: Record<string, unknown> };
    const vcode = e instanceof ValidationError ? (e.code ?? coded.apiCode) : undefined;
    const vdetails = e instanceof ValidationError ? (e.params ?? coded.apiParams) : undefined;
    if (e instanceof ValidationError && vcode) throw new HttpException({ message: e.message, code: vcode, ...(vdetails ? { details: vdetails } : {}) }, isRegisteredCode(vcode) ? ERROR_REGISTRY[vcode as keyof typeof ERROR_REGISTRY].status : HttpStatus.BAD_REQUEST);
    // Fair Turn Engine: the turn queue's standard codes (§194) with their friendly sentence (§195)
    if ((e as any)?.name === 'TurnQueueError') throw new HttpException({ message: (e as any).message, code: (e as any).code }, (e as any).status ?? HttpStatus.BAD_REQUEST);
    if (e instanceof ValidationError || e instanceof QueueRuleError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(QueueControllerListQueries)
@Controller('pos/queue')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  @Get('state') @RequirePermission('pos.queue.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.queue.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('wait-estimate') @RequirePermission('pos.queue.view') waitEstimate(@Req() r: any) { return run(() => this.svc.waitEstimate(ctxFrom(r))); }
  // BUILD_PLAN Phase 6 — literal routes before the ':queueItemId' param ones
  @Get('technicians/availability') @RequirePermission('pos.queue.view') availability(@Req() r: any) { return run(() => this.svc.technicianAvailability(ctxFrom(r))); }
  @Post('reorder') @RequirePermission('pos.queue.update_priority') reorder(@Req() r: any, @Body(ValidatedBody(Q_REORDER_BODY, { strict: true })) b: any) { return run(() => this.svc.reorder(ctxFrom(r), b)); }
  @Get('groups') @RequirePermission('pos.queue.view') groups(@Req() r: any) { return run(() => this.svc.groups(ctxFrom(r))); }
  @Post('groups') @RequirePermission('pos.queue.edit') createGroup(@Req() r: any, @Body(ValidatedBody(Q_GROUP_BODY, { strict: true })) b: any) { return run(() => this.svc.createGroup(ctxFrom(r), b)); }
  // multi-technician routing: the ONE multi-line writer (split visit / party, all or none) and "Start party"
  @Post('plans/assign') @RequirePermission('pos.queue.assign_technician') assignPlan(@Req() r: any, @Body(ValidatedBody(Q_ASSIGN_PLAN_BODY, { strict: true })) b: AssignPlanRequest): Promise<AssignPlanResult> { return run(() => this.svc.assignPlan(ctxFrom(r), b)); }
  @Post('groups/:groupId/move-to-tech-queue') @RequirePermission('pos.queue.move_to_tech_queue') moveGroup(@Req() r: any, @Param('groupId') id: string): Promise<MoveGroupToTechQueueResult> { return run(() => this.svc.moveGroupToTechQueue(ctxFrom(r), id)); }
  @Get('items') @RequirePermission('pos.queue.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.items(ctxFrom(r), filtersFrom(q))); }
  @Post('items') @RequirePermission('pos.queue.create') create(@Req() r: any, @Body(ValidatedBody(Q_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(r), b)); }
  @Get('items/:queueItemId') @RequirePermission('pos.queue.view') detail(@Req() r: any, @Param('queueItemId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch('items/:queueItemId') @RequirePermission('pos.queue.edit') update(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post('items/:queueItemId/call-next') @RequirePermission('pos.queue.call_next') callNext(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_CALL_NEXT_BODY, { strict: true })) b: any) { return run(() => this.svc.callNext(ctxFrom(r), id, !!b?.notify)); }
  @Post('items/:queueItemId/assign-technician') @RequirePermission('pos.queue.assign_technician') assign(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_ASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.assignTechnician(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/unassign-technician') @RequirePermission('pos.queue.assign_technician') unassign(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_UNASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.unassignTechnician(ctxFrom(r), id, b)); }
  @Post('auto-balance/preview') @RequirePermission('pos.queue.assign_technician') abPreview(@Req() r: any) { return run(() => this.svc.previewAutoBalance(ctxFrom(r))); }
  @Post('auto-balance/apply') @RequirePermission('pos.queue.assign_technician') abApply(@Req() r: any, @Body(ValidatedBody(Q_AUTO_BALANCE_BODY, { strict: true })) b: any) { return run(() => this.svc.applyAutoBalance(ctxFrom(r), b)); }
  @Post('items/:queueItemId/change-requested-technician') @RequirePermission('pos.queue.assign_technician') changeRequestedTech(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_REQUESTED_TECH_BODY, { strict: true })) b: any) { return run(() => this.svc.changeRequestedTechnician(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/update-services') @RequirePermission('pos.queue.edit') updateServices(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_SERVICES_BODY, { strict: true })) b: any) { return run(() => this.svc.updateServices(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/update-priority') @RequirePermission('pos.queue.update_priority') updatePriority(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_PRIORITY_BODY, { strict: true })) b: any) { return run(() => this.svc.updatePriority(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/notify-customer') @RequirePermission('pos.queue.edit') notify(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(NOTIFY_BODY, { strict: true })) b: any) { return run(() => this.svc.notifyCustomer(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/move-to-tech-queue') @RequirePermission('pos.queue.move_to_tech_queue') moveTech(@Req() r: any, @Param('queueItemId') id: string) { return run(() => this.svc.moveToTechQueue(ctxFrom(r), id)); }
  @Post('items/:queueItemId/start-service') @RequirePermission('pos.queue.move_to_serving') startService(@Req() r: any, @Param('queueItemId') id: string) { return run(() => this.svc.moveToServing(ctxFrom(r), id)); }
  @Post('items/:queueItemId/move-to-serving') @RequirePermission('pos.queue.move_to_serving') moveServing(@Req() r: any, @Param('queueItemId') id: string) { return run(() => this.svc.moveToServing(ctxFrom(r), id)); }
  @Post('items/:queueItemId/cancel') @RequirePermission('pos.queue.cancel') cancel(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_CANCEL_BODY, { strict: true })) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b)); }
  @Get('items/:queueItemId/history') @RequirePermission('pos.queue.view') history(@Req() r: any, @Param('queueItemId') id: string) { return run(() => this.svc.history(ctxFrom(r), id)); }
  // lock / unlock additionally require ai_queue_assignment.override (checked in the service)
  @Post('items/:queueItemId/lock') @RequirePermission('pos.queue.assign_technician') lock(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_LOCK_BODY, { strict: true })) b: any) { return run(() => this.svc.lock(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/unlock') @RequirePermission('pos.queue.assign_technician') unlock(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_UNLOCK_BODY, { strict: true })) b: any) { return run(() => this.svc.unlock(ctxFrom(r), id, b)); }
  @Put('items/:queueItemId/service-assignments') @RequirePermission('pos.queue.assign_technician') serviceAssignments(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_SERVICE_ASSIGNMENTS_BODY, { strict: true })) b: any) { return run(() => this.svc.setServiceAssignments(ctxFrom(r), id, b)); }
  @Post('items/:queueItemId/remove') @RequirePermission('pos.queue.remove') remove(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(Q_REMOVE_BODY, { strict: true })) b: any) { return run(() => this.svc.remove(ctxFrom(r), id, b)); }
}

/** Customer-facing queue routes (the customer app; session = the signed-in customer). BUILD_PLAN Phase 6: when the
 *  technician the customer asked for is busy, they may accept another one — recorded in the history with source 'customer'. */
@Controller('customer/queue')
export class CustomerQueueController {
  constructor(private readonly svc: QueueService) {}
  @Get(':queueItemId/alternates') alternates(@Req() r: any, @Param('queueItemId') id: string) { return run(() => this.svc.customerAlternates(ctxFrom(r), id)); }
  @Post(':queueItemId/accept-alternate') acceptAlternate(@Req() r: any, @Param('queueItemId') id: string, @Body(ValidatedBody(ACCEPT_ALTERNATE_BODY, { strict: true })) b: any) { return run(() => this.svc.acceptAlternate(ctxFrom(r), id, b)); }
}
