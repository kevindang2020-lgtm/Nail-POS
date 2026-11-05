# AIPowerSalon — Full Wiring Audit & Fixes (2026-07-12)

Deep scan of the whole monorepo for registration/wiring gaps: NestJS modules → controllers → routers,
and every frontend screen → route → backend endpoint. **4 real defects found and fixed. 1 regression guard added.**

---

## What the scan actually covered

| Surface | Result |
|---|---|
| API modules reachable from `AppModule` | **192 / 192** — zero unreachable |
| Controllers declared in a module | **272 / 272** — zero orphans |
| `@Injectable` services in a `providers[]` | **97 / 97** — zero orphans |
| HTTP routes registered | **2,186** — **0 collisions** (was 1) |
| Frontend API calls resolving to a real route | **1,538 / 1,538** (was 1,537) |
| pos-web sidebar ↔ route invariant | **7 / 7** |

**Your backend DI graph was already perfect.** Every module is registered, every controller is wired to a
module, every service is provided. Nothing was missing from `app.module.ts`. The defects were all in the
*seams* — where a route was claimed twice, or a built screen was never attached to a router.

---

## Defect 1 — `GET /owner/context` was registered twice; one shadowed the other (HIGH)

`OwnerController.context()` and `OwnerPortfolioController.context()` both declared `@Get('context')` under
`@Controller('owner')`. Nest registers controllers in module-import order, and `OwnerPortfolioModule`
(app.module line 230) is imported before `OwnerModule` (line 241) — so **the portfolio handler won the path
and `OwnerController.context()` never executed.**

Two different frontends call that one path expecting different payloads:

- `OwnerSalonContext.tsx` wants `{ activeSalonId }` → portfolio shape ✅ (this one worked)
- `OwnerBranchContext.tsx` wants `{ allowedBranches, canViewAllAssignedBranches, defaultBranchId }` → owner shape ❌

So `OwnerBranchProvider` was doing `ctx.allowedBranches.map(...)` on **undefined**. The owner's branch
selector / "All My Salons" list was broken in production, and the `owner_context_loaded` audit row was
never written.

**Fix.** The two endpoints answer genuinely different questions under *different auth* — portfolio is
guarded by `OwnerPortfolioGuard`, the branch context requires `owner.dashboard.view` — so merging them
into one payload would leak branch data through the laxer guard. They get distinct paths instead:

- `apps/api/src/owner/owner.controller.ts` — `@Get('context')` → **`@Get('branch-context')`**
- `apps/owner-web/src/api/ownerApi.ts` — `ownerContextApi.context()` → **`/owner/branch-context`**

`/owner/context` stays with owner-portfolio (which already owned it at runtime, and documents it in its
header), so the salon switcher is untouched.

---

## Defect 2 — the POS sidebar called a route that does not exist (MEDIUM)

`POSLayout.tsx` fetched the salon name from **`GET /settings`**. There is no such route — the API has no
top-level `/settings` namespace at all. The 404 was swallowed by an empty `.catch(() => {})`, so the
sidebar header silently fell back to the hardcoded placeholder **"Your Salon" for every tenant, forever.**

The obvious source, `GET /pos/settings/business-branch`, is the wrong fix: it requires `settings.view`, and
the sidebar renders for **every** POS role — a technician would 403 and still see the placeholder.

**Fix.** `salonName` now rides on `GET /tenant/navigation` — the sidebar's own endpoint, which has no
permission guard and which `POSLayout` **already calls**:

- `apps/api/src/tenant-navigation/tenant-navigation.service.ts` — reads `settings_json->>'salonName'` from
  `tenant_settings` (branch row first, tenant-wide row as fallback), fail-soft to `null`
- `apps/pos-web/src/shell/tenant-access.ts` — `salonName: string | null` added to `NavAccess`
- `apps/pos-web/src/shell/POSLayout.tsx` — dead `/settings` call and its now-unused `api` import removed

Fail-soft to `null` (not an invented name) keeps the honest-verification invariant.

---

## Defect 3 — AI Receipt & Document module: backend shipped, frontend never re-attached (MEDIUM)

`POS_WEB_WIRING_AUDIT.md` says the OCR route was deliberately removed because *"no `ai-ocr-receipt.module.ts`
exists… not imported in `app.module.ts` → all 5 endpoints 404 at runtime."* **That document is now stale.**

Current reality:

- `AiOcrReceiptModule` **exists** (created Jul 11) and **is registered** — `app.module.ts:226`
- Ports are DB-backed: `KyselyDocStore`, `KyselySettingsStore`, `KyselyOcrAuditSink`, `DbFileStore`,
  `KyselyPostingIdempotency`; posting writes through the real `InventoryService`
- Migrations **344** + **359** present
- RBAC resolved — `pos.ai_ocr_receipt.*` aliases to `inventory` capabilities in `security-core.ts`, and
  `permission-reachability.vitest.spec.ts` pins `pos.ai_ocr_receipt.view` as reachable for MANAGER
- 13 routes live under `@Controller('pos/ai-ocr-receipt')`; the typed client `posAiOcrReceiptApi.ts` was retained

The only thing still missing was the **route and the nav item** — removed when the module didn't exist, never
restored after it was built. A complete, tested, DB-backed feature was invisible to every tenant.

**Fix.**

- `apps/pos-web/src/App.tsx` — `<Route path="tenant/ai/ocr-receipt" element={<POSAIOcrReceiptScreen />} />`
- `apps/pos-web/src/shell/tenant-nav.tsx` — nav item `ai-ocr-receipt` ("Receipt & Document AI") in **AI CENTER**,
  gated by `aiPackageCode: 'ai_ocr_receipt_scanner'` — the same shape the integrated peers use
  (`ai-reputation`, `ai-scheduling-optimizer`); `/tenant/ai/ocr-receipt` added to `EXISTING_ROUTES`
- `POSAIOcrReceiptScreen.tsx` — `signedPreview` returns a `notconnected:<key>` marker (blob store is not wired).
  The screen was feeding that straight into `<img src>`, which paints a **broken-image icon** — reads as
  "this document is corrupt". Now a marker is treated as *no preview* and labelled honestly.

**Still genuinely NotConnected** (unchanged, and now correctly surfaced rather than faked):
- **Blob storage** — `DbFileStore` records file *metadata* only; there is no object store, so the scanned
  image cannot be displayed back.
- **Malware scan** — `NotConnectedMalwareScan` returns `unscanned`, which quarantines when the tenant
  requires scanning.

Everything else in the workspace is live: list, filter, review, correct-field, approve/reject/return, post
into real expenses/inventory, settings.

---

## Defect 4 — customer password & session management was built but unreachable (MEDIUM)

`ProfileSecurityScreen.tsx` (customer-web) was routed nowhere. All six of its endpoints are live on
`CustomerSecurityController`:

```
GET  /customer/me/security/status            POST /customer/me/security/password/create
GET  /customer/me/security/sessions          POST /customer/me/security/password/change
POST /customer/me/security/sessions/:id/revoke
POST /customer/me/security/sessions/revoke-others
```

A customer who activated with an SMS one-time code **has no password**. This screen is the only way to add
one, to see active sessions, to sign out another device, and to enrol Face ID — and there was no path to it.

**Fix.**
- `apps/customer-web/src/App.tsx` — `<Route path="/profile/security" element={<ProfileSecurityScreen />} />`
- `apps/customer-web/src/screens/ProfileScreen.tsx` — "🔒 Password & Security" row added to the profile menu

---

## Regression guard added

`apps/api/src/common/route-collision.vitest.spec.ts` — **3 tests**, fails if any two controllers ever claim
the same `METHOD + path` again.

**Proven:** reverting Defect 1 makes it fail with the exact collision; restoring the fix makes it pass.

Why nothing caught this before: a duplicate route is not a type error and not a DI error. `DI_GRAPH_OK`
passes (both modules load), `tsc` passes (both are valid), and **every frontend test mocked the API client**,
so the URL was never exercised. It is a silent *behavioural* failure — it needed a test at exactly this layer.

---

## Two things that look wrong in a scan but are NOT

1. **21 "duplicate route prefixes"** (e.g. 10 controllers share `customer`). Normal in Nest — only exact
   `METHOD + full path` duplicates shadow. There is now **1 → 0**.
2. **`owner-web` / `tech-web` / `manager-pay-web` declare zero `<Route>`.** They use state-based
   tab/push routers (`useOwnerNav`, `useTechNav`) — mobile-app style, intentional. Every screen in all three
   is wired.

Also left alone: `SuperAdminPlaceholder` (reusable + unit-tested, just no longer needed) and
`pos-web/screens/ComingSoon.tsx` — unused scaffolding, not defects.

---

## Verification — and what I could NOT run

**Done:**
- Route/DI/cross-wire audits re-run on the patched tree: 0 collisions, 0 orphans, 1538/1538 calls resolve
- pos-web sidebar↔route invariant replicated exactly: **7/7 pass** + 4 OCR-specific checks
- New route-collision spec: **3/3 pass**, and proven to fail on the pre-fix code
- All 10 changed files parsed with TypeScript 5.6: **0 syntax errors**
- Regression surfaces checked: `useEffect` still used in POSLayout; `NavAccess` is only ever consumed via
  the hook (never constructed as a literal, so the new field breaks no caller); no test mocks `/settings` or
  `useTenantNavAccess`; API specs touch only `/owner/context/switch` and `/owner/context/select` — neither
  path changed; `SalonSwitcher.test.tsx` mocks the raw `/owner/context` URL and still gets the portfolio
  shape it expects.

**Not done — please run locally:** `npm install` would not complete in this sandbox (hangs at 17 MB with 0
binaries; the registry is reachable and a single package installs in seconds, so it is something in the
10-app tree, likely a postinstall). So **full `tsc --noEmit` and the real vitest suites did not run here.**

```
npm install
npm run typecheck
npm test -w apps/api        # includes the new route-collision spec
npm test -w apps/pos-web    # includes tenant-nav.wiring.test (7/7)
npm test -w apps/owner-web
```

---

## Files changed (11)

```
apps/api/src/owner/owner.controller.ts                        @Get('context') → @Get('branch-context')
apps/api/src/tenant-navigation/tenant-navigation.service.ts   + salonName on GET /tenant/navigation
apps/api/src/common/route-collision.vitest.spec.ts            NEW — collision guard (3 tests)
apps/owner-web/src/api/ownerApi.ts                            → /owner/branch-context
apps/pos-web/src/shell/tenant-access.ts                       + salonName on NavAccess
apps/pos-web/src/shell/POSLayout.tsx                          − dead GET /settings, + real salon name
apps/pos-web/src/shell/tenant-nav.tsx                         + ai-ocr-receipt nav item + EXISTING_ROUTES
apps/pos-web/src/App.tsx                                      + /tenant/ai/ocr-receipt route
apps/pos-web/src/screens/POSAIOcrReceiptScreen.tsx            honest no-preview (no broken-image icon)
apps/customer-web/src/App.tsx                                 + /profile/security route
apps/customer-web/src/screens/ProfileScreen.tsx               + Password & Security menu row
```

## Suggested next, in order

1. **Object storage for OCR blobs** — the last thing keeping Receipt AI from complete. `DbFileStore.store()`
   already computes `tenants/{tenantId}/ocr/{documentId}/original.{ext}`; it needs a real bucket +
   `signedPreview()` returning a genuine signed URL. Malware scan slots in at the same seam.
2. **Fix the stale docs** — `POS_WEB_WIRING_AUDIT.md` still says `ai-ocr-receipt.module.ts` does not exist,
   which is what caused this whole gap to persist. It should be corrected or deleted.
3. Resolve the open `pos.aipowersalon.com` vs `app.aipowersalon.com` host ambiguity before hard-coding it
   into the marketing site.
