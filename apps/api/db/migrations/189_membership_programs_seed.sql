-- 189_membership_programs_seed.sql — realistic membership data for the Super Admin Membership Programs oversight surface,
-- across the two seeded tenants. Idempotent on plan_code / member_number. Money is integer cents. Counts are honest
-- (reflect the seeded records, not the reference image's large fixtures). Recurring payments use the tenant's own
-- records (never AI PowerSalon subscription billing).
DO $$
DECLARE
  t1 uuid := 'e167929e-8d62-4de5-8a0b-0b727d08be38';  -- Pilot Nail Salon
  t2 uuid := 'd45202a2-9910-4431-966e-0e372a702251';  -- Second Salon
  b1 uuid; b2 uuid;
  t1c uuid[] := ARRAY['20daf31e-88fc-4121-b4bd-26cb8a5171d0','aac15013-cc50-4456-b508-5222fc214a27','bac8f3eb-57f7-4df8-be37-efbaed9c3cef','e5217ef2-0b7f-409e-aa94-7e8bdfd816e3','eda8b930-30cb-4680-871f-8396c42967ce']::uuid[];
  t2c uuid[] := ARRAY['17616f59-857e-44fe-abcb-5c9a075a4c93','471c0311-c1c4-438a-b7f6-62120bc56b27','8f249acb-50dd-4cd3-bc88-4557aaa21d66','b0ba7206-ee16-4d87-b4b0-5b7eec650079','bd12c5df-9b0b-4bc1-b382-5b875ceaaa2b']::uuid[];
  pv record; plan_row record; vid uuid; mid uuid;
  seq int := 0;
  -- plan blueprint: name, code, type, price cents, benefits count, trial_days
  plans_t1 text[][] := ARRAY[
    ARRAY['Basic Nail Membership','BASIC_NAIL','nail','4900','1'],
    ARRAY['Pedicure Club','PEDI_CLUB','spa','5900','3'],
    ARRAY['VIP Membership','VIP','premium','9900','5']
  ];
  plans_t2 text[][] := ARRAY[
    ARRAY['Family Membership','FAMILY','family','9900','6'],
    ARRAY['Premium Beauty Plan','PREMIUM_BEAUTY','premium','12900','7']
  ];
  statuses text[] := ARRAY['active','active','active','active','trial','paused','past_due','cancelled'];
  bp text[];
BEGIN
  -- Guard: fixtures only apply on demo-seeded databases (clean DBs skip; keeps migrations
  -- runnable from scratch).
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = t1) OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = t2) THEN
    RAISE NOTICE '189_membership_programs_seed: demo tenants not present — skipping fixtures (clean database)';
    RETURN;
  END IF;
  SELECT id INTO b1 FROM branches WHERE tenant_id = t1 ORDER BY created_at LIMIT 1;
  SELECT id INTO b2 FROM branches WHERE tenant_id = t2 ORDER BY created_at LIMIT 1;

  -- Create plans + a published version + benefits for each tenant.
  FOREACH bp SLICE 1 IN ARRAY (plans_t1 || plans_t2) LOOP
    -- resolve tenant/branch/customers for this plan
    DECLARE
      tid uuid; bid uuid; custs uuid[]; pid uuid; price int := bp[4]::int; nbenefits int := bp[5]::int; i int;
    BEGIN
      IF bp[2] IN ('BASIC_NAIL','PEDI_CLUB','VIP') THEN tid := t1; bid := b1; custs := t1c; ELSE tid := t2; bid := b2; custs := t2c; END IF;
      IF EXISTS (SELECT 1 FROM membership_plans WHERE tenant_id = tid AND plan_code = bp[2]) THEN CONTINUE; END IF;

      INSERT INTO membership_plans (tenant_id, branch_id, name, plan_code, product_type, description, status, is_popular, member_visible, created_at)
      VALUES (tid, bid, bp[1], bp[2], bp[3], bp[1] || ' membership', 'active', bp[2] IN ('VIP','PREMIUM_BEAUTY'), true, now() - interval '120 days')
      RETURNING id INTO pid;

      INSERT INTO membership_plan_versions (plan_id, tenant_id, version_number, billing_interval, interval_count, price_cents, trial_days, auto_renew, rollover_allowed, credit_expiry_days, is_published, effective_at, created_at)
      VALUES (pid, tid, 1, 'month', 1, price, CASE WHEN bp[2]='VIP' THEN 14 ELSE 0 END, true, true, 90, true, now() - interval '120 days', now() - interval '120 days')
      RETURNING id INTO vid;
      UPDATE membership_plans SET current_version_id = vid WHERE id = pid;

      FOR i IN 1..nbenefits LOOP
        INSERT INTO membership_benefits (plan_version_id, tenant_id, benefit_type, label, credits_per_cycle, value_cents, percent, max_per_cycle, rollover_allowed, sort_order)
        VALUES (vid, tid, CASE WHEN i=1 THEN 'service_credit' WHEN i=2 THEN 'product_discount' ELSE 'included_service' END,
                'Benefit ' || i, CASE WHEN i=1 THEN 1 ELSE 0 END, CASE WHEN i=1 THEN price ELSE 0 END,
                CASE WHEN i=2 THEN 10 ELSE 0 END, 1, true, i);
      END LOOP;

      -- Enroll members across a spread of statuses; cycle through the tenant's customers.
      FOR i IN 1..array_length(statuses,1) LOOP
        seq := seq + 1;
        DECLARE
          st text := statuses[i]; cust uuid := custs[1 + (i % array_length(custs,1))];
          mref text := 'MBR-' || lpad(seq::text, 5, '0');
          started timestamptz := now() - ((30 + i*7) || ' days')::interval;
          periodEnd timestamptz := now() + ((30 - i) || ' days')::interval;
          cmid uuid;
        BEGIN
          IF EXISTS (SELECT 1 FROM customer_memberships WHERE tenant_id=tid AND member_number=mref) THEN CONTINUE; END IF;
          INSERT INTO customer_memberships (tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, member_number, started_at, current_period_start, current_period_end, next_billing_at, cycles_billed, auto_renew, comped, canceled_at, cancel_reason, paused_at, pause_resumes_at, created_at)
          VALUES (tid, bid, cust, pid, vid, st, mref, started, now() - interval '15 days',
                  periodEnd, CASE WHEN st IN ('active','past_due','trial') THEN periodEnd ELSE NULL END,
                  GREATEST(i,1), st <> 'cancelled', false,
                  CASE WHEN st='cancelled' THEN now() - interval '5 days' ELSE NULL END,
                  CASE WHEN st='cancelled' THEN 'customer_request' ELSE NULL END,
                  CASE WHEN st='paused' THEN now() - interval '3 days' ELSE NULL END,
                  CASE WHEN st='paused' THEN now() + interval '20 days' ELSE NULL END,
                  started)
          RETURNING id INTO cmid;

          -- Payments: a successful recurring charge for billing statuses; a failed one for past_due.
          IF st IN ('active','paused','past_due') THEN
            INSERT INTO membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, tax_cents, status, processor, idempotency_key, attempt_number, period_start, period_end, created_at, settled_at)
            VALUES (tid, bid, cmid, cust, 'recurring', price, 0, 'succeeded', 'fiserv', mref || ':p1', 1, now()-interval '30 days', now(), now()-interval '30 days', now()-interval '30 days');
          END IF;
          IF st = 'past_due' THEN
            INSERT INTO membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, tax_cents, status, processor, idempotency_key, attempt_number, failure_reason, period_start, period_end, created_at)
            VALUES (tid, bid, cmid, cust, 'recurring', price, 0, 'failed', 'fiserv', mref || ':p2', 2, 'card_declined', now(), now()+interval '30 days', now()-interval '1 day');
          END IF;

          -- Credit ledger: issue a credit for active/paused; some expiring soon.
          IF st IN ('active','paused','trial') THEN
            INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, entry_type, quantity, amount_cents, expires_at, reason, created_at)
            VALUES (tid, cmid, 'issued', 1, price, now() + ((10 + i) || ' days')::interval, 'cycle_grant', now()-interval '10 days');
          END IF;

          -- Redemptions are tracked via the credit ledger here (membership_redemptions requires a ticket).
          IF st = 'active' AND (i % 2 = 0) THEN
            INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, entry_type, quantity, amount_cents, reason, created_at)
            VALUES (tid, cmid, 'redeemed', 1, price, 'benefit_redeemed', now()-interval '3 days');
          END IF;

          -- Activity feed.
          INSERT INTO membership_activity (tenant_id, branch_id, customer_membership_id, customer_id, plan_id, activity_type, plan_name_snapshot, amount_cents, occurred_at)
          VALUES (tid, bid, cmid, cust, pid, CASE WHEN st='cancelled' THEN 'canceled' WHEN st='trial' THEN 'trial_started' ELSE 'enrolled' END, bp[1], price, started);
        END;
      END LOOP;
    END;
  END LOOP;
END $$;
