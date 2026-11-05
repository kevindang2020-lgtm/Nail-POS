// realm.guard.ts — Constitution 12 §6, §15, §27: a session from one realm never acts in another.
//
// Authentication was already deny-by-default (every non-public route needs a valid, unrevoked session). The
// permission layer was not: RolePermissionGuard lets any handler WITHOUT @RequirePermission through, and 336 routes
// have neither a permission nor a realm guard. Most authorize inside their domain service (the right layer), but
// nothing stopped a CUSTOMER session — which carries a salon's tenantId — from reaching a staff route at all.
//
// This guard closes that boundary for every route at once, from the path, before any handler runs:
//   /customer/*                        → CUSTOMER only
//   /pos/*, /owner/*, /tenant/*, /tech/* → never CUSTOMER
//   /super-admin/*                     → SUPER_ADMIN only (its own guard already does this; stated here too)
// Public routes have no session (the middleware is excluded for them) and pass untouched.
// A denial is a 404 for the customer → staff direction (§265: do not confirm that a staff route exists) and a 403
// otherwise, and it is recorded as PRIVILEGE_ESCALATION_ATTEMPT.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { canAccessRoutePrefix, routeFirstSegment, isCustomerPrincipal } from '@aipowersalon/permissions';
import { SecurityEvents } from '@aipowersalon/security-center';

@Injectable()
export class RealmGuard implements CanActivate {
  constructor(@Optional() private readonly securityEvents?: SecurityEvents) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const role = req?.ctx?.role;
    if (!role) return true;                                   // public route: no session, nothing to cross
    const path = String(req.route?.path ?? req.path ?? req.originalUrl ?? '');
    if (canAccessRoutePrefix(role, path)) return true;
    const seg = routeFirstSegment(path);
    void this.securityEvents?.record({
      type: 'PRIVILEGE_ESCALATION_ATTEMPT', tenantId: req.ctx.tenantId || null, actorType: String(role).toLowerCase(),
      actorId: req.ctx.userId ?? null, resourceType: 'realm', resourceId: seg, reason: `${req.method} /${seg}/… by ${role}`,
    });
    if (isCustomerPrincipal(role)) throw new NotFoundException();
    throw new ForbiddenException('This area is not available to your account type.');
  }
}
