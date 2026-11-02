# Branch Footprint — Build Report (closes REMAINING_BLOCKERS #2)

The table no longer silently hides multi-branch tenants behind a single branch's city/state. It now flags multi-branch
tenants and the detail panel lists the **full footprint**.

## Architectural note (honest)
The gateway is **per-tenant**: `tenant_payment_config`'s primary key is `tenant_id`, so one gateway serves all of a
tenant's branches. City/State is therefore *location context*, not a per-branch gateway — a "per-branch gateway selector"
would imply branch-level gateway overrides that don't exist in the schema. So the correct close is **branch visibility**,
not a fake selector. (Branch-level gateway overrides remain a possible future feature, not a current gap.)

## What changed
- **`super-admin-platform.repository.ts`** — the existing single `branches` query now also carries `id`/`name`/`status` and
  builds a per-tenant footprint: `branchCount` (exact) + `branches[]` (creation order, capped at 12). No new query.
- **`payment-gateways-core.ts`** — `BranchRef` type; `RawGatewayRow`/`GatewayView` gain `branchCount` + `branches`;
  `toGatewayView` passes them through. The compact `location` (primary branch) is unchanged for the table.
- **Frontend `PaymentGatewaysScreen.tsx`** —
  - **Table City/State** shows the primary `location` plus a **"+N"** indicator for multi-branch tenants, with a `title`
    tooltip listing every branch's city/state.
  - **Detail panel** gains a **Branches** section: each branch (name → city, state), the total count, a "+N more" line if the
    footprint exceeds the cap, and an honest note that "One gateway serves all branches for this tenant."
- **`superAdminApi.ts`** — `PgGateway` gains `branchCount` + `branches`.

## Tests / verification
- `payment-gateways-core.spec.ts` — **65 assertions** (added: view carries the branch footprint, order preserved).
- `PaymentGatewaysScreen.test.tsx` — **9 tests** (added: multi-branch tenant renders the "+2" indicator and the detail
  panel lists non-primary branches like "Galleria" / "Austin, TX").
- Full backend suite **606 + harness, RESULT: PASS**; full admin-web **30 files / 156 tests**; `tsc` clean (api + admin-web);
  production `vite build` succeeds.
