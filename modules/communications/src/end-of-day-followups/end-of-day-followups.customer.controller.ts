/**
 * end-of-day-followups.customer.controller.ts — Customer surface (/customer/follow-ups/*). Reads req.ctx (global guard
 * populates tenant/user); the customer record id is resolved server-side from the session inside the service, and a
 * customer only ever sees follow-ups that were actually sent to them. Supports both specs' verbs: 'respond' is an
 * alias of 'reply'.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { FollowUpError, type FollowUpContext } from './end-of-day-followups.dto';
import { FOLLOWUP_CUSTOMER_REPLY_BODY } from '../request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

function ctxFrom(req: any): FollowUpContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof FollowUpError) {
      if (e.code === 'forbidden' || e.code === 'not_technician') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('customer/follow-ups')
export class FollowUpCustomerController {
  constructor(private readonly svc: DailyFollowUpService) {}

  @Get('')
  list(@Req() r: any) { return run(() => this.svc.customerList(ctxFrom(r))); }

  @Get(':id')
  get(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.customerGet(ctxFrom(r), id)); }

  @Post(':id/reply')
  reply(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_CUSTOMER_REPLY_BODY)) b: any) { return run(() => this.svc.customerReply(ctxFrom(r), id, b?.text ?? b?.message ?? '')); }

  @Post(':id/respond')
  respond(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(FOLLOWUP_CUSTOMER_REPLY_BODY)) b: any) { return run(() => this.svc.customerReply(ctxFrom(r), id, b?.text ?? b?.message ?? '')); }

  @Post(':id/rebook')
  rebook(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.customerRebook(ctxFrom(r), id)); }
}
