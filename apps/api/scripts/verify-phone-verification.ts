/* verify-phone-verification.ts — proves signup phone verification (soft confirm): a code is issued + SMS-dispatched
 * (captured here), the correct code verifies + stamps customers.phone_verified_at, codes are single-use and expire, a
 * wrong code is rejected, and a customer with no phone can't request one. Real Postgres (PGlite). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCustomerRepository } from '../src/customer/customer.kysely.repository';
import { CustomerService } from '../src/customer/customer.service';
import { MockSmsSender } from '@aipowersalon/notifications';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5461;
  const T = '00000000-0000-0000-0000-0000000000a4', B = '00000000-0000-0000-0000-0000000000b4', U = '00000000-0000-0000-0000-0000000000c4', U2 = '00000000-0000-0000-0000-0000000000c5';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot Salon','pilot4','PILOT04')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, role, status) VALUES ('${U}','${T}','${B}','has-phone@cust.com','CUSTOMER','active'),('${U2}','${T}','${B}','no-phone@cust.com','CUSTOMER','active')`);
  const withPhone = (await db.query<{ id: string }>(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, user_id) VALUES (gen_random_uuid(),'${T}','${B}','Has','Phone','Has Phone','(609) 555-1212','6095551212','${U}') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) VALUES (gen_random_uuid(),'${T}','${B}','No','Phone','No Phone','${U2}')`);

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    const sms = new MockSmsSender();
    const svc = new CustomerService(new KyselyCustomerRepository(k), sms);
    const ctx = { tenantId: T, branchId: '', userId: U, role: 'CUSTOMER', permissions: [] } as any;
    const ctxNoPhone = { tenantId: T, branchId: '', userId: U2, role: 'CUSTOMER', permissions: [] } as any;

    const codeOf = () => (sms.sent[sms.sent.length - 1].body.match(/\b(\d{6})\b/) || [])[1] || '';
    ok('profile starts unverified', (await svc.getProfile(ctx))!.phoneVerified === false);

    // 1) request a code (dispatched via SMS)
    const req = await svc.requestPhoneVerification(ctx);
    const codeA = codeOf();
    ok('requesting a code succeeds and dispatches an SMS with a 6-digit code', req.ok === true && sms.sent.length === 1 && sms.sent[0].to === '(609) 555-1212' && /^\d{6}$/.test(codeA), JSON.stringify({ req, sent: sms.sent.length, codeA }));

    // 2) a wrong code is rejected while a code is active
    const wrong = await svc.confirmPhoneVerification(ctx, codeA === '000000' ? '111111' : '000000');
    ok('a wrong code is rejected (still unverified)', wrong.ok === false && (await svc.getProfile(ctx))!.phoneVerified === false, JSON.stringify(wrong));

    // 3) an expired code is rejected (force codeA expired)
    await db.query(`UPDATE customer_phone_verifications SET expires_at = now() - interval '1 minute' WHERE customer_id=$1 AND consumed_at IS NULL`, [withPhone]);
    const expired = await svc.confirmPhoneVerification(ctx, codeA);
    ok('an expired code is rejected', expired.ok === false && /expired/i.test(expired.message || ''), JSON.stringify(expired));

    // 4) a fresh code verifies the phone (still unverified, so request issues a new one)
    await svc.requestPhoneVerification(ctx);
    const codeB = codeOf();
    const good = await svc.confirmPhoneVerification(ctx, codeB);
    const stamp = (await db.query<{ phone_verified_at: string | null }>(`select phone_verified_at from customers where id=$1`, [withPhone])).rows[0].phone_verified_at;
    ok('the correct code verifies the phone + stamps phone_verified_at', good.ok === true && good.verified === true && !!stamp && (await svc.getProfile(ctx))!.phoneVerified === true, JSON.stringify({ good, stamp: !!stamp }));

    // 5) single-use: the verifying code cannot be replayed
    const reuse = await svc.confirmPhoneVerification(ctx, codeB);
    ok('the code is single-use (cannot be replayed)', reuse.ok === false, JSON.stringify(reuse));

    // 6) once verified, re-requesting is an idempotent no-op (no new code dispatched)
    const sentBefore = sms.sent.length;
    const already = await svc.requestPhoneVerification(ctx);
    ok('re-requesting after verification is a no-op', already.ok === true && already.verified === true && sms.sent.length === sentBefore, JSON.stringify({ already, dispatched: sms.sent.length - sentBefore }));

    // 7) a customer with no phone cannot request a code
    const noPhone = await svc.requestPhoneVerification(ctxNoPhone);
    ok('a customer with no phone cannot request a code', noPhone.ok === false && /phone number/i.test(noPhone.message || ''), JSON.stringify(noPhone));

    console.log(`\n${fail === 0 ? '✅ PHONE VERIFICATION VERIFIED on real Postgres' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) { console.error('THREW:', e?.message || e); fail++; }
  finally { try { await k.destroy(); } catch {} try { await pool.end(); } catch {} try { await server.stop(); } catch {} try { await db.close(); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
