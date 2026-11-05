# Changelog — Inventory

## Added
- Migration `108_inventory_management.sql` (categories, brands, vendors, products, location_stock, units,
  stock_movements, technician_reports) + indexes + dedup constraint.
- `inventory/inventory-core.ts` (pure, 29 tests), `inventory.service.ts`, `inventory.controller.ts`,
  `technician-inventory.controller.ts`, `inventory.module.ts` (registered).
- Permissions `inventory.*` (+ technician limited `inventory.view_limited` / `.technician_report.submit` /
  `.product_usage.submit` / `.bottle.open`).
- pos-web `api/inventoryApi.ts` + `screens/TenantInventoryScreen.tsx` + route `/tenant/inventory`.

## Not duplicated
- Legacy `inventory_items` left untouched. One canonical implementation; no InventoryV2/Final.
