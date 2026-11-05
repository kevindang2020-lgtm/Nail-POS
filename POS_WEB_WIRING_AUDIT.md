# pos-web (Tenant POS) — Sidebar & Wiring Audit

Same methodology used for admin-web: sidebar → route (dead links), and every frontend API call reconciled against the
app's **real registered route table** (2,135 routes enumerated from the running Express router).

## Sidebar → route

- **187 nav items** across 12 sections (TODAY, CUSTOMERS, TEAM, SERVICES & PRODUCTS, PAYMENTS & MONEY, COMMUNICATIONS,
  MARKETING & GROWTH, AI CENTER, REPORTS, MANAGEMENT, DEVICES & INTEGRATIONS, ACCOUNT).
- Sidebar↔route wiring is **already locked by a test** (`tenant-nav.wiring.test.ts`, 7/7 passing): it fails if any nav
  item points at an unregistered route or a dedicated screen becomes unreachable. **No dead links.**

## Frontend → controller (verified against real routes)

- **337 distinct frontend API calls** (pos 234, tenant 77, auth 9, customer 6, owner 4, tech 2, ai 2, me 2, public 1).
- **332 wired** to a registered controller route.
- **5 orphans — one module: `/pos/ai-ocr-receipt/*`** (`GET/POST documents`, `GET/PUT settings`, `POST upload`).

## The one real gap: `ai-ocr-receipt` ("AI Receipt Recognition")

- Frontend is reachable: nav item `pay-ai-receipts` → `/tenant/ai/ocr-receipt`, screen `POSAIOcrReceiptScreen.tsx`,
  calling 5 `/pos/ai-ocr-receipt/*` endpoints.
- Backend controller **exists** (`ai-ocr-receipt.controller.ts`, `@Controller('pos/ai-ocr-receipt')`, 13 routes) and the
  domain logic + service are **complete and unit-tested** (6 passing spec files).
- **But it is not production-integrated:**
  - **No `ai-ocr-receipt.module.ts`** anywhere, and it is **not imported in `app.module.ts`** → the controller's routes
    never register → all 5 endpoints **404 at runtime**. (`DI_GRAPH_OK` can't catch this — an unimported module is
    invisible to the graph.)
  - The service needs **6 ports** bound — `DocStorePort`, `SettingsStorePort`, `FileStorePort`, `MalwareScanPort`,
    `PostingService`, `AuditSink` — and **no production adapters exist** for them (only mock/in-memory impls inside the
    unit tests). Receipt scanning uploads files and posts to accounting, so it needs real file storage + malware
    scanning + DB-backed stores.
  - The `pos.ai_ocr_receipt.*` capabilities are **not granted** in rbac (only referenced in a comment) — so even once
    registered, it would 403 until granted (same class as the fixed `ai_checkout_upsell` gap).

### Why it was left unfixed (deliberately)

Force-wiring with in-memory stubs would make the feature *appear* to work while **losing uploaded financial documents
on restart and skipping malware scanning** — actively harmful. Completing it properly is an integration project (build
file-storage + malware-scan + DB-store adapters, write the module, bind ports, grant caps, add migrations if missing),
not a wiring one-liner.

### Resolution applied — option (a): frontend entry hidden

Decision (picked based on the codebase: a POS with card processors and **no file-storage/malware-scan infrastructure**,
whose principle is real-wired-code + honest states, and which already gates unreleased AI features by `aiPackageCode`):
**hide the entry rather than stub the backend** (stubbing would drop scanned financial documents — the opposite of the
money-integrity discipline).

Done: removed the ungated `pay-ai-receipts` nav item, its dedicated `/tenant/ai/ocr-receipt` route, and its
`EXISTING_ROUTES` entry, so the broken screen is **no longer reachable** by users. The gated `ai-receipt` upsell entry
remains for discovery, and the screen + all backend code are **retained** for when integration happens. Verified:
`tenant-nav.wiring.test` 7/7, pos-web `tsc` clean, pos-web production build clean.

**Still open (backend integration, for when you choose to build it):** create `AiOcrReceiptModule`, build production
adapters for the 6 ports (file storage, malware scan, doc/settings stores), register in `app.module.ts`, grant
`ai_ocr_receipt.*`, then re-add the nav item + route (gated by `aiPackageCode`). At that point the frontend API client
(retained) lights up.

### Recommended options (product decision) — original

1. **Complete the integration** — build the production port adapters (file storage, malware scan, Kysely doc/settings
   stores), create `AiOcrReceiptModule`, register it, grant `ai_ocr_receipt.*`, verify end-to-end. Substantial.
2. **Hide the frontend entry** until (1) is done — gate/remove the `pay-ai-receipts` nav item + route so users don't
   reach a 404'ing screen. Small, safe, non-destructive to backend.

## Scope note

This audit covers pos-web. The other tenant apps (owner-web, tech-web, customer-web, manager-pay-web,
go-check-in-admin/kiosk, customer-display) have not yet had this same frontend↔controller reconciliation.
