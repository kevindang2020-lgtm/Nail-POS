# TESTING_CHECKLIST.md — AI PowerSalon (merged)

## Build checks completed (this merge session)
- [x] API workspace dependencies installed (`npm install --workspace @aipowersalon/api`, 290 packages).
- [x] **`tsc --noEmit` on merged API → 0 errors** (whole `apps/api/src/**`, includes ported modules + adapter).
- [x] No merge-conflict markers in `apps/api/src` or `apps/pos-web/src`.
- [x] All ported frontend imports resolve to existing files.
- [x] New modules registered in `app.module.ts`; reminder job route added to middleware exclusions.

## Module tests completed (ported feature — 64/64 assertions)
- [x] `notifications-core.spec.ts` — **29/29** (validation, send path, capacity gate, provider-failure
      no-charge, role guards, recent log, opt-out enforcement, inbound keyword parsing).
- [x] `reminder-core.spec.ts` — **14/14** (window selection half-open bounds, status/address filters,
      already-sent exclusion, message templating + opt-out line).
- [x] `reminders-service-core.spec.ts` — **21/21** (window+send, idempotency, disabled-tenant skip,
      opted-out blocked+marked, over-limit retried, provider-failure retried, email channel, config CRUD + validation).

## API tests — to run before deploy
- [ ] `npm test` (full `scripts/run-core-specs.sh`: all `*-core.spec.ts` harnesses + `vitest`) against Postgres.
- [ ] `apps/api` harnesses: `npm run test:harness`.

## Permission / tenant-isolation tests
- [x] Notifications/reminders tenant scoping is enforced server-side: `tenantId` comes from `req.ctx`
      (session), never the request body; `TenantAuthGuard` on all `/pos/*` routes. (Verified by code review +
      the ported service specs which assert role-forbidden and no-tenant paths.)
- [ ] Live two-tenant isolation proof for the messaging tables (`notifications`, `notification_opt_outs`,
      `reminder_settings`) against a seeded DB — recommended before pilot.

## Database migration validation
- [x] Migrations renumbered to avoid collision (101/102/103); table names verified unique vs Project A.
- [ ] `npm run db:migrate` against a fresh Postgres 16 to confirm 001 → 103 apply cleanly.

## Frontend builds — to run before deploy
- [ ] `npm install` (root) then per-app `tsc` / `vite build` for all 9 frontends (only API deps installed here).
- [ ] Manual smoke of pos-web **Messages** screen: compose+send (Mock), recent log, opt-out add/remove,
      reminders enable + lead/window/channel save.

## Remaining manual tests
- [ ] Configure `JOBS_SECRET` + scheduler; POST `/jobs/appointment-reminders` and confirm idempotent sends.
- [ ] With real `TWILIO_*` / `SENDGRID_*` creds, verify live SMS/email delivery and credit decrement on
      `tenant_usage_limits` (`sms_credits` / `email_credits`).
- [ ] Confirm opt-out blocks subsequent sends to the same address (compliance).
