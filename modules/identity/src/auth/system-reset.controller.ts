// system-reset.controller.ts — admin / super-admin initiated reset + temporary-password flow (SystemPasswordResetService).
//   POST /auth/super-admin/forgot-password   — super-admin self-serve (no salon code); always generic.
//   POST /auth/admin/reset-user-password      — authenticated actor resets another user (permission + reason enforced).
//   POST /auth/temp-password-login            — exchange a temporary password for a must-change session.
//   POST /auth/change-temporary-password      — set the new password; revoke old sessions; fresh tokens.
import { safeInet, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { Body, Controller, HttpCode, HttpException, Post, Req, Inject, Optional } from '@nestjs/common';
import { SystemPasswordResetService, type UserRow } from './system-password-reset.service';
import { sessionFromRequest } from './session-from-request';
import type { AnyRole } from './reset-authz';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ADMIN_RESET_BODY, CHANGE_TEMP_PASSWORD_BODY, SA_FORGOT_BODY, TEMP_PASSWORD_LOGIN_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
@Controller('auth')
export class SystemResetController {
  constructor(private readonly svc: SystemPasswordResetService, @Optional() @Inject(DATABASE) private readonly db: AppDatabase) {}

  @Post('super-admin/forgot-password') @HttpCode(200)
  superAdminForgot(@Body(ValidatedBody(SA_FORGOT_BODY)) b: any, @Req() r: any) {
    return this.svc.superAdminForgotPassword({ emailOrPhone: String(b?.emailOrPhone ?? ''), deliveryMethod: b?.deliveryMethod, ip: safeInet(r?.ip) ?? undefined });
  }

  @Post('admin/reset-user-password') @HttpCode(200)
  async adminReset(@Body(ValidatedBody(ADMIN_RESET_BODY)) b: any, @Req() r: any) {
    const session = sessionFromRequest(r, process.env.AUTH_SESSION_SECRET || '');
    if (!session) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED', message: 'Please sign in.' }, 401);
    const actor = { userId: session.userId, role: session.role as AnyRole, tenantId: session.tenantId ?? null, permissions: (session as any).permissions ?? [], mfaVerified: !!r?.headers?.['x-mfa-verified'] };
    try {
      return await this.svc.adminResetUserPassword(actor, String(b?.targetUserId ?? ''), { deliveryMethod: b?.deliveryMethod ?? 'auto', reason: String(b?.reason ?? '') });
    } catch (e: any) {
      const m = e?.message || 'reset_failed';
      const code = m === 'forbidden' || m === 'forbidden_cross_tenant' || m === 'mfa_required' ? 403 : m === 'not_found' ? 404 : 400;
      throw new HttpException({ ok: false, code: m, message: m }, code);
    }
  }

  @Post('temp-password-login') @HttpCode(200)
  async tempLogin(@Body(ValidatedBody(TEMP_PASSWORD_LOGIN_BODY)) b: any) {
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
    return this.svc.loginWithTemporaryPassword(user, String(b?.password ?? ''), { hash: row.temp_password_hash, expiresAt });
  }

  @Post('change-temporary-password') @HttpCode(200)
  async change(@Body(ValidatedBody(CHANGE_TEMP_PASSWORD_BODY)) b: any) {
    try {
      return await this.svc.changeTemporaryPassword({ changePasswordSessionId: String(b?.changePasswordSessionId ?? ''), newPassword: String(b?.newPassword ?? ''), confirmPassword: String(b?.confirmPassword ?? '') });
    } catch (e: any) {
      throw new HttpException({ ok: false, code: e?.message || 'change_failed', message: e?.message || 'change_failed' }, 400);
    }
  }
}
