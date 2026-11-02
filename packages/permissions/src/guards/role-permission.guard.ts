// role-permission.guard.ts — @RequirePermission('checkout.process_payment') on a handler; the global guard enforces it.
//
// BUILD_PLAN Phase 9 (Constitution 2):
//   • the answer is the DECISION OBJECT (decision.ts), not a boolean: a refusal is 403
//     { code: 'PERMISSION_DENIED', reason, permission, message } — the reason says WHY (missing_permission,
//     denied_by_override, account_inactive, platform_key_for_tenant, …);
//   • every refusal is recorded (sampled per user + key + reason + minute) through the optional AUTHZ_DENIAL_SINK — the
//     owner's denial report and the platform's probing signal read it. Recording never blocks or fails a request;
//   • DEFAULT DENY for salon staff: a /pos, /owner, /tenant or /tech handler that declares no key is refused
//     (AUTHZ_ROUTE_UNKEYED) — behind TENANT_DEFAULT_DENY, which the lead flips once every staff route is keyed (the
//     check:api-contract unkeyed baseline is empty). Customers, platform staff (PlatformDomainGuard owns that plane),
//     public routes (no session) and /auth are never affected.
import { CanActivate, ExecutionContext, Inject, Injectable, ForbiddenException, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isTenantRole, routeFirstSegment, type Ctx } from '../security-core';
import { decide, type AuthzDecision } from '../decision';

export const RequirePermission = (key: string) => SetMetadata('perm', key);

/**
 * THE FLAG. false = a staff handler with no @RequirePermission passes (today's behaviour); true = it is refused with
 * AUTHZ_ROUTE_UNKEYED. Flip to true at integration, after check:api-contract reports 0 unkeyed staff routes.
 */
export const TENANT_DEFAULT_DENY: boolean = true;   // flipped by the lead at Phase 9 integration: the unkeyed staff baseline is 0
/** DI token: overrides TENANT_DEFAULT_DENY for one guard instance (tests; never provided in the app). */
export const TENANT_DEFAULT_DENY_OVERRIDE = 'TENANT_DEFAULT_DENY_OVERRIDE';
/** DI token: where denials are recorded (identity's AuthModule provides the Postgres sink). */
export const AUTHZ_DENIAL_SINK = 'AUTHZ_DENIAL_SINK';
export interface AuthzDenialRecord { tenantId: string | null; userId: string | null; role: string | null; permission: string; reason: string; route: string | null }
export interface AuthzDenialSink { record(d: AuthzDenialRecord): void | Promise<void> }

const STAFF_SEGMENTS = new Set(['pos', 'owner', 'tenant', 'tech']);
const isIntegration = (c: any) => c?.actorType === 'INTEGRATION' && c?.role === 'INTEGRATION';

/** The principal the decision sees for a request: the GRANT (pre-override) and the overrides, when the middleware
 *  recorded them; otherwise the context's own permission list (already effective). */
export function principalOfRequest(ctx: Ctx) {
  const a = ctx.authz;
  return {
    userId: ctx.userId, tenantId: ctx.tenantId || null, branchId: ctx.branchId || null, role: ctx.role,
    permissions: a?.grant ?? ctx.permissions ?? [],
    templateKey: a?.templateKey ?? null, scope: a?.scope ?? null, branchIds: a?.branchIds ?? null, overrides: a?.overrides ?? [],
  };
}

export function permissionDenied(d: Pick<AuthzDecision, 'reason' | 'key'>, message?: string): ForbiddenException {
  return new ForbiddenException({ code: 'PERMISSION_DENIED', reason: d.reason, permission: d.key, message: message ?? 'Missing permission: ' + d.key });
}

@Injectable()
export class RolePermissionGuard implements CanActivate {
  private readonly defaultDeny: boolean;
  constructor(
    private reflector: Reflector,
    @Optional() @Inject(AUTHZ_DENIAL_SINK) private readonly denials?: AuthzDenialSink | null,
    @Optional() @Inject(TENANT_DEFAULT_DENY_OVERRIDE) defaultDeny?: boolean | null,
  ) {
    this.defaultDeny = typeof defaultDeny === 'boolean' ? defaultDeny : TENANT_DEFAULT_DENY;
  }

  private route(req: any): string { return String(req?.route?.path ?? req?.originalUrl ?? req?.url ?? ''); }

  private record(req: any, key: string, reason: string): void {
    if (!this.denials) return;
    const c = req?.ctx ?? {};
    try {
      const r = this.denials.record({ tenantId: c.tenantId || null, userId: c.userId || null, role: c.role ?? null, permission: key, reason, route: this.route(req).slice(0, 300) || null });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch { /* recording never blocks a request */ }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const key = this.reflector.get<string>('perm', ctx.getHandler());
    const req = ctx.switchToHttp().getRequest();
    if (!key) {
      if (!this.defaultDeny) return true;
      const c = req?.ctx;
      if (!c || !(isTenantRole(c.role) || isIntegration(c))) return true;       // public / customer / platform: not this rule
      if (!STAFF_SEGMENTS.has(routeFirstSegment(this.route(req)))) return true;   // /auth, /me, /push …: declared per route
      this.record(req, '(unkeyed)', 'AUTHZ_ROUTE_UNKEYED');
      throw new ForbiddenException({ code: 'AUTHZ_ROUTE_UNKEYED', reason: 'missing_permission', permission: null, message: 'This action has no permission declared, so it is refused by default.' });
    }
    if (!req?.ctx) throw permissionDenied({ key, reason: 'missing_permission' });
    const d = decide(principalOfRequest(req.ctx), key);
    if (!d.allowed) {
      this.record(req, key, d.reason);
      throw permissionDenied(d);
    }
    return true;
  }
}
