import { Controller, Get, Patch, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { PolicyService, PolicyError } from './policy.service';
import { SEC_POLICY_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof PolicyError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security')
export class PolicyController {
  constructor(private readonly svc: PolicyService) {}
  @Get('mfa-policy') getMfa() { return run(() => this.svc.get('mfa')); }
  @Patch('mfa-policy') setMfa(@Req() r: any, @Body(ValidatedBody(SEC_POLICY_BODY)) b: any) { return run(() => this.svc.update('mfa', b?.config || b || {}, actorOf(r))); }
  @Get('password-policy') getPw() { return run(() => this.svc.get('password')); }
  @Patch('password-policy') setPw(@Req() r: any, @Body(ValidatedBody(SEC_POLICY_BODY)) b: any) { return run(() => this.svc.update('password', b?.config || b || {}, actorOf(r))); }
  @Get('session-policy') getSess() { return run(() => this.svc.get('session')); }
  @Patch('session-policy') setSess(@Req() r: any, @Body(ValidatedBody(SEC_POLICY_BODY)) b: any) { return run(() => this.svc.update('session', b?.config || b || {}, actorOf(r))); }
}
