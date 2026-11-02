// account.controller.ts — POST /auth/change-password for the signed-in user (thin adapter over account-core; same
// shape as mfa.controller: req.ctx identity, optional DATABASE, HttpException(400) with a stable code). On success the
// change is written to audit_logs (action user_password_changed) with which step-up confirmed.
import { Body, Controller, HttpCode, HttpException, Inject, Optional, Post, Req } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';   // INET column: a raw proxy-chain ip would throw and the row would be lost
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { changeOwnPasswordCore, AccountError } from './account-core';
import { verifyPassword, hashPassword } from '@aipowersalon/auth';
import { MFA_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { matchedTotpStep } from './totp';
import { sql } from 'kysely';
import { propagateTechnicianPassword } from './password-scope';
import { SecurityEvents } from '@aipowersalon/security-center';
import { PostgresAttemptBudget, attemptLockoutRecorder, type AttemptBudget } from './auth-attempt-budget';

/** The AccountError codes that are a wrong GUESS (spent against the budget); anything else is refunded. */
const GUESS_FAILURES: ReadonlySet<string> = new Set(['invalid_current', 'invalid_mfa', 'replayed_mfa']);

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CHANGE_PASSWORD_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('auth')
export class AccountController {
  // Security Deep Scan C4: the current password (and code) re-proved here had no attempt limit — a hijacked session was an
  // unlimited password oracle. 5 wrong guesses per account per 15 minutes, in Postgres (every replica, no Redis needed).
  private readonly budget: AttemptBudget | null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Inject(MFA_SECRETS) private readonly mfaSecrets: ProviderSecrets,
              @Optional() private readonly securityEvents?: SecurityEvents | null) {
    this.budget = db ? new PostgresAttemptBudget(db, { onLockout: attemptLockoutRecorder(securityEvents) }) : null;
  }
  private uid(r: any): string { const u = r?.ctx?.userId; if (!u) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401); return u; }
  private need(): NonNullable<AppDatabase> { if (!this.db) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'Database required.' }, 503); return this.db; }

  @Post('change-password') @HttpCode(200)
  async changePassword(@Req() r: any, @Body(ValidatedBody(CHANGE_PASSWORD_BODY, { strict: true })) b: any) {
    const db = this.need(); const userId = this.uid(r);
    const admission = this.budget ? await this.budget.admit('password_change', userId, { tenantId: r?.ctx?.tenantId ?? null, ip: safeInet(r?.ip), sessionId: r?.sessionId ?? null }) : null;
    if (admission && !admission.allowed) throw new HttpException({ ok: false, code: 'AUTH_ATTEMPTS_LOCKED', message: 'Too many incorrect attempts. Wait a few minutes and try again.', retryAfterSeconds: Math.ceil(admission.retryAfterMs / 1000) }, 429);
    let guessFailed = false;
    try {
      const out = await changeOwnPasswordCore({
        loadPasswordHash: async (id) => (await db.selectFrom('users').select(['password_hash']).where('id', '=', id).executeTakeFirst())?.password_hash ?? null,
        verify: verifyPassword,
        hash: hashPassword,
        setPassword: async (id, hash) => {
          await db.updateTable('users').set({ password_hash: hash, password_changed_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
          // A technician has ONE password. See auth/password-scope.ts.
          await propagateTechnicianPassword(db as any, id, hash);
        },
        loadConfirmedTotpSecret: async (id) => {
          const f = await db.selectFrom('mfa_factors').select(['secret_enc']).where('user_id', '=', id).where('type', '=', 'totp').where('confirmed', '=', true).orderBy('created_at', 'desc').executeTakeFirst();
          return f?.secret_enc ? this.mfaSecrets.decrypt(f.secret_enc) : null;
        },
        matchTotpStep: (secret, code, atMs) => matchedTotpStep(secret, code, atMs),
        markTotpStepUsed: async (id, step) => {
          const res: any = await (db as any).updateTable('mfa_factors').set({ last_used_step: step })
            .where('user_id', '=', id).where('type', '=', 'totp').where('confirmed', '=', true)
            .where((eb: any) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)]))
            .executeTakeFirst();
          return !!res && Number(res.numUpdatedRows ?? 0) > 0;
        },
        now: () => Date.now(),
      }, userId, {
        currentPassword: String(b?.currentPassword ?? ''), newPassword: String(b?.newPassword ?? ''),
        confirmPassword: String(b?.confirmPassword ?? ''), mfaCode: b?.mfaCode ? String(b.mfaCode) : undefined,
      });
      await db.insertInto('audit_logs' as any).values({
        id: sql`gen_random_uuid()`, tenant_id: r?.ctx?.tenantId ?? null, user_id: userId, role: r?.ctx?.role ?? null,
        action_type: 'user_password_changed', entity_type: 'user', entity_id: userId,
        metadata_json: JSON.stringify({ stepUp: out.stepUp }), ip_address: safeInet(r?.ip),
      } as any).execute().catch(() => { /* audit best-effort; the change itself already committed */ });
      return { ok: true };
    } catch (e) {
      guessFailed = e instanceof AccountError && GUESS_FAILURES.has(e.code);
      if (e instanceof AccountError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.code === 'not_found' ? 404 : 400);
      throw e;
    } finally {
      await admission?.settle(!guessFailed);
    }
  }


}
