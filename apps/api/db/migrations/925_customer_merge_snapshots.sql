-- 925_customer_merge_snapshots.sql — CUSTOMER 08 (extras round 10): a reversible-merge record for every completed customer merge.
-- mergeCustomersTx (customer-merge.ts, the one canonical merge both merge routes run) writes ONE row here in the merge's own
-- transaction: exactly which rows moved from which source (ids per table, the tags moved / dropped, the loyalty profiles it folded
-- in, the points it moved) plus a fingerprint (md5 of the row) of every moved row AS THE MERGE LEFT IT. "Unmerge" restores from this
-- snapshot ONLY when nothing touched those rows since (every fingerprint still matches, the sources are still the archived copies
-- this merge made, the survivor is live, no loyalty entry since) — otherwise it refuses with a reason and changes nothing.
-- The snapshot itself is immutable; the only update is the single active → undone transition (who / when / why).
CREATE TABLE IF NOT EXISTS customer_merge_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants (id),
  branch_id             UUID,
  group_id              TEXT NOT NULL,
  survivor_customer_id  UUID NOT NULL,
  source_customer_ids   UUID[] NOT NULL CHECK (cardinality(source_customer_ids) >= 1),
  merge_log_ids         JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot              JSONB NOT NULL,
  merged_by_user_id     UUID,
  merged_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
  undone_at             TIMESTAMPTZ,
  undone_by_user_id     UUID,
  undo_reason           TEXT CHECK (undo_reason IS NULL OR length(undo_reason) <= 500),
  CHECK ((status = 'undone') = (undone_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_cms_tenant_time ON customer_merge_snapshots (tenant_id, merged_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_cms_survivor ON customer_merge_snapshots (tenant_id, survivor_customer_id);

CREATE OR REPLACE FUNCTION customer_merge_snapshots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'customer_merge_snapshots rows are never deleted'; END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'undone'
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.survivor_customer_id IS DISTINCT FROM OLD.survivor_customer_id OR NEW.source_customer_ids IS DISTINCT FROM OLD.source_customer_ids
     OR NEW.merge_log_ids IS DISTINCT FROM OLD.merge_log_ids OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
     OR NEW.merged_by_user_id IS DISTINCT FROM OLD.merged_by_user_id OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'customer_merge_snapshots: the only change allowed is active -> undone';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cms_guard ON customer_merge_snapshots;
CREATE TRIGGER trg_cms_guard BEFORE UPDATE OR DELETE ON customer_merge_snapshots FOR EACH ROW EXECUTE FUNCTION customer_merge_snapshots_guard();
