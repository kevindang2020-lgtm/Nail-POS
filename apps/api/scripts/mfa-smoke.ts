// mfa-smoke.ts — validates REAL TOTP MFA against live Postgres via the actual LoginService + Kysely auth repo.
import { createDatabase } from '../../../packages/database/src/kysely.provider';
import { KyselyAuthUserRepository } from '../../../modules/identity/src/auth/auth-user.kysely.repository';
import { LoginService } from '../../../modules/identity/src/auth/auth-login.service';
import { generateSecret, totpCode } from '../../../modules/identity/src/auth/totp';
import { encryptSecret } from '../src/common/mfa-enc';

const EMAIL = 'admin@aps.test', PW = 'Admin!2345';
(async () => {
  const db = createDatabase();
  if (!db) { console.error('no db (set REPO_DRIVER=postgres + DATABASE_URL)'); process.exit(1); }
  const svc = new LoginService(new KyselyAuthUserRepository(db));
  let pass = 0, fail = 0;
  const check = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };

  const sa = await db.selectFrom('users').select(['id']).where('role', '=', 'SUPER_ADMIN')
    .where((eb: any) => eb(eb.fn('lower', ['email']), '=', EMAIL)).executeTakeFirst();
  check('super-admin row exists', !!sa);
  if (!sa) { console.log('\nFAILURES: cannot proceed'); process.exit(1); }
  // clean baseline: remove any prior TOTP factors
  await db.deleteFrom('mfa_factors').where('user_id', '=', sa.id).where('type', '=', 'totp').execute();

  // (a) NOT enrolled → format-gate fallback lets the bootstrap super-admin in
  const r1 = await svc.attempt({ portal: 'super-admin', identifier: EMAIL, password: PW, mfaCode: '123456' });
  check('not-enrolled: format code 123456 → SUCCESS (bootstrap fallback)', r1.outcome === 'SUCCESS', r1.outcome);

  // (b) enroll a CONFIRMED TOTP factor (what /auth/mfa/enroll+confirm persist)
  const secret = generateSecret();
  await db.insertInto('mfa_factors').values({ user_id: sa.id, type: 'totp', secret_enc: encryptSecret(secret), confirmed: true }).execute();
  await db.updateTable('users').set({ mfa_enabled: true }).where('id', '=', sa.id).execute();
  check('enrolled + confirmed a TOTP factor (encrypted secret persisted)', true);

  // (c) valid TOTP → SUCCESS
  const good = totpCode(secret, Date.now());
  const r2 = await svc.attempt({ portal: 'super-admin', identifier: EMAIL, password: PW, mfaCode: good });
  check(`enrolled: valid TOTP ${good} → SUCCESS`, r2.outcome === 'SUCCESS', r2.outcome);

  // (d) wrong code → MFA_REQUIRED
  const r3 = await svc.attempt({ portal: 'super-admin', identifier: EMAIL, password: PW, mfaCode: '000000' });
  check('enrolled: wrong code 000000 → MFA_REQUIRED', r3.outcome === 'MFA_REQUIRED', r3.outcome);

  // (e) the old format-gate no longer bypasses once enrolled
  const r4 = await svc.attempt({ portal: 'super-admin', identifier: EMAIL, password: PW, mfaCode: '123456' });
  check('enrolled: format code 123456 → MFA_REQUIRED (real TOTP now enforced)', r4.outcome === 'MFA_REQUIRED', r4.outcome);

  // (f) wrong password + valid TOTP → not SUCCESS (credentials still checked)
  const r5 = await svc.attempt({ portal: 'super-admin', identifier: EMAIL, password: 'wrong', mfaCode: totpCode(secret, Date.now()) });
  check('enrolled: wrong password → not SUCCESS', r5.outcome !== 'SUCCESS', r5.outcome);

  console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'}: ${pass} passed, ${fail} failed`);
  await (db as any).destroy?.();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
