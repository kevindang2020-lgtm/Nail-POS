// duplicate-review-center.controller.ts — Duplicate Review guides (Nov 1 2026): `/pos/duplicate-review/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role come from the session (req.ctx), never the client.
//   pos.customers.view   summary · groups · groups/:id (comparison, audited fail-closed) · groups/:id/preview (read-only,
//                        recorded) · history · scan (writes review records only) · check (read-only diagnostics)
//   pos.customers.edit   decision in_review / defer / reopen / request_evidence · notes
//   pos.customers.merge  decision keep_separate · groups/:id/merge (preview hash + idempotency key + acknowledgements)
//   + pos.customers.export full phone / email (otherwise masked)
// Display-only access never implies the ability to merge (guide §17).
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission, S, type BodySchema } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { CustomerMergeRecordPage, CustomerUnmergeCheck, CustomerUnmergeResult } from '@aipowersalon/api-contracts/tenant';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isUuid, type RetentionContext } from '../retention/retention.repository';
import { DuplicateReviewCenter, DuplicateReviewError, DR_ACK_CODES } from './duplicate-review-center';
import { DR_STATUS_FILTERS, DR_CONFIDENCES, DR_REASONS, DR_DATE_FIELDS, DR_PRESETS, DR_DECISIONS, DR_EVENT_TYPES } from './duplicate-review-core';

export const DUPLICATE_REVIEW_CENTER = 'DuplicateReviewCenter';
export const DR_EMPTY_BODY: BodySchema = S.object({});
export const DR_DECISION_BODY: BodySchema = S.object({
  decision: S.enumOf(DR_DECISIONS), note: S.text(1000), expectedVersion: S.integer({ minimum: 1 }), assignee: S.uuid(), dueOn: S.date(),
}, ['decision']);
export const DR_NOTE_BODY: BodySchema = S.object({ note: S.text(1000, { minLength: 1 }) }, ['note']);
export const DR_PREVIEW_BODY: BodySchema = S.object({ survivorId: S.uuid() }, ['survivorId']);
export const DR_MERGE_BODY: BodySchema = S.object({
  survivorId: S.uuid(), previewHash: S.text(80, { minLength: 8 }), idempotencyKey: S.text(100, { minLength: 8 }),
  acknowledged: S.array(S.enumOf(DR_ACK_CODES), { maxItems: DR_ACK_CODES.length }), confirm: S.boolean(),
}, ['survivorId', 'previewHash', 'idempotencyKey', 'confirm']);
/** extras Customer 08: undo a merge — a reason and an explicit confirm */
export const DR_UNMERGE_BODY: BodySchema = S.object({ reason: S.text(500, { minLength: 3 }), confirm: S.boolean() }, ['reason', 'confirm']);

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, ...perms: string[]) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  for (const perm of perms) if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
const can = (ctx: RetentionContext, perm: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], perm);
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof DuplicateReviewError) throw new HttpException({ code: e.code, message: e.message, details: e.details }, e.status);
    throw e;
  }
}
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });
const LIST = {
  filters: {
    status: { type: 'enum', values: DR_STATUS_FILTERS }, confidence: { type: 'enum', values: DR_CONFIDENCES }, reason: { type: 'enum', values: DR_REASONS },
    dateField: { type: 'enum', values: DR_DATE_FIELDS }, preset: { type: 'enum', values: DR_PRESETS }, branch: { type: 'text', maxLength: 40 },
  },
  sorts: { newest: null, oldest: null, confidence: null, members: null, updated: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 },
  maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;
const MERGES = { filters: { status: { type: 'enum', values: ['active', 'undone'] } }, sorts: { newest: null }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const HISTORY = {
  filters: { groupId: { type: 'uuid' }, customerId: { type: 'uuid' }, eventType: { type: 'enum', values: DR_EVENT_TYPES }, preset: { type: 'enum', values: DR_PRESETS } },
  sorts: { newest: null }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'],
} as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/duplicate-review')
export class DuplicateReviewCenterController {
  constructor(@Inject(DUPLICATE_REVIEW_CENTER) private readonly dr: DuplicateReviewCenter | null) {}
  private r(): DuplicateReviewCenter { if (!this.dr) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Duplicate Review needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.dr; }
  private audit(c: RetentionContext, action: string, resourceId: string, summary: string) {
    return (trx: any, meta: Record<string, unknown>) => recordAuditStrict(trx, actor(c), { module: 'customers', action, resourceType: 'customer_duplicate_group', resourceId, summary, metadata: meta });
  }

  /** the KPI row + real data freshness (last scan, rule version) */
  @Get('summary') @RequirePermission('pos.customers.view')
  summary(@Req() q: any, @Query('branch') branch?: string) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().summary(c, { branch })); }

  /** the candidate queue: q (name · phone · email · customer / group / appointment / ticket id) · status · confidence · reason ·
   *  date field + range · sort (newest detected first by default) · pages 10/25/50/100 */
  @Get('groups') @RequirePermission('pos.customers.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().list(c, f ?? {}, { fullContact: can(c, 'pos.customers.export') })); }

  /** run detection now (rate-limited per salon; writes review records only, never a customer) */
  @Post('scan') @RequirePermission('pos.customers.view')
  scan(@Req() q: any, @Body(ValidatedBody(DR_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().scan(c, 'manual')); }

  /** side-by-side comparison of every member — every open is audited (fail-closed) */
  @Get('groups/:id') @RequirePermission('pos.customers.view')
  detail(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(() => this.r().detail(c, id, { fullContact: can(c, 'pos.customers.export'), audit: this.audit(c, 'duplicate_review.group_viewed', id, 'Duplicate group comparison opened') }));
  }

  /** Keep Separate needs the merge permission (it ends the review); the other decisions need customer edit */
  @Post('groups/:id/decision') @RequirePermission('pos.customers.edit')
  decide(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(DR_DECISION_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.edit');
    if (b?.decision === 'keep_separate') need(c, 'pos.customers.merge');
    return run(() => this.r().decide(c, id, b ?? {}, this.audit(c, 'duplicate_review.decided', id, `Duplicate review decision: ${String(b?.decision)}`)));
  }

  /** append-only reviewer note */
  @Post('groups/:id/notes') @RequirePermission('pos.customers.edit')
  note(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(DR_NOTE_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'pos.customers.edit'); return run(() => this.r().addNote(c, id, b ?? {})); }

  /** read-only merge impact: survivor / sources, rows that move, blockers, required acknowledgements, a state hash */
  @Post('groups/:id/preview') @RequirePermission('pos.customers.view')
  preview(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(DR_PREVIEW_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(() => this.r().preview(c, id, String(b?.survivorId ?? ''), { fullContact: can(c, 'pos.customers.export') }));
  }

  /** the confirmed, human-approved merge — re-validated on the server; idempotent on the request key */
  @Post('groups/:id/merge') @RequirePermission('pos.customers.merge')
  merge(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(DR_MERGE_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.merge');
    return run(() => this.r().confirm(c, id, b ?? {}, this.audit(c, 'duplicate_review.merged', id, 'Duplicate profiles merged after human review')));
  }

  /** extras Customer 08: completed merges (the reversible-merge records), newest first */
  @Get('merges') @RequirePermission('pos.customers.view')
  @ListQuery(MERGES)
  merges(@Req() q: any, @Query() f: any): Promise<CustomerMergeRecordPage> { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().merges(c, f ?? {})); }

  /** extras Customer 08: read-only — can this merge be undone right now (and if not, why) */
  @Get('merges/:id/unmerge-check') @RequirePermission('pos.customers.merge')
  unmergeCheck(@Req() q: any, @Param('id') id: string): Promise<CustomerUnmergeCheck> { const c = ctxFrom(q); need(c, 'pos.customers.merge'); return run(() => this.r().unmergeCheck(c, id)); }

  /** extras Customer 08: undo a completed merge from its snapshot — only while nothing touched the merged rows; audited */
  @Post('merges/:id/unmerge') @RequirePermission('pos.customers.merge')
  unmerge(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(DR_UNMERGE_BODY, { strict: true })) b: any): Promise<CustomerUnmergeResult> {
    const c = ctxFrom(q); need(c, 'pos.customers.merge');
    return run(() => this.r().unmerge(c, id, b ?? {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'customer.unmerged', resourceType: 'customer_merge', resourceId: id, summary: 'Customer merge undone from its snapshot', metadata: meta })));
  }

  /** review / merge history, newest first */
  @Get('history') @RequirePermission('pos.customers.view')
  @ListQuery(HISTORY)
  history(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().history(c, f ?? {})); }

  /** Check Duplicate Review System — read-only; records what it observed; never merges, edits, books or sends */
  @Post('check') @RequirePermission('pos.customers.view')
  check(@Req() q: any, @Body(ValidatedBody(DR_EMPTY_BODY, { strict: true })) _b: unknown) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().check(c)); }
}
