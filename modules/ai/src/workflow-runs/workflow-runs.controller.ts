/** workflow-runs.controller.ts — `/tenant/ai/workflows/*`. TenantAuthGuard; scope from req.ctx (session), never client. */
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { WORKFLOW_RUN_BODY } from '../request-schemas';
import { WorkflowRunsService } from './workflow-runs.service';

function scopeFrom(req: any): { tenantId: string; branchId: string | null } {
  const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null };
}

@UseGuards(TenantAuthGuard)
@Controller('tenant/ai/workflows')
export class WorkflowRunsController {
  constructor(private readonly svc: WorkflowRunsService) {}
  @RequirePermission('ai.use') @Get('runs/summary') summary(@Req() r: any) { return this.svc.summary(scopeFrom(r)); }
  @RequirePermission('ai.use') @Post('runs') record(@Req() r: any, @Body(ValidatedBody(WORKFLOW_RUN_BODY, { strict: true })) body: any) { const s = scopeFrom(r); return this.svc.record(s.tenantId, s.branchId, body || {}); }
}
