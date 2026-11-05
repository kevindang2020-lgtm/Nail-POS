# Super Admin Technician Account Management — Session Handoff & Changelog

A single account of everything delivered this session and exactly what to do to bring it into your live tree. Nothing
here is new code — it's the map for pulling in what's already built and verified. (A separate, older
`CHANGELOG_HANDOFF.md` in this tree covers an unrelated Face ID effort and is left untouched.)

---

## 1. What shipped this session

**Super Admin Technician Account Management** — audit + nine phases + four extensions + a tenant-isolation hardening
pass. A gap-fill on the ~75%-existing `super-admin-staff` module, never a rebuild. The Technician Social Profile and
Deals Marketplace shared surfaces this work touched (a tech-profile enforcement guard, a deals repo method) were
re-verified alongside.

## 2. Migrations to apply (in order, additive, following the existing 376–394 line)

- `395_tech_account_status.sql` — account status gains `paused` + `locked`; pause fields; `tech_account_status_events`
  history table.
- `396_membership_pause.sql` — `tech_salon_memberships.status` gains `paused`; history table gains `target_id` /
  `target_kind`.
- `397_admin_scoped_pause.sql` — `admin_profile_hidden` / `admin_messaging_paused` / `admin_deals_frozen` on
  `global_tech_profiles`.

## 3. Backend changes (apps/api)

- `super-admin-staff/global-tech-admin.service.ts` — pause/reactivate, membership pause/reactivate, scoped pauses,
  suspend cascade (+ session revoke + notify), lock/unlock, support summary + revoke-sessions, destination-approval
  decision, status-history, elevation gate on anonymize/merge. New private helpers: `recordStatusEvent`,
  `revokeAllSessions`, `notifyProfileTechnicians`, `requireElevation`.
- `super-admin-staff/global-tech-admin.controller.ts` — routes for all of the above, each behind its own
  `@RequirePermission('super_admin.technicians.*')`; a second `TechMembershipAdminController` for
  `PATCH /super-admin/technician-memberships/:id` (pause / reactivate / approve_destination / reject_destination);
  `elevation_required` → 403.
- `super-admin-staff/cross-tenant-transfer.executor.ts` — source-salon operational blocks (open service, cash handoff)
  and optional `requireDestinationApproval` routing.
- `auth/rbac.ts` — fifteen `super_admin.technicians.*` permission keys (auto-granted to Super Admin, minted at login).
- `deals/` (service, repository, kysely) — `techDealsFrozen(tenantId, technicianId)` (tenant-scoped) blocking frozen
  technicians from creating deals and from redeeming pre-existing ones at checkout.
- `common/tenant-isolation.vitest.spec.ts` — ten justified `STMT_ALLOW` entries for the deals marketplace's by-design
  cross-tenant queries.

## 4. Frontend changes (apps/admin-web)

- `screens/GlobalTechniciansScreen.tsx` — the detail page surfaces pause/reactivate, lock/unlock, membership pause,
  destination approve/reject, scoped-pause toggles, the support panel (sessions + tickets + revoke), and status history.
- `api/superAdminTechniciansApi.ts` — client methods + types for the new endpoints.
- `shell/AdminLayout.tsx` — the Workforce Oversight entry relabeled "Technician Account Management".

## 5. New permission keys (mint into Super Admin sessions)

`super_admin.technicians.` + `view · manage · pause · reactivate · suspend · restore · transfer · memberships_manage ·
profile_moderate · support_mode · merge · delete_request · anonymize · hard_delete · security_manage`. Already in the
RBAC catalog; a session can be issued with any subset to restrict a given admin.

## 6. Verification status (sandbox, at head)

Integrity gates: typecheck, di, cross-wiring, permissions, unguarded-routes, SQL, nav, dead-client — all pass. Suites:
auth **354**, common **187**, super-admin-staff **102**, deals **87**, tech-profile **79**, plus admin-web typecheck +
build + shell. Migrations 395–397 load.

## 7. Pull-in checklist (your live tree)

1. Apply migrations 395–397.
2. Merge the backend and frontend files above.
3. Confirm the fifteen permission keys mint into your Super Admin sessions (they ride `rbac.ts`).
4. Run the integrity gates and the auth / common / super-admin-staff / deals / tech-profile suites against your tree —
   that's the real final gate; the sandbox verification is not your repo.
5. Decide the operational policy for the elevation gate: anonymize and merge now require an active `security_admin`
   grant, so ensure the grant request→approve flow is available to your admins before they need it.

## 8. Honestly, what's left

Nothing outstanding in the spec or its extensions. The only open item is operational, not code: the elevation gate
changes how anonymize/merge behave (they now need an approved grant) — a policy decision to confirm on your side.
