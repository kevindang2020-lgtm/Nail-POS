# Changelog — Salon Locations

## Added
- Migration `106_tenant_location_management.sql`: branch management columns (salon_code,
  public_display_name, formatted_address, google_place_id, map_accuracy, map_pin_confirmed_at/by,
  timezone, verification_status, is_public + customer-facing toggles, published/unpublished/verified
  timestamps, manager/internal fields, deleted_at) + indexes (coords, verification, public);
  tables `tenant_location_hours`, `tenant_location_map_history`.
- `tenant-locations` module: pure core, maps geocoding provider adapter, tenant service+controller,
  super-admin verification service+controller. Registered in `app.module.ts`.
- Permissions `locations.*` and `super_admin.platform_locations.*` (OWNER auto-grant; MANAGER granted).
- pos-web: `posLocationsApi`, `TenantLocationsScreen`, `SalonLocationMapEditor`; real route for
  `/tenant/management/locations`.

## Changed
- `customer-salons.service.ts`: discovery query now hides `is_public = false`, `deleted_at` rows, and
  `verification_status = 'suspended'` branches (existing rows with `is_public = NULL` stay visible).

## Not duplicated
- Reused canonical `branches` table, `tenant_app_flags`, and the entire `customer-salons` discovery
  stack + `customer-web/FindSalonsScreen`.
