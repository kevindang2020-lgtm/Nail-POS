/**
 * super-admin-tenants.controller.ts
 * ---------------------------------------------------------------------------
 * HTTP surface for the Super Admin Tenants console. Mounted behind the
 * `super-admin` guard (integration-bundle/.../guards/super-admin.guard.ts) —
 * CROSS-TENANT, never scoped(). Thin: validation/logic live in the service+core.
 */

import { PaymentGatewayResolver, type UpsertGatewayInput, gatewayStatusTransition, type GatewayAction } from '@aipowersalon/payments';
import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  HttpException,
  Optional,
} from '@nestjs/common';
import { sql } from 'kysely';
import { SuperAdminGuard, RequireStepUp, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { CommissionSecurityService, hashCommissionAuthCode, newCommissionAuthCode } from '@aipowersalon/workforce';
import { SuperAdminTenantsService, type Actor } from './super-admin-tenants.service';
import { TenantPosLanguageService, TenantPosLanguageError } from './tenant-pos-language';
import type { SetTenantPosLanguageBody, TenantPosLanguage } from '@aipowersalon/api-contracts';
import { fetchCommissionHistory } from './commission-history.query';
import { queryToFilter } from './super-admin-tenants.dto';
import type {
  TenantsStateQuery,
  CreateTenantRequest,
  SuspendTenantRequest,
  ImportTenantsRequest,
} from './super-admin-tenants.dto';
import type { TabKey } from './super-admin-tenants-core';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminTenantsControllerListQueries } from './super-admin-tenants.list-queries';
import { TEN_BRANCH_MERCHANT_BODY, TEN_BRANCH_MERCHANT_STATUS_BODY, TEN_BULK_STATUS_BODY, TEN_COMMISSION_BODY, TEN_COMMISSION_CODE_BODY, TEN_CREATE_BODY, TEN_GATEWAY_BODY, TEN_IMPORT_BODY, TEN_POS_LANGUAGE_BODY, TEN_LIFECYCLE_BODY, TEN_RESET_OWNER_PASSWORD_BODY, TEN_STATUS_BODY, TEN_SUPPORT_ACCESS_BODY, TEN_SUSPEND_BODY, TEN_WARNING_BODY } from './request-schemas-tenants';   // BUILD_PLAN Phase 12 (#17)
import type { BranchMerchantAccountView, BranchMerchantStatusRequest, MerchantConnectionTestResult } from '@aipowersalon/api-contracts';   // wave 3 PAYI: branch merchant wire types

function actorFrom(req: any): Actor {
  return { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined, permissions: Array.isArray(req?.ctx?.permissions) ? req.ctx.permissions : [] };
}


/** §163 run 3 (Oct 27 2026): the payment-gateway routes read the salon by :id inside the gateway resolver, which wrapped a
 *  malformed id's database error as a ProcessorError (500) — a non-uuid id is refused up front as a 400. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function gatewayTenantId(id: string): string {
  if (!UUID_RE.test(String(id ?? ''))) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'That salon id is not valid.', details: { field: 'id' } }, 400);
  return id;
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminTenantsControllerListQueries)
@Controller('super-admin')
export class SuperAdminTenantsController {
  constructor(
    private readonly svc: SuperAdminTenantsService,
    private readonly gateway: PaymentGatewayResolver,
    @Optional() private readonly posLanguage?: TenantPosLanguageService,
  ) {}

  // ---- Vietnamese POS mandate WP-A (§93): the salon's DEFAULT POS language (English UI here). The authority is the
  // salon-wide Business & Branch setting the owner also edits in POS Settings; a staff member's own choice always wins. ----
  @RequirePermission('super_admin.tenants.view')
  @Get('tenants/:id/pos-language')
  async getPosLanguage(@Param('id') id: string): Promise<TenantPosLanguage> {
    return this.posLanguageCall(() => this.posLanguageSvc().get(id));
  }

  @RequireStepUp()   // tenant configuration, same bar as the other tenant-config writes
  @RequirePermission('super_admin.tenants.edit')
  @Put('tenants/:id/pos-language')
  async setPosLanguage(@Param('id') id: string, @Body(ValidatedBody(TEN_POS_LANGUAGE_BODY, { strict: true })) body: SetTenantPosLanguageBody, @Req() req: any): Promise<TenantPosLanguage & { changed: boolean }> {
    const actor = actorFrom(req);
    const out = await this.posLanguageCall(() => this.posLanguageSvc().set(id, body?.language, actor, body?.reason ?? null));
    if (out.changed) await this.svc.recordGatewayAudit(id, 'super_admin_tenant_pos_language_changed', actor, { source: 'tenants_detail_pos_language', to: out.language, reason: body?.reason?.trim() || null });
    return out;
  }

  private posLanguageSvc(): TenantPosLanguageService {
    if (!this.posLanguage) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The tenant language setting needs the database.' }, 503);
    return this.posLanguage;
  }
  private async posLanguageCall<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      if (e instanceof TenantPosLanguageError) throw new HttpException({ code: e.code, message: e.message }, e.code === 'RESOURCE_NOT_FOUND' ? 404 : 400);
      throw e;
    }
  }

  // ---- Per-tenant payment gateway (Payment Gateway Isolation §5/§17). Cross-tenant by design (Super Admin guard);
  // each route targets one explicit :id. Secrets are encrypted on write and never returned (masked view only). ----
  @Get('tenants/:id/payment-gateway')
  getGateway(@Param('id') id: string) {
    return this.gateway.getMasked(gatewayTenantId(id));
  }

  @RequireStepUp()   // Constitution 7 §8: changing merchant configuration
  @Post('tenants/:id/payment-gateway')
  setGateway(@Param('id') id: string, @Body(ValidatedBody(TEN_GATEWAY_BODY, { strict: true })) body: UpsertGatewayInput, @Req() req: any) {
    return this.gateway.upsertConfig(gatewayTenantId(id), body || {}, req?.ctx?.userId);
  }

  @RequireStepUp()   // Constitution 7 §8: changing merchant configuration
  @Patch('tenants/:id/payment-gateway')
  patchGateway(@Param('id') id: string, @Body(ValidatedBody(TEN_GATEWAY_BODY, { strict: true })) body: UpsertGatewayInput, @Req() req: any) {
    return this.gateway.upsertConfig(gatewayTenantId(id), body || {}, req?.ctx?.userId);
  }

  @Post('tenants/:id/payment-gateway/test-connection')
  testGateway(@Param('id') id: string) {
    return this.gateway.testConnection(gatewayTenantId(id));
  }

  // Verify Credentials (§5/§6) — reports which required credential fields are missing for the chosen processor (no secrets).
  @Post('tenants/:id/payment-gateway/verify-credentials')
  async verifyGateway(@Param('id') id: string, @Req() req: any) {
    const res = await this.gateway.verifyCredentials(id);
    await this.svc.recordGatewayAudit(id, 'payment_gateway_credentials_verified', { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined }, { ok: res.ok, missing: res.missing });
    return res;
  }

  // Sync Merchant Status (§5/§6) — returns the current persisted boarding/underwriting status.
  @Post('tenants/:id/payment-gateway/sync-merchant-status')
  async syncGateway(@Param('id') id: string, @Req() req: any) {
    const res = await this.gateway.syncMerchantStatus(id);
    await this.svc.recordGatewayAudit(id, 'payment_gateway_status_synced', { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined }, { onboardingStatus: res.onboardingStatus, status: res.status });
    return res;
  }

  // Rotate Webhook Secret (§5 dangerous action) — generates + stores a new signing secret, returns it ONCE.
  @RequireStepUp()   // Security Deep Scan C7: a payment credential change
  @Post('tenants/:id/payment-gateway/webhooks/rotate-secret')
  async rotateWebhookSecret(@Param('id') id: string, @Req() req: any) {
    const res = await this.gateway.rotateWebhookSecret(id, req?.ctx?.userId);
    await this.svc.recordGatewayAudit(id, 'payment_gateway_webhook_secret_rotated', { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined });
    return res;
  }

  // Settlement history (§5/§6) — safe summary rows; no secrets.
  @Get('tenants/:id/payment-gateway/settlements')
  gatewaySettlements(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.gateway.listSettlements(id, limit ? +limit : 25);
  }

  // Webhook events + health (§4.H/§6) — recent inbound processor webhooks with signature-verification status.
  @Get('tenants/:id/payment-gateway/webhooks')
  gatewayWebhooks(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.gateway.listWebhookEvents(id, limit ? +limit : 25);
  }

  // Dedicated, audited gateway lifecycle actions (§12). Thin wrappers over the resolver's status update: a pure guard
  // decides the target status, the resolver applies it (encryption/masking unchanged), and the action is written to
  // audit_logs. Pause → 'paused' (On Hold), disable → 'disabled', resume → 'active'.
  // Security Deep Scan C7: the salon's card payments stop / start — the same step-up as the gateway configuration itself
  @RequireStepUp()
  @Post('tenants/:id/payment-gateway/pause')
  pauseGateway(@Param('id') id: string, @Req() req: any) { return this.gatewayStatusAction(id, 'pause', req); }
  @RequireStepUp()
  @Post('tenants/:id/payment-gateway/resume')
  resumeGateway(@Param('id') id: string, @Req() req: any) { return this.gatewayStatusAction(id, 'resume', req); }
  @RequireStepUp()
  @Post('tenants/:id/payment-gateway/disable')
  disableGateway(@Param('id') id: string, @Req() req: any) { return this.gatewayStatusAction(id, 'disable', req); }

  private async gatewayStatusAction(id: string, action: GatewayAction, req: any) {
    const current = await this.gateway.getMasked(gatewayTenantId(id));
    const t = gatewayStatusTransition(current.status, action);
    if (!t.ok) throw new BadRequestException(t.error);
    await this.gateway.upsertConfig(id, { status: t.to }, req?.ctx?.userId);
    await this.svc.recordGatewayStatusAudit(id, action, current.status, t.to!, { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined });
    return this.gateway.getMasked(gatewayTenantId(id));
  }

  // ---- Branch merchant accounts (Payments mandate §7 / §10 / §55 / §163, wave 3; migration 638). A multi-location salon
  // whose branch settles to its own MID. Masked reads; credentials sealed on write; step-up + audit on every change;
  // the status moves through the same PAYMENT_GATEWAY machine as the tenant default. ----
  @Get('tenants/:id/payment-gateway/branches')
  listBranchMerchants(@Param('id') id: string): Promise<BranchMerchantAccountView[]> { return this.gateway.listBranchMerchants(id); }

  @RequireStepUp()
  @Post('tenants/:id/payment-gateway/branches/:branchId')
  async setBranchMerchant(@Param('id') id: string, @Param('branchId') branchId: string, @Body(ValidatedBody(TEN_BRANCH_MERCHANT_BODY, { strict: true })) body: any, @Req() req: any): Promise<BranchMerchantAccountView> {
    const prior = await this.gateway.getBranchMerchant(id, branchId);
    const view = await this.gateway.upsertBranchMerchant(id, branchId, body || {}, req?.ctx?.userId);
    // §55: merchant configured / changed — never a credential, only which fields changed
    const changed = Object.keys(body || {}).filter((k) => (body as any)[k] !== undefined && (body as any)[k] !== '');
    await this.svc.recordGatewayAudit(id, 'payment_merchant_account_configured', { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined }, { branchId, merchantAccountId: view.id, created: !prior, fields: changed.map((k) => (/password|secret|key|username/i.test(k) ? `${k}:rotated` : k)), status: view.status, configVersion: view.configVersion });
    return view;
  }

  @Post('tenants/:id/payment-gateway/branches/:branchId/test-connection')
  async testBranchMerchant(@Param('id') id: string, @Param('branchId') branchId: string, @Req() req: any): Promise<MerchantConnectionTestResult> {
    const res = await this.gateway.testBranchConnection(id, branchId);
    await this.svc.recordGatewayAudit(id, 'payment_merchant_account_tested', { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined }, { branchId, ok: res.ok, tested: res.tested });
    return res;
  }

  @RequireStepUp()
  @Post('tenants/:id/payment-gateway/branches/:branchId/status')
  async branchMerchantStatus(@Param('id') id: string, @Param('branchId') branchId: string, @Body(ValidatedBody(TEN_BRANCH_MERCHANT_STATUS_BODY, { strict: true })) body: BranchMerchantStatusRequest, @Req() req: any): Promise<BranchMerchantAccountView> {
    const current = await this.gateway.getBranchMerchant(id, branchId);
    if (!current) throw new BadRequestException('This location has no merchant account of its own.');
    const t = gatewayStatusTransition(current.status, body?.action);
    if (!t.ok) throw new BadRequestException(t.error);
    const view = await this.gateway.setBranchMerchantStatus(id, branchId, t.to!, req?.ctx?.userId);
    await this.svc.recordGatewayAudit(id, 'payment_merchant_account_status_changed', { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined }, { branchId, merchantAccountId: view.id, action: body.action, from: current.status, to: t.to });
    return view;
  }

  @Get('tenants/state')
  getState(@Query() q: TenantsStateQuery) {
    return this.svc.getState({
      tab: (q.tab as TabKey) ?? 'all',
      filter: queryToFilter(q),
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 10,
    });
  }

  // Read-only analytics for the Tenants page (12 KPIs, plan/status/health distributions, growth, alerts,
  // onboarding pipeline, upcoming renewals). Cross-tenant by design under the Super Admin guard. Reconciles
  // with the directory total because it derives from the same record set as /tenants/state (§36).
  @Get('tenants/directory-overview')
  getDirectoryOverview() {
    return this.svc.getDirectoryOverview();
  }

  // Bulk status change (Bulk Actions §27). Dangerous targets require a reason; each tenant is validated + audited
  // individually and results are reported per tenant. Cross-tenant by design under the Super Admin guard.
  // Constitution 7 §8: bulk status changes suspend and reactivate tenants too — the same step-up as the single change
  @RequireStepUp()
  @Post('tenants/bulk-status')
  bulkStatus(@Body(ValidatedBody(TEN_BULK_STATUS_BODY, { strict: true })) body: { tenantIds?: string[]; status?: 'active' | 'paused' | 'suspended' | 'cancelled'; reason?: string; reasonCode?: string }, @Req() req: any) {
    if (!body?.status) throw new BadRequestException('status is required');
    return this.svc.bulkChangeStatus(body.tenantIds || [], body.status, body.reason, actorFrom(req), body.reasonCode);
  }

  @Post('tenants')
  create(@Body(ValidatedBody(TEN_CREATE_BODY, { strict: true })) body: CreateTenantRequest, @Req() req: any) {
    return this.svc.createTenant(body, actorFrom(req));
  }

  @RequireStepUp()   // Security Deep Scan C7: PATCH tenants/:id/status already asks for it — suspend did not
  @Post('tenants/:id/suspend')
  suspend(@Param('id') id: string, @Body(ValidatedBody(TEN_SUSPEND_BODY, { strict: true })) body: SuspendTenantRequest, @Req() req: any) {
    return this.svc.suspend(id, body?.reason ?? '', actorFrom(req));
  }

  @RequireStepUp()   // C7: the reverse of suspend, same as PATCH tenants/:id/status
  @Post('tenants/:id/reactivate')
  reactivate(@Param('id') id: string, @Req() req: any) {
    return this.svc.reactivate(id, actorFrom(req));
  }

  // ---- Quick Actions (Tenants/Salons detail panel) ----
  // Constitution 7 §16–§21: move a tenant through the explicit lifecycle (transition table + per-move requirements)
  @RequireStepUp()
  @Post('tenants/:id/lifecycle')
  changeLifecycle(@Param('id') id: string, @Body(ValidatedBody(TEN_LIFECYCLE_BODY, { strict: true })) body: { state?: string; reason?: string; reasonCode?: string }, @Req() req: any) {
    return this.svc.changeLifecycle(id, String(body?.state ?? ''), body?.reason, body?.reasonCode, actorFrom(req));
  }

  @RequireStepUp()   // Constitution 7 §8: suspending / reactivating a tenant
  @Patch('tenants/:id/status')
  changeStatus(@Param('id') id: string, @Body(ValidatedBody(TEN_STATUS_BODY, { strict: true })) body: { status: 'active' | 'paused' | 'suspended' | 'cancelled'; reason?: string; reasonCode?: string }, @Req() req: any) {
    return this.svc.changeStatus(id, body?.status, body?.reason, actorFrom(req), body?.reasonCode);
  }

  @Post('tenants/:id/warning')
  sendWarning(@Param('id') id: string, @Body(ValidatedBody(TEN_WARNING_BODY, { strict: true })) body: any, @Req() req: any) {
    return this.svc.sendWarning(id, body || {}, actorFrom(req));
  }

  @Get('tenants/:id/warnings')
  listWarnings(@Param('id') id: string, @Query() q: any) {
    return this.svc.listWarnings(id, Number(q?.limit) || 20);
  }

  // Constitution 7 §8 / §74: opening a tenant's POS in support mode is entering Support Mode — same step-up
  @RequireStepUp()
  @Post('tenants/:id/support-access')
  supportAccess(@Param('id') id: string, @Body(ValidatedBody(TEN_SUPPORT_ACCESS_BODY, { strict: true })) body: { reason?: string; source?: string }, @Req() req: any) {
    return this.svc.openSupportAccess(id, body || {}, actorFrom(req));
  }

  // Security Deep Scan C2 (Oct 23 2026): step-up + a reason (audited); the temporary password goes to the OWNER by email /
  // SMS and is never returned; a platform account is never reset from here. Refusals carry a registered code.
  @RequireStepUp()
  @Post('tenants/:id/reset-owner-password')
  async resetOwnerPassword(@Param('id') id: string, @Body(ValidatedBody(TEN_RESET_OWNER_PASSWORD_BODY, { strict: true })) body: { reason?: string; deliveryMethod?: 'auto' | 'email' | 'sms' }, @Req() req: any) {
    const out = await this.svc.resetOwnerPassword(id, actorFrom(req), { reason: body?.reason, deliveryMethod: body?.deliveryMethod ?? undefined });
    if (out.ok) return out;
    const message = out.errors?.[0] ?? 'The password could not be reset.';
    const status = out.code === 'RESOURCE_NOT_FOUND' ? 404 : out.code === 'PLATFORM_ACCOUNT_TARGET' ? 403 : out.code === 'CANNOT_DELIVER' ? 422 : out.code === 'DELIVERY_FAILED' ? 502 : 400;
    throw new HttpException({ code: out.code ?? 'VALIDATION_FAILED', message }, status);
  }

  @Post('tenants/import')
  import(@Body(ValidatedBody(TEN_IMPORT_BODY, { strict: true })) body: ImportTenantsRequest, @Req() req: any) {
    return this.svc.importTenants(body, actorFrom(req));
  }

  @Get('tenants/:id/audit')
  audit(@Param('id') id: string) {
    return this.svc.getAudit(id);
  }

  // ---- Commission Security Control & Authorization Code Management ----
  // Hardened in the Sep 2026 merge (developer feature): tenants.edit + step-up, ONE salon (no '*'), a reason, audited;
  // the code is shown ONCE and stored only as a hash; 24 h; single use (commission-security.service).
  @RequireStepUp()
  @Post('commission-auth-code/generate') @RequirePermission('super_admin.tenants.edit')
  async generateCommissionAuthCode(@Body(ValidatedBody(TEN_COMMISSION_CODE_BODY, { strict: true })) body: any, @Req() req: any) {
    const tenantId = body && typeof body === 'object' && typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
    const reason = String(body?.reason ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new BadRequestException({ code: 'tenant_required', message: 'Choose the salon this code is for.' });
    if (reason.length < 10) throw new BadRequestException({ code: 'reason_required', message: 'A reason of at least 10 characters is required.' });
    const repoDb = (this.svc as any).repo?.db;
    if (!repoDb) throw new BadRequestException('Commission authorization codes need the database.');
    const code = newCommissionAuthCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await repoDb.transaction().execute(async (trx: any) => {
      await trx.insertInto('admin_commission_auth_codes').values({ tenant_id: tenantId, code_enc: hashCommissionAuthCode(code),
        generated_by_user_id: req?.ctx?.userId || 'super_admin', generated_by_name: req?.ctx?.email || 'Super Admin', expires_at: expiresAt } as any).execute();
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${req?.ctx?.userId ?? null}, 'SUPER_ADMIN', 'commission_auth_code_issued', 'tenant', ${tenantId}, ${JSON.stringify({ reason, expiresAt: expiresAt.toISOString(), codeTail: code.slice(-4) })}::jsonb)`.execute(trx);
    });
    return { ok: true, code, tenantId, expiresAt: expiresAt.toISOString(), note: 'Shown once. Give it to the salon owner; it works one time, for this salon, for 24 hours.' };
  }

  @Get('commission-oversight') @RequirePermission('super_admin.tenants.view')
  async getCommissionOversight() {
    const repoDb = (this.svc as any).repo?.db;
    if (!repoDb) return { ok: true, activeCodes: [], history: [] };

    // never the code (only its hash is stored anyway): who issued it, for which salon, and when it expires
    const activeCodes: any[] = await repoDb
      .selectFrom('admin_commission_auth_codes')
      .select(['id', 'tenant_id', 'generated_by_user_id', 'generated_by_name', 'expires_at', 'created_at'] as any)
      .where('used_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute()
      .catch(() => []);

    const historyRows: any[] = await fetchCommissionHistory(repoDb);   // SCAN (Oct 12): a failure surfaces — it used to read as "no history"

    return {
      ok: true,
      activeCodes: activeCodes.map((c) => ({
        id: c.id,
        tenantId: c.tenant_id,
        code: c.code_enc,
        generatedByName: c.generated_by_name || 'Super Admin',
        expiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null,
        createdAt: new Date(c.created_at).toISOString(),
      })),
      history: historyRows.map((h) => ({
        ...h,
        oldCommissionPercent: Number(h.oldCommissionPercent || 0),
        newCommissionPercent: Number(h.newCommissionPercent || 0),
        createdAt: new Date(h.createdAt).toISOString(),
      })),
    };
  }

  @Patch('tenants/:id/commission')
  async updateTenantCommission(@Param('id') id: string, @Body(ValidatedBody(TEN_COMMISSION_BODY, { strict: true })) body: { initialCommissionPercent: number }, @Req() req: any) {
    const commPct = Number(body?.initialCommissionPercent);
    if (!Number.isFinite(commPct) || commPct < 0 || commPct > 100) {
      throw new BadRequestException('Commission percentage must be between 0 and 100');
    }

    const repoDb = (this.svc as any).repo?.db;
    if (repoDb) {
      const tenantRow: any = await repoDb.selectFrom('tenants').where('id', '=', id as any).select(['default_commission_percent', 'display_name']).executeTakeFirst();
      const oldComm = tenantRow?.default_commission_percent != null ? Number(tenantRow.default_commission_percent) : 50;

      await repoDb.updateTable('tenants').set({ default_commission_percent: commPct }).where('id', '=', id as any).execute();

      await CommissionSecurityService.recordChange(repoDb, {
        tenantId: id,
        targetType: 'salon_default',
        oldCommissionPercent: oldComm,
        newCommissionPercent: commPct,
        requestedByUserId: req?.ctx?.userId || 'super_admin',
        requestedByName: 'Super Admin',
        requestedByRole: 'SUPER_ADMIN',
        authorizedByUserId: req?.ctx?.userId || 'super_admin',
        authorizedByName: 'Super Admin',
        authCodeUsed: 'SUPER_ADMIN_DIRECT',
      });
    }

    return { ok: true, id, defaultCommissionPercent: commPct };
  }
}
