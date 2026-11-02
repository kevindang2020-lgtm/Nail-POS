// STEP 3 — /super-admin/* only. Tenants get 403.
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (!req.ctx || req.ctx.role !== "SUPER_ADMIN") throw new ForbiddenException("Super Admin only");
    return true;
  }
}
