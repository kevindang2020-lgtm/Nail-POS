-- 410_ticket_line_supply_snapshot.sql — bake the resolved product-cost/supply method onto each service line (spec §9),
-- mirroring the commission snapshot. The compensation engine already computes a salon-retained supply charge that reduces
-- the commissionable base for 'fixed'/'percent' methods; this is the missing storage so a rule's supply config actually
-- reaches the engine. DEFAULT is 'none' (0), which is Method A: product cost tracked separately, NEVER deducted from the
-- commissionable base. 'fixed'/'percent' reduce the base only when a tenant explicitly authored them; 'tiered'/'recipe'
-- are treated as tracked-separately (engine returns 0) until a later phase surfaces their cost. Integer cents; snapshot is
-- frozen at line creation so historical tickets never move.

ALTER TABLE ticket_service_lines
  ADD COLUMN IF NOT EXISTS supply_method_snapshot TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS supply_value_snapshot  INTEGER NOT NULL DEFAULT 0;
