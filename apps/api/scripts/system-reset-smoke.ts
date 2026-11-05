/* system-reset-smoke.ts — admin-initiated reset E2E against LIVE Postgres (no HTTP server).
 * owner resets a FRONT_DESK staff → temp password emailed → temp-login → change → verify the staff password changed. */
import { readFileSync } from 'node:fs';
import { createDatabase } from '../../../packages/database/src/kysely.provider';
import { makeKyselySystemResetPorts } from '../../../modules/identity/src/auth/system-reset.ports.kysely';
import { SystemPasswordResetService, type UserRow } from '../../../modules/identity/src/auth/system-password-reset.service';
import { MockSmsSender } from '@aipowersalon/notifications';
import { MockEmailSender } from '@aipowersalon/notifications';
import { verifyPassword } from '../../../packages/auth/src/password';

const [TENANT, STAFF] = readFileSync('/tmp/sids.txt', 'utf8').trim().split('\n');
const NEW = 'RobinNew!2345';
let pass = 0, fail = 0; const check = (n: string, ok: boolean, x = '') => { if (ok) { pass++; console.log(`✅ ${n} ${x}`); } else { fail++; console.log(`❌ ${n} ${x}`); } };

(async () => {
  const db = createDatabase(); if (!db) { console.log('NO DB'); process.exit(1); }
  const sms = new MockSmsSender(); const email = new MockEmailSender();
  const svc = new SystemPasswordResetService(makeKyselySystemResetPorts(db, sms, email));

  const actor = { userId: '00000000-0000-0000-0000-0000000000aa', role: 'OWNER' as const, tenantId: TENANT, permissions: ['users.reset_password'], mfaVerified: true };
  const res = await svc.adminResetUserPassword(actor, STAFF, { deliveryMethod: 'email', reason: 'forgot at front desk' });
  check('adminResetUserPassword ok', !!(res as any).ok, JSON.stringify(res));
  check('temp password emailed', email.sent.length === 1, `emails=${email.sent.length}`);
  const temp = (email.sent[0]?.body.split('is: ')[1] || '').split('\n')[0].trim();
  console.log('   temp password:', temp);

  // load staff + temp state, then temp-login
  const row: any = await db.selectFrom('users').select(['id', 'tenant_id', 'branch_id', 'full_name', 'role', 'status', 'email', 'normalized_phone', 'temp_password_hash', 'temp_password_expires_at', 'must_change_password']).where('id', '=', STAFF).executeTakeFirst();
  check('temp set + must_change flagged', !!row?.temp_password_hash && row?.must_change_password === true, `must_change=${row?.must_change_password}`);
  const user: UserRow = { userId: row.id, tenantId: row.tenant_id, branchId: row.branch_id, fullName: row.full_name, role: row.role, status: row.status, email: row.email, normalizedPhone: row.normalized_phone, permissions: [] };
  const login = await svc.loginWithTemporaryPassword(user, temp, { hash: row.temp_password_hash, expiresAt: new Date(row.temp_password_expires_at).getTime() });
  check('temp-login ok (must change)', !!(login as any).ok && !!(login as any).changePasswordSessionId, JSON.stringify({ ok: (login as any).ok, must: (login as any).mustChangePassword }));

  const done = await svc.changeTemporaryPassword({ changePasswordSessionId: (login as any).changePasswordSessionId, newPassword: NEW, confirmPassword: NEW });
  check('changeTemporaryPassword returns tokens', !!(done as any).accessToken, `redirect=${(done as any).redirect} role=${(done as any).role}`);

  const after: any = await db.selectFrom('users').select(['password_hash', 'temp_password_hash', 'must_change_password', 'password_changed_at']).where('id', '=', STAFF).executeTakeFirst();
  check('new password verifies', await verifyPassword(NEW, after?.password_hash ?? ''));
  check('temp cleared + must_change reset', !after?.temp_password_hash && after?.must_change_password === false);
  check('password_changed_at set', !!after?.password_changed_at);
  const sess = await db.selectFrom('sessions').select((eb) => eb.fn.count<string>('id').as('c')).where('user_id', '=', STAFF).where('status', '=', 'active').executeTakeFirst();
  check('active session created', Number(sess?.c ?? 0) >= 1, `sessions=${sess?.c}`);

  await db.destroy();
  console.log(`\n=== system-reset (admin) E2E: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 2 : 0);
})();
