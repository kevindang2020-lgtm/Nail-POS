// customer-activation.controller.ts — PUBLIC (pre-auth) first-time activation endpoints.
//
// These are unauthenticated by necessity: the customer has no session yet. They are therefore excluded from the
// session middleware in AppModule, exactly like /auth/login and /customer/auth/register.
//
// A successful activation issues the SAME kind of session the rest of the platform uses (signed httpOnly cookie),
// including a `sid` so the session is REVOCABLE — a session that cannot be revoked is a session you cannot kill
// when a device is lost.
import { signSession, cookieNameFor, type SessionStore } from '@aipowersalon/identity';
import { NotificationsModule } from '@aipowersalon/communications';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';
import { safeInet, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SecurityEvents } from '@aipowersalon/security-center';
import { Body, Controller, HttpCode, HttpException, Inject, Optional, Post, Req, Res } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { CustomerActivationService, ActivationError, InMemoryTicketStore, GrantTicketStore, type SmsSender } from './customer-activation.service';
import { KyselyEphemeralGrants } from '@aipowersalon/auth';
import { KyselyActivationRepo, InMemoryActivationRepo, type ActivationRepo } from './customer-activation.repository';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ACTIVATION_REQUEST_BODY, ACTIVATION_SELECT_SALON_BODY, ACTIVATION_VERIFY_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
const TTL = Number(process.env.AUTH_SESSION_TTL) || 60 * 60 * 12;

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ActivationError) throw new HttpException({ ok: false, code: e.code, ...(e.extra || {}) }, e.status);
    throw e;
  }
}

@Controller('customer/auth/activation')
export class CustomerActivationController {
  constructor(
    private readonly svc: CustomerActivationService,
    @Optional() @Inject('SessionStore') private readonly sessions?: SessionStore,
  ) {}

  /** Step 1 — phone only. Response is identical whether or not the number is known. */
  @Post('request-code') @HttpCode(200)
  requestCode(@Req() r: any, @Body(ValidatedBody(ACTIVATION_REQUEST_BODY, { strict: true })) b: any) {
    return run(() => this.svc.requestCode({ phone: b?.phone, ip: safeInet(r?.ip) ?? null, deviceId: b?.deviceId ?? null }));
  }

  /** Resend — the cooldown lives in the service; this is the same operation. */
  @Post('resend-code') @HttpCode(200)
  resend(@Req() r: any, @Body(ValidatedBody(ACTIVATION_REQUEST_BODY, { strict: true })) b: any) {
    return run(() => this.svc.requestCode({ phone: b?.phone, ip: safeInet(r?.ip) ?? null, deviceId: b?.deviceId ?? null }));
  }

  /** Step 2 — verify. Only on success does any customer information get resolved. */
  @Post('verify-code') @HttpCode(200)
  async verify(@Body(ValidatedBody(ACTIVATION_VERIFY_BODY, { strict: true })) b: any, @Res() res: any) {
    const result = await run(() => this.svc.verifyCode({ phone: b?.phone, code: String(b?.code ?? '') }));
    await this.finish(result, res);
  }

  /** Step 2b — the customer picked which salon. The ticket proves the phone was just verified. */
  @Post('select-salon') @HttpCode(200)
  async selectSalon(@Body(ValidatedBody(ACTIVATION_SELECT_SALON_BODY, { strict: true })) b: any, @Res() res: any) {
    const result = await run(() => this.svc.selectSalon({ ticket: String(b?.ticket ?? ''), choiceId: String(b?.choiceId ?? '') }));
    await this.finish(result, res);
  }

  /** Issue the session cookie on SUCCESS. Nothing about the customer is returned before this point. */
  private async finish(result: any, res: any) {
    if (result.outcome !== 'SUCCESS') { res.status(200).json({ ok: result.outcome !== 'FAILED', ...result }); return; }

    const secret = process.env.AUTH_SESSION_SECRET || '';
    if (!secret) { res.status(500).json({ ok: false, error: 'AUTH_SESSION_SECRET is not configured' }); return; }

    // Create a revocable session row first, then embed its id in the token.
    const sid = this.sessions
      ? await this.sessions.create({ userId: result.userId, tenantId: result.tenantId, branchId: null, ttlSeconds: TTL })
      : null;

    const token = signSession(
      { userId: result.userId, tenantId: result.tenantId, branchId: null, role: 'CUSTOMER', permissions: [], subscriptionStatus: 'active', ...(sid ? { sid } : {}) } as any,
      { secret, ttlSeconds: TTL },
    );
    res.cookie(cookieNameFor('CUSTOMER'), token, {   // §1–6: the customer realm's cookie
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: TTL * 1000, path: '/',
    });
    // Safe session data only — no tenant internals, no customer record.
    res.status(200).json({ ok: true, outcome: 'SUCCESS', salonName: result.salonName });
  }
}

@Module({
  imports: [NotificationsModule],
  controllers: [CustomerActivationController],
  providers: [
    {
      provide: CustomerActivationService,
      useFactory: (db: AppDatabase, messenger: TenantMessenger, securityEvents?: SecurityEvents) => {
        const repo: ActivationRepo = db ? new KyselyActivationRepo(db) : new InMemoryActivationRepo();
        // SMS goes through the tenant messenger (Phase 2: NotificationsService.sendSms — one send path, provider
        // breaker, ledger and events) — not a second SMS implementation.
        //
        // Deliberately a PLAIN assignment, not a cast. `as unknown as SmsSender` would compile even if the real
        // service's signature drifted away from the port — the mismatch would only surface at runtime, when a
        // customer's verification text silently fails to send. This way tsc proves the binding on every build.
        const sms: SmsSender = messenger;
        // Constitution 12 §115: a refused premium-rate destination is HIGH; a high-cost one sent anyway is MEDIUM —
        // grouped later by the security events' countRecent, never paged per event.
        const onAbuse = (e: { risk: string; maskedPhone: string; ip: string | null }) => void securityEvents?.record({
          type: 'SMS_ABUSE_DETECTED', severity: e.risk === 'high_cost' ? 'MEDIUM' : 'HIGH', actorType: 'anonymous',
          resourceType: 'customer_activation', resourceId: e.risk, reason: `${e.risk} destination ${e.maskedPhone}`, ip: e.ip,
        });
        // Durable, cross-instance tickets when a database is configured (migration 456); in-memory only without one.
        const tickets = db ? new GrantTicketStore(new KyselyEphemeralGrants(db)) : new InMemoryTicketStore();
        return new CustomerActivationService(repo, sms, tickets, undefined, onAbuse);
      },
      inject: [DATABASE, TENANT_MESSENGER, { token: SecurityEvents, optional: true }],
    },
  ],
  exports: [CustomerActivationService],
})
export class CustomerActivationModule {}
