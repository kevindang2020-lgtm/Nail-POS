# Today's Volume (Intraday Rollup) — Build Report (closes REMAINING_BLOCKERS #1)

The detail panel showed only **Month-to-Date** (settled) and **Last Transaction** — there was no intraday figure. The
panel now shows **Processed Today**: a real per-day rollup of today's volume + transaction count.

## Why "approved payments", not "settled"
Settlements batch and lag (a payment captured today typically settles next business day), so a "settled today" figure
reads ~0 intraday and would be misleading. The honest live signal for "what did this salon process today" is **approved
payments since the start of the (server-local) day** — the same basis the platform reports already use for volume. It is a
deliberately different basis from the settled MTD number, and the UI labels both so they aren't conflated.

## What was added
- **`super-admin-platform.repository.ts`** — a per-tenant subquery in the command-center `/state` builder:
  `sum(amount_cents)` + `count(*)` from `payments` where `status = 'approved'` and `created_at >= date_trunc('day', now())`,
  grouped by tenant, mapped onto each row as `todayVolumeCents` / `todayTxnCount`. (Graceful `catch → []`, like the other
  rollups, so a missing/empty table never breaks the page.)
- **`super-admin-platform/payment-gateways-core.ts`** — `todayVolumeCents` / `todayTxnCount` on `RawGatewayRow` and
  `GatewayView`; `toGatewayView` passes them through, clamped to `>= 0`.
- **Frontend `PaymentGatewaysScreen.tsx`** — the detail **Settlement Summary** gained a **Processed Today** line
  (`$<today>` · `<n> txn`), and the existing line was relabelled **Month to Date (settled)** so the two bases are explicit.
- **Frontend `superAdminApi.ts`** — `PgGateway` carries `todayVolumeCents` + `todayTxnCount`.

## Tests / verification
- `payment-gateways-core.spec.ts` — **81 assertions** (view carries today's volume + count; negatives clamp to 0).
- `PaymentGatewaysScreen.test.tsx` — **13 tests** (detail shows "Processed Today" with the dollar figure + "7 txn").
- Full backend suite **608 + harness, RESULT: PASS**; full admin-web **30 files / 161 tests**; `tsc` clean (api +
  admin-web); production `vite build` succeeds.

## Honest notes
- **Day boundary is server-local** (`date_trunc('day', now())`), not the salon's local timezone. For a single South-Jersey
  market this is effectively correct; a true per-tenant timezone boundary (using a tenant/branch tz column) would be a
  small follow-up if multi-timezone tenants are ever onboarded.
- This is a per-row + detail-panel figure (matching the blocker's scope). A platform-wide "Today's Processed Volume" KPI
  card is a clean follow-up if wanted — the per-tenant numbers it would sum are now in the payload.
