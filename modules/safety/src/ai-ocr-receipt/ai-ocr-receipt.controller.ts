// ai-ocr-receipt.controller.ts — tenant-facing API. TenantAuthGuard + RolePermissionGuard; tenant + branch come from
// req.ctx (never the client). Granular pos.ai_ocr_receipt.* permissions map to the inventory capability in security-core;
// per-action authority (approve/post) is enforced in the service. OcrError → HTTP via run().
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { OCR_CORRECT_FIELD_BODY, OCR_DECISION_BODY, OCR_POST_BODY, OCR_SETTINGS_BODY, OCR_UPLOAD_BODY } from '../request-schemas';
import { Body, Controller, Get, HttpException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import { OcrError } from './ai-ocr-receipt-errors';
import { ListQueries } from '@aipowersalon/database';
import { AiOcrReceiptControllerListQueries } from './ai-ocr-receipt.list-queries';

function ctx(req: any) { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof OcrError) throw new HttpException({ ok: false, code: e.code, message: e.message, ...(e.extra || {}) }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(AiOcrReceiptControllerListQueries)
@Controller('pos/ai-ocr-receipt')
export class AiOcrReceiptController {
  constructor(private readonly svc: AiOcrReceiptService) {}

  @Get('settings') @RequirePermission('pos.ai_ocr_receipt.view') getSettings(@Req() r: any) { return run(() => this.svc.effectiveConfig(ctx(r))); }

  @Get('documents') @RequirePermission('pos.ai_ocr_receipt.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc['docs'].list(ctx(r), q)); }
  @Get('documents/:id') @RequirePermission('pos.ai_ocr_receipt.view') detail(@Req() r: any, @Param('id') id: string) { return run(async () => { const d = await this.svc['docs'].get(ctx(r), id); if (!d) throw new OcrError('NOT_FOUND'); return d; }); }
  @Get('documents/:id/preview-url') @RequirePermission('pos.ai_ocr_receipt.view') preview(@Req() r: any, @Param('id') id: string, @Query('key') key: string) { return run(() => this.svc.previewUrl(ctx(r), id, key)); }

  @Post('upload') @RequirePermission('pos.ai_ocr_receipt.manage') upload(@Req() r: any, @Body(ValidatedBody(OCR_UPLOAD_BODY)) b: any) {
    // b carries filename/declaredMime/sizeBytes + base64 bytes (decoded by an upstream interceptor in the real wiring)
    return run(() => this.svc.upload(ctx(r), { filename: b.filename, declaredMime: b.mimeType, sizeBytes: b.sizeBytes, headerBytes: b.headerBytes ?? [], pageCount: b.pageCount ?? null, width: b.width ?? null, height: b.height ?? null, bytes: b.bytes ?? new Uint8Array() }));
  }

  @Post('documents/:id/correct-field') @RequirePermission('pos.ai_ocr_receipt.manage') correct(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_CORRECT_FIELD_BODY)) b: any) { return run(() => this.svc.correctField(ctx(r), id, b.field, { value: b.value, valueCents: b.valueCents, confirmOnly: b.confirmOnly })); }
  // Re-ask the scanner about a quarantined document and apply ONLY what it actually says. S3-side scanners tag
  // out of band, so the scan at upload time is normally 'unscanned' and (with malwareScanRequired defaulting to
  // true) the document quarantines; without this route it could never leave. `manage` is the right gate: it
  // releases a file into extraction, it does not approve or post anything.
  @Post('documents/:id/rescan') @RequirePermission('pos.ai_ocr_receipt.manage') rescan(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.rescan(ctx(r), id)); }
  // Run OCR on a document parked in `extracting`. Before this route existed nothing called the extraction
  // stage at all, so a clean-scanned receipt stopped there permanently. `manage`, not `approve`: extraction
  // proposes values for a human to check — it cannot approve or post anything.
  @Post('documents/:id/extract') @RequirePermission('pos.ai_ocr_receipt.manage') extract(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.runExtraction(ctx(r), id)); }
  @Post('documents/:id/start-review') @RequirePermission('pos.ai_ocr_receipt.manage') startReview(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.startReview(ctx(r), id)); }
  @Post('documents/:id/approve') @RequirePermission('pos.ai_ocr_receipt.approve') approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_DECISION_BODY)) b: any) { return run(() => this.svc.decide(ctx(r), id, 'approve', b?.reason)); }
  @Post('documents/:id/reject') @RequirePermission('pos.ai_ocr_receipt.approve') reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_DECISION_BODY)) b: any) { return run(() => this.svc.decide(ctx(r), id, 'reject', b?.reason)); }
  @Post('documents/:id/return') @RequirePermission('pos.ai_ocr_receipt.manage') return_(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_DECISION_BODY)) b: any) { return run(() => this.svc.decide(ctx(r), id, 'return', b?.reason)); }
  @Post('documents/:id/post') @RequirePermission('pos.ai_ocr_receipt.post') post(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_POST_BODY)) b: any) { return run(() => this.svc.post(ctx(r), id, b?.destination === 'inventory_receipt' ? 'inventory_receipt' : 'expense')); }

  @Put('settings') @RequirePermission('pos.ai_ocr_receipt.manage') saveSettings(@Req() r: any, @Body(ValidatedBody(OCR_SETTINGS_BODY)) b: any) { return run(() => this.svc.effectiveConfig(ctx(r))); }
}
