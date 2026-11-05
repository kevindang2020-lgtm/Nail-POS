/** ai-revenue.controller.ts — `/tenant/ai/revenue/*`. TenantAuthGuard; scope from req.ctx (session), never client. */
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_REVENUE_ATTRIBUTION_BODY } from '../request-schemas';
import { AiRevenueService } from './ai-revenue.service';

function scopeFrom(req: any): { tenantId: string; branchId: string | null } {
  const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null };
}

@UseGuards(TenantAuthGuard)
@Controller('tenant/ai/revenue')
export class AiRevenueController {
  constructor(private readonly svc: AiRevenueService) {}
  @RequirePermission('ai.use') @Get('summary') summary(@Req() r: any) { return this.svc.summary(scopeFrom(r)); }
  @RequirePermission('ai.use') @Post('attributions') record(@Req() r: any, @Body(ValidatedBody(AI_REVENUE_ATTRIBUTION_BODY)) body: any) { const s = scopeFrom(r); return this.svc.record(s.tenantId, s.branchId, body || {}); }
}
