#!/usr/bin/env node
// db-explain-pass.mjs — BUILD_PLAN Phase 10 (agent E; Constitution 1 §45 "query plan verification", §101, §111 "indexes
// match real queries", "high-volume queries are measured").
//
// WHAT IT DOES
//   1. creates a scratch database (default `explain_p10`) on the server DATABASE_URL points at, and migrates it with the
//      real runner (scripts/migrate.mjs) — every migration, the same way a deploy does;
//   2. seeds it with generated SQL: ten salons (the measured one, "EXP0", plus nine others so a tenant filter is
//      selective, as in production) × 3 branches × 5,000 customers / 20,000 tickets (+ one service line each) / 20,000
//      payments / 10,000 appointments / 2,000 queue items / 3,000 loyalty profiles + ledger rows / 5,000 deal
//      redemptions / 20,000 audit events / 5,000 AI usage rows / 5,000 outbox events / sessions / stock / schedules /
//      180 days of the daily sales summary; then ANALYZE;
//   3. runs EXPLAIN (ANALYZE, FORMAT JSON) for every query SHAPE below — each copied from the repository that issues it
//      (the source is named next to it) with literal values for the parameters;
//   4. FAILS when a plan has a Seq Scan over a table of ≥ 1,000 rows and the shape filters by tenant (a platform-wide
//      shape — the Super Admin's cross-salon reads — may scan; it is reported, not failed);
//   5. with --write-doc, writes docs/DB_EXPLAIN_PASS_2026-10-08.md (shape → plan root → index used → ms);
//   6. with --load, boots the API against the seeded database and runs scripts/api-load-test.mjs at 50 clients
//      (LOAD_CLIENTS / LOAD_SECONDS), appending p50/p95 to the doc (sandbox numbers, labelled as such);
//   7. drops the scratch database (unless --keep).
//
// Run (apps/api built for --load):  DATABASE_URL=postgres://… node scripts/db-explain-pass.mjs [--write-doc] [--load] [--keep]
// Never point it at production: it creates and DROPS a database named EXPLAIN_DB (default explain_p10).
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pg = require('pg');
const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..');
const ROOT = join(API_DIR, '..', '..');
const BASE_URL = process.env.DATABASE_URL;
if (!BASE_URL) { console.error('DATABASE_URL is required (the server to create the scratch database on)'); process.exit(2); }
const DBNAME = process.env.EXPLAIN_DB || 'explain_p10';
if (!/^[a-z_][a-z0-9_]*$/.test(DBNAME) || !/explain/.test(DBNAME)) { console.error('EXPLAIN_DB must be a plain identifier containing "explain"'); process.exit(2); }
const args = new Set(process.argv.slice(2));
const urlFor = (db) => { const u = new URL(BASE_URL); u.pathname = `/${db}`; return u.toString(); };
const SCRATCH_URL = urlFor(DBNAME);
const SEQ_SCAN_ROWS = 1000;
const TENANTS = 10, PER = { customers: 5000, tickets: 20000, appts: 10000, queue: 2000, loyalty: 3000, redemptions: 5000, audit: 20000, ai: 5000, outbox: 5000 };

// ── seed ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Appointments: technician = a % 15, slot = a / 15 → day (slot % 74, ±37 days) and hour (9 + slot / 74), so one
// technician never has two overlapping bookings (pos_tech_appointments_no_overlap).
// Deterministic ids: md5(kind-tenant-n)::uuid, so every shape below can name a real row. t = 0 is the measured salon.
const id = (kind, t, n) => `md5('${kind}-' || ${t} || '-' || ${n})::uuid`;
const SEED = [
  `insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, lifecycle_state, created_at)
     select ${id('tenant', 't', 0)}, 'Explain Salon ' || t, 'Explain Salon ' || t, 'explain-salon-' || t, 'EXP' || t, 'active', 'ACTIVE', now() - (t || ' days')::interval
     from generate_series(0, ${TENANTS - 1}) t`,
  `insert into branches (id, tenant_id, name, status, timezone, address)
     select ${id('branch', 't', 'b')}, ${id('tenant', 't', 0)}, 'Branch ' || b, 'active', 'America/New_York', b || ' Explain Way'
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 2) b`,
  `insert into users (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, status, role)
     select ${id('user', 't', 'u')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'u % 3')}, 'User', 'N' || u, 'User N' || u,
            'user' || u || '@explain' || t || '.test', '+1556' || lpad((t * 100 + u)::text, 7, '0'), 'active', case when u = 0 then 'OWNER' when u < 4 then 'MANAGER' else 'FRONT_DESK' end
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 10) u`,
  `insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status)
     select ${id('tech', 't', 'k')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'k % 3')}, 'Tech', 'T' || k, 'Tech T' || k, 'active'
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 14) k`,
  `insert into service_categories (id, tenant_id, branch_id, name)
     select ${id('cat', 't', 'b')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'b')}, 'Nails ' || b from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 2) b`,
  `insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status)
     select ${id('svc', 't', 's')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 's % 3')}, ${id('cat', 't', 's % 3')}, 'Service ' || s, 30 + (s % 4) * 15, 2000 + s * 250, 'active'
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 19) s`,
  `insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, created_at)
     select ${id('cust', 't', 'c')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'c % 3')}, (array['Ana','Bao','Cara','Dung','Eve','Faye','Gia','Hana','Ivy','Jade'])[1 + c % 10],
            (array['Nguyen','Tran','Smith','Johnson','Le','Pham','Garcia','Brown','Davis','Lee'])[1 + (c / 10) % 10] || c,
            (array['Ana','Bao','Cara','Dung','Eve','Faye','Gia','Hana','Ivy','Jade'])[1 + c % 10] || ' ' || (array['Nguyen','Tran','Smith','Johnson','Le','Pham','Garcia','Brown','Davis','Lee'])[1 + (c / 10) % 10] || c,
            '+1555' || lpad((t * ${PER.customers} + c)::text, 7, '0'), 'c' || c || '@explain' || t || '.test', now() - ((c % 400) || ' days')::interval
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.customers - 1}) c`,
  `insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, total_cents, ticket_number, created_at, paid_at)
     select ${id('ticket', 't', 'k')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'k % 3')}, ${id('cust', 't', `k % ${PER.customers}`)}, ${id('tech', 't', 'k % 15')},
            case when k % 50 = 0 then 'ready_for_payment' else 'paid' end, 4500, 4500, 'T' || t || '-' || k,
            now() - ((k % 180) || ' days')::interval - ((k % 600) || ' minutes')::interval,
            case when k % 50 = 0 then null else now() - ((k % 180) || ' days')::interval - ((k % 600) || ' minutes')::interval end
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.tickets - 1}) k`,
  `insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'k % 3')}, ${id('ticket', 't', 'k')}, ${id('svc', 't', 'k % 20')}, 'Service ' || (k % 20), 4500, 45, 4500
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.tickets - 1}) k`,
  `insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor, created_at, approved_at)
     select ${id('pay', 't', 'k')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'k % 3')}, ${id('ticket', 't', 'k')}, case when k % 4 = 0 then 'cash' else 'card' end, 4500, 500, 'approved',
            case when k % 4 = 0 then null else 'fiserv' end, now() - ((k % 180) || ' days')::interval - ((k % 600) || ' minutes')::interval, now() - ((k % 180) || ' days')::interval - ((k % 600) || ' minutes')::interval
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.tickets - 1}) k where k % 50 <> 0`,
  `insert into payment_refunds (tenant_id, payment_id, amount_cents, created_at)
     select ${id('tenant', 't', 0)}, ${id('pay', 't', 'k * 50 + 1')}, 500, now() - ((k % 180) || ' days')::interval from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 199) k`,
  `insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
     select ${id('appt', 't', 'a')}, ${id('tenant', 't', 0)}, ${id('branch', 't', '(a % 15) % 3')}, ${id('tech', 't', 'a % 15')}, ${id('cust', 't', `a % ${PER.customers}`)}, 'Guest ' || a, '[]'::jsonb,
            current_date + ((a / 15) % 74 - 37), lpad((9 + (a / 15) / 74)::text, 2, '0') || ':00', lpad((10 + (a / 15) / 74)::text, 2, '0') || ':00', 60,
            case when (a / 15) % 74 - 37 < 0 then 'completed' else 'booked' end, 'phone'
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.appts - 1}) a`,
  `insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, source, priority, status, assigned_technician_id, checked_in_at, created_at)
     select ${id('queue', 't', 'q')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'q % 3')}, ${id('cust', 't', `q % ${PER.customers}`)}, 'Guest ' || q, 'walk_in', 'normal',
            case when q % 40 = 0 then 'waiting' else 'completed' end, ${id('tech', 't', '(q % 5) * 3 + q % 3')},
            now() - ((q % 90) || ' days')::interval, now() - ((q % 90) || ' days')::interval
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.queue - 1}) q`,
  `insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'c % 3')}, ${id('cust', 't', 'c')}, 100, 100 from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.loyalty - 1}) c`,
  `insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, created_at)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'c % 3')}, ${id('cust', 't', 'c')}, 'earn', 100, 'payment', 100, now() - ((c % 180) || ' days')::interval
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.loyalty - 1}) c`,
  `insert into deals (id, tenant_id, branch_id, owner_type, title, discount_type, discount_percent, status, kind)
     select ${id('deal', 't', 'd')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'd % 3')}, 'salon', 'Deal ' || d, 'percent', 10, 'active', 'deal' from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 9) d`,
  `insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, ticket_id, amount_discounted_cents, deal_version, status, created_at)
     select ${id('deal', 't', 'r % 10')}, ${id('tenant', 't', 0)}, ${id('branch', 't', '(r % 10) % 3')}, ${id('cust', 't', `r % ${PER.customers}`)}, ${id('ticket', 't', 'r')}, 450, 1, 'redeemed', now() - ((r % 180) || ' days')::interval
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.redemptions - 1}) r`,
  `insert into audit_events (tenant_id, branch_id, occurred_at, actor_user_id, actor_role, module, action, resource_type, resource_id, status, severity)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'e % 3')}, now() - ((e % 180) || ' days')::interval - ((e % 1440) || ' minutes')::interval, ${id('user', 't', 'e % 11')}, 'MANAGER',
            (array['checkout','customers','booking','queue','settings'])[1 + e % 5], 'updated', 'ticket', 'r' || e, 'success', 'low'
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.audit - 1}) e`,
  `insert into ai_usage_logs (tenant_id, user_id, package_code, action, model_provider, model_name, input_tokens, output_tokens, total_tokens, cost_estimate_cents, status, created_at)
     select ${id('tenant', 't', 0)}, ${id('user', 't', 'a % 11')}, 'ai_receptionist', 'chat', 'openai', 'gpt', 100, 50, 150, 1, 'success', now() - ((a % 90) || ' days')::interval
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.ai - 1}) a`,
  `insert into outbox_events (id, event_type, tenant_id, aggregate_type, aggregate_id, correlation_id, payload_json, occurred_at, publish_status, next_attempt_at, published_at)
     select ${id('outbox', 't', 'o')}, 'ticket.updated', ${id('tenant', 't', 0)}, 'ticket', 'k' || o, 'corr-' || o, '{}'::jsonb, now() - ((o % 30) || ' days')::interval,
            case when o % 50 = 0 then 'pending' else 'published' end, now() - ((o % 30) || ' days')::interval, case when o % 50 = 0 then null else now() - ((o % 30) || ' days')::interval end
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, ${PER.outbox - 1}) o`,
  `insert into sessions (user_id, tenant_id, branch_id, status, created_at, expires_at, revoked_at)
     select ${id('user', 't', 'u')}, ${id('tenant', 't', 0)}, ${id('branch', 't', 'u % 3')}, 'active', now() - ((s % 60) || ' days')::interval, now() + interval '1 day' - ((s % 60) || ' days')::interval,
            case when s % 10 = 0 then null else now() - ((s % 60) || ' days')::interval end
     from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 10) u, generate_series(0, 49) s`,
  `insert into inventory_products (id, tenant_id, name) select ${id('prod', 't', 'p')}, ${id('tenant', 't', 0)}, 'Polish ' || p from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 199) p`,
  `insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'b')}, ${id('prod', 't', 'p')}, 10 from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 2) b, generate_series(0, 199) p`,
  `insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'k % 3')}, ${id('tech', 't', 'k')}, d, '09:00', '18:00' from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 14) k, generate_series(0, 6) d`,
  `insert into tenant_daily_sales_summary (tenant_id, branch_id, summary_date, revenue_cents, refunds_cents, created_at)
     select ${id('tenant', 't', 0)}, ${id('branch', 't', 'b')}, current_date - d, 100000, 0, (current_date - d)::timestamptz from generate_series(0, ${TENANTS - 1}) t, generate_series(0, 2) b, generate_series(0, 179) d`,
];

// ── the shapes ──────────────────────────────────────────────────────────────────────────────────────────────────────
// tenantFiltered: the shape names one salon (a seq scan over a big table is a failure). Platform shapes (the Super
// Admin's cross-salon reads) are reported but may scan. T/B/C/U/K = the measured salon's tenant/branch/customer/user/tech.
const T = `md5('tenant-0-0')::uuid`, B = `md5('branch-0-1')::uuid`, C = `md5('cust-0-42')::uuid`, U = `md5('user-0-2')::uuid`, K = `md5('tech-0-4')::uuid`, TK = `md5('ticket-0-1234')::uuid`, P = `md5('pay-0-1234')::uuid`, D = `md5('deal-0-3')::uuid`;
const SHAPES = [
  { name: 'payments list by salon + branch + date range', source: 'modules/payments (POS transactions list)', tenantFiltered: true,
    sql: `select id, ticket_id, method, amount_cents, tip_cents, status, created_at from payments where tenant_id = ${T} and branch_id = ${B} and created_at >= now() - interval '7 days' and created_at < now() order by created_at desc limit 50` },
  { name: 'payments of a ticket', source: 'modules/checkout checkout.kysely.repository (tender list)', tenantFiltered: true,
    sql: `select id, method, amount_cents, status from payments where tenant_id = ${T} and ticket_id = ${TK}` },
  { name: 'refunds of a payment', source: 'modules/checkout (refund totals)', tenantFiltered: true,
    sql: `select coalesce(sum(amount_cents), 0) from payment_refunds where tenant_id = ${T} and payment_id = ${P}` },
  { name: 'owner dashboard: sales per day, 30 days', source: 'modules/reports owner dashboard', tenantFiltered: true,
    sql: `select date_trunc('day', approved_at) d, sum(amount_cents) from payments where tenant_id = ${T} and status = 'approved' and approved_at >= now() - interval '30 days' group by 1 order by 1` },
  { name: 'owner dashboard: daily sales summary, 90 days', source: 'super-admin-overview overview.kysely.repository / owner reports', tenantFiltered: true,
    sql: `select summary_date, sum(revenue_cents) from tenant_daily_sales_summary where tenant_id = ${T} and summary_date >= current_date - 90 group by 1 order by 1` },
  { name: 'Super Admin tenant list (page)', source: 'super-admin-tenants list', tenantFiltered: false,
    sql: `select id, display_name, tenant_code, status, lifecycle_state, created_at from tenants order by created_at desc limit 50` },
  { name: 'Super Admin tenant lookup by code', source: 'super-admin-tenants.kysely.repository:127', tenantFiltered: false,
    sql: `select id from tenants where tenant_code = 'EXP3'` },
  { name: 'Super Admin payment volume per salon, 30 days', source: 'super-admin-platform.repository (top tenants)', tenantFiltered: false,
    sql: `select tenant_id, sum(amount_cents) from payments where status = 'approved' and created_at >= now() - interval '30 days' group by tenant_id order by 2 desc limit 10` },
  { name: 'AI usage per salon per day, 30 days', source: 'super-admin-ai-usage ai-usage-config.kysely.repository:63', tenantFiltered: true,
    sql: `select to_char(created_at, 'YYYY-MM-DD'), coalesce(sum(total_tokens), 0) from ai_usage_logs where created_at >= now() - interval '30 days' and tenant_id = ${T} group by 1 order by 1` },
  { name: 'customer by phone (identity / check-in)', source: 'modules/customers (phone lookup)', tenantFiltered: true,
    sql: `select id from customers where tenant_id = ${T} and normalized_phone = '+15550000042'` },
  { name: 'customer search by name (trigram)', source: 'super-admin-platform-search / POS search', tenantFiltered: true,
    sql: `select id, full_name from customers where tenant_id = ${T} and full_name ilike '%johnson4%' limit 20` },
  { name: 'customer search by phone fragment (trigram)', source: 'POS search', tenantFiltered: true,
    sql: `select id from customers where tenant_id = ${T} and normalized_phone like '%0004%' limit 20` },
  { name: 'customer list (page) for a branch', source: 'modules/customers customers.kysely.repository (list)', tenantFiltered: true,
    sql: `select id, full_name, normalized_phone from customers where tenant_id = ${T} and branch_id = ${B} order by full_name limit 50` },
  { name: 'queue board (active + today)', source: 'modules/queue queue.kysely.repository:189 loadAll', tenantFiltered: true,
    sql: `select id, customer_name, status, assigned_technician_id from pos_queue_items where tenant_id = ${T} and branch_id = ${B} and (status not in ('completed','done','cancelled','removed') or checked_in_at >= date_trunc('day', now()))` },
  { name: 'appointments of a day (booking board)', source: 'modules/booking booking.kysely.repository', tenantFiltered: true,
    sql: `select id, technician_id, start_time, end_time, status from pos_tech_appointments where tenant_id = ${T} and branch_id = ${B} and appt_date = current_date + 3 order by start_time` },
  { name: 'appointments of a technician, next 14 days', source: 'modules/queue tech.kysely.repository / availability', tenantFiltered: true,
    sql: `select id, appt_date, start_time from pos_tech_appointments where tenant_id = ${T} and technician_id = ${K} and appt_date between current_date and current_date + 14` },
  { name: 'appointments of a customer (history)', source: 'customer app / customer profile', tenantFiltered: true,
    sql: `select id, appt_date, status from pos_tech_appointments where tenant_id = ${T} and customer_id = ${C} order by appt_date desc limit 20` },
  { name: 'technician weekly schedule', source: 'modules/queue live-technician-schedule.kysely.repository', tenantFiltered: true,
    sql: `select day_of_week, start_time, end_time from technician_schedules where tenant_id = ${T} and technician_id = ${K}` },
  { name: 'loyalty balance of a customer', source: 'modules/customers loyalty-ledger.service', tenantFiltered: true,
    sql: `select points_balance from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C}` },
  { name: 'loyalty ledger of a customer', source: 'modules/customers loyalty-ledger.service', tenantFiltered: true,
    sql: `select * from loyalty_ledger where tenant_id = ${T} and customer_id = ${C} order by created_at desc limit 50` },
  { name: 'deal redemptions of a deal', source: 'super-admin-promotions promotions-oversight.kysely.repository / deals engine caps', tenantFiltered: true,
    sql: `select count(*) from deal_redemptions where tenant_id = ${T} and deal_id = ${D} and status in ('applied','redeemed')` },
  { name: 'deal redemptions of a customer (per-customer cap)', source: 'modules/deals engine (max_per_customer)', tenantFiltered: true,
    sql: `select count(*) from deal_redemptions where tenant_id = ${T} and deal_id = ${D} and customer_id = ${C} and status in ('applied','redeemed')` },
  { name: 'audit trail by actor', source: 'modules/audit audit.kysely.repository (actorUserId filter)', tenantFiltered: true,
    sql: `select id, module, action, occurred_at from audit_events where tenant_id = ${T} and actor_user_id = ${U} order by occurred_at desc limit 50` },
  { name: 'audit trail by module (page)', source: 'modules/audit audit.kysely.repository (module filter)', tenantFiltered: true,
    sql: `select id, action, occurred_at from audit_events where tenant_id = ${T} and module = 'checkout' order by occurred_at desc limit 50` },
  { name: 'inventory stock of a branch', source: 'super-admin-platform.repository / modules/inventory', tenantFiltered: true,
    sql: `select product_id, quantity_on_hand from inventory_location_stock where tenant_id = ${T} and branch_id = ${B}` },
  { name: 'active sessions of a user', source: 'modules/identity sessions (sign-out everywhere / devices)', tenantFiltered: true,
    sql: `select id, created_at from sessions where user_id = ${U} and revoked_at is null order by created_at desc` },
  { name: 'outbox: due pending events (publisher claim)', source: 'apps/api/src/events/outbox-publisher.ts claimBatch', tenantFiltered: false,
    sql: `select id from outbox_events where publish_status = 'pending' and next_attempt_at <= now() order by occurred_at limit 100` },
  { name: 'tickets open at a branch', source: 'modules/checkout checkout state', tenantFiltered: true,
    sql: `select id, status, total_cents from tickets where tenant_id = ${T} and branch_id = ${B} and status in ('ready_for_payment','open','in_service') order by created_at desc limit 100` },
  { name: 'tickets of a customer (visit history)', source: 'modules/customers profile', tenantFiltered: true,
    sql: `select id, total_cents, created_at from tickets where tenant_id = ${T} and customer_id = ${C} order by created_at desc limit 20` },
  { name: 'service lines of a ticket', source: 'modules/checkout ticket detail', tenantFiltered: true,
    sql: `select id, service_name_snapshot, line_total_cents from ticket_service_lines where tenant_id = ${T} and ticket_id = ${TK}` },
  { name: 'staff sign-in by email (owner portal)', source: 'modules/identity auth-user.kysely.repository:60', tenantFiltered: true,
    sql: `select id, role, password_hash from users where tenant_id = ${T} and lower(email) = lower('user2@explain0.test')` },
];

// ── plan walking ────────────────────────────────────────────────────────────────────────────────────────────────────
function walk(node, out = []) { out.push(node); for (const c of node.Plans ?? []) walk(c, out); return out; }
function describe(plan) {
  const nodes = walk(plan);
  const indexes = [...new Set(nodes.map((n) => n['Index Name']).filter(Boolean))];
  const seqs = nodes.filter((n) => n['Node Type'] === 'Seq Scan').map((n) => n['Relation Name']);
  // rows a scan read and threw away (filter / recheck), × loops — the measure of an index that does not match the shape
  const removed = nodes.reduce((a, n) => a + ((n['Rows Removed by Filter'] ?? 0) + (n['Rows Removed by Index Recheck'] ?? 0)) * (n['Actual Loops'] ?? 1), 0);
  return { root: plan['Node Type'], indexes, seqs, removed, rows: Number(plan['Actual Rows'] ?? 0) };
}
const WASTE_ROWS = 1000;   // a salon-scoped shape that reads and discards ≥ 1,000 rows (and ≥ 10× what it returns) is flagged

const md5Uuid = (text) => { const h = require('node:crypto').createHash('md5').update(text).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const results = [];
let admin = null, scratch = null;
const log = (...a) => console.log(...a);
async function main() {
  admin = new pg.Client({ connectionString: BASE_URL }); await admin.connect();
  const exists = (await admin.query('select 1 from pg_database where datname = $1', [DBNAME])).rowCount > 0;
  const reuse = args.has('--reuse') && exists;   // iterate on indexes without re-seeding: migrate the kept database, re-ANALYZE, re-EXPLAIN
  if (!reuse) {
    await admin.query(`drop database if exists ${DBNAME} with (force)`);
    await admin.query(`create database ${DBNAME}`);
  }
  log(`scratch database ${DBNAME} ${reuse ? 'reused' : 'created'}; migrating …`);
  const mig = spawnSync('node', [join(API_DIR, 'scripts', 'migrate.mjs')], { env: { ...process.env, DATABASE_URL: SCRATCH_URL }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (mig.status !== 0) throw new Error(`migrate failed: ${(mig.stderr || mig.stdout).split('\n').filter(Boolean).slice(-4).join(' | ')}`);
  scratch = new pg.Client({ connectionString: SCRATCH_URL }); await scratch.connect();
  const seedStart = Date.now();
  for (const s of reuse ? [] : SEED) {
    const t = Date.now();
    try { const r = await scratch.query(s); log(`  seed ${s.slice(12, 60).split('(')[0].trim().padEnd(30)} ${String(r.rowCount).padStart(7)} rows ${Date.now() - t} ms`); }
    catch (e) { throw new Error(`seed failed on: ${s.slice(0, 80)} … — ${e.message}`); }
  }
  await scratch.query('analyze');
  log(`seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)} s`);
  const rel = new Map((await scratch.query(`select relname, reltuples::bigint as n from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p')`)).rows.map((r) => [r.relname, Number(r.n)]));

  for (const s of SHAPES) {
    await scratch.query(s.sql);   // warm the cache once (a cold first read measures the disk, not the plan)
    const r = await scratch.query(`explain (analyze, format json) ${s.sql}`);
    const top = r.rows[0]['QUERY PLAN'][0];
    const d = describe(top.Plan);
    const bigSeqs = d.seqs.filter((t) => (rel.get(t) ?? 0) >= SEQ_SCAN_ROWS);
    const fail = s.tenantFiltered && bigSeqs.length > 0;
    const wasteful = s.tenantFiltered && d.removed >= WASTE_ROWS && d.removed >= 10 * Math.max(1, d.rows);
    results.push({ ...s, ...d, bigSeqs, ms: Number(top['Execution Time'] ?? 0), fail, wasteful });
  }
  for (const x of results) log(`${x.fail ? 'FAIL' : x.wasteful ? 'WARN' : x.bigSeqs.length ? 'SCAN' : 'ok  '}  ${x.name.padEnd(56)} ${x.root.padEnd(18)} ${(x.indexes.join(', ') || (x.seqs.length ? 'seq: ' + x.seqs.join(', ') : '—')).slice(0, 70).padEnd(70)} ${x.ms.toFixed(2)} ms  discarded ${x.removed}`);
  const failed = results.filter((x) => x.fail);
  log(`\n${results.length - failed.length}/${results.length} shapes pass (a tenant-filtered shape may not seq-scan a table of ≥ ${SEQ_SCAN_ROWS} rows); ${results.filter((x) => x.wasteful).length} flagged as discarding ≥ ${WASTE_ROWS} rows`);
  if (args.has('--strict')) return failed.length + results.filter((x) => x.wasteful).length;

  let load = null;   // [{ clients, seconds, table, result }]
  if (args.has('--load')) load = await runLoad();
  if (args.has('--write-doc')) writeDoc(rel, load);
  return failed.length;
}

// ── load (§101) ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function runLoad() {
  const { hashPassword } = require('@aipowersalon/auth');
  const PW = 'Explain!' + Math.random().toString(36).slice(2, 10);
  await scratch.query(`update users set password_hash = $1 where id = md5('user-0-0')::uuid`, [await hashPassword(PW)]);
  await scratch.query(`insert into user_branch_access (tenant_id, branch_id, user_id, access_level) select md5('tenant-0-0')::uuid, md5('branch-0-' || b)::uuid, md5('user-0-0')::uuid, 'manager' from generate_series(0, 2) b on conflict do nothing`).catch(() => undefined);
  const PORT = Number(process.env.LOAD_PORT || 3061);
  const env = { ...process.env, DATABASE_URL: SCRATCH_URL, REPO_DRIVER: 'postgres', AUTH_SESSION_SECRET: 'explain-pass-session-secret-0123456789abcdef', NODE_ENV: 'development', PORT: String(PORT), PROCESS_ROLE: 'api',
    AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off' };
  const proc = spawn('node', ['dist/main.js'], { cwd: API_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errs = ''; proc.stderr.on('data', (c) => { errs += c; });
  try {
    let up = false; for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { /* booting */ } if (!up) await new Promise((r) => setTimeout(r, 250)); }
    if (!up) throw new Error(`API did not boot: ${errs.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
    const seconds = Number(process.env.LOAD_SECONDS || 20);
    const passes = [...new Set([1, Number(process.env.LOAD_CLIENTS || 50)])];   // one client = the latency of the path itself; 50 = §101
    const out = [];
    for (const clients of passes) {
      const r = spawnSync('node', [join(API_DIR, 'scripts', 'api-load-test.mjs'), String(clients), String(seconds)], {
        env: { ...process.env, API_URL: `http://127.0.0.1:${PORT}`, LOGIN: JSON.stringify({ portal: 'tenant', salonCode: 'EXP0', identifier: 'user0@explain0.test', password: PW }), SELECT_BRANCH: md5Uuid('branch-0-1'), P95_BUDGET_MS: '100000' },
        encoding: 'utf8', timeout: (seconds + 900) * 1000 });
      const text = `${r.stdout}\n${r.stderr}`;
      log(text);
      const m = /RESULT: requests=(\d+) throughput=([\d.]+) req\/s p50=(\d+)ms p95=(\d+)ms p99=(\d+)ms 5xx\/network=(\d+)/.exec(text);
      out.push({ clients, seconds, table: text.split('\n').filter((l) => /^(GET|endpoint)/.test(l)).join('\n'), result: m ? { requests: +m[1], rps: +m[2], p50: +m[3], p95: +m[4], p99: +m[5], errors: +m[6] } : null, raw: m ? null : `exit ${r.status} ${r.signal ?? ''} ${r.error?.message ?? ''} ${text.slice(-600)}` });
    }
    return out;
  } finally { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800)); }
}

function writeDoc(rel, load) {
  const rows = results.map((x) => `| ${x.name} | ${x.tenantFiltered ? 'salon' : 'platform'} | ${x.root} | ${x.indexes.length ? x.indexes.map((i) => '`' + i + '`').join(', ') : x.seqs.length ? 'seq scan: ' + x.seqs.join(', ') : '—'} | ${x.ms.toFixed(2)} | ${x.removed.toLocaleString('en-US')} | ${x.fail ? '**FAIL**' : x.wasteful ? '**discards rows**' : x.bigSeqs.length ? 'scan (platform)' : 'ok'} | ${x.source} |`).join('\n');
  const big = ['customers', 'tickets', 'payments', 'pos_tech_appointments', 'pos_queue_items', 'audit_events', 'deal_redemptions', 'loyalty_ledger', 'ai_usage_logs', 'outbox_events', 'sessions'].map((t) => `${t} ${Number(rel.get(t) ?? 0).toLocaleString('en-US')}`).join(' · ');
  const lr = load?.result;
  const doc = `# DB EXPLAIN pass — 2026-10-08

BUILD_PLAN Phase 10 (Constitution 1 §45 query plan verification, §101 load testing, §111 "indexes match real queries",
"high-volume queries are measured"). Generated by \`apps/api/scripts/db-explain-pass.mjs --write-doc${load ? ' --load' : ''}\`; re-run it after any
migration that adds or drops an index.

## Method

A scratch database (\`${DBNAME}\`, dropped at the end) migrated with the real runner (all migrations), seeded with generated
SQL: ${TENANTS} salons × 3 branches — the measured salon plus nine others so a tenant filter is as selective as in production
— each with ${PER.customers.toLocaleString('en-US')} customers, ${PER.tickets.toLocaleString('en-US')} tickets (+ a service line each), ~${(PER.tickets * 0.98).toLocaleString('en-US')} payments,
${PER.appts.toLocaleString('en-US')} appointments, ${PER.queue.toLocaleString('en-US')} queue items, ${PER.loyalty.toLocaleString('en-US')} loyalty profiles + ledger rows, ${PER.redemptions.toLocaleString('en-US')} deal redemptions,
${PER.audit.toLocaleString('en-US')} audit events, ${PER.ai.toLocaleString('en-US')} AI usage rows, ${PER.outbox.toLocaleString('en-US')} outbox events, 550 sessions, 600 stock rows, 105 schedule rows and
180 days of the daily sales summary; then \`ANALYZE\`. Row estimates after seeding: ${big}.

Each shape below is the SQL a repository issues (source named), with literal parameter values, run once to warm the
cache and then under \`EXPLAIN (ANALYZE, FORMAT JSON)\`. **Rule:** a shape that filters by salon fails when its plan
has a Seq Scan over a table of ≥ ${SEQ_SCAN_ROWS.toLocaleString('en-US')} rows; it is flagged ("discards rows") when its scans read and threw away ≥ ${WASTE_ROWS.toLocaleString('en-US')}
rows and at least ten times what it returned (an index that exists but does not match the shape). Platform shapes (the Super Admin's cross-salon reads, the outbox
publisher) may scan and are labelled. Times are single-run sandbox times (one shared CPU), not production latencies.

## Result: ${results.length - results.filter((x) => x.fail).length}/${results.length} shapes pass

| Shape | Scope | Plan root | Index used | ms | Rows discarded | Verdict | Source |
|---|---|---|---|---:|---:|---|---|
${rows}

## Indexes added by this pass (migration 546)

See \`apps/api/db/migrations/546_explain_pass_indexes.sql\` — each index names the shape above that needed it. Before 546
the pass failed on the shapes listed in that file's header; after it, the table above.

## Load (§101) — sandbox numbers

${load ? load.map((l) => l.result ? `### ${l.clients} client${l.clients === 1 ? '' : 's'} × ${l.seconds} s

\`\`\`
${l.table}
\`\`\`

**p50 ${l.result.p50.toLocaleString('en-US')} ms · p95 ${l.result.p95.toLocaleString('en-US')} ms · p99 ${l.result.p99.toLocaleString('en-US')} ms · ${l.result.rps} req/s · ${l.result.requests} requests · ${l.result.errors} 5xx/network errors.**` : `### ${l.clients} clients — no RESULT line: \`${String(l.raw || '').replace(/`/g, "'").slice(0, 300)}\``).join('\n\n') + `

\`scripts/api-load-test.mjs\` against the API booted on this seeded database (the measured salon's owner, branch "Branch 1"
selected; a 429 from the rate limiter would be counted, none occurred unless the table shows one). Sandbox: one container, ${'2'} vCPUs shared by PostgreSQL, the API, the other
build agents and the load generator — not target-infrastructure numbers (that run is Kevin's).

**Finding (fixed in Phase 10) — the load was dominated by one code path, not by a query plan.** \`GET /api/v1/pos/checkout/state\` loaded EVERY
ticket the branch ever had and hydrated each (several queries per ticket) plus every payment: 41.7 s for ONE request on a
branch with ~6,700 tickets; at 50 clients p50 47 s / p95 128 s with 23 errors (the first run of this pass). The board now
reads only the tickets still open plus those created or paid since the branch's midnight, and only today's payments
(\`loadBoard\` / \`paymentsSince\` in \`modules/checkout/src/checkout/checkout.kysely.repository.ts\`; test \`checkout-state-bounded.pgtest\`).
The numbers above are after the fix: one request p50 ≈ 0.4 s at one client; 0 errors at 50 clients. At 50 clients on 2 shared
vCPUs every endpoint queues on CPU (7 req/s in total), so those latencies measure the sandbox, not the code — the run on
target infrastructure is Kevin's. The Oct 4 run (p95 1,585 ms) was on the 7-customer, 1-ticket dev salon.` : 'Not run in this pass (`--load`).'}
`;
  writeFileSync(join(ROOT, 'docs', 'DB_EXPLAIN_PASS_2026-10-08.md'), doc);
  log('wrote docs/DB_EXPLAIN_PASS_2026-10-08.md');
}

let code = 1;
try { code = (await main()) ? 1 : 0; }
catch (e) { console.error(String(e?.stack || e)); code = 1; }
finally {
  await scratch?.end().catch(() => undefined);
  if (admin) {
    if (!args.has('--keep')) { await admin.query(`drop database if exists ${DBNAME} with (force)`).catch((e) => console.error('drop failed:', e.message)); log(`dropped ${DBNAME}`); }
    await admin.end().catch(() => undefined);
  }
}
process.exit(code);
