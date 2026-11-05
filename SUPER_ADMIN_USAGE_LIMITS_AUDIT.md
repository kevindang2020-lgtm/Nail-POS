# Super Admin → Usage Limits — audit & fix (audit-first hardening)

Page: `apps/admin-web/src/screens/UsageLimitsScreen.tsx` (route `/usage-limits`). Previously had no test; now covered
on both ends. This is the first **backend** correctness fix in the audit series (the prior two were client-side).

## Wiring verified (correct — no rebuilds, no duplication)
- Client `usageLimits()` ↔ `@Get('usage-limits')`; `setUsageLimit(tenantId, metric, limitValue)` posts `{ metric, limitValue }`
  ↔ `@Post('usage-limits/:tenantId')` which reads exactly those keys.
- `repo.usageLimits()` joins `tenants` × `tenant_usage_limits` and maps to the camelCase the screen reads
  (`tenantName`, `tenantCode`, `metrics[].metric/usedValue/limitValue`) — no blank-cell bug.
- The page lists all tenants (no pagination endpoint) and renders them all, so it is **not** affected by the list-pagination
  cap fixed on Applications/Users.

## Bug found & fixed — non-numeric limit silently set the value to 0 (data integrity)
The input accepts free text; a non-numeric entry (e.g. "abc") becomes `Number(...) === NaN` on the client, and **`NaN`
serializes to JSON `null`**. Server-side, the old guard did `const v = Math.round(Number(limitValue))` — and
`Number(null) === 0`, which passed the `>= 0` check, so the tenant's limit was **silently set to 0** instead of being
rejected. (Verified: `Number(null) === 0`; `JSON.stringify({limitValue: NaN}) === '{"limitValue":null}'`.)

Fix (defense in depth):
- **Backend** (`super-admin-platform.service.ts setUsageLimit`): reject `null` / `undefined` / `''` *before* the `Number()`
  coercion can mask them as 0, then keep the existing finite/range checks. Error message unified to
  "limitValue must be a number from 0 to 100,000,000."
- **Frontend** (`UsageLimitsScreen.save`): validate the entry is a whole number ≥ 0 before calling the API; otherwise show
  inline guidance ("Enter a whole number of 0 or more for the limit.") and send nothing — instant feedback, no bad request.

## Tests added (8, all pass)
- `usage-limits.vitest.spec.ts` (backend, 4): rejects null/undefined/'' (the JSON-null case), NaN/negative/over-max,
  unknown metric + missing tenant; accepts a valid value and rounds (250.6 → 251; 0 allowed).
- `UsageLimitsScreen.test.tsx` (frontend, 4): renders used/limit; blocks non-numeric and negative input client-side with no
  API call; posts a valid whole-number limit via the real route.

## Honest remainder
- The page loads all tenants unbounded (fine at current scale); if the tenant count grows very large, a server-side
  page/limit on `usage-limits` would be a follow-up.

## Verification
Backend `tsc` clean, **603 tests pass**, RESULT: PASS. admin-web `tsc` clean, **118 tests pass**, `vite build` clean.
