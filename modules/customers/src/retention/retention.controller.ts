// retention.controller.ts — Customer Retention mandate (Oct 29 2026): `/pos/retention/*`. Guards: TenantAuthGuard +
// RolePermissionGuard; tenant / branch / role from the session (req.ctx), never the body.
//   reads      pos.customers.view   summary · customers · customers/:id · sms/readiness
//   campaigns  pos.marketing.view   sms/campaigns · sms/campaigns/:id
//   send       pos.marketing.manage sms/preview · sms/campaigns (confirm)   — least privilege: the marketing capability
//   Complete Build Guide (Oct 30 2026):
//   recovery   pos.customers.view   recovery (recovered customers, observed post-campaign returns, trend)
//   settings   pos.customers.view   GET settings · PUT settings needs pos.settings.edit (audited fail-closed, same transaction)
//   export     pos.customers.export customers/export (async export contract) (audited fail-closed: requested → succeeded | failed | denied)
//   Four-Module Completion Guide (Oct 30 2026):
//   CR-01      pos.customers.view   snapshots/day · snapshots/members · snapshots/compare · snapshots/runs (READ the stored
//                                   snapshots; nothing is recomputed in a GET) · POST snapshots/backfill needs pos.settings.edit
//                                   (bounded, one durable job per day, audited fail-closed in the same transaction)
//   CR-02      ?branch= on summary / customers / export / recovery / SMS selection: the session's authorized branches only
//                                   (403 BRANCH_NOT_AUTHORIZED otherwise); customers stay tenant-wide
//   CR-03      pos.marketing.view   GET sms/pricing · PUT sms/pricing needs pos.settings.edit (append-only, effective-dated, audited)
import { ListQuery, type ListQuerySpec } from '@aipowersalon/database';
import type { WinbackPickedResult } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody, AsyncExport } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Put, Body, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { recordAuditStrict } from '@aipowersalon/audit';
import { logException } from '@aipowersalon/observability';
import { RetentionRepository, RetentionError, RETENTION_SEGMENTS, PERIOD_PRESETS, DATE_BASES, PRIORITY_BANDS, SEARCH_SCOPES, isUuid, type RetentionContext, type ListFilters } from './retention.repository';
import { RetentionSmsService } from './retention-sms.service';
import { RetentionSnapshotRepository, SNAPSHOT_SEGMENTS } from './retention-snapshots';
import { RetentionPricingRepository } from './retention-pricing';
import { RETENTION_SMS_PREVIEW_BODY, RETENTION_SMS_CONFIRM_BODY, RETENTION_SMS_CANCEL_BODY, RETENTION_SETTINGS_BODY, RETENTION_SNAPSHOT_BACKFILL_BODY, RETENTION_SMS_PRICING_BODY, WINBACK_EMPTY_BODY, WINBACK_PLAN_BODY, WINBACK_AUDIENCE_BODY, WINBACK_PICKED_BODY } from '../request-schemas';
import { WinBackCenter } from './winback-center';

export const RETENTION_REPOSITORY = 'RetentionRepository';
export const RETENTION_SMS_SERVICE = 'RetentionSmsService';

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
    if (e instanceof RetentionError) throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, e.status);
    throw e;
  }
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** the list's query → filters (period + date basis, band, SMS, visits); unknown values are dropped by the repository */
function listFilters(f: any): ListFilters {
  return { segment: str(f?.segment), q: str(f?.q), sort: str(f?.sort), preset: str(f?.preset), from: str(f?.from), to: str(f?.to), basis: str(f?.basis), band: str(f?.band),
    sms: str(f?.sms), email: str(f?.email), future: str(f?.future), minDays: f?.minDays, minVisits: f?.minVisits, page: f?.page, pageSize: f?.pageSize, branch: str(f?.branch),
    scope: str(f?.scope), category: str(f?.category), technician: str(f?.technician), spend: str(f?.spend), areaCode: str(f?.areaCode) };   // A19 Nov 6 · Win-Back §01 area code
}
const LIST_QUERY = { filters: { segment: { type: 'enum', values: RETENTION_SEGMENTS }, preset: { type: 'enum', values: PERIOD_PRESETS },
  basis: { type: 'enum', values: DATE_BASES }, band: { type: 'enum', values: PRIORITY_BANDS }, sms: { type: 'enum', values: ['eligible', 'not_eligible'] }, minVisits: { type: 'int', min: 0, max: 1000 },
  scope: { type: 'enum', values: SEARCH_SCOPES }, category: { type: 'uuid' }, technician: { type: 'uuid' }, spend: { type: 'enum', values: ['low', 'mid', 'high'] },
  email: { type: 'enum', values: ['eligible', 'not_eligible', 'opted_out'] }, future: { type: 'enum', values: ['yes', 'no'] }, minDays: { type: 'int', min: 1, max: 3650 },
  branch: { type: 'text', maxLength: 40 }, areaCode: { type: 'text', maxLength: 3 } },
  sorts: { priority: null, created_desc: null, oldest_visit: null, newest_visit: null, name: null, spend: null, visits: null }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 1830 }, params: ['page'] } satisfies ListQuerySpec;
const actor = (c: RetentionContext) => ({ tenantId: c.tenantId, branchId: isUuid(c.branchId) ? c.branchId : null, userId: c.userId, role: c.role });

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/retention')
export class RetentionController {
  private readonly snaps: RetentionSnapshotRepository | null; private readonly pricing: RetentionPricingRepository | null;
  constructor(@Inject(RETENTION_REPOSITORY) private readonly repo: RetentionRepository | null, @Inject(RETENTION_SMS_SERVICE) private readonly sms: RetentionSmsService | null) {
    this.snaps = repo ? new RetentionSnapshotRepository(repo.db) : null; this.pricing = repo ? new RetentionPricingRepository(repo.db) : null;
    this.wb = repo ? new WinBackCenter(repo.db, repo) : null;
  }
  private readonly wb: WinBackCenter | null;
  private w(): WinBackCenter { if (!this.wb) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Retention needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.wb; }
  private sn(): RetentionSnapshotRepository { if (!this.snaps) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Retention needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.snaps; }
  private pr(): RetentionPricingRepository { if (!this.pricing) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Retention needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.pricing; }
  private r(): RetentionRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Retention needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private s(): RetentionSmsService { if (!this.sms) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Retention needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.sms; }

  @Get('summary') @RequirePermission('pos.customers.view')
  @ListQuery({ filters: { preset: { type: 'enum', values: PERIOD_PRESETS }, branch: { type: 'text', maxLength: 40 } }, search: false, dateRange: { maxDays: 1830 } })
  summary(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().summary(c, { preset: str(f?.preset), from: str(f?.from), to: str(f?.to), branch: str(f?.branch) })); }

  @Get('recovery') @RequirePermission('pos.customers.view')
  @ListQuery({ filters: { preset: { type: 'enum', values: PERIOD_PRESETS }, branch: { type: 'text', maxLength: 40 } }, search: false, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 1830 }, params: ['page'] })
  recovery(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().recovery(c, { preset: str(f?.preset), from: str(f?.from), to: str(f?.to), branch: str(f?.branch), page: f?.page, pageSize: f?.pageSize })); }

  @Get('settings') @RequirePermission('pos.customers.view')
  settings(@Req() q: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(async () => ({ ...(await this.r().settings(c)), canEdit: hasPermission(c as Parameters<typeof hasPermission>[0], 'pos.settings.edit') }));
  }

  @Put('settings') @RequirePermission('pos.settings.edit')
  saveSettings(@Req() q: any, @Body(ValidatedBody(RETENTION_SETTINGS_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.settings.edit');
    return run(() => this.r().updateSettings(c, b ?? {}, (trx, before, after) => recordAuditStrict(trx, actor(c), {
      module: 'retention', action: 'retention.settings.updated', resourceType: 'tenant_retention_settings', resourceId: c.tenantId, summary: `Retention thresholds v${after.version}`,
      before: { riskDays: before.riskDays, approachingDays: before.approachingDays, observationWindowDays: before.observationWindowDays, version: before.version },
      after: { riskDays: after.riskDays, approachingDays: after.approachingDays, observationWindowDays: after.observationWindowDays, version: after.version } })));
  }

  // ── Win-Back guide §09 Check Retention Data (READ-ONLY; every run recorded) ─────────────────────────────────────────
  @Get('health') @RequirePermission('pos.customers.view')
  health(@Req() q: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.w().lastHealth(c)); }

  @Post('health-check') @RequirePermission('pos.customers.view')
  healthCheck(@Req() q: any, @Body(ValidatedBody(WINBACK_EMPTY_BODY, { strict: true })) _b: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.w().runHealth(c)); }

  // ── Win-Back guide §10 AI Win-Back Assistant: suggestions + an UNSENT audience; Campaign Center approves and sends ──────
  @Post('winback/plan') @RequirePermission('pos.marketing.view')
  winbackPlan(@Req() q: any, @Body(ValidatedBody(WINBACK_PLAN_BODY, { strict: true })) b: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.w().plan(c, b || {})); }

  /** A19 Nov 6: Add to eligible audience — the picked customers become an unsent draft (Campaign Center sends) */
  @Post('winback/audience/picked') @RequirePermission('pos.marketing.manage')
  winbackPicked(@Req() q: any, @Body(ValidatedBody(WINBACK_PICKED_BODY, { strict: true })) b: any): Promise<WinbackPickedResult> {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.w().addToAudience(c, b || {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'retention.winback.picked_audience_saved',
      resourceType: 'segment_audience_draft', resourceId: String(meta.draftId), summary: `Win-back audience from picked customers: ${String(meta.eligible)} eligible of ${String(meta.selected)} — not sent`, after: meta }))) as Promise<WinbackPickedResult>;
  }

  @Post('winback/audience') @RequirePermission('pos.marketing.manage')
  winbackAudience(@Req() q: any, @Body(ValidatedBody(WINBACK_AUDIENCE_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.w().saveAudience(c, b || {}, (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'customers', action: 'retention.winback.audience_saved',
      resourceType: 'segment_audience_draft', resourceId: String(meta.draftId), summary: `Win-back audience (${String(meta.goal)}, ${String(meta.channel)}): ${String(meta.eligible)} eligible of ${String(meta.selected)} — not sent`, after: meta })));
  }

  @Get('customers') @RequirePermission('pos.customers.view')
  @ListQuery(LIST_QUERY)
  customers(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.r().customers(c, listFilters(f))); }

  /** the list as filtered, as CSV (masked phones) through the ONE async export contract. Fail-closed audit:
   *  requested → succeeded | failed; denied (recorded) without pos.customers.export; no audit row → no file. */
  @AsyncExport({ kind: 'pos.retention.export' }) @Get('customers/export') @RequirePermission('pos.customers.view') @ListQuery({ ...LIST_QUERY, maxLimit: 5000, defaultLimit: 5000 })
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Cache-Control', 'no-store')
  exportCsv(@Req() q: any, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    const flt = listFilters(f); const meta = { segment: flt.segment ?? 'all', preset: flt.preset ?? null, from: flt.from ?? null, to: flt.to ?? null, basis: flt.basis ?? null, band: flt.band ?? null, sms: flt.sms ?? null, hasSearch: !!flt.q };
    const base = { module: 'retention', resourceType: 'retention_export', resourceId: null };
    const db = this.r().db;
    return run(async () => {
      if (!hasPermission(c as Parameters<typeof hasPermission>[0], 'pos.customers.export')) {
        await recordAuditStrict(db, actor(c), { ...base, action: 'retention.export.denied', status: 'denied', severity: 'warning', summary: 'Retention list export denied', metadata: { ...meta, permissionMissing: 'pos.customers.export' } })
          .catch((x) => logException(x, { where: 'retention.export.denial_not_recorded', tenantId: c.tenantId }));
        throw new HttpException({ code: 'PERMISSION_DENIED', message: 'Your role cannot export customers.' }, HttpStatus.FORBIDDEN);
      }
      await recordAuditStrict(db, actor(c), { ...base, action: 'retention.export.requested', summary: 'Retention list export requested', metadata: meta });
      try {
        const out = await this.r().exportCsv(c, flt);
        await recordAuditStrict(db, actor(c), { ...base, action: 'retention.export.succeeded', summary: `Retention list exported (${out.rows} rows)`, metadata: { ...meta, rows: out.rows } });
        q?.res?.setHeader?.('Content-Disposition', `attachment; filename="${out.filename}"`);
        return out.csv;
      } catch (e) {
        await recordAuditStrict(db, actor(c), { ...base, action: 'retention.export.failed', status: 'failure', summary: 'Retention list export failed', metadata: meta })
          .catch((x) => logException(x, { where: 'retention.export.failed_not_recorded', tenantId: c.tenantId }));
        throw e;
      }
    });
  }

  @Get('customers/:customerId') @RequirePermission('pos.customers.view')
  customer(@Req() q: any, @Param('customerId') id: string) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(async () => { const s = await this.r().customerSnapshot(c, id); if (!s) throw new RetentionError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404); return s; });
  }

  @Get('sms/readiness') @RequirePermission('pos.customers.view')
  readiness(@Req() q: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(async () => ({ sender: await this.r().sender(c), quietHours: await this.r().quietUntil(c), canSend: hasPermission(c as Parameters<typeof hasPermission>[0], 'pos.marketing.manage') }));
  }

  @Post('sms/preview') @RequirePermission('pos.marketing.manage')
  preview(@Req() q: any, @Body(ValidatedBody(RETENTION_SMS_PREVIEW_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.s().preview(c, { customerIds: Array.isArray(b?.customerIds) ? b.customerIds.map(String) : undefined,
      // the FULL filter set (period, basis, band, SMS, visits, branch) — the server resolves "all matching" against it
      selection: b?.selection ? { ...listFilters(b.selection), excludeIds: Array.isArray(b.selection.excludeIds) ? b.selection.excludeIds.map(String) : [] } : undefined,
      body: String(b?.body ?? ''), label: str(b?.label), audience: b?.audience === 'first_visit' ? 'first_visit' : 'win_back' }));
  }

  @Post('sms/campaigns') @RequirePermission('pos.marketing.manage')
  confirm(@Req() q: any, @Body(ValidatedBody(RETENTION_SMS_CONFIRM_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.s().confirm(c, { previewId: String(b?.previewId ?? ''), idempotencyKey: String(b?.idempotencyKey ?? ''), acceptChanges: b?.acceptChanges === true, label: str(b?.label) }));
  }

  /** C5 audit (Nov 4 2026): stop a queued / sending campaign (texts already sent stay sent) — audited with its reason */
  @Post('sms/campaigns/:campaignId/cancel') @RequirePermission('pos.marketing.manage')
  cancelCampaign(@Req() q: any, @Param('campaignId') id: string, @Body(ValidatedBody(RETENTION_SMS_CANCEL_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.manage');
    return run(() => this.s().cancel(c, id, String(b?.reason ?? ''), (trx, meta) => recordAuditStrict(trx, actor(c), { module: 'retention', action: 'retention.sms_campaign.canceled',
      resourceType: 'retention_sms_campaign', resourceId: id, summary: `Win-back campaign canceled — ${String(meta.stoppedTexts)} unsent text(s) stopped`, after: meta })));
  }

  // ── CR-01 historical snapshots (read the stored rows; the job computes them) ───────────────────────────────────────────
  @Get('snapshots/day') @RequirePermission('pos.customers.view')
  snapshotDay(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.sn().day(c, str(f?.date), str(f?.branch))); }

  @Get('snapshots/members') @RequirePermission('pos.customers.view')
  @ListQuery({ filters: { segment: { type: 'enum', values: SNAPSHOT_SEGMENTS }, date: { type: 'date' }, branch: { type: 'text', maxLength: 40 } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  snapshotMembers(@Req() q: any, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.customers.view');
    return run(() => this.sn().members(c, { date: str(f?.date), segment: str(f?.segment), q: str(f?.q), branch: str(f?.branch), page: f?.page, pageSize: f?.pageSize }));
  }

  @Get('snapshots/compare') @RequirePermission('pos.customers.view')
  snapshotCompare(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.sn().compare(c, str(f?.a), str(f?.b), str(f?.branch))); }

  @Get('snapshots/runs') @RequirePermission('pos.customers.view')
  @ListQuery({ search: false, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 400 }, params: ['page'] })
  snapshotRuns(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.customers.view'); return run(() => this.sn().runs(c, { from: str(f?.from), to: str(f?.to), page: f?.page, pageSize: f?.pageSize })); }

  @Post('snapshots/backfill') @RequirePermission('pos.settings.edit')
  snapshotBackfill(@Req() q: any, @Body(ValidatedBody(RETENTION_SNAPSHOT_BACKFILL_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.settings.edit');
    return run(() => this.sn().requestBackfill(c, { from: b?.from, to: b?.to }, (trx, meta) => recordAuditStrict(trx, actor(c), {
      module: 'retention', action: 'retention.snapshot.backfill.requested', resourceType: 'customer_retention_snapshot_runs', resourceId: null,
      summary: `Retention snapshot backfill ${String(meta.from)} → ${String(meta.to)} (${String(meta.days)} days)`, metadata: meta })));
  }

  // ── CR-03 SMS price (effective-dated; the preview's estimate reads the price in force) ───────────────────────────────────
  @Get('sms/pricing') @RequirePermission('pos.marketing.view')
  smsPricing(@Req() q: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    return run(async () => ({ ...(await this.pr().overview(c)), canEdit: hasPermission(c as Parameters<typeof hasPermission>[0], 'pos.settings.edit') }));
  }

  @Put('sms/pricing') @RequirePermission('pos.settings.edit')
  setSmsPricing(@Req() q: any, @Body(ValidatedBody(RETENTION_SMS_PRICING_BODY, { strict: true })) b: any) {
    const c = ctxFrom(q); need(c, 'pos.settings.edit');
    return run(() => this.pr().setPricing(c, b ?? {}, (trx, before, after) => recordAuditStrict(trx, actor(c), {
      module: 'retention', action: 'retention.sms_pricing.set', resourceType: 'tenant_sms_pricing', resourceId: after.pricingId,
      summary: `SMS price ${after.retailPricePerSegment} ${after.currency}/segment from ${after.effectiveFrom.slice(0, 10)}`,
      before: before ? { retailPricePerSegment: before.retailPricePerSegment, carrierFeePerSegment: before.carrierFeePerSegment, taxRatePercent: before.taxRatePercent, currency: before.currency, effectiveFrom: before.effectiveFrom } : null,
      after: { retailPricePerSegment: after.retailPricePerSegment, carrierFeePerSegment: after.carrierFeePerSegment, taxRatePercent: after.taxRatePercent, currency: after.currency, effectiveFrom: after.effectiveFrom } })));
  }

  @Get('sms/campaigns') @RequirePermission('pos.marketing.view') @ListQuery({ search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  campaigns(@Req() q: any, @Query() f: any) { const c = ctxFrom(q); need(c, 'pos.marketing.view'); return run(() => this.r().listCampaigns(c, { page: f?.page, pageSize: f?.pageSize })); }

  @Get('sms/campaigns/:campaignId') @RequirePermission('pos.marketing.view')
  @ListQuery({ filters: { status: { type: 'enum', values: ['excluded', 'queued', 'sent', 'blocked', 'failed', 'unknown', 'delivered', 'undelivered'] } }, search: false, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  campaign(@Req() q: any, @Param('campaignId') id: string, @Query() f: any) {
    const c = ctxFrom(q); need(c, 'pos.marketing.view');
    return run(async () => { const d = await this.r().campaignDetail(c, id, { page: f?.page, pageSize: f?.pageSize, status: str(f?.status) }); if (!d) throw new RetentionError('Campaign not found.', 'CAMPAIGN_NOT_FOUND', 404); return d; });
  }
}
