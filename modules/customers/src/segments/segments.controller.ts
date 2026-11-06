// segments.controller.ts — Customer Segments Complete Build Guide (30 Oct 2026): `/pos/marketing/segments/*`.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch / role from the session (req.ctx), never the body or query.
//   reads     pos.customers.view   summary · members · customers/:id/qualification · customers/:id (overlay, audited) ·
//                                  snapshots/day (stored history only)
//   audience  pos.marketing.view   GET audience-drafts/:id
//             pos.marketing.manage POST audience-drafts (create, audited fail-closed in the same transaction) ·
//                                  POST audience-drafts/:id/recheck · /discard · /campaign
// NOTHING here sends a message: an audience draft is handed to Campaign Center, whose own approval (activate with the
// confirmed estimate) and send-time consent checks decide whether anything is ever sent.
import { ListQuery, type ListQuerySpec } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { RETENTION_REPOSITORY } from '../retention/retention.controller';
import { RetentionRepository, RetentionError, PERIOD_PRESETS, isUuid, type RetentionContext } from '../retention/retention.repository';
import { SegmentsRepository, SegmentsError, SEGMENTS, SEGMENT_SORTS, SEGMENT_BASES, type SegmentFilters } from './segments.repository';
import { SEGMENT_AUDIENCE_DRAFT_BODY, SEGMENT_EMPTY_BODY, SEGMENT_DRAFT_CAMPAIGN_BODY } from '../request-schemas';

function ctxFrom(req: any): RetentionContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], salonName: c.salonName,
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds : null } : null };
}
function need(ctx: RetentionContext, perm: string) {
  if (!ctx?.tenantId || !ctx?.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
  if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], perm)) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot do this.' }, HttpStatus.FORBIDDEN);
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof SegmentsError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status);
    // the stored-history reads (snapshots/day) go through the retention snapshot reader: a bad date was a 500 (Nov 6 full run)
    if (e instanceof RetentionError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status);
    throw e;
  }
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
function filtersOf(f: any): SegmentFilters {
  return { segment: str(f?.segment), q: str(f?.q), sort: str(f?.sort), page: f?.page, pageSize: f?.pageSize, branch: str(f?.branch), preset: str(f?.preset), from: str(f?.from), to: str(f?.to),
    basis: str(f?.basis), minVisits: f?.minVisits, maxVisits: f?.maxVisits, minSpend: f?.minSpend, maxSpend: f?.maxSpend, tier: str(f?.tier), service: str(f?.service), sms: str(f?.sms), email: str(f?.email) };
}
const LIST_QUERY = { filters: { segment: { type: 'enum', values: SEGMENTS }, preset: { type: 'enum', values: PERIOD_PRESETS }, basis: { type: 'enum', values: SEGMENT_BASES },
  branch: { type: 'text', maxLength: 40 }, minVisits: { type: 'int', min: 0, max: 100000 }, maxVisits: { type: 'int', min: 0, max: 100000 }, minSpend: { type: 'int', min: 0, max: 1000000000 },
  maxSpend: { type: 'int', min: 0, max: 1000000000 }, tier: { type: 'text', maxLength: 40 }, service: { type: 'text', maxLength: 60 }, sms: { type: 'enum', values: ['eligible', 'not_eligible'] },
  email: { type: 'enum', values: ['eligible', 'not_eligible'] } },
  sorts: { created_desc: null, recent_visit: null, visits: null, spend: null, name_asc: null, name_desc: null } satisfies Record<(typeof SEGMENT_SORTS)[number], null>, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 1830 }, params: ['page'] } satisfies ListQuerySpec;
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/marketing/segments')
export class SegmentsController {
  private readonly repo: SegmentsRepository | null;
  constructor(@Inject(RETENTION_REPOSITORY) ret: RetentionRepository | null) { this.repo = ret ? new SegmentsRepository(ret.db, ret) : null; }
  private r(): SegmentsRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Customer Segments needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('summary') @RequirePermission('pos.customers.view')
  @ListQuery({ filters: { preset: { type: 'enum', values: PERIOD_PRESETS }, branch: { type: 'text', maxLength: 40 } }, search: false, dateRange: { maxDays: 1830 } })
  summary(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().summary(c, { preset: str(f?.preset), from: str(f?.from), to: str(f?.to), branch: str(f?.branch) })); }

  @Get('members') @RequirePermission('pos.customers.view')
  @ListQuery(LIST_QUERY)
  members(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().members(c, filtersOf(f))); }

  @Get('snapshots/day') @RequirePermission('pos.customers.view')
  @ListQuery({ filters: { date: { type: 'text', maxLength: 10 } }, search: false })
  snapshotDay(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().snapshotDay(c, str(f?.date))); }

  @Get('customers/:id/qualification') @RequirePermission('pos.customers.view')
  qualification(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().qualification(c, id)); }

  /** the customer history & marketing overlay (masked contact details) — a sensitive read, audited fail-closed */
  @Get('customers/:id') @RequirePermission('pos.customers.view')
  overlay(@Req() q: any, @Param('id') id: string) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(async () => {
      const out = await this.r().overlay(c, id);
      await recordAuditStrict(this.r().db, actor(c), { module: 'customers', action: 'segments.customer.viewed', resourceType: 'customer', resourceId: id, summary: 'Customer Segments overlay opened' });
      return out;
    });
  }

  @Post('audience-drafts') @RequirePermission('pos.marketing.manage')
  createDraft(@Req() q: any, @Body(ValidatedBody(SEGMENT_AUDIENCE_DRAFT_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.r().createDraft(c, { channel: b.channel, purpose: b.purpose === 'win_back' ? 'win_back' : 'general', selectionMode: b.selectionMode,
      customerIds: Array.isArray(b.customerIds) ? b.customerIds : null, filters: filtersOf(b.filters ?? {}), message: typeof b.message === 'string' ? b.message : null, idempotencyKey: String(b.idempotencyKey) },
      (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'segments.audience_draft.created', resourceType: 'segment_audience_draft', resourceId: String(meta.draftId),
        summary: `Audience draft (${String(meta.channel)}, ${String(meta.segment)}): ${String(meta.eligible)} eligible of ${String(meta.selected)} — not sent`, after: meta })));
  }

  @Get('audience-drafts/:id') @RequirePermission('pos.marketing.view')
  draft(@Req() q: any, @Param('id') id: string) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().draft(c, id)); }

  @Post('audience-drafts/:id/recheck') @RequirePermission('pos.marketing.manage')
  recheck(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(SEGMENT_EMPTY_BODY, { strict: true })) _b: any) { const c = ctxFrom(q); need(c, 'pos.marketing.manage'); return run(() => this.r().recheck(c, id)); }

  @Post('audience-drafts/:id/discard') @RequirePermission('pos.marketing.manage')
  discard(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(SEGMENT_EMPTY_BODY, { strict: true })) _b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(async () => {
      return this.r().discard(c, id, (trx) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'segments.audience_draft.discarded', resourceType: 'segment_audience_draft', resourceId: id, summary: 'Audience draft discarded' }));
    });
  }

  @Post('audience-drafts/:id/campaign') @RequirePermission('pos.marketing.manage')
  linkCampaign(@Req() q: any, @Param('id') id: string, @Body(ValidatedBody(SEGMENT_DRAFT_CAMPAIGN_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(async () => {
      return this.r().linkCampaign(c, id, String(b.campaignId), (trx) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'segments.audience_draft.linked', resourceType: 'segment_audience_draft', resourceId: id, summary: 'Audience draft handed to a Campaign Center draft (not sent)', after: { campaignId: b.campaignId } }));
    });
  }
}
