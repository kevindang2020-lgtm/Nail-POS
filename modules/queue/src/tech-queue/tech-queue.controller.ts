// tech-queue.controller.ts — tenant POS Tech Queue HTTP surface (`/pos/tech-queue/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx. Literal routes (state/kpis/
// technician-lanes/tickets) are declared before the bare `:techQueueTicketId`.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CLEAR_DELAY_BODY, DELAY_BODY, NOTIFY_BODY, OVERRIDE_BODY, TQ_ACCEPT_BODY, TQ_CANCEL_BODY, TQ_DECLINE_BODY, TQ_PRIORITY_BODY, TQ_REASSIGN_BODY, TQ_SERVICES_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TechQueueService, ForbiddenError, ValidationError } from './tech-queue.service';
import type { TechQueueContext } from './tech-queue.repository';
import type { TechQueueFilters } from './tech-queue.dto';
import { ListQueries } from '@aipowersalon/database';
import { TechQueueControllerListQueries } from './tech-queue.list-queries';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // V-5 (Oct 27 2026)

function ctxFrom(req: any): TechQueueContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): TechQueueFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { search: q.search, status: q.status, source: q.source, technicianId: q.technicianId, serviceCategory: q.serviceCategory, priority: q.priority, station: q.station, delayStatus: q.delayStatus, page: n(q.page), pageSize: n(q.pageSize),
  // 200-technician §2: the lane page (search / status group), and roster=none (no filters.technicians name list)
  lanePage: n(q.lanePage), lanePageSize: n(q.lanePageSize), laneSearch: q.laneSearch || undefined, laneStatus: q.laneStatus || undefined, roster: q.roster === 'none' ? 'none' : undefined }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError && e.code && isRegisteredCode(e.code)) throw new HttpException({ message: e.message, code: e.code, ...(e.params ? { details: e.params } : {}) }, ERROR_REGISTRY[e.code].status);   // V-5: the code the POS words in the cashier's language
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TechQueueControllerListQueries)
@Controller('pos/tech-queue')
export class TechQueueController {
  constructor(private readonly svc: TechQueueService) {}

  @Get('state') @RequirePermission('pos.tech_queue.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.tech_queue.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('technician-lanes') @RequirePermission('pos.tech_queue.view') lanes(@Req() r: any) { return run(() => this.svc.lanes(ctxFrom(r))); }
  @Get('tickets') @RequirePermission('pos.tech_queue.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.tickets(ctxFrom(r), filtersFrom(q))); }
  @Get('tickets/:techQueueTicketId') @RequirePermission('pos.tech_queue.view') detail(@Req() r: any, @Param('techQueueTicketId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }

  @Post('tickets/:techQueueTicketId/accept') @RequirePermission('pos.tech_queue.accept') accept(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(TQ_ACCEPT_BODY, { strict: true })) b: any) { return run(() => this.svc.accept(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/decline') @RequirePermission('pos.tech_queue.decline') decline(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(TQ_DECLINE_BODY, { strict: true })) b: any) { return run(() => this.svc.decline(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/reassign-technician') @RequirePermission('pos.tech_queue.reassign') reassign(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(TQ_REASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.reassign(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/update-services') @RequirePermission('pos.tech_queue.update_services') updateServices(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(TQ_SERVICES_BODY, { strict: true })) b: any) { return run(() => this.svc.updateServices(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/update-priority') @RequirePermission('pos.tech_queue.update_priority') updatePriority(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(TQ_PRIORITY_BODY, { strict: true })) b: any) { return run(() => this.svc.updatePriority(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/notify-technician') @RequirePermission('pos.tech_queue.notify_technician') notifyTech(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(NOTIFY_BODY, { strict: true })) b: any) { return run(() => this.svc.notifyTechnician(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/notify-customer') @RequirePermission('pos.tech_queue.notify_customer') notifyCust(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(NOTIFY_BODY, { strict: true })) b: any) { return run(() => this.svc.notifyCustomer(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/report-delay') @RequirePermission('pos.tech_queue.report_delay') reportDelay(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(DELAY_BODY, { strict: true })) b: any) { return run(() => this.svc.reportDelay(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/clear-delay') @RequirePermission('pos.tech_queue.report_delay') clearDelay(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(CLEAR_DELAY_BODY, { strict: true })) b: any) { return run(() => this.svc.clearDelay(ctxFrom(r), id, b)); }
  @Post('tickets/:techQueueTicketId/start-service') @RequirePermission('pos.tech_queue.move_to_serving') startService(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(OVERRIDE_BODY, { strict: true })) b: any) { return run(() => this.svc.startService(ctxFrom(r), id, !!b?.managerOverride)); }
  @Post('tickets/:techQueueTicketId/move-to-serving') @RequirePermission('pos.tech_queue.move_to_serving') moveServing(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(OVERRIDE_BODY, { strict: true })) b: any) { return run(() => this.svc.moveToServing(ctxFrom(r), id, !!b?.managerOverride)); }
  @Post('tickets/:techQueueTicketId/cancel') @RequirePermission('pos.tech_queue.reassign') cancel(@Req() r: any, @Param('techQueueTicketId') id: string, @Body(ValidatedBody(TQ_CANCEL_BODY, { strict: true })) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b)); }
}
