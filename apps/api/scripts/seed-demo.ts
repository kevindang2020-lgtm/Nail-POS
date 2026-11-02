/*
 * seed-demo.ts — populates the seeded pilot tenant with realistic OPERATIONAL data so every POS screen has
 * something to show and every action can be exercised. Run AFTER migrate + seed.ts.
 *
 *   DATABASE_URL=postgres://… [SEED_TENANT_CODE=PILOT01] npx tsx apps/api/scripts/seed-demo.ts
 *
 * Idempotent: if the tenant already has services, it assumes demo data is present and exits without inserting.
 * Creates: service categories + services, technicians (+ live statuses), customers, today's appointments in several
 * states, queue items, an accepted tech-queue ticket, tickets in serving / service-done / ready-for-checkout / paid
 * states with service lines, and a pending per-tenant payment-gateway config.
 */
import { Pool } from 'pg';
import { hashPassword } from '../../../packages/auth/src/password';

const code = process.env.SEED_TENANT_CODE || 'PILOT01';
const today = new Date().toISOString().slice(0, 10);

async function main() {
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const q = (sql: string, p: any[] = []) => c.query(sql, p);
  try {
    const t = (await q(`select id from tenants where tenant_code=$1 limit 1`, [code])).rows[0]
      || (await q(`select id from tenants where status='active' order by created_at desc limit 1`)).rows[0];
    if (!t) { console.error(`No tenant found (tenant_code=${code}). Run seed.ts first.`); process.exit(1); }
    const tenantId = t.id;
    const branchId = (await q(`select id from branches where tenant_id=$1 order by created_at asc limit 1`, [tenantId])).rows[0]?.id;
    if (!branchId) { console.error('Tenant has no branch. Run seed.ts first.'); process.exit(1); }

    // Keyed on technicians, not services: seed.ts (which runs first) already inserts two starter services, so a
    // services check made this script skip on every documented run (w4 sweep finding SW-01).
    const already = (await q(`select 1 from technicians where tenant_id=$1 limit 1`, [tenantId])).rows[0];
    if (already) { console.log('Demo data already present for this tenant — skipping.'); return; }

    await q('BEGIN');

    // --- service categories + services ---
    const cats: Record<string, string> = {};
    for (const [i, name] of ['Manicures', 'Pedicures', 'Enhancements'].entries()) {
      cats[name] = (await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order) values (gen_random_uuid(),$1,$2,$3,$4) returning id`, [tenantId, branchId, name, i + 1])).rows[0].id;
    }
    const svc: { id: string; name: string; price: number; dur: number }[] = [];
    const svcDefs: [string, string, number, number][] = [
      ['Manicures', 'Classic Manicure', 3000, 30], ['Manicures', 'Gel Manicure', 4500, 45],
      ['Pedicures', 'Classic Pedicure', 4000, 45], ['Pedicures', 'Spa Pedicure', 6000, 60],
      ['Enhancements', 'Full Set Acrylic', 6500, 75], ['Enhancements', 'Gel-X Extensions', 7500, 90],
    ];
    for (const [i, [cat, name, price, dur]] of svcDefs.entries()) {
      const id = (await q(
        `insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, online_booking_enabled, customer_app_booking_enabled, ai_booking_enabled, status, sort_order, created_at, updated_at)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,'percent',40,true,true,true,'active',$7,now(),now()) returning id`,
        [tenantId, branchId, cats[cat], name, dur, price, i + 1])).rows[0].id;
      svc.push({ id, name, price, dur });
    }

    // --- technicians (+ live status) ---
    const techs: { id: string; name: string; status: string }[] = [];
    const techDefs: [string, string, string][] = [
      ['Ava', 'Nguyen', 'available'], ['Mia', 'Tran', 'in_service'], ['Leo', 'Pham', 'on_break'], ['Zoe', 'Le', 'available'],
    ];
    for (const [first, last, status] of techDefs) {
      const id = (await q(
        `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,'Nail Tech','active','percent',40,40,true,now(),now()) returning id`,
        [tenantId, branchId, first, last, `${first} ${last}`])).rows[0].id;
      techs.push({ id, name: `${first} ${last}`, status });
    }

    // --- customers ---
    const custs: { id: string; name: string; phone: string }[] = [];
    const custDefs: [string, string, string][] = [
      ['Grace', 'Kim', '+18565550101'], ['Nora', 'Patel', '+18565550102'], ['Ivy', 'Park', '+18565550103'],
      ['Ruby', 'Diaz', '+18565550104'], ['Lena', 'Cho', '+18565550105'],
    ];
    for (const [first, last, phone] of custDefs) {
      const id = (await q(
        `insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, status, created_at, updated_at)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,'active',now(),now()) returning id`,
        [tenantId, branchId, first, last, `${first} ${last}`, phone])).rows[0].id;
      custs.push({ id, name: `${first} ${last}`, phone });
    }

    const svcJson = (s: { id: string; name: string; price: number; dur: number }) =>
      JSON.stringify([{ serviceId: s.id, serviceName: s.name, durationMinutes: s.dur, priceCents: s.price }]);

    // --- today's appointments in several states ---
    const apptDefs: [number, number, string, string, string][] = [
      [0, 0, '09:00', 'completed', 'manual'], [1, 1, '10:00', 'checked_in', 'online'],
      [2, 2, '11:30', 'confirmed', 'phone'], [3, 3, '13:00', 'booked', 'customer_app'], [4, 0, '15:00', 'booked', 'online'],
    ];
    for (const [ci, ti, start, status, source] of apptDefs) {
      const s = svc[(ci + ti) % svc.length];
      const endH = String(Number(start.slice(0, 2)) + 1).padStart(2, '0') + start.slice(2);
      await q(
        `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
        [tenantId, branchId, techs[ti].id, custs[ci].id, custs[ci].name, svcJson(s), today, start, endH, s.dur, status, source]);
    }

    // --- queue items (waiting walk-ins) ---
    for (const [ci, ti] of [[2, 3], [3, 0]] as [number, number][]) {
      const s = svc[ci % svc.length];
      await q(
        `insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, customer_phone, is_vip, source, requested_services, priority, status, assigned_technician_id, checked_in_at)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,false,'walk_in',$6::jsonb,'normal','waiting',$7,now())`,
        [tenantId, branchId, custs[ci].id, custs[ci].name, custs[ci].phone, svcJson(s), techs[ti].id]);
    }

    // --- tickets in serving / service_done / ready_checkout / paid (+ service lines) ---
    const mkTicket = async (ci: number, ti: number, status: string, tsCols: string[]) => {
      const s = svc[(ci + 2) % svc.length];
      const cols = ['id', 'tenant_id', 'branch_id', 'customer_id', 'primary_technician_id', 'status', 'subtotal_cents', 'total_cents', ...tsCols, 'created_at', 'updated_at'];
      const vals = ['gen_random_uuid()', '$1', '$2', '$3', '$4', '$5', '$6', '$7', ...tsCols.map(() => 'now()'), 'now()', 'now()'];
      const tk = (await q(
        `insert into tickets (${cols.join(', ')}) values (${vals.join(', ')}) returning id`,
        [tenantId, branchId, custs[ci].id, techs[ti].id, status, s.price, s.price])).rows[0].id;
      await q(
        `insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot, status)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,'percent',40,'assigned')`,
        [tenantId, branchId, tk, s.id, s.name, s.price, s.dur, s.price]);
      return tk;
    };
    await mkTicket(0, 1, 'serving', ['serving_started_at']);
    await mkTicket(1, 2, 'service_done', ['serving_started_at', 'service_done_at']);
    await mkTicket(2, 3, 'ready_checkout', ['serving_started_at', 'service_done_at', 'ready_checkout_at']);
    await mkTicket(4, 0, 'paid', ['serving_started_at', 'service_done_at', 'paid_at']);

    await q('COMMIT');

    // Best-effort extras, OUTSIDE the transaction so a failure here can't roll back the committed core demo data.
    for (const t of techs) {
      await q(`insert into technician_statuses (id, tenant_id, branch_id, technician_id, status) values (gen_random_uuid(),$1,$2,$3,$4)`, [tenantId, branchId, t.id, t.status]).catch(() => {});
    }
    await q(
      `insert into pos_tech_queue_tickets (id, tenant_id, branch_id, customer_id, customer_name, customer_phone, is_vip, source, requested_services, priority, status, assigned_technician_id)
       values (gen_random_uuid(),$1,$2,$3,$4,$5,false,'walk_in',$6::jsonb,'normal','accepted',$7)`,
      [tenantId, branchId, custs[1].id, custs[1].name, custs[1].phone, svcJson(svc[1]), techs[1].id]).catch((e) => console.warn('tech-queue seed skipped:', e.message));
    await q(
      `insert into tenant_payment_config (tenant_id, processor, environment, status, fiserv_configured)
       values ($1,'fiserv','sandbox','pending',false)
       on conflict (tenant_id) do nothing`, [tenantId]).catch((e) => console.warn('payment-config seed skipped:', e.message));

    // A TECHNICIAN login so the technician web app (apps/tech-web) is testable. TECHNICIAN holds pos.login,
    // so it signs in through the tenant portal with salon code PILOT01 + this email + password.
    try {
      const techHash = await hashPassword('Tech!2345');
      await q(
        `insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
         select $1,$2,'Tina','Tech','Tina Tech','tech@pilotsalon.com',$3,'active','TECHNICIAN',false
         where not exists (select 1 from users where email='tech@pilotsalon.com')`,
        [tenantId, branchId, techHash]);
    } catch (e: any) { console.warn('tech-user seed skipped:', e.message); }

    // A CUSTOMER login linked to a seeded customer record, so the customer web app (apps/customer-web) is testable
    // with real data. The customer portal resolves the signed-in user to a customer via customers.user_id, so we both
    // create the login and link it to one of the demo customers. Signs in through the tenant portal (salon PILOT01).
    try {
      const custHash = await hashPassword('Cust!2345');
      await q(
        `insert into users (tenant_id, branch_id, first_name, last_name, full_name, email, password_hash, status, role, mfa_enabled)
         select $1,$2,'Casey','Customer','Casey Customer','customer@pilotsalon.com',$3,'active','CUSTOMER',false
         where not exists (select 1 from users where email='customer@pilotsalon.com')`,
        [tenantId, branchId, custHash]);
      await q(
        `update customers set user_id = (select id from users where email='customer@pilotsalon.com' and tenant_id=$1 limit 1)
         where tenant_id=$1 and id=$2 and user_id is null`,
        [tenantId, custs[0].id]);
    } catch (e: any) { console.warn('customer-user seed skipped:', e.message); }

    console.log(`Demo data seeded for tenant ${code}: ${svc.length} services, ${techs.length} technicians, ${custs.length} customers, 5 appointments, 2 queue items, an accepted tech-queue ticket, and tickets in serving/done/ready/paid.`);
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    console.error('seed-demo failed:', e);
    process.exit(1);
  } finally {
    c.release(); await pool.end();
  }
}
main();
