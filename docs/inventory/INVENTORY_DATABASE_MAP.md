# Inventory — Database Map (migration 108)

- `inventory_categories` (tenant, nested via parent_category_id, tracking_mode)
- `inventory_brands` (tenant)
- `inventory_vendors` (tenant)
- `inventory_products` (tenant-level definitions: brand/category, color_number/name/family/finish, sku/barcode/upc,
  unit_type, tracking_mode, cost/retail cents, reorder_level/quantity, maximum_stock, track_expiration, is_retail/is_service)
- `inventory_location_stock` (tenant+branch+product, UNIQUE(branch_id,product_id); on_hand/available/unopened/open/low/empty/damaged — **recomputed from bottle rows**)
- `inventory_units` (the bottles: tenant+branch+product, status, lot/expiration, opened/emptied by+at, unique internal_barcode per tenant)
- `inventory_stock_movements` (immutable ledger: type, before/change/after, related_type/id, actor)
- `inventory_technician_reports` (type/status, dedup unique partial index on (unit,type) where pending)

Isolation: every query filters `tenant_id` (and `branch_id` for stock/bottles/movements/reports) from the
session context. Products are tenant-shared; stock & bottles are per-branch (§19). Indexes on tenant/branch,
category, brand, barcode, unit status, movement scope, and report scope.
