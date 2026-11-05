-- profiling-seed.sql — generates a realistic large tenant for Phase 1.3 hot-path index profiling.
-- Target tenant: 200k customers, 20k technicians, ~2M appointments across a year of dates + several branches.
-- Plus 40 smaller "neighbor" tenants so the hot tables hold cross-tenant volume (the real test of tenant-partitioned
-- indexes). Set-based generate_series for speed. Idempotent-ish: run against a fresh migrated DB.

\set BIG_TENANT '11111111-1111-1111-1111-111111111111'

-- ---- 40 neighbor tenants, each with ~5k customers / ~40 techs / ~50k appts, to load the shared tables ----
INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in, created_at, updated_at)
SELECT gen_random_uuid(),
       ('20000000-0000-0000-0000-' || lpad(t::text,12,'0'))::uuid,
       ('30000000-0000-0000-0000-' || lpad((t*10 + (n % 3))::text,12,'0'))::uuid,
       'First'||n, 'Last'||n, 'First'||n||' Last'||n,
       CASE WHEN n % 20 = 0 THEN 'archived' ELSE 'active' END,
       (n % 2 = 0), (n % 3 = 0), (n % 2 = 0),
       now() - ((n % 365) || ' days')::interval, now()
FROM generate_series(1,40) t, generate_series(1,5000) n;

-- ---- the BIG tenant: 200,000 customers across 8 branches ----
INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, status, marketing_sms_opt_in, marketing_email_opt_in, marketing_opt_in, created_at, updated_at)
SELECT gen_random_uuid(),
       :'BIG_TENANT'::uuid,
       ('30000000-0000-0000-0000-' || lpad((n % 8 + 1)::text,12,'0'))::uuid,
       'Cust'||n, 'Big'||n, 'Cust'||n||' Big'||n,
       '+1555' || lpad((n % 10000000)::text, 7, '0'),
       '(555) ' || lpad((n % 1000)::text,3,'0') || '-' || lpad((n % 10000)::text,4,'0'),
       'cust'||n||'@example.com',
       CASE WHEN n % 25 = 0 THEN 'archived' ELSE 'active' END,
       (n % 2 = 0), (n % 3 = 0), (n % 2 = 0),
       now() - ((n % 365) || ' days')::interval, now()
FROM generate_series(1,200000) n;

-- ---- the BIG tenant: 20,000 technicians across 8 branches ----
INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, role_label, status, commission_type, commission_value, default_commission_split_percent, is_active, created_at, updated_at)
SELECT gen_random_uuid(),
       :'BIG_TENANT'::uuid,
       ('30000000-0000-0000-0000-' || lpad((n % 8 + 1)::text,12,'0'))::uuid,
       'Tech'||n, 'Nail'||n, 'Tech'||n||' Nail'||n,
       'technician',
       CASE WHEN n % 10 = 0 THEN 'inactive' ELSE 'active' END,
       'percent', 40, 40, (n % 10 <> 0),
       now() - ((n % 365) || ' days')::interval, now()
FROM generate_series(1,20000) n;

-- ---- the BIG tenant: ~2,000,000 appointments across a year, 8 branches, real dates + statuses ----
-- 200k "customers" worth × ~10 appts each, spread over the last 365 days and next 30.
INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status, created_at, updated_at)
SELECT gen_random_uuid(),
       :'BIG_TENANT'::uuid,
       ('30000000-0000-0000-0000-' || lpad((n % 8 + 1)::text,12,'0'))::uuid,
       NULL, NULL,
       'Cust'||(n % 200000),
       (n % 50 = 0),
       CASE WHEN n % 3 = 0 THEN 'walk_in' ELSE 'appointment' END,
       '[]'::jsonb,
       (current_date - 365 + (n % 395)),
       '09:00', '10:00', 60,
       (ARRAY['booked','completed','cancelled','no_show','checked_in'])[1 + (n % 5)],
       'none',
       now() - ((n % 365) || ' days')::interval, now()
FROM generate_series(1,2000000) n;

-- neighbor-tenant appointments too, so the table isn't single-tenant
INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status, created_at, updated_at)
SELECT gen_random_uuid(),
       ('20000000-0000-0000-0000-' || lpad(t::text,12,'0'))::uuid,
       ('30000000-0000-0000-0000-' || lpad((t*10)::text,12,'0'))::uuid,
       NULL, NULL, 'Neighbor'||n, false,
       'appointment', '[]'::jsonb,
       (current_date - 180 + (n % 210)),
       '09:00','10:00',60,
       (ARRAY['booked','completed','cancelled'])[1 + (n % 3)],
       'none', now(), now()
FROM generate_series(1,40) t, generate_series(1,50000) n;

ANALYZE customers;
ANALYZE technicians;
ANALYZE pos_tech_appointments;
