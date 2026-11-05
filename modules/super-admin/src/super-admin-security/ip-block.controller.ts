import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IpBlockService, IpBlockError } from './ip-block.service';
import { SEC_IP_ALLOW_BODY, SEC_IP_BLOCK_BODY, SEC_IP_PREVIEW_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof IpBlockError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'protected' || e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security/ip-blocks')
export class IpBlockController {
  constructor(private readonly svc: IpBlockService) {}
  @Get() list() { return run(() => this.svc.list(20)); }
  @Post('preview') preview(@Body(ValidatedBody(SEC_IP_PREVIEW_BODY)) b: any) { return run(() => this.svc.preview(b?.target)); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(SEC_IP_BLOCK_BODY)) b: any) { return run(() => this.svc.createBlock({ target: b?.target, threatType: b?.threatType, source: b?.source, reason: b?.reason, country: b?.country, tenantId: b?.tenantId, expiresAt: b?.expiresAt }, actorOf(r))); }
  @Post('allowlist') allow(@Req() r: any, @Body(ValidatedBody(SEC_IP_ALLOW_BODY)) b: any) { return run(() => this.svc.addAllowlist(b?.target, b?.reason ?? null, actorOf(r))); }
  @Delete(':id') unblock(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.unblock(id, actorOf(r))); }
}
