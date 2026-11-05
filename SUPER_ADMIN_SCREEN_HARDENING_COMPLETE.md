# admin-web screen hardening — complete

Audit-first hardening pass over the entire Super Admin (`admin-web`) screen layer: read each screen against its API client
and backend, fix real bugs found, and add regression tests. Every screen now has coverage.

## Coverage milestone
All `admin-web/src/screens/*.tsx` are now covered — each active screen has a dedicated `*.test.tsx`, and the two
dead/unrouted legacy screens (`LeadsScreen`, `HardwareScreen`) are exercised by existing specs
(`ApplicationsLeads.test.tsx`, `HardwareScreen.test.tsx`). admin-web went from ~96 to **151 passing tests** (30 files);
`tsc` clean; `vite build` clean. Backend unchanged throughout except one validation fix; backend at **603 / PASS**.

## Final screen audited this pass — Project Status (verified clean)
`ProjectStatusScreen` reads `GET /super-admin/project-status/pos-settings` (`{ parent, sections }`) and rechecks a module
via `PATCH .../pos-settings/:moduleKey/recheck`. Verified the client targets the **super-admin** project-status controller
(distinct from the POS-facing `pos/project-status` one), and `getPosSettings()` always returns a non-null `parent`, so the
screen's `s.parent.*` access is safe. Added 4 tests (KPI roll-up math, module readiness details, recheck via the real
route, load-error path). No bug.

## Real bugs found & fixed across the whole series (6)
1. **Applications** — list capped at 25 (controller default) with no pager; ~3 of 28 applications were unreachable. Now
   requests the repo max (100) + honest "first N of total" hint.
2. **Users & Roles** — same cap at 50 (worse: customers across tenants); fixed + corrected a misleading "{total} shown".
3. **Usage Limits** — *backend* `setUsageLimit` let a non-numeric input (NaN → JSON `null` → `Number(null)===0`) slip past
   the `>= 0` check and silently set a tenant's limit to 0. Now rejected server-side + guarded client-side.
4. **Billing** — a no-subscription tenant (`status: 'none'`) mis-rendered in the status `<select>` (showed "active"). Fixed
   with a disabled `— none —` option.
5. **Payment Gateways** — direct `.replace()` on a server status field was a latent list-killer; guarded.
6. **Login** — empty MFA code could be submitted, and a wrong code showed the first-prompt message; both fixed (the screen
   now distinguishes a re-prompt and says "That code wasn't valid").

## Screens verified clean (correct wiring, regression-locked with tests)
Hardware Payments (money path — exact payloads incl. dollars→cents), Hardware Payment Reports (roll-up aggregation),
System Health (degraded path), Audit Logs (bug #13 stale-filter regression lock), Project Status.

## Verification
admin-web `tsc` clean, **151 tests pass** (30 files), `vite build` clean. Backend `tsc` clean, **603 tests**, RESULT: PASS.
