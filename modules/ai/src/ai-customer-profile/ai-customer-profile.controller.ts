// ai-customer-profile.controller.ts — read-only endpoints under /pos/ai-customer-profile. Tenant/branch/permissions
// are server-derived from req.ctx (never from body/query/header) — same pattern as every other POS slice.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_CUSTOMER_MERGE_BODY, AI_CUSTOMER_PROFILE_SETTINGS_BODY } from '../request-schemas';
import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AiCustomerProfileService, AiCustomerProfileForbiddenError } from './ai-customer-profile.service';
import type { AiCustomerProfileContext } from './ai-customer-profile.dto';
import { ListQueries } from '@aipowersalon/database';
import { AiCustomerProfileControllerListQueries } from './ai-customer-profile.list-queries';

function ctxFrom(req: any): AiCustomerProfileContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_customer_profile_assistant')
@ListQueries(AiCustomerProfileControllerListQueries)
@Controller('pos/ai-customer-profile')
export class AiCustomerProfileController {
  constructor(private readonly svc: AiCustomerProfileService) {}

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e: any) {
      // Our own forbidden + the Customers module's ForbiddenError (thrown by customers.merge) both map to 403.
      if (e instanceof AiCustomerProfileForbiddenError || e?.name === 'ForbiddenError') throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'CUSTOMER_NOT_FOUND') throw new HttpException(msg, HttpStatus.NOT_FOUND);
      if (msg === 'DUPLICATE_REVIEW_REQUIRED') throw new HttpException(msg, HttpStatus.CONFLICT);
      if (msg === 'AI_CUSTOMER_PROFILE_DISABLED') throw new HttpException(msg, HttpStatus.FORBIDDEN);
      if (msg === 'SETTINGS_NOT_PERSISTED') throw new HttpException(msg, HttpStatus.NOT_IMPLEMENTED);
      if (msg === 'BRANCH_NOT_AUTHORIZED') throw new HttpException(msg, HttpStatus.BAD_REQUEST);
      if (e?.name === 'ValidationError') throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  @Get('duplicates') @RequirePermission('pos.ai_customer_profile.view')
  duplicates(@Req() r: any) { return this.guard(() => this.svc.duplicates(ctxFrom(r))); }

  @Get('customers/:id/overview') @RequirePermission('pos.ai_customer_profile.view')
  overview(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.overview(ctxFrom(r), id)); }

  @Get('customers/:id/visit-summary') @RequirePermission('pos.ai_customer_profile.view')
  visitSummary(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.visitSummary(ctxFrom(r), id)); }

  @Get('customers/:id/service-preferences') @RequirePermission('pos.ai_customer_profile.view')
  servicePreferences(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.servicePreferences(ctxFrom(r), id)); }

  @Get('customers/:id/technician-preference') @RequirePermission('pos.ai_customer_profile.view')
  technicianPreference(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.technicianPreference(ctxFrom(r), id)); }

  @Get('customers/:id/branch-preference') @RequirePermission('pos.ai_customer_profile.view')
  branchPreference(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.branchPreference(ctxFrom(r), id)); }

  @Get('customers/:id/inactivity') @RequirePermission('pos.ai_customer_profile.view')
  inactivity(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.inactivity(ctxFrom(r), id)); }

  @Get('customers/:id/completeness') @RequirePermission('pos.ai_customer_profile.view')
  completeness(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.completeness(ctxFrom(r), id)); }

  // Churn is gated by the manage-level key (maps to customers.edit) so receptionists/technicians can't see it (§49).
  @Get('customers/:id/churn') @RequirePermission('pos.ai_customer_profile.churn')
  churn(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.churnRisk(ctxFrom(r), id)); }

  @Get('customers/:id/recommendations') @RequirePermission('pos.ai_customer_profile.view')
  recommendations(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.serviceRecommendations(ctxFrom(r), id)); }

  @Get('customers/:id/rebooking') @RequirePermission('pos.ai_customer_profile.view')
  rebooking(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.rebooking(ctxFrom(r), id)); }

  @Get('customers/:id/timeline') @RequirePermission('pos.ai_customer_profile.view')
  timeline(@Req() r: any, @Param('id') id: string, @Query('limit') limit?: string, @Query('before') before?: string) {
    return this.guard(() => this.svc.timeline(ctxFrom(r), id, { limit: limit ? Number(limit) : undefined, before: before || null }));
  }

  @Get('customers/:id/call-summary') @RequirePermission('pos.ai_customer_profile.view')
  callSummary(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.callSummary(ctxFrom(r), id)); }

  // ---- Stage 3 ----

  // Reception Copilot shared-layer entry point (§25).
  @Get('customers/:id/copilot-context') @RequirePermission('pos.ai_customer_profile.view')
  copilotContext(@Req() r: any, @Param('id') id: string) { return this.guard(() => this.svc.copilotContext(ctxFrom(r), id)); }

  // Duplicate merge PREVIEW route retired Nov 2 2026 (Duplicate Review guides): the POS previews through
  // POST /pos/duplicate-review/groups/:id/preview, which is recorded and hash-bound to the confirmed merge. The service
  // method stays for the AI tool (ai-customer-profile.tools.ts).

  // Duplicate merge EXECUTION (mutation) — requires explicit confirm=true AND the elevated pos.customers.merge
  // permission (re-enforced inside customers.merge). Never auto-merges (§16).
  @Post('duplicates/:groupId/merge') @RequirePermission('pos.customers.merge')
  merge(@Req() r: any, @Param('groupId') groupId: string, @Body(ValidatedBody(AI_CUSTOMER_MERGE_BODY, { strict: true })) body: { primaryCustomerId?: string; confirm?: boolean }) {
    return this.guard(() => this.svc.merge(ctxFrom(r), groupId, String(body?.primaryCustomerId ?? ''), body?.confirm === true));
  }

  // Customer Intelligence Overview aggregate (§44) — cached; refresh is worker-ready.
  @Get('tenant-overview') @RequirePermission('pos.ai_customer_profile.view')
  tenantOverview(@Req() r: any) { return this.guard(() => this.svc.tenantOverview(ctxFrom(r))); }

  @Post('tenant-overview/refresh') @RequirePermission('pos.ai_customer_profile.view')
  refreshTenantOverview(@Req() r: any) { return this.guard(() => this.svc.refreshTenantOverview(ctxFrom(r))); }

  // Effective settings (§52) — resolved platform→tenant→branch→user; shows thresholds + any disabled level.
  @Get('settings') @RequirePermission('pos.ai_customer_profile.view')
  settings(@Req() r: any) { return this.guard(() => this.svc.getEffectiveSettings(ctxFrom(r))); }

  // Per-tenant usage counters for the AI Usage surface (§58). Manage-gated.
  @Get('usage') @RequirePermission('pos.ai_customer_profile.churn')
  usage(@Req() r: any) { return this.guard(() => this.svc.getUsage(ctxFrom(r))); }

  // Persist a per-scope override (enable/disable + tunables). Manage-gated; requires the DB-backed settings port.
  @Put('settings/:level') @RequirePermission('pos.ai_customer_profile.churn')
  updateSettings(@Req() r: any, @Param('level') level: string, @Body(ValidatedBody(AI_CUSTOMER_PROFILE_SETTINGS_BODY, { strict: true })) body: { enabled?: boolean; tunables?: any }) {
    const lvl = (['tenant', 'branch', 'user'].includes(level) ? level : 'tenant') as 'tenant' | 'branch' | 'user';
    return this.guard(() => this.svc.updateSettings(ctxFrom(r), lvl, { enabled: body?.enabled, tunables: body?.tunables }));
  }
}
