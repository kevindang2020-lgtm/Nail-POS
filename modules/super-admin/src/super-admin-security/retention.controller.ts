import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { RetentionService, RetentionError } from './retention.service';
import { SEC_RETENTION_RULE_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof RetentionError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'unsupported' ? HttpStatus.NOT_IMPLEMENTED : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security/retention-rules')
export class RetentionController {
  constructor(private readonly svc: RetentionService) {}
  @Get() list() { return run(() => this.svc.list(30)); }
  @Get(':dataClass') get(@Param('dataClass') dc: string) { return run(() => this.svc.get(dc)); }
  @Patch(':dataClass') upsert(@Req() r: any, @Param('dataClass') dc: string, @Body(ValidatedBody(SEC_RETENTION_RULE_BODY)) b: any) { return run(() => this.svc.upsert(dc, Number(b?.retentionDays), b?.action, actorOf(r))); }
  @Post(':dataClass/preview-purge') preview(@Req() r: any, @Param('dataClass') dc: string) { return run(() => this.svc.previewPurge(dc, actorOf(r))); }
}
