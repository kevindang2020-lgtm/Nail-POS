// mfa-enrollment.guard.ts — Constitution 3 §176 (Step 9): the salon requires two-factor for owners and managers, and
// this one has no authenticator yet. The session reaches only its sign-in routes (/auth/* — setting up and confirming
// the authenticator, me, refresh, sign-out) until a factor is confirmed; the moment it is, the gate lifts (re-read for
// restricted sessions only), so they continue without signing in again. Never a lock-out, never a way around the policy.
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';

export const MFA_ENROLLMENT_REFUSAL = { code: 'MFA_ENROLLMENT_REQUIRED', message: 'Your salon requires two-factor sign-in. Set up your authenticator app to continue.' };
export function enrollmentAllows(path: string): boolean { return /^\/(api\/v1\/)?auth(\/|$)/.test(String(path || '').split('?')[0]); }

@Injectable()
export class MfaEnrollmentGuard implements CanActivate {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    if (req?.ctx?.restriction !== 'MFA_ENROLLMENT_REQUIRED') return true;
    if (enrollmentAllows(String(req.originalUrl ?? req.url ?? req.path ?? ''))) return true;
    if (this.db && req.ctx.userId) {
      const r: any = await sql`select 1 from mfa_factors where user_id = ${req.ctx.userId} and type = 'totp' and confirmed = true limit 1`.execute(this.db).catch(() => ({ rows: [] }));
      if (r.rows.length) return true;   // enrolled now — the policy is satisfied
    }
    throw new ForbiddenException(MFA_ENROLLMENT_REFUSAL);
  }
}
