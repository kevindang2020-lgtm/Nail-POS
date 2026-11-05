/** ai-governance.controller.ts — `/tenant/ai/control-modes`. TenantAuthGuard; scope + actor from req.ctx (session). */
import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_CONTROL_MODE_BODY } from '../request-schemas';
import { AiGovernanceService } from './ai-governance.service';

function ctxFrom(req: any) { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId ?? null, role: c.role, permissions: c.permissions || [] }; }

@UseGuards(TenantAuthGuard)
@Controller('tenant/ai/control-modes')
export class AiGovernanceController {
  constructor(private readonly svc: AiGovernanceService) {}
  @RequirePermission('ai.use') @Get() list(@Req() r: any) { return this.svc.list(ctxFrom(r).tenantId); }
  @RequirePermission('ai.control.manage') @Patch(':assistantKey') set(@Req() r: any, @Param('assistantKey') key: string, @Body(ValidatedBody(AI_CONTROL_MODE_BODY)) body: any) {
    return this.svc.setMode(ctxFrom(r), key, body?.mode);
  }
}
