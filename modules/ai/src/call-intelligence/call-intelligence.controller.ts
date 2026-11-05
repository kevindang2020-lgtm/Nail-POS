/**
 * call-intelligence.controller.ts — `/tenant/ai/call-intelligence/*`. Behind TenantAuthGuard; scope from req.ctx
 * (session), never the client. The production producer is the telephony webhook (signature-verified) calling the
 * service; this surface serves the summary and accepts authorized ingest.
 */
import { Body, Controller, Get, Post, Req, UseGuards , Query} from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { CALL_INTELLIGENCE_EVENT_BODY } from '../request-schemas';
import { CallIntelligenceService } from './call-intelligence.service';
import { ListQueries } from '@aipowersalon/database';
import { CallIntelligenceControllerListQueries } from './call-intelligence.list-queries';

function scopeFrom(req: any): { tenantId: string; branchId: string | null } {
  const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null };
}

@UseGuards(TenantAuthGuard)
@ListQueries(CallIntelligenceControllerListQueries)
@Controller('tenant/ai/call-intelligence')
export class CallIntelligenceController {
  constructor(private readonly svc: CallIntelligenceService) {}
  @RequirePermission('ai.use') @Get('summary') summary(@Req() r: any) { return this.svc.summary(scopeFrom(r)); }
  @RequirePermission('ai.use') @Get('recent') recent(@Req() r: any, @Query('limit') limit?: string) { return this.svc.recent(scopeFrom(r), Math.max(1, Math.min(200, Number(limit) || 50))); }
  @RequirePermission('ai.use') @Post('events') ingest(@Req() r: any, @Body(ValidatedBody(CALL_INTELLIGENCE_EVENT_BODY)) body: any) {
    const s = scopeFrom(r);
    return this.svc.record(s.tenantId, s.branchId, body || {});
  }
}
