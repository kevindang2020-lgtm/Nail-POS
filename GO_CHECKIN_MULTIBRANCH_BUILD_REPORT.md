# Multi-Branch Go Check-In Devices (Build Report)

Closes the §4 "multi-branch device config" item from `GO_CHECK_IN_SPEC_GAP_REVIEW.md`. A single (e.g. shared front-desk)
kiosk can now serve check-ins for **several branches**, with the chosen location validated server-side against a per-device
allow-list and carried on the session. Fully **additive** — single-branch devices behave exactly as before.

## Model
- The existing `go_checkin_devices.branch_id` stays the **default** branch. A new `allowed_branch_ids` (JSONB) holds any
  **additional** branches the device may serve. The **selectable set = default ∪ allowed** (deduped). NULL/empty allowed =
  single-branch (today's behavior).
- At session start the kiosk may pass a `branchId`; it **must** be in the selectable set or it's rejected. The chosen
  branch is stored on the session and drives every check-in write.

## Security (the deliberate widening, done carefully)
The flow previously pinned `branch_id` from the device record only. It now uses the **session's chosen branch**, validated
at start:
- Pure, exported guards: `selectableBranchIds(device)`, `isBranchAllowed(device, id)`, `resolveSessionBranch(device, requested)`.
- `startSession(slug, branchId?)`: a requested branch outside the allow-list → **`400 branch_not_allowed`**, nothing
  started; no choice → the default branch.
- The branch source for **every** check-in write/read/realtime switched from `r.device.branchId` → `r.session.branchId`
  (kiosk ctx, appointment lookups, realtime room). So a shared kiosk lands in exactly the branch the guest picked, and only
  a branch the Super Admin explicitly allowed for that device is ever reachable. The blast radius is within-tenant by
  construction (allowed ids are admin-curated from the tenant's own branches; `listBranchNames` only resolves same-tenant).

## What changed
- **DB migration `100_go_checkin_allowed_branches.sql`** — `allowed_branch_ids JSONB`. `kysely.types.ts` updated.
- **`go-check-in.dto.ts`** — `GoCheckInDevice.allowedBranchIds`; the three pure guards; `KioskConfig.branches` (selectable
  list with `isDefault`).
- **Repository** (interface + Kysely + in-memory) — create/read carry `allowedBranchIds`; new `setDeviceBranches(...)` and
  `listBranchNames(tenantId, ids)` (same-tenant only).
- **`go-check-in.service.ts`** — branch-validated `startSession`; `getConfig` exposes selectable branches (names + default
  flagged); `createDevice`/`updateDevice` accept default + allowed (default de-duped out of "additional"); `listDevices`
  surfaces `allowedBranchIds`; all check-in branch reads moved to the session.
- **Controllers** — public `start-session` accepts `{ branchId }`; admin `create`/`update` accept `allowedBranchIds`
  (+ default `branchId`).
- **admin-web** — `checkInDevicesApi` carries `allowedBranchIds` + `setBranches`; the **Check-In Devices** screen got a
  "Default branch" + "Also serves" additional-branches picker on create, a **+N** multi-branch indicator per device, and an
  inline branch editor (default dropdown + additional checkboxes → save).
- **Kiosk** (`apps/go-check-in-kiosk`, synced to www + native mirrors) — when `config.branches.length > 1`, a **location
  picker** appears before check-in; the chosen `branchId` is sent to `start-session`; a `400` re-shows the picker.

## Tests / verification
- `go-check-in-super-admin.vitest.spec.ts` — **17 tests** (was 10, +7): guard truth table; allowed branch carried on the
  session; **disallowed branch rejected, nothing started**; no-choice → default; `getConfig` selectable list + default flag
  + resolved names; single-branch device unaffected (non-default rejected, default used, no picker); `updateDevice` sets
  default + allowed with the default de-duped out.
- `CheckInDevicesScreen.test.tsx` — **7 tests** (was 6, +1): the +N indicator + the inline editor → `setBranches`.
- Full backend suite **629 + harness, RESULT: PASS**; full admin-web **31 files / 168 tests**; `tsc` clean (api +
  admin-web); production `vite build` succeeds; kiosk script parses + all four copies synced.

## Honest notes
- The backend allow-list and the admin UI are unit-proven. The kiosk **location picker** is verified by JS parse + the API
  contract here; exercising it on a physical device needs hardware in hand.
- Validation is at session **start**; a session is short-lived (idle timeout), so a branch removed from the allow-list
  mid-session isn't re-checked per action. Re-validating each action is possible later but isn't needed for correctness.
- An intermittent, unrelated concurrency flake in `HardwareScreen.test` can surface on a first full admin-web run; it
  passes in isolation and on re-run (untouched by this change).
