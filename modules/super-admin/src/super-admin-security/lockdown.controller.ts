import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { LockdownService, LockdownError } from './lockdown.service';
import { SEC_LOCKDOWN_CONFIRM_BODY, SEC_LOCKDOWN_PROPOSE_BODY, SEC_REASON_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof LockdownError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'forbidden' ? HttpStatus.FORBIDDEN : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null, sessionId: r?.ctx?.sessionId || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security/lockdowns')
export class LockdownController {
  constructor(private readonly svc: LockdownService) {}
  @Get() list() { return run(() => this.svc.list(20)); }
  @Get(':id') get(@Param('id') id: string) { return run(() => this.svc.get(id)); }
  @Post('propose') propose(@Req() r: any, @Body(ValidatedBody(SEC_LOCKDOWN_PROPOSE_BODY, { strict: true })) b: any) { return run(() => this.svc.propose({ scope: b?.scope, target: b?.target, reason: b?.reason }, actorOf(r))); }
  @RequireStepUp()   // C7: server-enforced step-up (the body's stepUpVerified flag is only the client's claim)
  @Post(':id/confirm') confirm(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SEC_LOCKDOWN_CONFIRM_BODY, { strict: true })) b: any) { return run(() => this.svc.confirm(id, b?.confirmationPhrase, !!b?.stepUpVerified, actorOf(r))); }
  @RequireStepUp()
  @Post(':id/execute') execute(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.execute(id, actorOf(r))); }
  @RequireStepUp()   // §133 / §138 (Oct 28 2026): undoing containment needs the same fresh proof as executing it
  @Post(':id/lift') lift(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SEC_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.lift(id, b?.reason ?? null, actorOf(r))); }
  @RequireStepUp()   // §133 / §138 (Oct 28 2026): undoing containment needs the same fresh proof as executing it
  @Post(':id/cancel') cancel(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancel(id, actorOf(r))); }
}
