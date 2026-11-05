# Technician Inventory Workflow

1. Technician searches a product (`GET /technician/inventory/search`) — cost/value hidden.
2. Reports an issue (`POST /technician/inventory/reports`): bottle_empty, bottle_low, open_new, damaged,
   missing, expired, wrong_quantity, need_reorder, used, other. Validated against the bottle's current
   status; duplicate pending reports blocked.
3. Report is created `pending` (manager approval model). Technician sees their own via `reports/mine`.
4. Manager sees pending reports in the Inventory → Technician Reports tab and Approves/Rejects.
5. **On approve**, the report's effect is applied to the bottle (empty→markEmpty, low→markLow,
   open_new→openUnit, damaged→markDamaged), stock recomputes, movement + audit recorded, reorder checked.
6. Technician may open a replacement bottle directly (`POST /technician/inventory/units/:id/open`,
   permission `inventory.bottle.open`) — guarded so a bottle can't be opened twice.
