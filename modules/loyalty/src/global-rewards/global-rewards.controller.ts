// global-rewards.controller.ts — the Global Loyalty & Rewards Network's HTTP surface (LoyaltyTokens.pdf §10.2,
// LoyaltyRules.pdf §4.2–§4.3). Tenant, branch and actor come from the session (req.ctx), never a body or a path.
//
// Salon (Front Desk POS / Owner):                                   permission
//   GET  pos/loyalty/network/state                                  pos.customers.view   active mode + true source, wallet, flags
//   GET  pos/loyalty/network/earning/history                        pos.customers.view
//   POST pos/loyalty/network/earning/preview                        pos.customers.view   $5–$100 token-cost preview (writes nothing)
//   POST pos/loyalty/network/earning/drafts                         pos.settings.edit    save / update a CUSTOM draft
//   POST pos/loyalty/network/earning/drafts/:id/discard             pos.settings.edit
//   POST pos/loyalty/network/earning/activate                       pos.settings.edit + STEP-UP
//   POST pos/loyalty/network/earning/use-global                     pos.settings.edit + explicit confirm
//   POST pos/loyalty/network/earning/versions/:id/cancel            pos.settings.edit    (only a change not yet started)
//   GET  pos/loyalty/network/wallet | wallet/ledger | purchases | purchases/:id
//   GET  pos/loyalty/network/reimbursements                         pos.customers.view   what the network owes this salon (read-only)
//   GET  pos/loyalty/network/finance-export?from&to                 pos.settings.edit    owner finance audit trail CSV (async export, audited)
//   POST pos/loyalty/network/purchases                              pos.settings.edit + STEP-UP + Idempotency-Key
// Super Admin (English only):                                       super_admin.billing.view / .manage (+ STEP-UP to change)
//   GET  super-admin/loyalty-network/overview | enrollments | purchases | reconciliation
//   POST super-admin/loyalty-network/global-rules/preview           (view; writes nothing)
//   POST super-admin/loyalty-network/global-rules | global-rules/:id/cancel | program | enrollments/:tenantId
//   POST super-admin/loyalty-network/purchases/:id/sandbox-advance  (sandbox provider only)
import { Body, Controller, Get, Header, HttpException, Inject, Optional, Param, Post, Query, Req, UseGuards, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PLATFORM_APPROVALS_TOKEN, type ApprovalsLike } from './global-rewards-dual-control';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody, SuperAdminGuard, AsyncExport, RequireFeature } from '@aipowersalon/permissions/guards';
import { ListQuery, type ListQuerySpec } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';
import type { RewardsSalonPayables, RewardsNetworkFinanceExport } from '@aipowersalon/api-contracts/tenant';
import type { RewardsIdempotencyPage } from '@aipowersalon/api-contracts/platform';
import { GlobalRewardsService } from './global-rewards.service';
import { GlobalRewardsError, type PurchaseStatus } from './global-rewards-core';
import type { GrCtx } from './global-rewards.repository';
import { GR_PREVIEW_BODY, GR_DRAFT_BODY, GR_ACTIVATE_BODY, GR_USE_GLOBAL_BODY, GR_BUY_TOKENS_BODY, GR_EMPTY_BODY, GR_GLOBAL_RULE_BODY, GR_PROGRAM_BODY,
  GR_ENROLLMENT_BODY, GR_SANDBOX_ADVANCE_BODY, GR_REVIEW_BODY, GR_PAYABLE_HOLD_BODY, GR_ACCOUNT_STATUS_BODY, GR_WALLET_LEVELS_BODY } from '../request-schemas';

export const GLOBAL_REWARDS_SERVICE = 'GlobalRewardsService';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function grCtx(req: any): GrCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role ?? null, permissions: c.permissions || [] };
}
/** a coded refusal → its registry status + code; anything else is rethrown */
export async function runGr<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof GlobalRewardsError) {
      const status = isRegisteredCode(e.code) ? ERROR_REGISTRY[e.code as keyof typeof ERROR_REGISTRY].status : e.status;
      throw new HttpException({ code: e.code, message: e.message, details: e.details ?? {} }, status);
    }
    throw e;
  }
}
const id = (v: string): string => { if (!UUID.test(String(v ?? ''))) throw new GlobalRewardsError('That item was not found.', 'RESOURCE_NOT_FOUND', 404); return v; };
const PAGE = { filters: {}, search: false, maxLimit: 50, defaultLimit: 20, params: ['page', 'pageSize'] } satisfies ListQuerySpec;
const pg = (q: any) => ({ page: Number(q?.page) || 1, size: Number(q?.pageSize) || 20 });

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('loyalty')   // plan-gated like the salon's own loyalty program (observe by default, feature-entitlement.ts)
@Controller('pos/loyalty/network')
export class GlobalRewardsController {
  constructor(@Inject(GLOBAL_REWARDS_SERVICE) private readonly svc: GlobalRewardsService | null) {}
  private s(): GlobalRewardsService { if (!this.svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The rewards network needs the database.' }, 503); return this.svc; }

  @Get('state') @RequirePermission('pos.customers.view')
  state(@Req() r: any) { return runGr(() => this.s().state(grCtx(r))); }
  @Get('earning/history') @RequirePermission('pos.customers.view')
  history(@Req() r: any) { return runGr(() => this.s().history(grCtx(r))); }
  @Post('earning/preview') @RequirePermission('pos.customers.view')
  preview(@Req() r: any, @Body(ValidatedBody(GR_PREVIEW_BODY, { strict: true })) b: any) { return runGr(() => this.s().preview(grCtx(r), b ?? {})); }
  @Post('earning/drafts') @RequirePermission('pos.settings.edit')
  draft(@Req() r: any, @Body(ValidatedBody(GR_DRAFT_BODY, { strict: true })) b: any) { return runGr(() => this.s().saveDraft(grCtx(r), b ?? {})); }
  @Post('earning/drafts/:id/discard') @RequirePermission('pos.settings.edit')
  discard(@Req() r: any, @Param('id') draftId: string, @Body(ValidatedBody(GR_EMPTY_BODY, { strict: true })) _b: any) { return runGr(() => this.s().discardDraft(grCtx(r), id(draftId))); }
  // addendum §4.3–§4.4: a financially material activation needs a fresh step-up
  @RequireStepUp() @Post('earning/activate') @RequirePermission('pos.settings.edit')
  activate(@Req() r: any, @Body(ValidatedBody(GR_ACTIVATE_BODY, { strict: true })) b: any) { return runGr(() => this.s().activate(grCtx(r), b ?? {})); }
  @Post('earning/use-global') @RequirePermission('pos.settings.edit')
  useGlobal(@Req() r: any, @Body(ValidatedBody(GR_USE_GLOBAL_BODY, { strict: true })) b: any) { return runGr(() => this.s().useGlobal(grCtx(r), b ?? {})); }
  @Post('earning/versions/:id/cancel') @RequirePermission('pos.settings.edit')
  cancel(@Req() r: any, @Param('id') versionId: string, @Body(ValidatedBody(GR_EMPTY_BODY, { strict: true })) _b: any) { return runGr(() => this.s().cancelScheduled(grCtx(r), id(versionId))); }

  @Get('wallet') @RequirePermission('pos.customers.view')
  wallet(@Req() r: any) { return runGr(() => this.s().wallet(grCtx(r))); }
  // C1 audit (Nov 4 2026) §5.6: the salon's own low / critical token-balance warnings (owner)
  @Post('wallet/levels') @RequirePermission('pos.settings.edit')
  walletLevels(@Req() r: any, @Body(ValidatedBody(GR_WALLET_LEVELS_BODY, { strict: true })) b: any) { return runGr(() => this.s().setWalletLevels(grCtx(r), b ?? {})); }
  @Get('wallet/ledger') @RequirePermission('pos.customers.view') @ListQuery(PAGE)
  ledger(@Req() r: any, @Query() q: any) { const p = pg(q); return runGr(() => this.s().ledger(grCtx(r), p.page, p.size)); }
  @Get('purchases') @RequirePermission('pos.customers.view') @ListQuery(PAGE)
  purchases(@Req() r: any, @Query() q: any) { const p = pg(q); return runGr(() => this.s().purchases(grCtx(r), p.page, p.size)); }
  @Get('purchases/:id') @RequirePermission('pos.customers.view')
  purchase(@Req() r: any, @Param('id') pid: string) { return runGr(() => this.s().purchase(grCtx(r), id(pid))); }
  // extras GLOBAL LOYALTY REWARDS 07 / 10: this salon's payables with provider + journal evidence and settlement freshness (read-only)
  @Get('reimbursements') @RequirePermission('pos.customers.view') @ListQuery({ filters: { status: { type: 'enum', values: ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'ON_HOLD', 'ADJUSTED', 'OFFSET'] } }, search: false, maxLimit: 25, defaultLimit: 10, params: ['page', 'pageSize'] })
  reimbursements(@Req() r: any, @Query() q: any): Promise<RewardsSalonPayables> {
    return runGr(() => this.s().reimbursements(grCtx(r), { status: q?.status || null, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 10 }));
  }
  // extras GLOBAL LOYALTY REWARDS 16: the owner's finance audit trail — purchases, allocations, payables + exceptions (ONE async export contract)
  @AsyncExport({ kind: 'pos.loyalty-network.finance-export' })
  @Get('finance-export') @RequirePermission('pos.settings.edit') @ListQuery({ filters: {}, search: false, dateRange: { maxDays: 400 } })
  financeExport(@Req() r: any, @Query() q: any): Promise<RewardsNetworkFinanceExport> {
    return runGr(() => this.s().financeExport(grCtx(r), { from: String(q?.from ?? ''), to: String(q?.to ?? '') }));
  }
  // guide §3.3 / §5.2: Owner (or a manager explicitly granted settings access), a fresh step-up, one request key per purchase
  @RequireStepUp() @Post('purchases') @RequirePermission('pos.settings.edit') @Idempotent({ required: true })
  buy(@Req() r: any, @Body(ValidatedBody(GR_BUY_TOKENS_BODY, { strict: true })) b: any) {
    return runGr(() => this.s().buyTokens(grCtx(r), b?.tokens, String(r?.headers?.['idempotency-key'] ?? '')));
  }
}

@UseGuards(SuperAdminGuard, RolePermissionGuard)
@Controller('super-admin/loyalty-network')
export class SuperAdminGlobalRewardsController implements OnModuleInit {
  constructor(@Inject(GLOBAL_REWARDS_SERVICE) private readonly svc: GlobalRewardsService | null, @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef | null) {}
  /** Batch C decision 1: bind the platform maker/checker (by token — loyalty does not import the platform module). */
  onModuleInit(): void {
    let a: ApprovalsLike | null = null;
    try { a = (this.moduleRef?.get(PLATFORM_APPROVALS_TOKEN, { strict: false }) as ApprovalsLike) ?? null; } catch { a = null; }   // a process without the platform module: changes run directly, as with the policy off
    this.svc?.useApprovals(a);
  }
  private who(r: any) { return { userId: String(r?.ctx?.userId ?? '') || null, permissions: (r?.ctx?.permissions ?? []) as string[] }; }
  private s(): GlobalRewardsService { if (!this.svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The rewards network needs the database.' }, 503); return this.svc; }
  private actor(r: any): string { return String(r?.ctx?.userId ?? ''); }

  @Get('overview') @RequirePermission('super_admin.billing.view')
  overview() { return runGr(() => this.s().adminOverview()); }
  @Get('reconciliation') @RequirePermission('super_admin.billing.view')
  reconciliation() { return runGr(() => this.s().reconciliation()); }
  @Get('enrollments') @RequirePermission('super_admin.billing.view') @ListQuery({ filters: {}, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 20, params: ['page', 'pageSize'] })
  enrollments(@Query() q: any) { return runGr(() => this.s().enrollments({ search: q?.q ?? null, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 20 })); }
  @Get('purchases') @RequirePermission('super_admin.billing.view') @ListQuery(PAGE)
  purchases(@Query() q: any) { const p = pg(q); return runGr(() => this.s().allPurchases(p.page, p.size)); }

  // read-only: what a proposed global rule would cost per sale and which salons it reaches (writes nothing)
  @Post('global-rules/preview') @RequirePermission('super_admin.billing.view')
  previewGlobal(@Body(ValidatedBody(GR_GLOBAL_RULE_BODY, { strict: true })) b: any) { return runGr(() => this.s().previewGlobal(b ?? {})); }
  @RequireStepUp() @Post('global-rules') @RequirePermission('super_admin.billing.manage')
  publish(@Req() r: any, @Body(ValidatedBody(GR_GLOBAL_RULE_BODY, { strict: true })) b: any) { return runGr(() => this.s().publishGlobalControlled(b ?? {}, this.who(r))); }
  @RequireStepUp() @Post('global-rules/:id/cancel') @RequirePermission('super_admin.billing.manage')
  cancelRule(@Req() r: any, @Param('id') vid: string, @Body(ValidatedBody(GR_EMPTY_BODY, { strict: true })) _b: any) { return runGr(() => this.s().cancelGlobal(id(vid), this.actor(r))); }
  @RequireStepUp() @Post('program') @RequirePermission('super_admin.billing.manage')
  program(@Req() r: any, @Body(ValidatedBody(GR_PROGRAM_BODY, { strict: true })) b: any) {
    const { expectedVersion, reason, ...patch } = b ?? {};
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
    return runGr(() => this.s().updateProgramControlled(clean, Number(expectedVersion), reason ?? null, this.who(r)));
  }
  @RequireStepUp() @Post('enrollments/:tenantId') @RequirePermission('super_admin.billing.manage')
  enroll(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(GR_ENROLLMENT_BODY, { strict: true })) b: any) {
    const to = String(b?.status ?? '');
    if (!['enrolled', 'suspended', 'withdrawn'].includes(to)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'status must be enrolled, suspended or withdrawn.' }, 400);
    return runGr(() => this.s().setEnrollment(id(tenantId), to as 'enrolled', { earningSuspended: b?.earningSuspended ?? undefined, purchasingSuspended: b?.purchasingSuspended ?? undefined, reason: String(b?.reason ?? ''), actorUserId: this.actor(r) }));
  }
  // ── Final Completion guide §07–§09: integrity dashboard, books check, payables, fraud review ─────────────────────────
  @Get('integrity') @RequirePermission('super_admin.billing.view')
  integrity() { return runGr(() => this.s().integrity()); }
  @Get('books-check/runs') @RequirePermission('super_admin.billing.view') @ListQuery(PAGE)
  books(@Query() q: any) { return runGr(() => this.s().books({ page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 25 })); }
  @Get('books-check/findings') @RequirePermission('super_admin.billing.view') @ListQuery({ filters: { runId: { type: 'uuid' }, tenantId: { type: 'uuid' }, outcome: { type: 'enum', values: ['PASS', 'WARNING', 'FAILED', 'UNKNOWN'] }, reviewStatus: { type: 'enum', values: ['OPEN', 'INVESTIGATING', 'RESOLVED', 'ACCEPTED'] } }, search: false, maxLimit: 100, defaultLimit: 25, params: ['page', 'pageSize'] })
  findings(@Query() q: any) { return runGr(() => this.s().findings({ runId: q?.runId || null, tenantId: q?.tenantId || null, outcome: q?.outcome || null, reviewStatus: q?.reviewStatus || null, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 25 })); }
  // on the ONE async export contract (Prefer: respond-async → 202 → worker re-runs this handler as the same person)
  @AsyncExport({ kind: 'super-admin.loyalty-network.findings-export', estimate: { table: 'rewards_recon_findings', platform: true } })
  @Get('books-check/findings.csv') @RequirePermission('super_admin.billing.view') @Header('Content-Type', 'text/csv; charset=utf-8') @ListQuery({ filters: { runId: { type: 'uuid' } }, search: false })
  findingsCsv(@Req() r: any, @Query() q: any) { return runGr(() => this.s().findingsCsv(this.actor(r), q?.runId || null)); }
  // the manual "Run check": the SAME checker the daily job runs; reads the books and writes only its own findings
  @Post('books-check/run') @RequirePermission('super_admin.billing.manage')
  runBooks(@Req() r: any, @Body(ValidatedBody(GR_EMPTY_BODY, { strict: true })) _b: any) { return runGr(() => this.s().runBooksCheckNow(this.actor(r))); }
  @Post('books-check/findings/:id/review') @RequirePermission('super_admin.billing.manage')
  reviewFinding(@Req() r: any, @Param('id') fid: string, @Body(ValidatedBody(GR_REVIEW_BODY, { strict: true })) b: any) { return runGr(() => this.s().reviewFinding(id(fid), String(b?.to ?? ''), String(b?.note ?? ''), this.actor(r))); }
  @Get('payables') @RequirePermission('super_admin.billing.view') @ListQuery({ filters: { tenantId: { type: 'uuid' }, status: { type: 'enum', values: ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'ON_HOLD', 'ADJUSTED', 'OFFSET'] } }, search: false, maxLimit: 100, defaultLimit: 25, params: ['page', 'pageSize'] })
  payables(@Query() q: any) { return runGr(() => this.s().payables({ status: q?.status || null, tenantId: q?.tenantId || null, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 25 })); }
  @Get('redemptions/:id/lineage') @RequirePermission('super_admin.billing.view')
  lineage(@Param('id') rid: string) { return runGr(() => this.s().lineage(id(rid))); }
  @RequireStepUp() @Post('payables/:id/eligible') @RequirePermission('super_admin.billing.manage')
  eligible(@Req() r: any, @Param('id') pid: string, @Body(ValidatedBody(GR_EMPTY_BODY, { strict: true })) _b: any) { return runGr(() => this.s().markEligible(id(pid), this.actor(r))); }
  @RequireStepUp() @Post('payables/:id/hold') @RequirePermission('super_admin.billing.manage')
  holdPayable(@Req() r: any, @Param('id') pid: string, @Body(ValidatedBody(GR_PAYABLE_HOLD_BODY, { strict: true })) b: any) { return runGr(() => this.s().holdPayable(id(pid), String(b?.reason ?? ''), this.actor(r))); }
  // money out: step-up + one request key; with no approved payout provider this answers PAYOUT_PROVIDER_UNAVAILABLE
  @RequireStepUp() @Post('payables/:id/payout') @RequirePermission('super_admin.billing.manage') @Idempotent({ required: true })
  payout(@Req() r: any, @Param('id') pid: string, @Body(ValidatedBody(GR_EMPTY_BODY, { strict: true })) _b: any) { return runGr(() => this.s().requestPayout(id(pid), this.actor(r), String(r?.headers?.['idempotency-key'] ?? ''))); }
  // C1 audit (Nov 4 2026) §4.4: pause / lift the pause on the rewards account an alert is about (step-up, reason, audited) —
  // the console never sees the customer's identity id, only the alert
  @RequireStepUp() @Post('fraud-alerts/:id/account-status') @RequirePermission('super_admin.billing.manage')
  accountStatus(@Req() r: any, @Param('id') aid: string, @Body(ValidatedBody(GR_ACCOUNT_STATUS_BODY, { strict: true })) b: any) {
    return runGr(() => this.s().setAccountStatusForAlert(id(aid), String(b?.status ?? '') as 'suspended', String(b?.reason ?? ''), this.actor(r)));
  }
  @Get('fraud-alerts') @RequirePermission('super_admin.billing.view') @ListQuery({ filters: { status: { type: 'enum', values: ['OPEN', 'INVESTIGATING', 'DISMISSED', 'CONFIRMED'] } }, search: false, maxLimit: 100, defaultLimit: 25, params: ['page', 'pageSize'] })
  fraudAlerts(@Query() q: any) { return runGr(() => this.s().fraudAlerts({ status: q?.status || null, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 25 })); }
  /** extras GLOBAL LOYALTY REWARDS 11 (round 10): the read-only idempotency conflict center — every repeated request key */
  @Get('idempotency') @RequirePermission('super_admin.billing.view') @ListQuery({ filters: { outcome: { type: 'enum', values: ['replay', 'conflict'] }, scope: { type: 'enum', values: ['token_purchase', 'redemption'] } }, search: false, maxLimit: 100, defaultLimit: 25, params: ['page', 'pageSize'] })
  idempotencyEvents(@Query() q: any): Promise<RewardsIdempotencyPage> { return runGr(() => this.s().idempotencyEvents({ outcome: q?.outcome || null, scope: q?.scope || null, page: Number(q?.page) || 1, pageSize: Number(q?.pageSize) || 25 })); }
  @Post('fraud-alerts/:id/review') @RequirePermission('super_admin.billing.manage')
  reviewFraud(@Req() r: any, @Param('id') aid: string, @Body(ValidatedBody(GR_REVIEW_BODY, { strict: true })) b: any) { return runGr(() => this.s().reviewFraud(id(aid), String(b?.to ?? ''), String(b?.note ?? ''), this.actor(r))); }
  @RequireStepUp() @Post('purchases/:id/sandbox-advance') @RequirePermission('super_admin.billing.manage')
  sandboxAdvance(@Req() r: any, @Param('id') pid: string, @Body(ValidatedBody(GR_SANDBOX_ADVANCE_BODY, { strict: true })) b: any) {
    return runGr(() => this.s().sandboxAdvance(id(pid), String(b?.status ?? '') as PurchaseStatus, this.actor(r)));
  }
}
