# Inventory — API Map

## Manager `/tenant/inventory` (TenantAuthGuard + RolePermissionGuard)
- `GET summary` · `inventory.view` — KPI cards (value omitted for technicians)
- `GET alerts` · `inventory.view`
- `GET/POST categories` · view / `inventory.category.manage`
- `GET/POST brands` · view / `inventory.brand.manage`
- `GET/POST vendors` · view / `inventory.vendor.manage`
- `GET products` · view (filters: search, categoryId, brandId)
- `GET products/:id` · view (returns bottles)
- `POST products` · `inventory.create`
- `PATCH products/:id` · `inventory.update`
- `POST products/:id/archive` · `inventory.archive`
- `POST products/:id/stock/add` · `inventory.stock.add` — creates bottles + movement + recompute
- `POST units/:id/open|mark-low|mark-empty|mark-damaged` · `inventory.update`
- `GET technician-reports?status=` · `inventory.technician_report.approve`
- `POST technician-reports/:id/approve|reject` · `inventory.technician_report.approve`

## Technician `/technician/inventory`
- `GET search` · `inventory.view_limited` (cost/value stripped)
- `POST reports` · `inventory.technician_report.submit`
- `GET reports/mine` · `inventory.technician_report.submit`
- `POST units/:id/open` · `inventory.bottle.open`

Every endpoint derives tenant+branch from the session, validates input, scopes queries, and audits writes.
