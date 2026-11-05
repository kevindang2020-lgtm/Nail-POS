-- 702_assign_unassigned_terminals_single_location.sql — Fiserv master build §5.2 (Nov 4 2026).
--
-- Since 701's code change, a paired terminal with NO location (branch_id NULL) is no longer used for any branch's card
-- charge (it used to match EVERY branch of the salon). Such rows came from pairing in a session with no location
-- selected; pairing now requires a location.
--
-- Backfill, deliberately narrow: a salon with exactly ONE location can only mean that location, so its unassigned
-- terminals are assigned to it. A salon with several locations is NOT guessed — the owner assigns each terminal in
-- POS → Devices → Payment terminals ("Assign to this location"). The register link is cleared on reassignment only if it
-- pointed at another location's register (it cannot: a NULL-branch terminal's register was never validated), so it is
-- left as-is when it belongs to the chosen location.
--
-- Idempotent (a second run finds nothing). Rollback: not needed — the previous meaning ("any branch") is what the code
-- now refuses; setting branch_id back to NULL would only make the terminal unusable again.
WITH single AS (
  SELECT tenant_id, min(id::text)::uuid AS branch_id
  FROM branches
  GROUP BY tenant_id
  HAVING count(*) = 1
)
UPDATE pos_payment_terminals t
SET branch_id = s.branch_id::text,
    station_id = CASE
      WHEN t.station_id IS NULL THEN NULL
      WHEN EXISTS (SELECT 1 FROM pos_stations ps WHERE ps.id::text = t.station_id::text AND ps.branch_id::text = s.branch_id::text) THEN t.station_id
      ELSE NULL END,
    updated_at = now()
FROM single s
WHERE t.tenant_id::text = s.tenant_id::text
  AND t.branch_id IS NULL;
