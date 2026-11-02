# App Sidebar & Frontend→Controller Wiring — Full Summary

Methodology (per app): sidebar → route (dead-link check), then every frontend API call reconciled against the API's
**actual registered route table** (2,135 routes enumerated from the running Express router — the authoritative source,
not static regex).

## Results

| App | Frontend calls reconciled | Wired to a real controller | Orphans |
|---|---|---|---|
| **admin-web** (Super Admin) | 486 | **486** | **0** ✓ |
| **pos-web** (Tenant POS) | 337 | 332 | **5** — one module (`ai-ocr-receipt`) |
| **owner-web** | 50 | **50** | **0** ✓ |
| **tech-web** | 46 | **46** | **0** ✓ |
| **customer-web** | 68 | **68** | **0** ✓ |
| **manager-pay-web** | 9 | **9** | **0** ✓ |
| **customer-display** | (template-literal `fetch`, not per-call reconciled) | backend `@Controller('customer-display')` registered (10 routes) | — |
| **go-check-in-admin** | (different client pattern, not per-call reconciled) | backend `@Controller('go-check-in')` registered (9 routes) | — |
| **go-check-in-kiosk** | no direct REST detected (realtime/shared client) | — | — |

**Per-call reconciled: 996 frontend calls across the 6 main apps → 991 wired, 5 orphans (all one module).**

## The single real gap: `ai-ocr-receipt` (pos-web "AI Receipt Recognition")

Fully detailed in `POS_WEB_WIRING_AUDIT.md`. Summary: the controller + service + domain logic exist and are
unit-tested, but the module is **never registered** (no `.module.ts`, not in `app.module.ts`) and has **no production
port adapters** (file storage, malware scan, doc/settings stores) — so its 5 endpoints 404. Not force-wired because
stubbing a receipt-scanner in-memory would lose financial documents and skip malware scanning. Needs either a real
integration (build adapters + module + grant `ai_ocr_receipt.*`) or hiding the frontend entry. **Product decision.**

## Honest scope boundaries

- customer-display / go-check-in-admin: backend controllers confirmed **registered**, but I did not do the exact
  per-call frontend reconciliation (their frontends call via template-literal `fetch`/shared client, which the
  extraction regex didn't cleanly capture). Backend wiring present; frontend-contract not exhaustively matched.
- go-check-in-kiosk: no direct REST calls detected (appears realtime/shared-client driven).
- This audit verifies **frontend call → registered controller route**. It does not re-verify each controller's
  service→repository→DB internals per route (those are covered by the test suites + the live Super Admin probe).
