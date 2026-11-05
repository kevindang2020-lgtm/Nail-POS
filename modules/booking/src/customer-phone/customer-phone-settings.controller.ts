// Tenant settings + Super Admin oversight for Customer Phone Management.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { PHONE_SETTINGS_BODY, PHONE_SWEEP_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Inject, Optional, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '@aipowersalon/audit';
import { CustomerPhoneSyncScheduler } from './customer-phone-sync.scheduler';
import { CustomerPhoneSettingsService, PhoneSettingsError } from './customer-phone-settings.service';
import { KyselyPhoneOversight } from './customer-phone-settings.kysely';
import { DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { CustomerPhoneSettingsControllerListQueries, CustomerPhoneOversightControllerListQueries } from './customer-phone-settings.list-queries';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof PhoneSettingsError) {
      throw new HttpException({ code: e.code, message: e.message }, e.code === 'forbidden' ? HttpStatus.FORBIDDEN : e.code === 'not_found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CustomerPhoneSettingsControllerListQueries)
@Controller('pos/settings/customer-phone')
export class CustomerPhoneSettingsController {
  constructor(private readonly svc: CustomerPhoneSettingsService) {}

  @Get() @RequirePermission('settings.view')
  get(@Req() r: any, @Query('branchId') branchId?: string) {
    return run(() => this.svc.get(r?.ctx?.tenantId, branchId || null));
  }

  // The salon-wide policy. `pos.customers.phone.settings` → customers.phone_manage (owners and managers — it used to
  // need settings.edit, which managers do not hold, although the service and the nav said managers configure this),
  // and the SERVICE also checks the ROLE. A receptionist changing the rules that constrain receptionists is not a
  // permission model.
  @Patch() @RequirePermission('pos.customers.phone.settings')
  patch(@Req() r: any, @Body(ValidatedBody(PHONE_SETTINGS_BODY)) b: any) {
    const c = r?.ctx || {};
    return run(() => this.svc.update(
      { tenantId: c.tenantId, branchId: null, userId: c.userId, role: String(c.role ?? ''), permissions: c.permissions ?? [] },
      b ?? {},
    ));
  }

  // ── One branch's own policy (audit E10) ────────────────────────────────────────────────────────────────
  // A branch override was saved from `body.branchId`, which the tenant-context middleware strips (a client never names
  // its own scope) — so overrides were unreachable. The branch is in the PATH now, and must belong to this salon.
  @Get('branches/:branchId') @RequirePermission('settings.view')
  getBranch(@Req() r: any, @Param('branchId') branchId: string) {
    return run(() => this.svc.getBranch(r?.ctx?.tenantId, branchId));
  }

  @Patch('branches/:branchId') @RequirePermission('pos.customers.phone.settings')
  patchBranch(@Req() r: any, @Param('branchId') branchId: string, @Body(ValidatedBody(PHONE_SETTINGS_BODY)) b: any) {
    const c = r?.ctx || {};
    return run(() => this.svc.update({ tenantId: c.tenantId, branchId, userId: c.userId, role: String(c.role ?? ''), permissions: c.permissions ?? [] }, b ?? {}));
  }

  /** Remove a branch's override: it inherits the salon-wide policy again. */
  @Delete('branches/:branchId') @RequirePermission('pos.customers.phone.settings')
  clearBranch(@Req() r: any, @Param('branchId') branchId: string) {
    const c = r?.ctx || {};
    return run(() => this.svc.clearBranch({ tenantId: c.tenantId, branchId, userId: c.userId, role: String(c.role ?? ''), permissions: c.permissions ?? [] }));
  }
}

/**
 * Super Admin — Customer Phone Verification Oversight.
 *
 * Counts and states ONLY. It cannot return a phone number, a code, or a credential — not because this controller
 * strips them, but because the queries behind it never select them. A privacy guarantee that depends on remembering
 * to strip a field is not a guarantee.
 */
@UseGuards(SuperAdminGuard)
@ListQueries(CustomerPhoneOversightControllerListQueries)
@Controller('super-admin/customer-phone')
export class CustomerPhoneOversightController {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Inject(CustomerPhoneSyncScheduler) private readonly scheduler: CustomerPhoneSyncScheduler,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  @Get('oversight')
  oversight(@Query('hours') hours?: string, @Query('tenantId') tenantId?: string) {
    const t = tenantId && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : null;
    return new KyselyPhoneOversight(this.db).summary(Math.min(720, Number(hours) || 168), t);
  }

  /** Per salon: where phone changes fail or wait. Counts only. */
  @Get('oversight/tenants')
  oversightByTenant(@Query('hours') hours?: string) {
    return new KyselyPhoneOversight(this.db).byTenant(Math.min(720, Number(hours) || 168));
  }

  /**
   * Run the phone sweep now: close changes past their deadline and put every failed synchronisation on the queue.
   * Touches no customer's number. A reason is required and audited.
   */
  @Post('sweep') @RequirePermission('super_admin.customers.manage')
  async sweep(@Req() r: any, @Body(ValidatedBody(PHONE_SWEEP_BODY)) b: any) {
    const reason = String(b?.reason ?? '').trim();
    if (reason.length < 5) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'A reason (at least 5 characters) is required.' }, HttpStatus.BAD_REQUEST);
    const out = await this.scheduler.tick();
    await this.audit?.recordPlatform({ module: 'customer_phone', action: 'customer_phone_sweep_run', resourceType: 'customer_phone', resourceId: null, userId: r?.ctx?.userId ?? null, role: r?.ctx?.role ?? null, summary: 'Customer phone sweep run by Super Admin', metadata: { reason, ...out } });
    return { ok: true, ...out };
  }
}
