// integration-permission.guard.ts — enforces @RequireIntegrationPermission(P.x) on a handler. Runs alongside
// SuperAdminGuard: SuperAdminGuard establishes the SUPER_ADMIN role; this narrows to the specific capability. A
// handler with no metadata is unaffected (returns true), so unannotated endpoints keep working.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { checkIntegrationPermission } from './integration-permissions';

export const INTEGRATION_PERM = 'integration_perm';
export const RequireIntegrationPermission = (key: string) => SetMetadata(INTEGRATION_PERM, key);

@Injectable()
export class IntegrationPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const key = this.reflector.get<string>(INTEGRATION_PERM, ctx.getHandler());
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!checkIntegrationPermission(req?.ctx, key)) throw new ForbiddenException('Missing permission: ' + key);
    return true;
  }
}
