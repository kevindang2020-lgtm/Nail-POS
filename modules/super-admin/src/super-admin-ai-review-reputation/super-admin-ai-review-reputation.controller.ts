// super-admin-ai-review-reputation.controller.ts — SuperAdminGuard-only oversight. Platform operational counts + an
// audited, reason-required per-tenant OPERATIONAL drill-down. No endpoint returns tenant review content.
import { Controller, Get, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminAiReviewReputationService, SuperAdminReputationError, type SuperAdminCtx } from './super-admin-ai-review-reputation.service';
import { SuperAdminAiReviewReputationControllerListQueries } from './super-admin-ai-review-reputation.list-queries';

function ctxFrom(req: any): SuperAdminCtx { const c = req?.ctx || req?.user || {}; return { userId: c.userId ?? c.id, email: c.email, ip: safeInet(req?.ip) ?? undefined }; }

@ListQueries(SuperAdminAiReviewReputationControllerListQueries)
@Controller('super-admin/ai-review-reputation')
@UseGuards(SuperAdminGuard)
export class SuperAdminAiReviewReputationController {
  constructor(private readonly svc: SuperAdminAiReviewReputationService) {}

  @Get('overview')
  overview(@Req() r: any) { return this.svc.platformOverview(ctxFrom(r)); }

  @Get('tenants/:tenantId')
  async tenantView(@Req() r: any, @Param('tenantId') tenantId: string, @Query('reason') reason: string) {
    try { return await this.svc.tenantView(ctxFrom(r), tenantId, reason); }
    catch (e) { if (e instanceof SuperAdminReputationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST); throw e; }
  }
}
