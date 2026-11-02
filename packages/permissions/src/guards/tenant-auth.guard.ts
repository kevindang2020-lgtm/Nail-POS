// STEP 3 — only tenant POS roles may hit /pos/*.
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { isTenantRole } from '../security-core';
@Injectable()
export class TenantAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    // Constitution 3 Step 7: a verified tenant API key (set ONLY by TenantContextMiddleware after the key checked out) is a
    // salon-scoped actor too; its permissions are its allow-listed scopes, which the permission guard still enforces.
    // Step 10d: an OAuth app token is the same kind of verified integration (integrationId = 'oauth:<client>' / 'apikey:<id>')
    const integration = req.ctx?.actorType === 'INTEGRATION' && req.ctx.role === 'INTEGRATION' && (typeof req.ctx?.apiKeyId === 'string' || /^oauth:/.test(String(req.ctx?.integrationId ?? '')));
    if (!req.ctx || (!isTenantRole(req.ctx.role) && !integration)) throw new ForbiddenException("Tenant POS access only");
    return true;
  }
}
