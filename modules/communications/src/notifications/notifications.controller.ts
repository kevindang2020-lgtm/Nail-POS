// notifications.controller.ts — tenant-facing send + recent log. Tenant comes from the session (req.ctx), never the body.
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { NotificationsService, ForbiddenError, ValidationError, type NotificationsContext } from './notifications.service';
import type { SendNotificationRequest } from './notifications.dto';
import { ListQueries } from '@aipowersalon/database';
import { NotificationsControllerListQueries } from './notifications.list-queries';
import { NOTIFICATION_OPT_BODY, NOTIFICATION_SEND_BODY } from '../request-schemas';

function ctxFrom(req: any): NotificationsContext {
  return { tenantId: req?.ctx?.tenantId, userId: req?.ctx?.userId, role: req?.ctx?.role, branchId: req?.ctx?.branchId, salonName: req?.ctx?.salonName };
}

// The service throws its own ForbiddenError / ValidationError; unmapped, the exception filter treated them as unknown and
// answered 500 "Something went wrong" (e.g. an empty send body) instead of 400 with the reason. Mapped as in communications.controller.
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}
@UseGuards(TenantAuthGuard)
// Constitution 5 Step 8 audit (Oct 4 2026): only CUSTOMER / display / SUPER_ADMIN were refused, so a TECHNICIAN could send an
// SMS or email to ANY recipient from the salon's sender and change customers' messaging consent. Keyed with the catalog's
// communications.manage / .view (owner, manager, front desk, reception). Technicians message their own clients via /tech/follow-ups.
@ListQueries(NotificationsControllerListQueries)
@Controller('pos/notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  // POST /pos/notifications/send — send an SMS/email to a customer; meters the tenant's sms/email credits.
  @RequirePermission('communications.manage') @Post('send')
  send(@Body(ValidatedBody(NOTIFICATION_SEND_BODY, { strict: true })) body: SendNotificationRequest, @Req() req: any) {
    return run(() => this.svc.send(ctxFrom(req), body));
  }

  // GET /pos/notifications?limit=50 — recent send log for the tenant.
  @RequirePermission('communications.view') @Get()
  recent(@Query('limit') limit: string, @Req() req: any) {
    return run(() => this.svc.recent(ctxFrom(req), limit ? Number(limit) : 50));
  }

  // POST /pos/notifications/opt-out {channel, address, reason?} — honor a customer's opt-out / unsubscribe.
  @RequirePermission('communications.manage') @Post('opt-out')
  optOut(@Body(ValidatedBody(NOTIFICATION_OPT_BODY, { strict: true })) body: { channel: 'sms' | 'email'; address: string; reason?: string }, @Req() req: any) {
    return run(() => this.svc.recordOptOut(ctxFrom(req), body?.channel, body?.address, body?.reason));
  }

  // POST /pos/notifications/opt-in {channel, address, consentNote} — re-subscribe a previously opted-out recipient.
  // 741: a customer's STOP is undone only by the customer (START); any other re-opt-in needs a consent note (how they agreed)
  @RequirePermission('communications.manage') @Post('opt-in')
  optIn(@Body(ValidatedBody(NOTIFICATION_OPT_BODY, { strict: true })) body: { channel: 'sms' | 'email'; address: string; consentNote?: string }, @Req() req: any) {
    return run(() => this.svc.recordOptIn(ctxFrom(req), body?.channel, body?.address, body?.consentNote ?? null));
  }

  // GET /pos/notifications/opt-outs — the tenant's opt-out list.
  @RequirePermission('communications.view') @Get('opt-outs')
  optOuts(@Query('limit') limit: string, @Req() req: any) {
    return run(() => this.svc.optOuts(ctxFrom(req), limit ? Number(limit) : 100));
  }
}
