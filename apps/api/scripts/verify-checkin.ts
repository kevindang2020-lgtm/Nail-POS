/* verify-checkin.ts — proves the customer self check-in over a real Postgres (PGlite): it inserts a real pos_queue_items
 * row (the SAME table the POS queue + the customer Live Queue read), is idempotent, and the customer's queue read then
 * shows them in line. Run: npx tsx scripts/verify-checkin.ts */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCustomerRepository } from '../src/customer/customer.kysely.repository';
import { CustomerService } from '../src/customer/customer.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5458;
  const T = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b1', U = '00000000-0000-0000-0000-0000000000c1';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot Salon','pilot','PILOT01')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, role, status) VALUES ('${U}','${T}','${B}','customer@pilotsalon.com','CUSTOMER','active')`);
  const customerId = (await db.query<{ id: string }>(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) VALUES (gen_random_uuid(),'${T}','${B}','Casey','Customer','Casey Customer','${U}') RETURNING id`)).rows[0].id;
  const techId = (await db.query<{ id: string }>(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES (gen_random_uuid(),'${T}','${B}','Lisa','Tech','Lisa Tech') RETURNING id`)).rows[0].id;
  // a confirmed appointment TODAY for this customer
  const apptId = (await db.query<{ id: string }>(`INSERT INTO pos_tech_appointments
    (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
    VALUES (gen_random_uuid(), '${T}', '${B}', '${techId}', '${customerId}', 'Casey Customer', false, 'customer_app',
            '[{"serviceId":"s1","name":"Acrylic Full Set"}]'::jsonb, current_date, '14:00', '15:00', 60, 'confirmed', 'not_required') RETURNING id`)).rows[0].id;

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    const svc = new CustomerService(new KyselyCustomerRepository(k));
    const ctx = { tenantId: T, branchId: B, userId: U, role: 'CUSTOMER', permissions: [] } as any;

    const r1 = await svc.checkIn(ctx, apptId);
    ok('check-in creates a queue item', r1.ok === true && !!r1.queueItemId && !r1.alreadyCheckedIn, JSON.stringify(r1));

    const qrow = (await db.query<{ status: string; source: string; customer_id: string }>(`select status, source, customer_id from pos_queue_items where appointment_id=$1`, [apptId])).rows[0];
    ok('a real pos_queue_items row exists (waiting, source=appointment, scoped to the customer)', !!qrow && qrow.status === 'waiting' && qrow.source === 'appointment' && qrow.customer_id === customerId, JSON.stringify(qrow));

    const r2 = await svc.checkIn(ctx, apptId);
    ok('second check-in is idempotent (no duplicate queue item)', r2.ok === true && r2.alreadyCheckedIn === true, JSON.stringify(r2));
    const cnt = (await db.query<{ n: number }>(`select count(*)::int n from pos_queue_items where appointment_id=$1`, [apptId])).rows[0].n;
    ok('exactly one queue item after a repeat check-in', cnt === 1, `count=${cnt}`);

    const q = await svc.getQueue(ctx);
    ok('customer Live Queue now shows them in line (#1)', q.inQueue === true && q.position === 1, JSON.stringify(q));

    // a NON-today appointment cannot be checked in
    const futureId = (await db.query<{ id: string }>(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status) VALUES (gen_random_uuid(), '${T}', '${B}', '${techId}', '${customerId}', 'Casey Customer', false, 'customer_app', '[]'::jsonb, current_date + 7, '14:00', '15:00', 60, 'confirmed', 'not_required') RETURNING id`)).rows[0].id;
    const rF = await svc.checkIn(ctx, futureId);
    ok('a future appointment is rejected (check in on the day)', rF.ok === false, JSON.stringify(rF));

    console.log(`\n${fail === 0 ? '✅ CUSTOMER CHECK-IN VERIFIED (real queue insert + idempotent + Live Queue integration)' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) { console.error('THREW:', e?.message || e); fail++; }
  finally { try { await k.destroy(); } catch {} try { await pool.end(); } catch {} try { await server.stop(); } catch {} try { await db.close(); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
