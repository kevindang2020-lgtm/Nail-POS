import { Controller, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SessionRevokeService, RevokeError } from './session-revoke.service';
import { SEC_SESSION_REVOKE_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof RevokeError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || r?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security/sessions')
export class SessionRevokeController {
  constructor(private readonly svc: SessionRevokeService) {}
  @Post('revoke/preview') preview(@Req() r: any, @Body(ValidatedBody(SEC_SESSION_REVOKE_BODY)) b: any) { return run(() => this.svc.preview({ scope: b?.scope, target: b?.target, reason: b?.reason, currentSessionId: r?.ctx?.sessionId || b?.currentSessionId, includeCurrent: !!b?.includeCurrent })); }
  @Post('revoke') revoke(@Req() r: any, @Body(ValidatedBody(SEC_SESSION_REVOKE_BODY)) b: any) { return run(() => this.svc.revoke({ scope: b?.scope, target: b?.target, reason: b?.reason, currentSessionId: r?.ctx?.sessionId || b?.currentSessionId, includeCurrent: !!b?.includeCurrent }, actorOf(r))); }
  @Post(':id/revoke') revokeOne(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.revoke({ scope: 'session', target: id, currentSessionId: r?.ctx?.sessionId }, actorOf(r))); }
}
