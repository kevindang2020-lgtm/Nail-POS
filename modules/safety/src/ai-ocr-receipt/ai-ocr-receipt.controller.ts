// ai-ocr-receipt.controller.ts — tenant-facing API. TenantAuthGuard + RolePermissionGuard; tenant + branch come from
// req.ctx (never the client). Granular pos.ai_ocr_receipt.* permissions map to the inventory capability in security-core;
// per-action authority (approve/post) is enforced in the service. OcrError → HTTP via run().
import type { OcrPostingResult, OcrPageAppendResult, OcrExtractionResult, OcrUploadResult } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { OCR_CORRECT_FIELD_BODY, OCR_DECISION_BODY, OCR_PAGE_BODY, OCR_POST_BODY, OCR_SETTINGS_BODY, OCR_UPLOAD_BODY } from '../request-schemas';
import { Body, Controller, Get, HttpException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import { OcrError } from './ai-ocr-receipt-errors';
import { bytesFromBody } from './ai-ocr-receipt-upload';
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

  // GET documents is retired (Receipt Document Recognition guide, Nov 2 2026): the queues read /pos/receipt-center/documents —
  // server pages, search and dates (this list stopped at 200 rows, and the POS sent a filter name it ignored)
  // Oct 27 2026 (§37/§38): the detail carries the per-field reading (confidence + state per field) and the line items, so the
  // review screen can mark the weak fields "Verify" and show what a person already confirmed / corrected
  @Get('documents/:id') @RequirePermission('pos.ai_ocr_receipt.view') detail(@Req() r: any, @Param('id') id: string) { return run(async () => { const d = await this.svc['docs'].get(ctx(r), id); if (!d) throw new OcrError('NOT_FOUND'); const x = await this.svc.extraction(ctx(r), id); return { ...d, fields: x.fields, lineItems: x.lineItems, amounts: x.amounts, arithmetic: x.arithmetic }; }); }
  @Get('documents/:id/preview-url') @RequirePermission('pos.ai_ocr_receipt.view') preview(@Req() r: any, @Param('id') id: string, @Query('key') key: string) { return run(() => this.svc.previewUrl(ctx(r), id, key)); }

  @Post('upload') @RequirePermission('pos.ai_ocr_receipt.manage') upload(@Req() r: any, @Body(ValidatedBody(OCR_UPLOAD_BODY, { strict: true })) b: any): Promise<OcrUploadResult> {
    // b carries filename / declaredMime / sizeBytes + the file's bytes as a JSON number array (bytesFromBody converts them)
    return run(async () => {
      const bytes = bytesFromBody(b.bytes);
      if (!bytes) throw new OcrError('INVALID_UPLOAD', 'The file bytes must be a list of byte values (0–255).');
      return this.svc.upload(ctx(r), { filename: b.filename, declaredMime: b.mimeType, sizeBytes: b.sizeBytes, headerBytes: b.headerBytes ?? [], pageCount: b.pageCount ?? null, width: b.width ?? null, height: b.height ?? null, bytes, source: b.source ?? null, deferExtraction: b.deferExtraction ?? null });
    });
  }
  // §17/§18 (Oct 27 2026): page 2, 3 … of ONE document (never a second document / expense); the same validation and scan as page 1
  @Post('documents/:id/pages') @RequirePermission('pos.ai_ocr_receipt.manage') addPage(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_PAGE_BODY, { strict: true })) b: any): Promise<OcrPageAppendResult> {
    return run(async () => {
      const bytes = bytesFromBody(b.bytes);
      if (!bytes) throw new OcrError('INVALID_UPLOAD', 'The file bytes must be a list of byte values (0–255).');
      return this.svc.appendPage(ctx(r), id, { filename: b.filename, declaredMime: b.mimeType, sizeBytes: b.sizeBytes, headerBytes: b.headerBytes ?? [], width: b.width ?? null, height: b.height ?? null, bytes });
    });
  }
  // §115 (Oct 27 2026): a person retries a reading that used its automatic attempts (the dead letter) — the ladder starts again
  @Post('documents/:id/retry-extract') @RequirePermission('pos.ai_ocr_receipt.manage') retryExtract(@Req() r: any, @Param('id') id: string): Promise<OcrExtractionResult> { return run(() => this.svc.retryExtraction(ctx(r), id)); }

  @Post('documents/:id/correct-field') @RequirePermission('pos.ai_ocr_receipt.manage') correct(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_CORRECT_FIELD_BODY, { strict: true })) b: any) { return run(() => this.svc.correctField(ctx(r), id, b.field, { value: b.value, valueCents: b.valueCents, confirmOnly: b.confirmOnly })); }
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
  @Post('documents/:id/approve') @RequirePermission('pos.ai_ocr_receipt.approve') approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.decide(ctx(r), id, 'approve', b?.reason)); }
  @Post('documents/:id/reject') @RequirePermission('pos.ai_ocr_receipt.approve') reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.decide(ctx(r), id, 'reject', b?.reason)); }
  @Post('documents/:id/return') @RequirePermission('pos.ai_ocr_receipt.manage') return_(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.decide(ctx(r), id, 'return', b?.reason)); }
  @Post('documents/:id/post') @RequirePermission('pos.ai_ocr_receipt.post') post(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_POST_BODY, { strict: true })) b: any) { return run(() => this.svc.post(ctx(r), id, b?.destination === 'inventory_receipt' ? 'inventory_receipt' : 'expense')); }
  // M3 (Oct 23 2026): a posting that FAILED (the finance / inventory write refused) is retried — idempotent per document + posting version
  @Post('documents/:id/retry-post') @RequirePermission('pos.ai_ocr_receipt.post') retryPost(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(OCR_POST_BODY, { strict: true })) b: any): Promise<OcrPostingResult> { return run(() => this.svc.retryPost(ctx(r), id, b?.destination === 'inventory_receipt' ? 'inventory_receipt' : 'expense')); }

  @Put('settings') @RequirePermission('pos.ai_ocr_receipt.manage') saveSettings(@Req() r: any, @Body(ValidatedBody(OCR_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.saveSettings(ctx(r), b)); }
}
