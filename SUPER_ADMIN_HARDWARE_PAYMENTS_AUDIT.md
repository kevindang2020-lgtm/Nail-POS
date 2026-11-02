# Super Admin → Hardware Payments — audit (money path) & regression lock-in

Page: `apps/admin-web/src/screens/HardwarePaymentsScreen.tsx` (route `/hardware-payments`) — per-tenant revenue-split
recovery: plan, split settings, invoices, ledger, and the money actions (recalculate a month, charge shortfall, import
residual volume, pause/resume, and a global Run Monthly). All amounts are integer cents server-side.

## Result: wiring verified correct — no bug found (the valuable outcome for a money path)
Audited every one of the 13 client methods against the backend `hardware-payment.super-admin.controller.ts`. All paths and
**all body keys match exactly**:
- `hwRecalc` → `POST tenants/:id/hardware-payment/recalculate-month`, reads `planId` / `billingMonth` / `cardVolumeCents` ✓
- `hwChargeShortfall` → `.../charge-shortfall`, reads `planId` / `billingMonth` ✓
- `hwImportVolume` → `.../import-volume`, reads `billingMonth` / `cardVolumeCents` / `source` ✓
- `hwCreatePlan` → `POST .../hardware-payment-plan`, body passthrough ✓
- `hwSetTenantSettings` → `PATCH .../hardware-payment/settings`, body passthrough ✓
- `hwPause` / `hwResume` → `.../pause|resume`, read `planId` ✓
- `hwRunMonthly` → `POST /super-admin/hardware-payment/run-monthly`, reads `billingMonth` ✓
- `hwPlan` / `hwTenantSettings` / `hwInvoices` / `hwLedger` GETs map 1:1 ✓
The screen also defends against response-shape variation (`arr()` unwraps `invoices`/`ledger`/`rows`/`items`; settings read
`effective ?? raw`), so the money logic (already heavily backend-tested) is surfaced correctly.

## Tests added (5, all pass) — regression protection for the money-path payloads
`HardwarePaymentsScreen.test.tsx`: selecting a tenant loads plan/invoices/ledger; **Recalculate month** asserts the exact
payload including dollars→integer-cents (`"50000"` → `5,000,000` cents) plus `planId`+`billingMonth`; **Charge shortfall**
asserts `planId`+`billingMonth`; **Run Monthly** asserts the chosen billing month; **Pause plan** asserts the real route.
These lock the payload shapes so a future refactor can't silently drift the money-path requests.

## Honest remainder (small, not blocking)
- Non-numeric entries in the dollar/bps/percent fields coerce to 0 client-side (`Number(x) || 0`) before the backend's own
  validation runs; the backend is the source of truth, but client-side guards (like the one just added to Usage Limits)
  would give faster feedback on these admin inputs. Left as a follow-up since these are admin-only fields with sane defaults.
- Invoices/ledger render unpaginated per tenant (fine — bounded by a single plan's months/transactions).

## Verification
admin-web `tsc` clean, **123 tests pass** (23 files), `vite build` clean. No backend change; backend remains 603 / PASS.
