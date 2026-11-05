// tenant-rate-limit.guard.ts — global guard enforcing per-tenant API rate limits (Scaling Roadmap Phase 3).
//
// Registered via APP_GUARD, it runs after TenantContextMiddleware so req.ctx.tenantId is available. ON by default since
// BUILD_PLAN Phase 11 (TENANT_RATE_LIMIT=off, or the Super Admin toggle set OFF, makes it a pass-through). When enabled and a tenant's per-window budget is exceeded, it throws
// 429 with a Retry-After header. It NEVER blocks requests without a tenant id (public/pre-session routes) and never
// limits SUPER_ADMIN (the one cross-tenant, low-volume operator role) — so platform operators and login flows are
// unaffected.
import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { rateLimitKey, tenantRateLimitEnabled, type TenantRateLimiter } from './tenant-rate-limit';
import { TENANT_RATE_LIMITER } from './rate-limit.module';
import { PlatformFlagService } from './platform-flags';
import { isPlatformPrincipal } from '@aipowersalon/permissions';

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  constructor(@Inject(TENANT_RATE_LIMITER) private readonly limiter: TenantRateLimiter, private readonly flags: PlatformFlagService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Kill-switches: TENANT_RATE_LIMIT=off (or the older TENANT_RATE_LIMIT_GUARD_DISABLED=true) — authenticated tenant API
    // traffic is never throttled. The limiter itself also goes no-op then (rate-limit.module), incl. the public AI
    // booking endpoints that share it.
    if (!tenantRateLimitEnabled()) return true;
    if (!this.limiter.enabled) return true;                 // no limiter backend → nothing to enforce with
    const req = context.switchToHttp().getRequest();
    const ctx = req?.ctx;
    const tenantId = ctx?.tenantId;
    // No tenant on the request (public/pre-session routes) → nothing to key on; let it through.
    if (!tenantId) return true;
    // SUPER_ADMIN is a low-volume cross-tenant operator; never rate-limit platform operations.
    if (isPlatformPrincipal(ctx)) return true;

    // Super Admin master toggle (Settings → General → "Per-Tenant API Rate Limiting"). Default ON since Phase 11; an
    // explicit OFF still turns it off, and a per-tenant rollout (allow/deny lists) applies when the flag service has one.
    const on = typeof (this.flags as any).isEnabledFor === 'function'
      ? await (this.flags as any).isEnabledFor('rate_limit.tenant_api_enabled', tenantId, true)
      : await this.flags.isEnabled('rate_limit.tenant_api_enabled', true);
    if (!on) return true;

    const decision = await this.limiter.hit(rateLimitKey(tenantId, ctx?.branchId));      // one budget per location; fail-open inside the limiter
    if (decision.allowed) return true;

    const res = context.switchToHttp().getResponse();
    const retryAfterSec = Math.ceil(decision.retryAfterMs / 1000);
    try { res?.header?.('Retry-After', String(retryAfterSec)); } catch { /* header best-effort */ }
    throw new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'RATE_LIMITED', error: 'Too Many Requests', message: 'Rate limit exceeded for this salon. Please retry shortly.', retryAfterSeconds: retryAfterSec, limit: decision.limit },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
