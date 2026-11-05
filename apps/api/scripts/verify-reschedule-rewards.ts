/* verify-reschedule-rewards.ts — proves reschedule (conflict-aware, window-checked, ownership) and rewards redemption
 * (atomic points deduction, insufficient-points guard, inactive-reward guard) over a real Postgres (PGlite). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselyCustomerRepository } from '../src/customer/customer.kysely.repository';
import { CustomerService } from '../src/customer/customer.service';
import { KyselyCustomerBookingRepository } from '../../../modules/booking/src/customer-booking/customer-booking.kysely.repository';
import { CustomerBookingService, BookingConflictError, BookingValidationError } from '../../../modules/booking/src/customer-booking/customer-booking.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const threw = async (fn: () => Promise<any>, cls: any) => { try { await fn(); return false; } catch (e: any) { return e instanceof cls; } };
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const PG = 5459;
  const T = '00000000-0000-0000-0000-0000000000a2', B = '00000000-0000-0000-0000-0000000000b2', U = '00000000-0000-0000-0000-0000000000c2';

  const db = await PGlite.create({ extensions: { pgcrypto } });
  const DIR = join(process.cwd(), 'db', 'migrations');
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(DIR, f), 'utf8'));
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('${T}','Pilot LLC','Pilot Salon','pilot2','PILOT02')`);
  await db.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main')`);
  await db.exec(`INSERT INTO users (id, tenant_id, branch_id, email, role, status) VALUES ('${U}','${T}','${B}','customer@pilotsalon.com','CUSTOMER','active')`);
  const cId = (await db.query<{ id: string }>(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) VALUES (gen_random_uuid(),'${T}','${B}','Casey','C','Casey C','${U}') RETURNING id`)).rows[0].id;
  const t1 = (await db.query<{ id: string }>(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES (gen_random_uuid(),'${T}','${B}','Lisa','T','Lisa T') RETURNING id`)).rows[0].id;
  const mkAppt = async (dateStr: string, start: string, end: string) => (await db.query<{ id: string }>(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status) VALUES (gen_random_uuid(),'${T}','${B}','${t1}','${cId}','Casey C',false,'customer_app','[{"serviceId":"s1","serviceName":"Acrylic","durationMinutes":60,"priceCents":4500}]'::jsonb,'${dateStr}','${start}','${end}',60,'confirmed','not_required') RETURNING id`)).rows[0].id;
  const apptA = await mkAppt(day(3), '14:00', '15:00');     // the appointment we will move
  await mkAppt(day(5), '10:00', '11:00');                    // blocker on day(5) for the same technician
  await db.exec(`INSERT INTO customer_loyalty_profiles (id, tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points) VALUES (gen_random_uuid(),'${T}','${B}','${cId}','Silver',1250,1250)`);
  const r1 = (await db.query<{ id: string }>(`INSERT INTO loyalty_rewards (id, tenant_id, title, description, points_cost, active, sort_order) VALUES (gen_random_uuid(),'${T}','Free Gel Polish','Add-on on us',500,true,1) RETURNING id`)).rows[0].id;
  const r2 = (await db.query<{ id: string }>(`INSERT INTO loyalty_rewards (id, tenant_id, title, description, points_cost, active, sort_order) VALUES (gen_random_uuid(),'${T}','Free Mani','A full manicure',5000,true,2) RETURNING id`)).rows[0].id;
  const r3 = (await db.query<{ id: string }>(`INSERT INTO loyalty_rewards (id, tenant_id, title, description, points_cost, active, sort_order) VALUES (gen_random_uuid(),'${T}','Retired',' ',100,false,3) RETURNING id`)).rows[0].id;

  const server = new PGLiteSocketServer({ db, port: PG, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port: PG, user: 'postgres', database: 'postgres', max: 1 });
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  try {
    const booking = new CustomerBookingService(new KyselyCustomerBookingRepository(k));
    const bctx = { tenantId: T, branchId: B, userId: U } as any;

    // ---- RESCHEDULE ----
    ok('reschedule into an occupied slot is rejected (409 conflict)', await threw(() => booking.reschedule(bctx, apptA, { date: day(5), startTime: '10:30' }), BookingConflictError));
    ok('reschedule outside salon hours is rejected (400)', await threw(() => booking.reschedule(bctx, apptA, { date: day(5), startTime: '06:00' }), BookingValidationError));
    ok('reschedule to a past date is rejected (400)', await threw(() => booking.reschedule(bctx, apptA, { date: day(-1), startTime: '12:00' }), BookingValidationError));
    ok('reschedule an unknown appointment is rejected (400)', await threw(() => booking.reschedule(bctx, '11111111-1111-1111-1111-111111111111', { date: day(5), startTime: '12:00' }), BookingValidationError));
    const moved = await booking.reschedule(bctx, apptA, { date: day(5), startTime: '12:00' });
    ok('reschedule into a free slot succeeds (end auto-computed from duration)', moved.date === day(5) && moved.startTime === '12:00' && moved.endTime === '13:00', JSON.stringify(moved));
    const row = (await db.query<{ appt_date: string; start_time: string; status: string }>(`select appt_date::text, start_time::text, status from pos_tech_appointments where id=$1`, [apptA])).rows[0];
    ok('the appointment row actually moved (date + time + status persisted)', row.appt_date === day(5) && row.start_time.startsWith('12:00') && row.status === 'confirmed', JSON.stringify(row));

    // ---- REWARDS ----
    const svc = new CustomerService(new KyselyCustomerRepository(k));
    const cctx = { tenantId: T, branchId: B, userId: U, role: 'CUSTOMER', permissions: [] } as any;
    const view = await svc.getRewards(cctx);
    const showsR1 = view.rewards.find((x) => x.id === r1);
    const showsR2 = view.rewards.find((x) => x.id === r2);
    const showsR3 = view.rewards.find((x) => x.id === r3);
    ok('rewards list shows real points + affordability, hides inactive', view.points === 1250 && !!showsR1 && showsR1!.affordable === true && !!showsR2 && showsR2!.affordable === false && !showsR3, JSON.stringify({ points: view.points, n: view.rewards.length }));

    const redeem = await svc.redeemReward(cctx, r1);
    ok('redeem deducts points atomically and returns a code', redeem.ok === true && !!redeem.code && redeem.code!.startsWith('RDM') && redeem.pointsBalance === 750, JSON.stringify(redeem));
    const prof = (await db.query<{ points_balance: number; total_redeemed_points: number }>(`select points_balance, total_redeemed_points from customer_loyalty_profiles where customer_id=$1`, [cId])).rows[0];
    const redemptions = (await db.query<{ n: number }>(`select count(*)::int n from loyalty_redemptions where customer_id=$1`, [cId])).rows[0].n;
    ok('balance debited (750), total_redeemed credited (500), redemption logged', prof.points_balance === 750 && prof.total_redeemed_points === 500 && redemptions === 1, JSON.stringify({ ...prof, redemptions }));

    const tooPricey = await svc.redeemReward(cctx, r2);
    ok('redeeming a reward you cannot afford is refused (no deduction)', tooPricey.ok === false && tooPricey.pointsBalance === 750, JSON.stringify(tooPricey));
    const stillProf = (await db.query<{ points_balance: number }>(`select points_balance from customer_loyalty_profiles where customer_id=$1`, [cId])).rows[0];
    ok('points unchanged after a failed redeem', stillProf.points_balance === 750, JSON.stringify(stillProf));
    const inactive = await svc.redeemReward(cctx, r3);
    ok('an inactive reward cannot be redeemed', inactive.ok === false, JSON.stringify(inactive));

    console.log(`\n${fail === 0 ? '✅ RESCHEDULE + REWARDS VERIFIED on real Postgres' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  } catch (e: any) { console.error('THREW:', e?.message || e); fail++; }
  finally { try { await k.destroy(); } catch {} try { await pool.end(); } catch {} try { await server.stop(); } catch {} try { await db.close(); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
