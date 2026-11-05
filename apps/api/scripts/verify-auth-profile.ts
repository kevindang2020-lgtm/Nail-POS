/* verify-auth-profile.ts — proves customer self-registration (creates a scrypt-hashed CUSTOMER user + linked customer,
 * rejects duplicates/unknown salons) and Edit-Profile (name + birthday persist + read back) over real Postgres (PGlite). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCustomerRegistrationRepository } from '../../../modules/identity/src/customer-registration/customer-registration.kysely.repository';
import { CustomerRegistrationService } from '../../../modules/identity/src/customer-registration/customer-registration.service';
import { KyselyCustomerRepository } from '../src/customer/customer.kysely.repository';
import { CustomerService } from '../src/customer/customer.service';
import { verifyPassword } from '../../../packages/auth/src/password';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5460;
  const T = '00000000-0000-0000-0000-0000000000a3', B = '00000000-0000-0000-0000-0000000000b3';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot Salon','pilot3','PILOT03')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    // ---- REGISTRATION ----
    const reg = new CustomerRegistrationService(new KyselyCustomerRegistrationRepository(k));
    const r1 = await reg.register({ salonCode: 'PILOT03', firstName: 'New', lastName: 'Customer', email: 'New@Cust.com', phone: '(609) 555-0000', password: 'secret123' });
    ok('registration succeeds for a valid salon code', r1.ok === true, JSON.stringify(r1));
    const u = (await db.query<{ id: string; role: string; status: string; password_hash: string; email: string }>(`select id, role, status, password_hash, email from users where email='new@cust.com'`)).rows[0];
    ok('a CUSTOMER user is created (active, email lowercased)', !!u && u.role === 'CUSTOMER' && u.status === 'active' && u.email === 'new@cust.com', JSON.stringify({ role: u?.role, status: u?.status }));
    ok('the password is scrypt-hashed and verifies', !!u && u.password_hash !== 'secret123' && await verifyPassword('secret123', u.password_hash));
    const cust = (await db.query<{ id: string; user_id: string; full_name: string }>(`select id, user_id, full_name from customers where user_id=$1`, [u.id])).rows[0];
    ok('a linked customer record is created', !!cust && cust.user_id === u.id && cust.full_name === 'New Customer', JSON.stringify(cust));
    const dup = await reg.register({ salonCode: 'PILOT03', firstName: 'New', lastName: 'Customer', email: 'new@cust.com', phone: '', password: 'secret123' });
    ok('a duplicate email is rejected', dup.ok === false && /already exists/i.test(dup.message || ''), JSON.stringify(dup));
    const noSalon = await reg.register({ salonCode: 'DOESNOTEXIST', firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '', password: 'secret123' });
    ok('an unknown salon code is rejected', noSalon.ok === false && /salon/i.test(noSalon.message || ''), JSON.stringify(noSalon));
    const weak = await reg.register({ salonCode: 'PILOT03', firstName: 'A', lastName: 'B', email: 'weak@b.com', phone: '', password: 'short' });
    ok('a too-short password is rejected', weak.ok === false, JSON.stringify(weak));

    // ---- EDIT PROFILE (name + birthday) ----
    const svc = new CustomerService(new KyselyCustomerRepository(k));
    const ctx = { tenantId: T, branchId: '', userId: u.id, role: 'CUSTOMER', permissions: [] } as any;
    await svc.updateProfile(ctx, { firstName: 'Renamed', lastName: 'Person', birthday: '1990-05-20', phone: '(609) 555-1111' } as any);
    const prof = await svc.getProfile(ctx);
    ok('profile reflects the new name + birthday + phone', !!prof && prof.fullName === 'Renamed Person' && prof.firstName === 'Renamed' && prof.lastName === 'Person' && prof.birthday === '1990-05-20' && (prof.phone || '').includes('555-1111'), JSON.stringify(prof));
    let threw = false; try { await svc.updateProfile(ctx, { birthday: 'not-a-date' } as any); } catch { threw = true; }
    ok('an invalid birthday is rejected', threw);
    const cleared = await (async () => { await svc.updateProfile(ctx, { birthday: '' } as any); return svc.getProfile(ctx); })();
    ok('birthday can be cleared', cleared.birthday === null, JSON.stringify({ birthday: cleared.birthday }));
    await svc.updateProfile(ctx, { marketingOptIn: true } as any);
    ok('marketing opt-in persists (no longer a dead toggle)', (await svc.getProfile(ctx)).marketingOptIn === true);
    await svc.updateProfile(ctx, { marketingOptIn: false } as any);
    ok('marketing opt-in can be turned back off', (await svc.getProfile(ctx)).marketingOptIn === false);

    console.log(`\n${fail === 0 ? '✅ REGISTRATION + EDIT-PROFILE VERIFIED on real Postgres' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) { console.error('THREW:', e?.message || e); fail++; }
  finally { try { await k.destroy(); } catch {} try { await pool.end(); } catch {} try { await server.stop(); } catch {} try { await db.close(); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
