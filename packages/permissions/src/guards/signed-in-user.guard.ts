// signed-in-user.guard.ts — Constitution 3 / 12 §27 (Oct 4 2026): a signed-in PERSON of any realm (salon staff, platform
// staff or customer) acting on their OWN account — their devices, sign-in activity, recovery codes, step-up. Integrations
// (API keys, OAuth apps) are refused: a token acting for a salon never manages a person's sign-in security.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
@Injectable()
export class SignedInUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = context.switchToHttp().getRequest()?.ctx;
    if (!ctx?.userId) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in first.' });
    if (ctx.actorType === 'INTEGRATION' || ctx.role === 'INTEGRATION') throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Apps cannot manage account security.' });
    return true;
  }
}
