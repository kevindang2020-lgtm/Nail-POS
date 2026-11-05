// STEP 3 — Technician app & Customer app guards (own-data surfaces).
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { isTenantRole } from '../security-core';
@Injectable()
export class TechnicianAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const r = req.ctx?.role;
    if (r === "TECHNICIAN" || isTenantRole(r)) return true; // managers may view tech surfaces
    throw new ForbiddenException("Technician access only");
  }
}
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.ctx?.role !== "CUSTOMER") throw new ForbiddenException("Customer access only");
    return true;
  }
}
