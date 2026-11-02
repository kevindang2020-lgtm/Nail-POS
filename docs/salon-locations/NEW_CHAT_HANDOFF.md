# Salon Location & Nearby Discovery — Module Map

Canonical record: the existing **`branches`** table (one row per location/branch). No parallel
`tenant_locations` table was created — the spec's suggested fields were added to `branches`.

## Backend (apps/api/src)
| Concern | File | Notes |
|---|---|---|
| Migration (branch columns, hours, map history) | `db/migrations/106_tenant_location_management.sql` | additive/idempotent |
| Pure core (publish gating, transitions, duplicate detection, public projection) | `tenant-locations/location-core.ts` | framework-free, reuses `customer-salons/salon-directory-core` haversine |
| Maps provider adapter (search/geocode/reverse/directions) | `tenant-locations/maps-geocoding.provider.ts` | server key only; no-key fallback |
| Tenant location service | `tenant-locations/tenant-location.service.ts` | CRUD, geocode, map-pin, confirm, publish/unpublish, audit |
| Tenant controller `/tenant/locations` | `tenant-locations/tenant-locations.controller.ts` | TenantAuthGuard + RolePermissionGuard |
| Super-admin verification service | `tenant-locations/super-admin-location.service.ts` | cross-tenant read + verify/reject/suspend/correct |
| Super-admin controller `/super-admin/tenant-locations` | `tenant-locations/super-admin-locations.controller.ts` | SuperAdminGuard |
| Module wiring | `tenant-locations/tenant-locations.module.ts` | registered in `app.module.ts` |
| Permissions | `auth/rbac.ts` | `locations.*` + `super_admin.platform_locations.*` |
| Core tests | `tenant-locations/location-core.spec.ts` | 25/25 |

## Customer discovery (REUSED — not duplicated)
`customer-salons/` — controller `/customer/salons/nearby|:id|:id/services`, `salon-directory-core.ts`,
`google-places.provider.ts`, favorites. Service query now also hides explicitly-unpublished
(`is_public = false`), soft-deleted, and `suspended` branches.

## Frontend (apps/pos-web/src)
| Concern | File |
|---|---|
| API client | `api/posLocationsApi.ts` |
| Locations page + editor | `screens/TenantLocationsScreen.tsx` |
| Map-pin editor | `screens/locations/SalonLocationMapEditor.tsx` |
| Route `/tenant/management/locations` | `App.tsx` (real screen wins over FeaturePage scaffold) |

Customer frontend: `apps/customer-web/src/screens/FindSalonsScreen.tsx` + route `/find-salons` (reused).

---
## Handoff status
- Backend complete + validated (API tsc 0; location-core 25/25; directory 6/6).
- pos-web Locations manager + map-pin editor complete (tsc 0, build OK).
- Customer discovery reused as-is.
- Remaining/optional: business-hours write endpoints + UI, super-admin verification *frontend*
  (admin-web) screen, map-history viewer UI, archive endpoint, branch-specific Book Now deep-link
  polish. Backend hooks/columns for these already exist.
