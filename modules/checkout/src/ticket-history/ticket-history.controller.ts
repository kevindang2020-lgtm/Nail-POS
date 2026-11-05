// ticket-history.controller.ts — GET /pos/tickets/:ticketId/history. Permanent, read-only ticket history for any status.
// Reuses pos.serving.view (whoever can view serving can view a ticket's history). Tenant/branch come from the session.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, HttpStatus, Param, Req, UseGuards } from '@nestjs/common';
import { TicketHistoryService, TicketHistoryError, type TicketHistoryCtx } from './ticket-history.service';

function ctxFrom(req: any): TicketHistoryCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/tickets')
export class TicketHistoryController {
  constructor(private readonly svc: TicketHistoryService) {}

  @Get(':ticketId/history') @RequirePermission('pos.serving.view')
  async history(@Req() req: any, @Param('ticketId') id: string) {
    try {
      return { ok: true, ...(await this.svc.getHistory(ctxFrom(req), id)) };
    } catch (e: any) {
      if (e instanceof TicketHistoryError) throw new HttpException({ ok: false, message: e.message }, HttpStatus.NOT_FOUND);
      throw e;
    }
  }
}
