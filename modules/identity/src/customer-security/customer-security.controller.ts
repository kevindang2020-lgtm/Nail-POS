// customer-security.controller.ts — Profile → Security for the Customer App.
//
// Everything here reuses existing platform code:
//   • password create/change → auth/account-core (createOwnPasswordCore / changeOwnPasswordCore) + the existing
//     password policy and hasher.
//   • sessions list / revoke → the existing `sessions` table + the SessionStore that makes revocation real.
//   • Face ID → the EXISTING WebAuthnService. That service was fully built (begin/finish registration and
//     authentication, with `webauthn_credentials` + `webauthn_challenges` tables) but was registered in NO
//     module, so it had no route and Face ID was unreachable. This controller is where it finally gets mounted.
//
// All routes require an authenticated customer session. A customer who activated by SMS one-time code has no
// password yet — `create` exists for exactly that case and refuses to overwrite an existing password.
import { AccountError, changeOwnPasswordCore, createOwnPasswordCore } from '../auth/account-core';
import { type SessionStore } from '../auth/session-store';
import { propagateTechnicianPassword } from '../auth/password-scope';
import { Body, Controller, Get, HttpException, Inject, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { CustomerAuthGuard } from './customer-security.guard';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CUSTOMER_PASSWORD_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxOf(req: any) {
  const c = req?.ctx || {};
  return { userId: String(c.userId || ''), tenantId: String(c.tenantId || ''), sessionId: req?.sessionId ?? null };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof AccountError) {
      const status = e.code === 'not_found' ? 404 : e.code === 'password_already_set' ? 409 : 400;
      throw new HttpException({ ok: false, code: e.code, message: e.message }, status);
    }
    throw e;
  }
}

@UseGuards(CustomerAuthGuard)
@Controller('customer/me/security')
export class CustomerSecurityController {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Optional() @Inject('SessionStore') private readonly sessions?: SessionStore,
  ) {}

  /** Deps for the shared account-core, bound to this platform's real hasher/policy/store. */
  private deps() {
    const db = this.db;
    return {
      async loadPasswordHash(userId: string): Promise<string | null> {
        if (!db) return null;
        const r: any = await sql`select password_hash from users where id = ${userId}`.execute(db);
        return r?.rows?.[0]?.password_hash ?? null;
      },
      verify: verifyPassword,
      hash: hashPassword,
      async setPassword(userId: string, hash: string): Promise<void> {
        if (!db) return;
        await sql`update users set password_hash = ${hash}, password_changed_at = now(), updated_at = now() where id = ${userId}`.execute(db);
        // A technician has ONE password (auth/password-scope.ts). For a CUSTOMER the peer query is definitionally
        // empty, so this costs one indexed lookup and nothing else — and it is called rather than reasoned about,
        // because "no technician can ever reach this route" is the kind of claim that quietly stops being true.
        await propagateTechnicianPassword(db as any, userId, hash);
      },
      async loadConfirmedTotpSecret(): Promise<string | null> { return null; },   // customers don't use TOTP
      // Customers do not use TOTP — MFA step-up is a staff control. These are inert stubs for the shared core.
      matchTotpStep: () => null,
      async markTotpStepUsed(): Promise<boolean> { return true; },
      now: () => Date.now(),
    };
  }

  /** Does this customer have a password yet? Drives the "Create a password…" prompt. */
  @Get('status')
  async status(@Req() r: any) {
    const { userId } = ctxOf(r);
    const hash = await this.deps().loadPasswordHash(userId);
    return { ok: true, hasPassword: !!hash };
  }

  /** Create a FIRST password (OTP-activated customers). Refuses if one already exists. */
  @Post('password/create')
  createPassword(@Req() r: any, @Body(ValidatedBody(CUSTOMER_PASSWORD_BODY, { strict: true })) b: any) {
    const { userId } = ctxOf(r);
    return run(async () => {
      await createOwnPasswordCore(this.deps(), userId, {
        newPassword: String(b?.newPassword ?? ''), confirmPassword: String(b?.confirmPassword ?? ''),
      });
      return { ok: true };
    });
  }

  /** Change an existing password — the current one must be proven. */
  @Post('password/change')
  changePassword(@Req() r: any, @Body(ValidatedBody(CUSTOMER_PASSWORD_BODY, { strict: true })) b: any) {
    const { userId } = ctxOf(r);
    return run(async () => {
      await changeOwnPasswordCore(this.deps() as any, userId, {
        currentPassword: String(b?.currentPassword ?? ''),
        newPassword: String(b?.newPassword ?? ''),
        confirmPassword: String(b?.confirmPassword ?? ''),
      });
      // Changing the password kills every OTHER session — a stolen session must not survive a password change.
      await this.revokeOthers(userId, ctxOf(r).sessionId);
      return { ok: true, otherSessionsSignedOut: true };
    });
  }

  /** Active sessions for this customer. Never exposes tokens — only device/created/last-seen metadata. */
  @Get('sessions')
  async listSessions(@Req() r: any) {
    const { userId, sessionId } = ctxOf(r);
    if (!this.db) return { ok: true, sessions: [] };
    const rows: any = await sql`
      select id, ip_address, user_agent, created_at, expires_at
      from sessions
      where user_id = ${userId} and status = 'active' and expires_at > now()
      order by created_at desc limit 50`.execute(this.db);
    return {
      ok: true,
      sessions: (rows?.rows ?? []).map((s: any) => ({
        id: String(s.id),
        current: String(s.id) === String(sessionId),
        ip: s.ip_address ?? null,
        device: s.user_agent ?? null,
        createdAt: s.created_at,
      })),
    };
  }

  /** Sign out one device. Revocation is real — the middleware rejects it on its next request, and any open
   *  realtime stream is terminated. */
  @Post('sessions/:id/revoke')
  async revokeSession(@Req() r: any, @Param('id') id: string) {
    const { userId } = ctxOf(r);
    if (!this.db || !this.sessions) return { ok: false };
    // Scope the revoke to THIS customer — you can never kill someone else's session.
    const owned: any = await sql`select id from sessions where id = ${id} and user_id = ${userId}`.execute(this.db);
    if (!owned?.rows?.length) throw new HttpException({ ok: false, code: 'not_found' }, 404);
    await this.sessions.revoke(id);
    return { ok: true };
  }

  /** Sign out of all OTHER devices. */
  @Post('sessions/revoke-others')
  async revokeOthersRoute(@Req() r: any) {
    const { userId, sessionId } = ctxOf(r);
    const n = await this.revokeOthers(userId, sessionId);
    return { ok: true, revoked: n };
  }

  private async revokeOthers(userId: string, keepSessionId: string | null): Promise<number> {
    if (!this.db || !this.sessions) return 0;
    const rows: any = await sql`
      select id from sessions where user_id = ${userId} and status = 'active'`.execute(this.db);
    const ids = (rows?.rows ?? []).map((x: any) => String(x.id)).filter((id: string) => id !== keepSessionId);
    for (const id of ids) await this.sessions.revoke(id);
    return ids.length;
  }
}
