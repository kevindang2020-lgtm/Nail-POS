// owner-portfolio.guard.ts — only an OWNER may touch the portfolio surface.
//
// The session middleware has already verified the signature, expiry AND revocation before this runs. This adds the
// one thing it cannot know: that the caller is an owner at all.
//
// A MANAGER or RECEPTION user must never reach the portfolio — it lists every salon a person may enter, so
// exposing it to salon staff would tell a receptionist at one salon which other businesses the owner runs.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { hasTenantWideScope } from '@aipowersalon/permissions';

// BUILD_PLAN Phase 9: was OWNER_ROLES = new Set(['OWNER']). "Is an owner" for the portfolio means the owner's
// cross-branch view — owner.branches.compare (owner-level templates hold it; a manager does not) — a permission the
// salon can deny or grant, not the role's name.

@Injectable()
export class OwnerPortfolioGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (!req?.ctx?.userId || !hasTenantWideScope(req.ctx)) {
      throw new ForbiddenException('Owner access only');
    }
    return true;
  }
}
