// platform-domain.guard.ts — Constitution 7 §7: DENY BY DEFAULT inside the control plane.
//
// RolePermissionGuard lets any handler WITHOUT @RequirePermission through. For /super-admin routes that meant any
// platform identity reached ~867 routes that declare no key — harmless while one role held everything, decisive the
// moment a narrower platform role exists. This guard gives every such route its DERIVED key (domain + read/manage, from
// platform-roles.ts) and refuses an identity that lacks it. A route that declares its own key is left to
// RolePermissionGuard (explicit always wins). A platform path the map does not classify is refused outright.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '../security-core';
import { platformDomainKeyFor, platformPathKey } from '../platform-roles';

@Injectable()
export class PlatformDomainGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (req?.ctx?.role !== 'SUPER_ADMIN') return true;                       // other planes: RealmGuard + RolePermissionGuard
    const path = String(req.route?.path ?? req.path ?? req.originalUrl ?? '');
    if (platformPathKey(path) === null) return true;                          // not a platform route
    if (this.reflector.get<string>('perm', context.getHandler())) return true;   // declares its own key: RolePermissionGuard enforces it
    const key = platformDomainKeyFor(path, req.method);
    if (!key) throw new ForbiddenException('This platform route is not classified — denied by default.');
    if (!hasPermission(req.ctx, key)) throw new ForbiddenException('Missing permission: ' + key);
    return true;
  }
}
