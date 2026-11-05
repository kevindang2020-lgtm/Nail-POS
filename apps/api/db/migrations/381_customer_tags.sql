-- 381_customer_tags.sql — the table a manager's customer tags have been thrown away for want of.
--
-- == THE BUG ==============================================================================================
--
-- POSCustomersScreen.tsx, line 648:
--
--     const saveTags = async (next) => {
--       setETags(next); setSaving('tags');
--       try { await posCustomersApi.setTags(row.customerId, next); flash('tags'); }   ← flash() = "Saved ✓"
--       catch { } finally { setSaving(null); }
--     };
--
-- And customers.kysely.repository.ts:
--
--     async getTags(ctx, id) { return (await this.exists(ctx, id)) ? [] : null; }   ← ALWAYS EMPTY
--     async setTags(ctx, id, t) { return (await this.exists(ctx, id)) ? t : null; } ← ECHOES. STORES NOTHING.
--
-- There is no `customer_tags` table. There never was. The write had nowhere to go, the endpoint returned 200,
-- and the screen flashed "saved".
--
-- EVERY CUSTOMER TAG EVER SET ON THIS PLATFORM HAS BEEN DISCARDED.
--
-- And a customer tag is not decoration. It is where a salon writes "allergic to acetone", "VIP", "no-show risk",
-- "pregnant — no gel". A front-desk person typed that, watched it save, and the next person to open that customer
-- saw nothing. This is the same defect as the technician permission matrix (migration 377) — a screen that
-- accepts a write and stores nothing — and it was sitting in the CUSTOMER record, which is where the
-- consequences are worst.

CREATE TABLE IF NOT EXISTS customer_tags (
  tenant_id     UUID NOT NULL,
  branch_id     UUID,
  customer_id   UUID NOT NULL,
  tag           TEXT NOT NULL,
  created_by_user_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_customer_tags_customer ON customer_tags (tenant_id, customer_id);
-- The salon filters its roster by tag ("show me every VIP"), so the tag itself is an entry point too.
CREATE INDEX IF NOT EXISTS idx_customer_tags_tag ON customer_tags (tenant_id, tag);

-- ── AND ONE MORE OF THE SAME CLASS ───────────────────────────────────────────────────────────────────────
--
-- technicians.kysely.repository.ts:
--
--     async setShift(ctx, id, s) { return (await this.exists(ctx, id)) ? s : null; }   ← ECHOED. STORED NOTHING.
--
-- `technician_shifts` has existed the whole time. A manager clocked somebody in, got a 200, and the shift went
-- nowhere. Wiring it needs one thing the table never had: a way to say "this technician, this day, one row".
-- Without it there is nothing for an upsert to conflict ON, and a second clock-in silently duplicates the day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_shifts_day
  ON technician_shifts (tenant_id, technician_id, shift_date);
