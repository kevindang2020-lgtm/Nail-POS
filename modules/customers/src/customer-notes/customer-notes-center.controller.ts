// customer-notes-center.controller.ts — Customer Notes SUNMI guide (Nov 9 2026): `/pos/customer-notes/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the query.
//   pos.customers.notes.view  summary · notes · notes/detail · check (read-only diagnostics)
//   pos.customers.notes.edit  review (confirm a safety note's current text, or mark it for correction)
// The note text itself is still edited where it always was: PUT /pos/customers/:id/notes.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { CnSummaryResponse, CnListResponse, CnDetailResponse, CnCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '../retention/retention.repository';
import { CustomerNotesCenter, CustomerNotesError, CN_CATEGORIES, CN_REVIEW, CN_DATE_FIELDS, CN_PRESETS } from './customer-notes-center';

export const CUSTOMER_NOTES_CENTER = 'CustomerNotesCenter';
/** POST check — no body */
export const CN_CHECK_BODY: BodySchema = S.object({});
/** POST review — the safety note, the text the reviewer read (sha256) and the decision */
export const CN_REVIEW_BODY: BodySchema = S.object({
  customerId: S.uuid(), category: S.enumOf(['allergy', 'warning']), contentHash: S.string({ minLength: 64, maxLength: 64 }),
  decision: S.enumOf(['confirmed', 'needs_correction']), reason: S.nullable(S.text(500)),
}, ['customerId', 'category', 'contentHash', 'decision']);

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof CustomerNotesError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: { category: { type: 'enum', values: CN_CATEGORIES }, review: { type: 'enum', values: CN_REVIEW }, dateField: { type: 'enum', values: CN_DATE_FIELDS }, preset: { type: 'enum', values: CN_PRESETS } },
  sorts: { newest: null, oldest: null, name: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-notes')
export class CustomerNotesCenterController {
  constructor(@Inject(CUSTOMER_NOTES_CENTER) private readonly cn: CustomerNotesCenter | null) {}
  private r(): CustomerNotesCenter { if (!this.cn) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Customer Notes needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.cn; }

  /** the four cards: customers with notes · safety warnings · preferences recorded · needs review */
  @Get('summary') @RequirePermission('pos.customers.notes.view')
  summary(@Req() q: any): Promise<CnSummaryResponse> { const c = ctxFrom(q); need(c, 'pos.customers.notes.view'); return run(() => this.r().summary(c)); }

  /** the notes table: q · category · review · which date + range · sort · pages 10/25/50/100 (newest first) */
  @Get('notes') @RequirePermission('pos.customers.notes.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any): Promise<CnListResponse> { const c = ctxFrom(q); need(c, 'pos.customers.notes.view'); return run(() => this.r().list(c, f ?? {})); }

  /** one customer's notes + review history (opening it is audited, fail-closed: notes are sensitive) */
  @Get('notes/detail') @RequirePermission('pos.customers.notes.view')
  @ListQuery({ maxLimit: 1, defaultLimit: 1, params: ['customerId', 'ticketId'] } as const)
  detail(@Req() q: any, @Query('customerId') customerId: string, @Query('ticketId') ticketId?: string): Promise<CnDetailResponse> {
    const c = ctxFrom(q); need(c, 'pos.customers.notes.view');
    return run(async () => {
      // Customer Notes 01: an optional visit (ticketId) ranks the notes for it; without one the session's branch + technician do
      const d = await this.r().detail(c, String(customerId ?? ''), { ticketId: ticketId ? String(ticketId) : null });
      await recordAuditStrict(this.r().db, actor(c), { module: 'customers', action: 'customer_notes.viewed', resourceType: 'customer', resourceId: d.customer.id, summary: 'Customer notes opened' });
      return d;
    });
  }

  /** Review & Accuracy: confirm the current text of a safety note, or mark it for correction (audited) */
  @Post('review') @RequirePermission('pos.customers.notes.edit')
  review(@Req() q: any, @Body(ValidatedBody(CN_REVIEW_BODY, { strict: true })) b: any): Promise<CnDetailResponse> {
    const c = ctxFrom(q); need(c, 'pos.customers.notes.edit');
    return run(async () => {
      const d = await this.r().review(c, b ?? {});
      await recordAuditStrict(this.r().db, actor(c), { module: 'customers', action: 'customer_notes.reviewed', resourceType: 'customer', resourceId: d.customer.id, summary: `Safety note ${b.category} ${b.decision}` });
      return d;
    });
  }

  /** Check Customer Notes System — read-only */
  @Post('check') @RequirePermission('pos.customers.notes.view')
  check(@Req() q: any, @Body(ValidatedBody(CN_CHECK_BODY, { strict: true })) _b: unknown): Promise<CnCheckResponse> { const c = ctxFrom(q); need(c, 'pos.customers.notes.view'); return run(() => this.r().check(c)); }

}
