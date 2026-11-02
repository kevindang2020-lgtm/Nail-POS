/* password-reset-smoke.ts — end-to-end tenant password reset against LIVE Postgres (no HTTP server).
 * request → (capture temp code from MockSms) → temp-login → complete → verify the password actually changed. */
import { createDatabase } from '../../../packages/database/src/kysely.provider';
import { makeKyselyResetPorts } from '../../../modules/identity/src/auth/password-reset.ports.kysely';
import { PasswordResetService } from '../../../modules/identity/src/auth/password-reset.service';
import { MockSmsSender } from '@aipowersalon/notifications';
import { verifyPassword } from '../../../packages/auth/src/password';

const SALON = 'PALACE', PHONE = '+18565550123', EMAIL = 'owner@palace.test';
const OLD = 'Owner!2345', NEW = 'NewOwner!2345';
let pass = 0, fail = 0; const check = (name: string, ok: boolean, extra = '') => { if (ok) { pass++; console.log(`✅ ${name} ${extra}`); } else { fail++; console.log(`❌ ${name} ${extra}`); } };

(async () => {
  const db = createDatabase(); if (!db) { console.log('NO DB'); process.exit(1); }
  const sms = new MockSmsSender();
  const svc = new PasswordResetService(makeKyselyResetPorts(db, sms));

  const req = await svc.requestReset({ salonCode: SALON, phone: PHONE, ip: '127.0.0.1', ua: 'smoke' });
  check('requestReset returns generic', !!(req as any).ok, JSON.stringify(req));
  check('SMS dispatched (code captured)', sms.sent.length === 1, `sent=${sms.sent.length}`);
  const code = (sms.sent[0]?.body.match(/code is (APS-\d{6})/) || [])[1];
  console.log('   temp code:', code);

  const login = await svc.loginWithTemp({ tenantCodeOrSlug: SALON, emailOrPhone: EMAIL, password: String(code) });
  check('temp-login succeeds', !!(login as any).ok && !!(login as any).resetSessionToken, JSON.stringify({ ok: (login as any).ok, force: (login as any).forcePasswordReset }));
  const rst = (login as any).resetSessionToken;

  const done = await svc.completeReset({ resetSessionToken: rst, newPassword: NEW, confirmPassword: NEW });
  check('completeReset returns tokens', !!(done as any).accessToken, `redirect=${(done as any).redirect}`);

  // verify the password actually changed in the DB
  const u = await db.selectFrom('users').select(['id', 'password_hash']).where('role', '=', 'OWNER').where('tenant_id', 'is not', null).executeTakeFirst();
  check('new password verifies', await verifyPassword(NEW, u?.password_hash ?? ''), '');
  check('old password rejected', !(await verifyPassword(OLD, u?.password_hash ?? '')), '');
  const tok = await db.selectFrom('password_reset_tokens').select(['used_at']).where('user_id', '=', u!.id).orderBy('created_at', 'desc').executeTakeFirst();
  check('reset token marked used', !!tok?.used_at, '');
  const sess = await db.selectFrom('sessions').select((eb) => eb.fn.count<string>('id').as('c')).where('user_id', '=', u!.id).where('status', '=', 'active').executeTakeFirst();
  check('active session created', Number(sess?.c ?? 0) >= 1, `sessions=${sess?.c}`);

  await db.destroy();
  console.log(`\n=== password-reset E2E: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 2 : 0);
})();
