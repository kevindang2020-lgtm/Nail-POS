import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { GrantService, GrantError } from './grant.service';
import { SEC_GRANT_REQUEST_BODY, SEC_REASON_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof GrantError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'forbidden' ? HttpStatus.FORBIDDEN : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security/privileged-access')
export class GrantController {
  constructor(private readonly svc: GrantService) {}
  @Get() list() { return run(() => this.svc.list(20)); }
  @Get('active') active() { return run(() => this.svc.listActive()); }
  @Get(':id') get(@Param('id') id: string) { return run(() => this.svc.get(id)); }
  @Post('request') request(@Req() r: any, @Body(ValidatedBody(SEC_GRANT_REQUEST_BODY, { strict: true })) b: any) { return run(() => this.svc.request({ userId: b?.userId, privilege: b?.privilege, scope: b?.scope, target: b?.target, reason: b?.reason, expiresAt: b?.expiresAt }, actorOf(r))); }
  @RequireStepUp()   // C7: approving privileged access
  @Post(':id/approve') approve(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.approve(id, actorOf(r))); }
  @Post(':id/deny') deny(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SEC_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.deny(id, b?.reason ?? null, actorOf(r))); }
  @Post(':id/revoke') revoke(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SEC_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.revoke(id, b?.reason ?? null, actorOf(r))); }
  @Post('expire-sweep') sweep(@Req() r: any) { return run(() => this.svc.expireSweep(actorOf(r))); }
}
