// ai-assistant.controller.ts — a single tenant-facing entry point for all 15 AI assistants: POST /ai/:packageCode.
// Every call is authenticated, tenant-resolved from the session, and forced through AiAssistantService (gate → gateway →
// usage log). A denied gate returns 403 with a clean reason + label the POS renders as a locked/upgrade panel; the
// provider is never called and no usage is charged. (Per-assistant convenience routes like /ai/booking-assistant are
// Phase 2 thin wrappers over this same path.)
import { Controller, Post, Param, Body, Req, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';
import { isAiPackageCode } from './ai-catalog';

import { ValidatedBody, TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { AI_INVOKE_BODY, AI_SCAN_RECEIPT_BODY } from '../request-schemas';
@Controller('ai')
export class AiAssistantController {
  constructor(private readonly svc: AiAssistantService) {}

  // Oct 21 2026 (Receipt / Expense / OCR mandate audit): this route had NO permission check — any signed-in session,
  // including a technician or a customer, could spend the salon's AI scans. It is the inventory screen's quick scan, so it
  // takes the same key as saving that scan as an expense (inventory.create).
  @UseGuards(TenantAuthGuard, RolePermissionGuard) @RequirePermission('inventory.create')
  @Post('ocr/scan-receipt')
  async scanReceipt(@Body(ValidatedBody(AI_SCAN_RECEIPT_BODY, { strict: true })) body: any, @Req() req: any) {
    const tenantId = req?.ctx?.tenantId ?? req?.tenant?.id ?? req?.user?.tenantId;
    const userId = req?.ctx?.userId ?? req?.user?.id ?? null;
    if (!tenantId) throw new HttpException('unauthenticated', HttpStatus.UNAUTHORIZED);
    const imageBase64 = String(body?.imageBase64 ?? '');
    const mimeType = String(body?.mimeType ?? '');
    if (!imageBase64 || !/^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(mimeType)) throw new HttpException('invalid_image', HttpStatus.BAD_REQUEST);
    if (imageBase64.length > 12_000_000) throw new HttpException('image_too_large', HttpStatus.PAYLOAD_TOO_LARGE); // ~9MB binary
    try {
      const result = await this.svc.scanReceipt({ tenantId, userId, imageBase64, mimeType });
      if (!result.ok) throw new HttpException({ error: 'ai_access_denied', ...result.decision }, HttpStatus.FORBIDDEN);
      return result;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(e?.message ?? 'ai_error', e?.status === 502 ? HttpStatus.BAD_GATEWAY : e?.status === 503 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Security Deep Scan E3: this route had no realm or permission check — any signed-in session (a customer's included:
  // customer sessions carry the salon's tenantId) could spend the salon's AI quota as a free LLM proxy. Staff with ai.use only.
  @UseGuards(TenantAuthGuard, RolePermissionGuard) @RequirePermission('ai.use')
  @Post(':packageCode')
  async invoke(@Param('packageCode') packageCode: string, @Body(ValidatedBody(AI_INVOKE_BODY, { strict: true })) body: any, @Req() req: any) {
    if (!isAiPackageCode(packageCode)) throw new HttpException('unknown_ai_package', HttpStatus.NOT_FOUND);
    const tenantId = req?.ctx?.tenantId ?? req?.tenant?.id ?? req?.user?.tenantId;
    const userId = req?.ctx?.userId ?? req?.user?.id ?? null;
    if (!tenantId) throw new HttpException('unauthenticated', HttpStatus.UNAUTHORIZED);

    try {
      const result = await this.svc.run({ tenantId, userId, packageCode, action: body?.action, prompt: String(body?.prompt ?? '') });
      if (!result.ok) throw new HttpException({ error: 'ai_access_denied', ...result.decision }, HttpStatus.FORBIDDEN);
      return result;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(e?.message ?? 'ai_error', e?.status === 502 ? HttpStatus.BAD_GATEWAY : HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
