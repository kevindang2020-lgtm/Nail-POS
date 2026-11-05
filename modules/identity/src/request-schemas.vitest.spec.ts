// BUILD_PLAN Phase 12 (#17): the identity routes' body validation, ROUTE BY ROUTE on the real controllers — the
// @Body(ValidatedBody(...)) pipe each handler carries (Nest's route metadata), fed (1) the bodies today's clients send
// (copied from the client code), which must pass with their fields intact, (2) the same plus an unknown field, which is
// stripped, (3) a bad body, which is a 400 VALIDATION_FAILED naming the field.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { AuthController } from './auth/auth.controller';
import { AccountController } from './auth/account.controller';
import { MfaController } from './auth/mfa.controller';
import { MfaRecoveryController } from './auth/mfa-recovery.controller';
import { SecurityNotMeController } from './auth/security-not-me.controller';
import { PasswordResetController } from './auth/password-reset.controller';
import { SystemResetController } from './auth/system-reset.controller';
import { CustomerSecurityController } from './customer-security/customer-security.controller';
import { StaffRolesController } from './staff-roles/staff-roles.controller';

type Case = { route: string; ctl: any; handler: string; today: Record<string, unknown>[]; bad: [Record<string, unknown>, string] };
const U = '11111111-1111-4111-8111-111111111111';
const CASES: Case[] = [
  { route: 'POST /auth/login', ctl: AuthController, handler: 'doLogin', today: [
      { portal: 'tenant', salonCode: 'PILOT03', identifier: 'kim@x.co', password: 'pw', rememberMe: true, mfaCode: '123456' },             // pos / tech / manager-pay
      { portal: 'owner', identifier: 'o@x.co', password: 'pw', ownerAccessCode: 'AC-1', rememberMe: false, device: { id: null, name: 'Owner app', platform: 'web' } },
      { portal: 'super-admin', identifier: 'sa@x.co', password: 'pw', rememberMe: true },                                                   // admin-web
      { portal: 'customer', identifier: 'c@x.co', password: 'pw' },                                                                         // minimal customer login (booking-html, removed Phase 15)
    ], bad: [{ identifier: 'x', password: { $ne: '' } }, 'password'] },
  { route: 'POST /auth/refresh', ctl: AuthController, handler: 'doRefresh', today: [{}, { refreshToken: 'r.t.k' }], bad: [{ refreshToken: ['a'] }, 'refreshToken'] },
  { route: 'POST /auth/select-branch', ctl: AuthController, handler: 'selectBranch', today: [{ branchId: U }, { branchId: U, deviceId: 'b4d0c7e2-0000-4000-8000-000000000001' }], bad: [{ branchId: { id: U } }, 'branchId'] },   // + manager-pay §120 (the phone asks the payment guard)
  { route: 'POST /auth/verify-pin', ctl: AuthController, handler: 'verifyPin', today: [{ pin: '1234' }], bad: [{ pin: 'x'.repeat(33) }, 'pin'] },
  { route: 'POST /auth/set-pin', ctl: AuthController, handler: 'setPin', today: [{ pin: '4321' }], bad: [{ pin: [1, 2, 3, 4] }, 'pin'] },
  { route: 'POST /auth/change-password', ctl: AccountController, handler: 'changePassword', today: [{ currentPassword: 'a', newPassword: 'b', confirmPassword: 'b' }, { currentPassword: 'a', newPassword: 'b', confirmPassword: 'b', mfaCode: '123456' }], bad: [{ newPassword: 'x'.repeat(2000) }, 'newPassword'] },
  { route: 'POST /auth/mfa/confirm', ctl: MfaController, handler: 'confirm', today: [{ code: '123456' }], bad: [{ code: { a: 1 } }, 'code'] },
  { route: 'POST /auth/mfa/recovery-codes', ctl: MfaController, handler: 'recoveryCodes', today: [{ code: '123456' }], bad: [{ code: true }, 'code'] },
  { route: 'POST /public/mfa-recovery/start', ctl: MfaRecoveryController, handler: 'start', today: [{ token: 'tok', password: 'pw' }], bad: [{ token: 'x'.repeat(600) }, 'token'] },
  { route: 'POST /public/mfa-recovery/confirm', ctl: MfaRecoveryController, handler: 'confirm', today: [{ token: 'tok', code: '123456' }], bad: [{ code: [] }, 'code'] },
  { route: 'POST /public/security/not-me', ctl: SecurityNotMeController, handler: 'notMe', today: [{ token: 'tok' }], bad: [{ token: {} }, 'token'] },
  { route: 'POST /auth/password-reset/request', ctl: PasswordResetController, handler: 'request', today: [{ salonCode: 'PILOT03', phone: '6095551234' }], bad: [{ phone: 'x'.repeat(40) }, 'phone'] },
  { route: 'POST /auth/password-reset/temp-login', ctl: PasswordResetController, handler: 'tempLogin', today: [{ tenantCodeOrSlug: 'PILOT03', emailOrPhone: '6095551234', password: '123456' }], bad: [{ emailOrPhone: ['a'] }, 'emailOrPhone'] },
  { route: 'POST /auth/password-reset/complete', ctl: PasswordResetController, handler: 'complete', today: [{ resetSessionToken: 't', newPassword: 'n', confirmPassword: 'n' }], bad: [{ newPassword: 5 }, 'newPassword'] },
  { route: 'POST /auth/super-admin/forgot-password', ctl: SystemResetController, handler: 'superAdminForgot', today: [{ emailOrPhone: 'sa@x.co', deliveryMethod: 'email' }], bad: [{ emailOrPhone: {} }, 'emailOrPhone'] },
  { route: 'POST /auth/admin/reset-user-password', ctl: SystemResetController, handler: 'adminReset', today: [{ targetUserId: U, deliveryMethod: 'auto', reason: 'locked out' }], bad: [{ reason: 'x'.repeat(1001) }, 'reason'] },
  { route: 'POST /auth/temp-password-login', ctl: SystemResetController, handler: 'tempLogin', today: [{ emailOrPhone: 'a@b.co', tenantCodeOrSlug: 'PILOT03', password: 'tmp' }], bad: [{ password: 123 }, 'password'] },
  { route: 'POST /auth/change-temporary-password', ctl: SystemResetController, handler: 'change', today: [{ changePasswordSessionId: 's', newPassword: 'n', confirmPassword: 'n' }], bad: [{ confirmPassword: [] }, 'confirmPassword'] },
  { route: 'POST /customer/me/security/password/create', ctl: CustomerSecurityController, handler: 'createPassword', today: [{ newPassword: 'n', confirmPassword: 'n' }], bad: [{ newPassword: {} }, 'newPassword'] },
  { route: 'POST /customer/me/security/password/change', ctl: CustomerSecurityController, handler: 'changePassword', today: [{ currentPassword: 'c', newPassword: 'n', confirmPassword: 'n' }], bad: [{ currentPassword: 1 }, 'currentPassword'] },
  { route: 'POST /pos/staff-roles', ctl: StaffRolesController, handler: 'createRole', today: [{ name: 'Senior tech', baseRole: 'TECHNICIAN', scope: 'BRANCH', permissions: ['pos.queue.view'] }], bad: [{ name: 'x', permissions: 'pos.queue.view' }, 'permissions'] },
];

const run = (pipe: any, body: unknown) => { try { return { ok: true, value: pipe.transform(body) }; } catch (e: any) { return { ok: false, status: e.getStatus?.(), res: e.getResponse?.() }; } };

describe('identity — validated bodies, route by route', () => {
  for (const c of CASES) {
    it(`${c.route}: today's bodies pass intact, an unknown field is stripped, a bad body is 400 naming the field`, () => {
      const pipe = bodyPipeOf(c.ctl, c.handler);
      expect(pipe, `${c.route} carries @Body(ValidatedBody(...))`).not.toBeNull();
      for (const body of c.today) {
        expect(run(pipe, body), JSON.stringify(body)).toEqual({ ok: true, value: body });
        expect(run(pipe, { ...body, someLegacyField: 'x' })).toEqual({ ok: true, value: body });
      }
      const r: any = run(pipe, c.bad[0]);
      expect(r.status).toBe(400);
      expect(r.res.code).toBe('VALIDATION_FAILED');
      expect(r.res.details.fields.map((f: any) => f.path)).toContain(c.bad[1]);
      // authority a body never carries: refused, not dropped
      expect(run(pipe, { ...c.today[0], tenantId: U })).toMatchObject({ ok: false, status: 400 });
    });
  }
});
