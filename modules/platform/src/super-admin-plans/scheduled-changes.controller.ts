// scheduled-changes.controller.ts — platform-level rollover of due scheduled (end_of_cycle) plan changes. Permission-
// gated in the service and audited. Intended to be driven by a scheduler/cron; exposed as an endpoint for now.
import { Controller, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SubscriptionChangeService, ChangeForbiddenError, type ChangeActor } from './subscription-change.service';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/scheduled-changes')
export class ScheduledChangesController {
  constructor(private readonly svc: SubscriptionChangeService) {}

  @Post('process')
  async process(@Req() req: any) {
    const actor: ChangeActor = { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
    try { return await this.svc.processScheduled(actor); }
    catch (e: any) {
      if (e instanceof ChangeForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      throw new HttpException(e?.message || 'Process failed', HttpStatus.BAD_REQUEST);
    }
  }
}
