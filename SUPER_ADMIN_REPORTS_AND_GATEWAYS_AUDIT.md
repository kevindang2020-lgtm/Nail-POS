# Super Admin → Hardware Payment Reports + Payment Gateways — audit & hardening

Two previously-untested read screens, audited for wiring + given coverage. One small defensive fix on Gateways.

## Hardware Payment Reports (`/hardware-payment-reports`) — verified clean
- `hwReports()` ↔ `@Get('hardware-payment/reports')` → `reportMonthlyTotals()`. The repo's `MonthlyReportRow` interface and
  aggregation produce exactly the fields the screen reads — `billingMonth`, `invoiceCount`, `cardVolumeCents`,
  `hardwareCreditCents`, **`dueCents`** (from `hardwareMonthlyDueCents`), `shortfallCents`, `chargedCents`, `paidCount`,
  `failedCount` — and the service adds **`collectionRatePct`**. No field-name mismatch, no `$0.00`/`undefined%` leak.
- The screen's overall collection rate is guarded against divide-by-zero (`shortfall > 0 ? … : 100`).
- **Tests added (4):** per-month rows render; the roll-up KPIs aggregate correctly across months (card volume, invoices,
  hardware credit, shortfall, collected, paid/failed); the overall rate computes from totals (100000/110000 → 91%); CSV
  export enables when rows exist. This locks the client-side aggregation math.

## Payment Gateways (`/payment-gateways`) — verified + one defensive fix
- `paymentGateways()` ↔ `@Get('payment-gateways')`. The repo left-joins `tenant_payment_config` and maps to camelCase with
  **masked MID only** (`••••` + last 4; secrets never leave the backend), and defaults `gatewayStatus` to `'not_configured'`
  when a tenant has no config — so the field is always a string in production.
- **Defensive fix:** the row template called `g.gatewayStatus.replace(...)` directly. The backend guarantees the field today,
  but a direct `.replace()` on a server value is a latent crash vector (any partial response / future call path missing it
  would throw and blank the whole list). Guarded to `(g.gatewayStatus || 'not_configured').replace(...)` — zero behavior
  change in production, but the list can no longer be taken down by a single missing field.
- **Tests added (4):** KPI roll-ups (active / needs-setup / errors / paired-terminal totals); masked-MID rendering; status-tab
  filtering; and a row with a missing status renders safely (shows "not configured" instead of throwing).

## Verification
admin-web `tsc` clean, **134 tests pass** (26 files), `vite build` clean. No backend change; backend remains 603 / PASS.

## Series status
Untested Super Admin screens are now down to **one**: `SystemHealthScreen`. Everything else in the directory has a screen
test. Bugs found & fixed across the series: Applications (pagination cap), Users & Roles (pagination cap + label),
Usage Limits (null→0 coercion, backend), Billing (status dropdown mis-render), Payment Gateways (defensive null guard);
Hardware Payments + Hardware Payment Reports verified clean and locked with tests.
