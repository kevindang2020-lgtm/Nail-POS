// customer-security.guard.ts — allows only an authenticated CUSTOMER.
//
// The platform's `TenantAuthGuard` uses `isTenantRole()`, which deliberately excludes CUSTOMER (it gates the
// staff POS). So customers could not reach any of the existing `pos/me` security endpoints at all — there was no
// customer-facing route to list sessions or set a password. This guard is the customer equivalent.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const role = req?.ctx?.role;
    // The session middleware has already verified the signature, expiry AND revocation before we get here.
    if (!req?.ctx || role !== 'CUSTOMER') throw new ForbiddenException('Customer access only');
    return true;
  }
}
