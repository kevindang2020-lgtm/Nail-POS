// super-admin-ai-ocr-receipt.controller.ts — SuperAdminGuard-only oversight. Platform operational counts + an audited,
// reason-required per-tenant OPERATIONAL drill-down. No endpoint returns a tenant's document content.
import { Controller, Get, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminAiOcrReceiptService, OcrOversightError, type SupportCtx } from './super-admin-ai-ocr-receipt.service';
import { SuperAdminAiOcrReceiptControllerListQueries } from './super-admin-ai-ocr-receipt.list-queries';

function ctxFrom(req: any): SupportCtx { const c = req?.ctx || req?.user || {}; return { userId: c.userId ?? c.id, email: c.email, ip: safeInet(req?.ip) ?? undefined }; }

@ListQueries(SuperAdminAiOcrReceiptControllerListQueries)
@Controller('super-admin/ai-ocr-receipt')
@UseGuards(SuperAdminGuard)
export class SuperAdminAiOcrReceiptController {
  constructor(private readonly svc: SuperAdminAiOcrReceiptService) {}

  @Get('overview')
  overview(@Req() r: any) { return this.svc.platformOverview(ctxFrom(r)); }

  @Get('tenants/:tenantId')
  async tenantView(@Req() r: any, @Param('tenantId') tenantId: string, @Query('reason') reason: string) {
    try { return await this.svc.tenantView(ctxFrom(r), tenantId, reason); }
    catch (e) { if (e instanceof OcrOversightError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST); throw e; }
  }
}
