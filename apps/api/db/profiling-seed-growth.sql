-- profiling-seed-growth.sql — the append-only "giants" that grow fastest (roadmap Phase 4 partition candidates).
-- audit_events: one row per action → the fastest-growing table. Seed ~3M for the big tenant + ~1M neighbors.
-- notifications: one row per message → seed ~1M big tenant.

\set BIG_TENANT '11111111-1111-1111-1111-111111111111'

-- ---- audit_events: 3,000,000 for the big tenant across a year, modules, severities ----
INSERT INTO audit_events (id, tenant_id, branch_id, occurred_at, actor_role, actor_name, module, action, resource_type, resource_id, summary, status, severity, metadata, created_at)
SELECT gen_random_uuid(),
       :'BIG_TENANT'::uuid,
       ('30000000-0000-0000-0000-' || lpad((n % 8 + 1)::text,12,'0'))::uuid,
       now() - ((n % 525600) || ' minutes')::interval,
       (ARRAY['OWNER','MANAGER','RECEPTION','TECH'])[1 + (n % 4)],
       'Actor'||(n % 500),
       (ARRAY['booking','checkout','customers','services','technicians','settings','auth','payments'])[1 + (n % 8)],
       (ARRAY['create','update','view','delete','login','export'])[1 + (n % 6)],
       'pos_resource', (n % 100000)::text,
       'Action '||n||' summary',
       CASE WHEN n % 50 = 0 THEN 'failure' ELSE 'success' END,
       (ARRAY['info','info','info','warning','critical'])[1 + (n % 5)],
       '{}'::jsonb,
       now() - ((n % 525600) || ' minutes')::interval
FROM generate_series(1,3000000) n;

-- ---- audit_events: 1,000,000 across neighbor tenants ----
INSERT INTO audit_events (id, tenant_id, occurred_at, module, action, status, severity, metadata, created_at)
SELECT gen_random_uuid(),
       ('20000000-0000-0000-0000-' || lpad(t::text,12,'0'))::uuid,
       now() - ((n % 262800) || ' minutes')::interval,
       (ARRAY['booking','checkout','customers'])[1 + (n % 3)],
       'update', 'success',
       (ARRAY['info','warning'])[1 + (n % 2)],
       '{}'::jsonb, now()
FROM generate_series(1,40) t, generate_series(1,25000) n;

-- ---- notifications: 1,000,000 for the big tenant ----
INSERT INTO notifications (id, tenant_id, channel, to_address, subject, body, status, created_at)
SELECT gen_random_uuid(),
       :'BIG_TENANT'::uuid,
       (ARRAY['sms','email','push'])[1 + (n % 3)],
       '+1555' || lpad((n % 10000000)::text,7,'0'),
       'Reminder '||n,
       'Your appointment is coming up.',
       (ARRAY['sent','sent','sent','delivered','failed'])[1 + (n % 5)],
       now() - ((n % 525600) || ' minutes')::interval
FROM generate_series(1,1000000) n;

ANALYZE audit_events;
ANALYZE notifications;
