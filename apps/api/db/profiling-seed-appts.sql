-- profiling-seed-appts.sql — appointments only, with real technician_ids (NOT NULL). Distributes ~2M big-tenant
-- appointments across that tenant's 20k technicians (row-number-mapped) + neighbor-tenant volume.

\set BIG_TENANT '11111111-1111-1111-1111-111111111111'

-- Materialize the big tenant's technician ids into an indexable array for fast round-robin assignment.
CREATE TEMP TABLE big_techs AS
SELECT row_number() OVER (ORDER BY id) AS rn, id, branch_id
FROM technicians WHERE tenant_id = :'BIG_TENANT'::uuid;

-- ~2,000,000 big-tenant appointments over the last 365 days + next 30, tech assigned round-robin.
INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status, created_at, updated_at)
SELECT gen_random_uuid(),
       :'BIG_TENANT'::uuid,
       bt.branch_id,
       bt.id,
       NULL,
       'Cust'||(n % 200000),
       (n % 50 = 0),
       CASE WHEN n % 3 = 0 THEN 'walk_in' ELSE 'online' END,
       '[]'::jsonb,
       (current_date - 365 + (n % 395)),
       '09:00', '10:00', 60,
       (ARRAY['booked','completed','cancelled','no_show','checked_in'])[1 + (n % 5)],
       'not_required',
       now() - ((n % 365) || ' days')::interval, now()
FROM generate_series(1,2000000) n
JOIN big_techs bt ON bt.rn = 1 + (n % 20000);

-- neighbor-tenant appointments (each neighbor gets its own tech pool would be ideal; for volume we reuse a NULL-free
-- placeholder tech per neighbor by creating one deterministic tech per neighbor first).
CREATE TEMP TABLE neighbor_techs AS
SELECT ('20000000-0000-0000-0000-' || lpad(t::text,12,'0'))::uuid AS tenant_id,
       ('30000000-0000-0000-0000-' || lpad((t*10)::text,12,'0'))::uuid AS branch_id,
       (SELECT id FROM technicians WHERE tenant_id = :'BIG_TENANT'::uuid LIMIT 1) AS any_tech
FROM generate_series(1,40) t;

INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, is_vip, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status, created_at, updated_at)
SELECT gen_random_uuid(), nt.tenant_id, nt.branch_id, nt.any_tech, NULL, 'Neighbor'||n, false,
       'online', '[]'::jsonb,
       (current_date - 180 + (n % 210)), '09:00','10:00',60,
       (ARRAY['booked','completed','cancelled'])[1 + (n % 3)], 'not_required', now(), now()
FROM neighbor_techs nt, generate_series(1,50000) n;

ANALYZE pos_tech_appointments;
