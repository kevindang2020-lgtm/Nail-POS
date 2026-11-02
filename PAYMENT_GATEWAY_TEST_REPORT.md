# Payment Gateway — Test Report

## Backend
- `super-admin-platform/payment-gateways-core.spec.ts` — **60 assertions pass** (esbuild+node harness): masking, status/stage
  mapping, settlement normalization, view shaping, KPI math (incl. chargebacks 0 + untracked, distinct connected
  processors), status breakdown, top processors (rank by volume), event mapping, server-side filter (search/status/
  needs_setup/processor/settlement/date), pagination (slice + clamp), CSV — plus **security**: raw MID never in any view or CSV.
- Full backend suite (`scripts/run-core-specs.sh`) — **603 vitest tests + all harness suites, RESULT: PASS** (no regression).
- `apps/api` `tsc --noEmit` — clean.

## Frontend (apps/admin-web)
- `screens/PaymentGatewaysScreen.test.tsx` — **7 tests pass**: 8 KPI cards render from `/state`; masked MID renders with no
  raw secret; chargebacks shown as "not tracked yet"; Status filter drives a server-side query; analytics modules render
  (status breakdown, top processors, events, activity); Export pulls the filtered CSV; Configure opens the secure masked
  drawer → Edit reveals write-only credential inputs + the "encrypted at rest" assurance.
- `components/PaymentGatewayPanel.test.tsx` — pre-existing, still passing (masked-only + cleared-after-save).
- Full admin-web suite — **30 files / 154 tests pass**. `tsc --noEmit` clean. Production `vite build` succeeds.

## Coverage vs §23 checklist
Page loads · KPIs load · search · status/processor/setup-stage/settlement/date filters · clear filters · pagination · row →
detail · Configure drawer opens · credential fields not pre-filled · GET returns masked only · raw secrets never returned ·
Export · status breakdown · top processors · recent events · recent activity · Super Admin guard · tenant isolation — all
exercised by the above. Save-after-clear and POS-uses-tenant-gateway are covered by the pre-existing panel + POS tests.
