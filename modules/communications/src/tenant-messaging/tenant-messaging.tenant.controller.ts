// tenant-messaging.tenant.controller.ts — self-service surface: a salon configures ITS OWN Twilio account. Behind
// TenantAuthGuard; the tenant is taken from the session (req.ctx), never the client, so a salon can only ever touch its
// own credentials. Writes require settings.edit. Auth token remains write-only (masked reads only).
//
// Phone & Messaging guide (Oct 30 2026): the shared readiness read both pages use (`readiness`), the authenticated
// Health Check (`health-check`, rate-limited per salon), a two-step number purchase (`number/quote` → `number/buy` with
// the server-issued confirmation), and a confirmed, idempotent Test SMS whose result is recorded.
//
// Round 2 (Four-Module Completion Guide §6–§7, Oct 30 2026): a BRANCH test SMS (only a branch the actor may act for —
// otherwise 403 — sent with that branch's effective configuration, never another branch's), the privileged Account SID
// reveal (step-up + audit; every ordinary read is masked), and the provider-backed "Refresh Status" for carrier
// registration / toll-free verification (rate-limited per salon).
import { Controller, Get, Put, Post, Delete, Body, Req, UseGuards, ForbiddenException, HttpException, HttpStatus, Query, Param, Optional } from '@nestjs/common';
import { TenantAuthGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';
import { TenantMessagingCredentialsService, CredentialsInputError } from './tenant-messaging-credentials.service';
import { TenantNumberService, NumberPurchaseError } from './tenant-number.service';
import { TenantMessagingReadinessService, ReadinessInputError } from './tenant-messaging-readiness.service';
import { TenantRegistrationSyncService, RegistrationSyncError } from './registration-sync.service';
import { ListQueries } from '@aipowersalon/database';
import { TenantMessagingSelfControllerListQueries } from './tenant-messaging.tenant.list-queries';
import { MESSAGING_CREDS_BODY, MESSAGING_TEST_BODY, PHONE_NUMBER_BODY, NUMBER_QUOTE_BODY, NUMBER_BUY_BODY, EMPTY_BODY, MESSAGING_REFRESH_BODY } from '../request-schemas';

type Ctx = { tenantId: string; userId: string; branchId: string | null; role?: string; permissions: string[]; authz: { scope: string | null; branchIds: string[] | null } | null };
function ctxFrom(req: any): Ctx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, userId: c.userId, branchId: c.branchId ?? null, role: c.role, permissions: c.permissions || [],
    authz: c.authz ? { scope: c.authz.scope ?? null, branchIds: Array.isArray(c.authz.branchIds) ? c.authz.branchIds.map(String) : null } : null };
}
/**
 * PM-01: the branches this actor may act for — null = every branch of the salon. An actor whose role template confines
 * them (BRANCH / SELECTED_BRANCHES) acts only for their granted branches (else their session branch) — the same rule
 * the payroll services use. Never decided from a role name.
 */
export function allowedBranchesOf(ctx: Pick<Ctx, 'branchId' | 'authz'>): string[] | null {
  const confined = ctx.authz?.scope === 'BRANCH' || ctx.authz?.scope === 'SELECTED_BRANCHES';
  if (!confined) return null;
  const ids = (ctx.authz?.branchIds ?? []).filter((b): b is string => !!b);
  return ids.length ? ids : ctx.branchId ? [ctx.branchId] : [];
}
/** a branch outside the actor's set → 403 (another salon's branch is refused by the service: BRANCH_NOT_FOUND) */
function mustReachBranch(ctx: Ctx, branchId: string): void {
  const allowed = allowedBranchesOf(ctx);
  if (allowed && !allowed.includes(branchId)) throw new HttpException({ code: 'BRANCH_ACCESS_DENIED', message: 'You do not have access to this location.' }, ERROR_REGISTRY.BRANCH_ACCESS_DENIED.status);
}
/** the permission decision (never a role name) */
function mustEdit(ctx: ReturnType<typeof ctxFrom>): void {
  if (!hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], 'settings.edit')) throw new ForbiddenException('settings.edit required');
}
/** a coded refusal → its registry status + code (+ safe params); anything else is rethrown */
async function coded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof CredentialsInputError || e instanceof NumberPurchaseError || e instanceof ReadinessInputError || e instanceof RegistrationSyncError) {
      const code = isRegisteredCode(e?.apiCode) ? e.apiCode : 'VALIDATION_FAILED';
      const status = isRegisteredCode(e?.apiCode) ? ERROR_REGISTRY[e.apiCode as keyof typeof ERROR_REGISTRY].status : HttpStatus.BAD_REQUEST;
      throw new HttpException({ code, message: e.message, ...(e.apiParams ? { params: e.apiParams } : {}) }, status);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard)
@ListQueries(TenantMessagingSelfControllerListQueries)
@Controller('tenant/messaging')
export class TenantMessagingSelfController {
  constructor(private readonly svc: TenantMessagingCredentialsService, private readonly numbers: TenantNumberService, @Optional() private readonly readinessSvc?: TenantMessagingReadinessService,
    @Optional() private readonly syncSvc?: TenantRegistrationSyncService) {}

  private sync(): TenantRegistrationSyncService {
    if (!this.syncSvc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Registration status is not available.' }, HttpStatus.SERVICE_UNAVAILABLE);
    return this.syncSvc;
  }

  private ready(): TenantMessagingReadinessService {
    if (!this.readinessSvc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Messaging readiness is not available.' }, HttpStatus.SERVICE_UNAVAILABLE);
    return this.readinessSvc;
  }

  // ---- the shared readiness (both pages) + the authenticated health check ----
  @Get('readiness') @RequirePermission('settings.view')
  readiness(@Req() r: any) { const ctx = ctxFrom(r); return coded(() => this.ready().readiness(ctx.tenantId, null, allowedBranchesOf(ctx))); }

  @Get('readiness/branches/:branchId') @RequirePermission('settings.view')
  readinessBranch(@Req() r: any, @Param('branchId') branchId: string) { const ctx = ctxFrom(r); return coded(async () => { mustReachBranch(ctx, branchId); return this.ready().readiness(ctx.tenantId, branchId, allowedBranchesOf(ctx)); }); }

  @Post('health-check') @RequirePermission('settings.edit')
  healthCheck(@Req() r: any, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { const ctx = ctxFrom(r); return coded(async () => { mustEdit(ctx); return this.ready().healthCheck(ctx, null, allowedBranchesOf(ctx)); }); }

  @Post('health-check/branches/:branchId') @RequirePermission('settings.edit')
  healthCheckBranch(@Req() r: any, @Param('branchId') branchId: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { const ctx = ctxFrom(r); return coded(async () => { mustEdit(ctx); mustReachBranch(ctx, branchId); return this.ready().healthCheck(ctx, branchId, allowedBranchesOf(ctx)); }); }

  /**
   * PM-03 / PM-04 "Refresh Status": read the salon's carrier registration (10DLC brand, campaign, Messaging Service,
   * number association — or the toll-free verification) from the provider NOW and return the readiness built on it.
   * Read-only at the provider; rate-limited per salon; idempotent per request key (a double tap reads once).
   */
  @Post('registration/refresh') @RequirePermission('settings.edit')
  refreshRegistration(@Req() r: any, @Body(ValidatedBody(MESSAGING_REFRESH_BODY, { strict: true })) b: any) {
    const ctx = ctxFrom(r);
    return coded(async () => {
      mustEdit(ctx);
      const { run, replayed } = await this.sync().refresh(ctx.tenantId, { trigger: 'manual', idempotencyKey: `ui:${String(b?.idempotencyKey ?? '')}`, actorUserId: ctx.userId });
      return { run, replayed, readiness: await this.ready().readiness(ctx.tenantId, null, allowedBranchesOf(ctx)) };
    });
  }

  // ---- number: status, search, deliberate two-step purchase, register an owned number ----
  @Get('number') @RequirePermission('settings.view') getNumber(@Req() r: any) { return this.numbers.get(ctxFrom(r).tenantId); }
  @Get('number/search') @RequirePermission('settings.view') searchNumbers(@Req() r: any, @Query('areaCode') areaCode?: string, @Query('country') country?: string) { return this.numbers.search(ctxFrom(r).tenantId, { areaCode, country }); }

  /** Step 1: availability re-check + the provider's quoted price + a short-lived confirmation. Buys nothing. */
  @Post('number/quote') @RequirePermission('settings.edit') quoteNumber(@Req() r: any, @Body(ValidatedBody(NUMBER_QUOTE_BODY, { strict: true })) b: any) {
    const ctx = ctxFrom(r);
    return coded(async () => { mustEdit(ctx); return this.numbers.quote(ctx.userId, ctx.tenantId, String(b?.phoneNumber ?? '').trim()); });
  }
  /** Step 2: buy — only with the confirmation issued for THIS salon and THIS number (a replay returns the first result). */
  @RequireStepUp() @Post('number/buy') @RequirePermission('settings.edit') buyNumber(@Req() r: any, @Body(ValidatedBody(NUMBER_BUY_BODY, { strict: true })) b: any) {
    const ctx = ctxFrom(r);
    return coded(async () => {
      mustEdit(ctx);
      if (!b?.phoneNumber) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'phoneNumber is required' }, HttpStatus.BAD_REQUEST);
      return this.numbers.confirmPurchase(ctx.userId, ctx.tenantId, String(b.phoneNumber).trim(), String(b?.confirmationToken ?? '').trim());
    });
  }
  @Post('number/register') @RequirePermission('settings.edit') registerNumber(@Req() r: any, @Body(ValidatedBody(PHONE_NUMBER_BODY, { strict: true })) b: any) {
    const ctx = ctxFrom(r); mustEdit(ctx);
    if (!b?.phoneNumber) throw new HttpException('phoneNumber is required', HttpStatus.BAD_REQUEST);
    return this.numbers.registerExisting(ctx.userId, ctx.tenantId, b.phoneNumber);
  }

  // Phase 4: the salon's own Twilio, including the Verify Service booking verification sends through. The plain routes
  // address the salon default every branch inherits; `credentials/branches/:branchId/…` a branch's own credentials.
  // A PATH parameter, not `?branchId=`: the session middleware strips tenantId/branchId from every tenant request's
  // body and query (a client must never name its scope) — the first version used the query and, live, every branch
  // operation silently hit the salon default. The service checks the branch is this salon's.
  @Get('credentials') @RequirePermission('settings.view')
  get(@Req() r: any) { return this.svc.getMasked(ctxFrom(r).tenantId, null); }

  @Get('credentials/branches') @RequirePermission('settings.view')
  branches(@Req() r: any) { return this.svc.listBranchOverrides(ctxFrom(r).tenantId); }

  @Get('credentials/branches/:branchId') @RequirePermission('settings.view')
  getBranch(@Req() r: any, @Param('branchId') branchId: string) { return this.svc.getMasked(ctxFrom(r).tenantId, branchId); }

  /** PM-02: the ONLY way to see the full Account SID — settings.edit + a fresh step-up, audited (fail-closed). */
  @RequireStepUp() @Post('credentials/reveal-sid') @RequirePermission('settings.edit')
  revealSid(@Req() r: any, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) { const ctx = ctxFrom(r); return coded(async () => { mustEdit(ctx); return this.svc.revealAccountSid(ctx.userId, ctx.tenantId, null); }); }

  @RequireStepUp() @Post('credentials/branches/:branchId/reveal-sid') @RequirePermission('settings.edit')
  revealSidBranch(@Req() r: any, @Param('branchId') branchId: string, @Body(ValidatedBody(EMPTY_BODY, { strict: true })) _b: any) {
    const ctx = ctxFrom(r); return coded(async () => { mustEdit(ctx); mustReachBranch(ctx, branchId); return this.svc.revealAccountSid(ctx.userId, ctx.tenantId, branchId); });
  }

  // Security Deep Scan §59 (Oct 28 2026): the salon's Twilio credentials — fresh step-up, like the Super Admin equivalent
  @RequireStepUp() @Put('credentials') @RequirePermission('settings.edit')
  set(@Req() r: any, @Body(ValidatedBody(MESSAGING_CREDS_BODY, { strict: true })) b: any) { return this.save(r, b, null); }

  @RequireStepUp() @Put('credentials/branches/:branchId') @RequirePermission('settings.edit')
  setBranch(@Req() r: any, @Body(ValidatedBody(MESSAGING_CREDS_BODY, { strict: true })) b: any, @Param('branchId') branchId: string) { return this.save(r, b, branchId); }

  private async save(r: any, b: any, branchId: string | null) {
    const ctx = ctxFrom(r); mustEdit(ctx);
    return coded(() => this.svc.set(ctx.userId, ctx.tenantId, {
      accountSid: b?.accountSid, authToken: b?.authToken, fromNumber: b?.fromNumber,
      verifyServiceSid: b?.verifyServiceSid, apiKeySid: b?.apiKeySid, apiKeySecret: b?.apiKeySecret, confirmUnverified: b?.confirmUnverified === true,
    }, branchId));
  }

  /** Disconnect this scope's Twilio (a branch falls back to the salon default). */
  @RequireStepUp() @Delete('credentials') @RequirePermission('settings.edit')
  disconnect(@Req() r: any) { return this.drop(r, null); }

  @RequireStepUp() @Delete('credentials/branches/:branchId') @RequirePermission('settings.edit')
  disconnectBranch(@Req() r: any, @Param('branchId') branchId: string) { return this.drop(r, branchId); }

  private async drop(r: any, branchId: string | null) {
    const ctx = ctxFrom(r); mustEdit(ctx);
    return coded(() => this.svc.disconnect(ctx.userId, ctx.tenantId, branchId));
  }

  /** "Test Verify": fetch the Verify Service with these credentials and record the outcome. */
  @Post('credentials/test-verify') @RequirePermission('settings.edit')
  testVerify(@Req() r: any) { const ctx = ctxFrom(r); return this.svc.testVerify(ctx.userId, ctx.tenantId, null); }

  @Post('credentials/branches/:branchId/test-verify') @RequirePermission('settings.edit')
  testVerifyBranch(@Req() r: any, @Param('branchId') branchId: string) { const ctx = ctxFrom(r); return this.svc.testVerify(ctx.userId, ctx.tenantId, branchId); }

  /** Test SMS: an explicit confirmation, an idempotency key, the readiness a real send needs, and a recorded result. */
  @Post('credentials/test') @RequirePermission('settings.edit')
  test(@Req() r: any, @Body(ValidatedBody(MESSAGING_TEST_BODY, { strict: true })) b: any) { return this.sendTest(r, b, null); }

  /** PM-01: the same test, sent with an AUTHORIZED branch's effective configuration (its own Twilio, else the default). */
  @Post('credentials/branches/:branchId/test') @RequirePermission('settings.edit')
  testBranch(@Req() r: any, @Param('branchId') branchId: string, @Body(ValidatedBody(MESSAGING_TEST_BODY, { strict: true })) b: any) { return this.sendTest(r, b, branchId); }

  private sendTest(r: any, b: any, branchId: string | null) {
    const ctx = ctxFrom(r);
    return coded(async () => {
      mustEdit(ctx);
      if (branchId) mustReachBranch(ctx, branchId);
      if (b?.confirm !== true) throw new HttpException({ code: 'TEST_SMS_CONFIRMATION_REQUIRED', message: 'Confirm the test message before it is sent.' }, ERROR_REGISTRY.TEST_SMS_CONFIRMATION_REQUIRED.status);
      if (!b?.idempotencyKey) throw new HttpException({ code: 'TEST_SMS_IDEMPOTENCY_KEY_REQUIRED', message: 'This test message is missing its request key.' }, ERROR_REGISTRY.TEST_SMS_IDEMPOTENCY_KEY_REQUIRED.status);
      return this.svc.testSend(ctx.userId, ctx.tenantId, b?.to, { idempotencyKey: String(b.idempotencyKey), requireReady: true, branchId, message: typeof b?.message === 'string' ? b.message : null });
    });
  }
}
