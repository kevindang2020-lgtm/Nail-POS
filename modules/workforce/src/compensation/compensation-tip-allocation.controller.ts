// compensation-tip-allocation.controller.ts — POST /pos/tickets/:id/tip-allocation (tips.adjust).
// Manual per-technician tip split for a ticket; Σ must equal the ticket tip; audited; a paid ticket's correction lands in
// the adjustments ledger (never the snapshot). Tenant/branch from the session. Thin: validate, authorise, call the service.
import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { TipAllocationService, TipAllocationError, type TipAllocationCtx } from './compensation-tip-allocation.service';
import { COMP_TIP_ALLOCATION_BODY } from '../request-schemas';
import type { TipAllocationRequest, TipAllocationResult, TicketTipAllocationView } from '@aipowersalon/api-contracts/tenant';

function ctxFrom(req: any): TipAllocationCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@Controller('pos/tickets')
export class TipAllocationController {
  constructor(private readonly svc: TipAllocationService) {}

  /** The current split + the technicians who worked the ticket (the POS re-split editor). */
  @RequirePermission('tips.adjust') @Get(':id/tip-allocation')
  async current(@Req() req: any, @Param('id') id: string): Promise<TicketTipAllocationView> {
    try { return await this.svc.current(ctxFrom(req), id); }
    catch (e: any) { if (e instanceof TipAllocationError) throw new HttpException({ ok: false, message: e.message }, e.status || HttpStatus.BAD_REQUEST); throw e; }
  }

  @RequirePermission('tips.adjust') @Post(':id/tip-allocation')
  async allocate(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(COMP_TIP_ALLOCATION_BODY, { strict: true })) body: TipAllocationRequest): Promise<TipAllocationResult> {
    try { return await this.svc.allocate(ctxFrom(req), id, { allocations: body?.allocations, reason: body?.reason ?? undefined }); }
    catch (e: any) {
      if (e instanceof TipAllocationError) throw new HttpException({ ok: false, ...(e.code ? { code: e.code } : {}), message: e.message }, e.status || HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
}
