# Sidebar wiring — Payments → Transactions & Tips (2026-07-06)

Continued the sidebar build. Two more real screens, wired to existing endpoints (no backend changes).

| Route | Screen | Endpoint | Gate |
|---|---|---|---|
| /tenant/payments/transactions | POSTransactionsScreen | GET /pos/reports/transactions | financial |
| /tenant/payments/tips | POSTipsScreen | GET /pos/reports/tips | financial |

- Transactions: KPIs (count, gross, tips, net) + a per-payment ledger table (time, customer,
  technician, method, gross, tip, net, status).
- Tips: KPIs (total, card, cash, avg %, no-tip count) + tips-by-technician chart and table.
- Both: period control, loading / 403 / error / empty states, Champagne-Gold + Mac-fit.

## Verification
- tsc 0 · build clean · lint clean.
- 3 new tests. Full pos-web **346/346** (incl. tenant-nav wiring invariant).
- Live E2E through real guards: both endpoints anon **401** / authed **200** with the exact shapes
  (transactions → array of rows; tips → {totalCents, cardTipsCents, cashTipsCents, tipPercentAvg, …}).

## Running sidebar tally
55 → **64** items on real screens.
- Reports: 7/13 (sales, services, technicians, payments, customers, appointments, tax).
- Payments: 2 of its items (transactions, tips) — both from the reports aggregation.

## Next candidates (need their own backends, larger)
Payments: refunds-voids, gift-cards, invoices, expenses, settlements (→ /pos/payments/reconciliation),
split-payments, terminals. Team: performance/commission/tips (pos-team + compensation modules).
