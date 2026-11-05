// staff-session.guard.ts — a signed-in STAFF session of any plane (tenant staff or platform staff), for self-service routes
// that act only on the caller's OWN row (their avatar, their POS lock PIN). Customer sessions are refused. Added in the Sep
// 2026 merge so the developer's /auth/avatar and /auth/*-pin routes declare their authorization (Constitution 12 §27).
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class StaffSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const ctx = req?.ctx;
    if (!ctx?.userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in first.' });
    if (String(ctx.role || '').toUpperCase() === 'CUSTOMER' || ctx.realm === 'customer') throw new ForbiddenException({ code: 'staff_only', message: 'Staff accounts only.' });
    return true;
  }
}
