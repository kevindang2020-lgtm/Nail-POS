// system-reset.controller.ts — admin / super-admin initiated reset + temporary-password flow (SystemPasswordResetService).
//   POST /auth/super-admin/forgot-password   — super-admin self-serve (no salon code); always generic.
//   POST /auth/admin/reset-user-password      — authenticated actor resets another user (permission + reason enforced).
//       Security Deep Scan C6/A2/E4: this route is BEHIND the session middleware (revocation, lock, platform lockdown,
//       current-grant re-authorization) and the global guards — @RequirePermission('roles.manage') + @RequireStepUp() —
//       and the actor comes from req.ctx. It used to be excluded from the middleware, verify the bare token signature
//       itself, and take the Super Admin MFA proof from a CLIENT header (x-mfa-verified). The Super Admin reset of a
//       salon account lives on the platform plane (super-admin routes); this is the salon owner / manager path.
//   POST /auth/temp-password-login            — exchange a temporary password for a must-change session.
//   POST /auth/change-temporary-password      — set the new password; revoke old sessions; fresh tokens.
import { safeInet, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { Body, Controller, HttpCode, HttpException, Post, Req, Inject, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { SystemPasswordResetService, type UserRow } from './system-password-reset.service';
import type { AnyRole } from './reset-authz';

import { RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ADMIN_RESET_BODY, CHANGE_TEMP_PASSWORD_BODY, SA_FORGOT_BODY, TEMP_PASSWORD_LOGIN_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('auth')
export class SystemResetController {
  constructor(private readonly svc: SystemPasswordResetService, @Optional() @Inject(DATABASE) private readonly db: AppDatabase) {}

  @Post('super-admin/forgot-password') @HttpCode(200)
  superAdminForgot(@Body(ValidatedBody(SA_FORGOT_BODY, { strict: true })) b: any, @Req() r: any) {
    return this.svc.superAdminForgotPassword({ emailOrPhone: String(b?.emailOrPhone ?? ''), deliveryMethod: b?.deliveryMethod, ip: safeInet(r?.ip) ?? undefined });
  }

  @Post('admin/reset-user-password') @HttpCode(200)
  @RequirePermission('roles.manage') @RequireStepUp()
  async adminReset(@Body(ValidatedBody(ADMIN_RESET_BODY, { strict: true })) b: any, @Req() r: any) {
    const ctx = r?.ctx;
    if (!ctx?.userId) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED', message: 'Please sign in.' }, 401);
    const actor = {
      userId: String(ctx.userId), role: String(ctx.role) as AnyRole, tenantId: ctx.tenantId ?? null,
      // the CURRENT permissions (the middleware re-authorized them from today's grants), never the token's
      permissions: Array.isArray(ctx.permissions) ? ctx.permissions : [],
      // MFA proof from the SERVER: this session's step-up (enforced by @RequireStepUp) was password + authenticator
      mfaVerified: await this.steppedUpWithMfa(r?.sessionId ?? null, String(ctx.userId)),
      branchIds: Array.isArray(ctx.authz?.branchIds) ? (ctx.authz.branchIds as string[]) : null,
      ip: safeInet(r?.ip) ?? null,
    };
    try {
      return await this.svc.adminResetUserPassword(actor, String(b?.targetUserId ?? ''), { deliveryMethod: b?.deliveryMethod ?? 'auto', reason: String(b?.reason ?? '') });
    } catch (e: any) {
      const m = e?.message || 'reset_failed';
      const code = m === 'forbidden' || m === 'forbidden_cross_tenant' || m === 'forbidden_out_of_branch' || m === 'mfa_required' ? 403 : m === 'not_found' ? 404 : 400;
      throw new HttpException({ ok: false, code: m, message: m }, code);
    }
  }

  /** True when this session's latest step-up proved password AND authenticator (read from the session row, not the client). */
  private async steppedUpWithMfa(sid: string | null, userId: string): Promise<boolean> {
    if (!this.db || !sid) return false;
    const row: any = (await sql`select step_up_strength from sessions where id = ${sid} and user_id = ${userId} and revoked_at is null limit 1`.execute(this.db)).rows[0];
    return row?.step_up_strength === 'password_mfa';
  }

  @Post('temp-password-login') @HttpCode(200)
  async tempLogin(@Body(ValidatedBody(TEMP_PASSWORD_LOGIN_BODY, { strict: true })) b: any, @Req() r: any) {
    if (!this.db) return { ok: false, reason: 'unavailable' };
    const raw = String(b?.emailOrPhone ?? '').trim();
    const isEmail = raw.indexOf('@') >= 0;
    const email = isEmail ? raw.toLowerCase() : null;
    const phone = isEmail ? null : raw;
    const salon = String(b?.tenantCodeOrSlug ?? b?.salonCode ?? '').trim();
    const cols = ['id', 'tenant_id', 'branch_id', 'full_name', 'role', 'status', 'email', 'normalized_phone', 'temp_password_hash', 'temp_password_expires_at'] as const;
    let row: any;
    if (salon) {
      const t = await this.db.selectFrom('tenants').select(['id']).where('tenant_code', '=', salon).executeTakeFirst();
      if (!t) return { ok: false, reason: 'invalid' };
      row = await this.db.selectFrom('users').select(cols as any).where('tenant_id', '=', t.id)
        .where((eb) => eb.or([...(email ? [eb('email', '=', email)] : []), ...(phone ? [eb('normalized_phone', '=', phone)] : [])])).executeTakeFirst();
    } else {
      row = await this.db.selectFrom('users').select(cols as any).where('tenant_id', 'is', null).where('role', '=', 'SUPER_ADMIN')
        .where((eb) => eb.or([...(email ? [eb('email', '=', email)] : []), ...(phone ? [eb('normalized_phone', '=', phone)] : [])])).executeTakeFirst();
    }
    if (!row || !row.temp_password_hash) return { ok: false, reason: 'invalid' };
    const user: UserRow = { userId: row.id, tenantId: row.tenant_id ?? null, branchId: row.branch_id ?? null, fullName: row.full_name ?? '', role: String(row.role) as AnyRole, status: String(row.status), email: row.email ?? null, normalizedPhone: row.normalized_phone ?? null, permissions: [] };
    const expiresAt = row.temp_password_expires_at ? new Date(row.temp_password_expires_at).getTime() : 0;
    return this.svc.loginWithTemporaryPassword(user, String(b?.password ?? ''), { hash: row.temp_password_hash, expiresAt }, { ip: safeInet(r?.ip) ?? null });
  }

  @Post('change-temporary-password') @HttpCode(200)
  async change(@Body(ValidatedBody(CHANGE_TEMP_PASSWORD_BODY, { strict: true })) b: any) {
    try {
      return await this.svc.changeTemporaryPassword({ changePasswordSessionId: String(b?.changePasswordSessionId ?? ''), newPassword: String(b?.newPassword ?? ''), confirmPassword: String(b?.confirmPassword ?? '') });
    } catch (e: any) {
      throw new HttpException({ ok: false, code: e?.message || 'change_failed', message: e?.message || 'change_failed' }, 400);
    }
  }
}
