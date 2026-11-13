// receipt-center.controller.ts — AI OCR Receipt Scanner guide (Nov 1 2026): `/pos/receipt-center/*`, the scanner page's read side.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from the session (req.ctx), never the client.
//   pos.ai_ocr_receipt.view   summary · documents · documents/:id · check
// Not behind the AI package gate on purpose: receipts already scanned stay visible when a trial ends (the books keep them).
// Every write (upload, extract, correct, approve, post, receive) stays on /pos/ai-ocr-receipt/* — nothing here changes a record.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { ReceiptProcessingResponse } from '@aipowersalon/api-contracts/tenant';
import { ReceiptCenter, ReceiptCenterError, RC_GROUPS, RC_DATE_FIELDS, RC_PRESETS, type RcCtx } from './receipt-center';

export const RECEIPT_CENTER = 'ReceiptCenter';
export const RC_EMPTY_BODY: BodySchema = S.object({});
const VIEW = 'pos.ai_ocr_receipt.view';
function ctxFrom(req: any): RcCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function need(ctx: RcCtx) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], VIEW)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof ReceiptCenterError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}
const PERIOD = { preset: { type: 'enum', values: RC_PRESETS } } as const;
const SUMMARY = { filters: PERIOD, dateRange: { maxDays: 3660 } } as const;
const DOCS = { filters: { ...PERIOD, group: { type: 'enum', values: RC_GROUPS }, dateField: { type: 'enum', values: RC_DATE_FIELDS } }, search: { maxLength: 80 },
  sorts: { newest: null, oldest: null, purchase_date: null, total_high: null, total_low: null, vendor: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

const PROCESSING = { sorts: { oldest: null, newest: null, attempts: null, phase: null }, maxLimit: 50, defaultLimit: 50 } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/receipt-center')
export class ReceiptCenterController {
  constructor(@Inject(RECEIPT_CENTER) private readonly rc: ReceiptCenter | null) {}
  private r(): ReceiptCenter { if (!this.rc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The receipt scanner needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.rc; }

  /** the four cards (one definition each) and what is stuck in the pipeline */
  @Get('summary') @RequirePermission('pos.ai_ocr_receipt.view') @ListQuery(SUMMARY)
  summary(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.r().summary(c, f ?? {})); }

  /** receipt history: search · status group · which date · presets / range · sort · pages (newest first) */
  @Get('documents') @RequirePermission('pos.ai_ocr_receipt.view') @ListQuery(DOCS)
  documents(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c); return run(() => this.r().documents(c, f ?? {})); }

  /** Receipt Document Recognition 03: the Extracting queue — phase cards, waiting receipts with attempts / latest job / retry eligibility */
  @Get('processing') @RequirePermission('pos.ai_ocr_receipt.view') @ListQuery(PROCESSING)
  processing(@Req() q: any, @Query() f: any): Promise<ReceiptProcessingResponse> { const c = ctxFrom(q); need(c); return run(() => this.r().processing(c, f ?? {})); }

  /** one receipt, read-only: fields, lines, checks, duplicates, the expense / receiving links, the approval trail */
  @Get('documents/:id') @RequirePermission('pos.ai_ocr_receipt.view')
  document(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c); return run(() => this.r().document(c, id)); }

  /** Check OCR System — read-only */
  @Post('check') @RequirePermission('pos.ai_ocr_receipt.view')
  check(@Req() q: any, @Body(ValidatedBody(RC_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c); return run(() => this.r().check(c)); }
}
