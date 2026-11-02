# Deep Scan — What Code Isn't Wired (frontend & backend)

A bidirectional audit: backend controllers/modules, frontend→backend calls, frontend screen reachability, dead
provider classes, and (with caveats) backend routes with no caller. Checked against the **running app's real route
table** (2,135 routes) where possible, not just static text.

## Summary — the only genuinely unwired code

| Item | Status |
|---|---|
| `ai-ocr-receipt` controller | Built, **unregistered** (no module) — *intentionally* parked this session; needs file-storage + malware-scan infra to complete. |
| `WebAuthnService` (passkeys) | Built + unit-tested, **no controller** — foundation wired this session; needs a device-tested finish (see `WEBAUTHN_BUILD_PLAN.md`). |
| `POSAIOcrReceiptScreen` (frontend) | The screen for the parked OCR feature — **unrouted** this session; file retained for when the backend is built. |
| ~5 internal adapters | **Not dead — investigated and cleared.** The 4 `InMemory*` adapters are the in-memory test doubles used by 13 AI-queue-assignment spec files (production uses the real Kysely adapters). `UnconfiguredMembershipChargeAdapter` is the default fail-closed charger (`membership-billing.service.ts:46`). Nothing to remove. |

**Everything else is wired.** Details below.

## 1. Backend controllers — 211/212 mount their routes

- **212** distinct `@Controller` prefixes in source (incl. controllers inside `.service.ts`/`.module.ts` files).
- **211 mount live**; the only unregistered one is `pos/ai-ocr-receipt` (above).

## 2. Backend modules — 180/180 loaded

- All 180 module classes are imported into the graph (app.module.ts). **0 orphan modules** — no whole feature sits
  unloaded.

## 3. Frontend → backend — every call resolves

- **996 distinct frontend API calls** reconciled against real routes across admin-web (486), pos-web (332), owner-web
  (50), tech-web (46), customer-web (68), manager-pay-web (9). **0 orphans** (after `ai-ocr-receipt` was handled).
- No screen calls a missing controller.

## 4. Frontend screens — 350/351 reachable

Screen files checked for any import/route reference:

| App | Screen files | Unreachable |
|---|---|---|
| admin-web | 96 | 0 |
| pos-web | 150 | **1** (`POSAIOcrReceiptScreen`, the parked OCR screen) |
| owner-web | 31 | 0 |
| tech-web | 19 | 0 |
| customer-web | 48 | 0 |
| manager-pay-web | 7 | 0 |

Only the intentionally-parked OCR screen is unreachable. Every other screen is routed.

## 5. Dead provider classes — 7 of 640

Referenced only in their own file: `AiReadinessService` (**false positive** — wired via a co-located controller,
`/super-admin/ai/readiness` returns 200 live), four `InMemory*` adapters + `UnconfiguredMembershipChargeAdapter`
(internal DI implementations — not controller candidates; possibly unused), and `WebAuthnService` (above). See
`BACKEND_CONTROLLER_COVERAGE.md`.

## 6. Backend routes with no frontend caller — NOT reliably determinable via static analysis

A raw scan flags ~388 routes as "no web caller," but this number is **not trustworthy** and should not be treated as
"unused code," because:

- The web apps build request paths dynamically — from `const BASE = …` constants, string concatenation, and
  `buildUrl()` helpers — which static text analysis cannot resolve. (Proven: `pos/checkout` shows as "no caller" yet
  pos-web clearly calls it.)
- **Native mobile apps** (React Native tech + customer apps, not in this web repo) call many endpoints
  (`mobile-checkout`, `technician`, `push`, much of `pos/*` and `customer/*`).
- **Webhooks and internal endpoints are caller-less by design**: `public/website/*`, `internal/ai-billing`,
  `internal/membership-billing`, and payment/bank/messaging callbacks are invoked by external services, not a frontend.
- `customer-display` / `go-check-in` frontends use template-literal `fetch` the extractor can't resolve.

The **reliable** signal for "do backend endpoints actually work and serve the frontend" is the runtime test, not static
matching — see `LIVE_FRONTEND_MODULE_TEST.md`: 515+ live module calls, real data, **0 server errors**. If you want a
true "dead route" list, it needs either runtime call-tracing in staging or resolving the web path-builders + including
the native apps — not a text scan.

## Bottom line

Nothing in your codebase is orphaned except the two features you already know about (`ai-ocr-receipt`, `WebAuthn`) and
their one parked frontend screen. The "possibly unused internal adapters" were investigated and **cleared** — all are
used (test doubles + a default charger). Backend controllers, modules, frontend calls, and frontend screens are
otherwise fully wired, and there is **no dead code to remove**.
