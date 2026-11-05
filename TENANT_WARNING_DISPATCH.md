# Tenant-warning dispatch worker — closing the email/SMS delivery loop

Until now, "Send Warning" (Super Admin → Tenants → Quick Actions) persisted a `tenant_warnings` row with
`delivery_status='pending'` and the code openly deferred delivery to "a downstream worker/notification service" that
didn't exist. This builds that worker. With SendGrid/Twilio credentials set, warnings now actually send; without them
they honestly record `skipped` (never a faked `sent`). No schema change — it uses the existing `delivery_status` states.

## Files (new module `apps/api/src/super-admin-tenant-warnings/`)
- `tenant-warning-dispatch-core.ts` — pure status resolution + email/SMS body builders
- `tenant-warning-dispatch.job.ts` — the worker, repo port, in-memory adapter, env gate, tick
- `tenant-warning-dispatch.kysely.repository.ts` — pending rows + owner contact + status update
- `tenant-warning-dispatch.scheduler.ts` — env-gated 5-minute in-process timer
- `tenant-warning-dispatch.cron.controller.ts` — shared-secret manual/ops trigger
- `tenant-warning-dispatch.module.ts` — wires senders (real-or-null), job, scheduler, controller
- `tenant-warning-dispatch.vitest.spec.ts` — 8 tests
- `app.module.ts` — module registered

## How it works
The worker reads `tenant_warnings` rows still in `pending`, joins the tenant owner's contact
(`tenants.owner_user_id → users.email / normalized_phone`), and for each requested channel:
- **email** via the existing `SendGridEmailSender`, **sms** via the existing `TwilioSmsSender`;
- then flips `delivery_status` to a terminal value and never touches that row again (idempotent — re-runs can't double-send).

**Honest per-channel semantics** (`resolveDeliveryStatus`):
- `sent` — at least one requested channel was delivered;
- `skipped` — requested but the provider isn't configured **or** the owner has no email/phone;
- `failed` — the provider threw (surfaces over success so it can be retried/inspected);
- `recorded` — only when no external channel was requested (dashboard-only; the worker leaves these alone).

**Real-or-null senders.** The module constructs a provider **only** when its full credential set is present
(`SENDGRID_API_KEY`+`SENDGRID_FROM`, `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_FROM`); otherwise it passes `null`,
so an unconfigured environment records `skipped` instead of a Mock pretending to send. This matches the "pending/skipped
until configured" design exactly.

## Turning it on
1. Set the provider creds the platform already uses elsewhere:
   `SENDGRID_API_KEY`, `SENDGRID_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
2. Enable automatic delivery one of two ways:
   - **In-process scheduler:** `TENANT_WARNING_DISPATCH_CRON_ENABLED=true` → dispatches every 5 minutes (timer is
     `.unref()`'d, non-overlapping). Off by default so dev/test/CI never send.
   - **External scheduler / manual:** set `TENANT_WARNING_DISPATCH_CRON_SECRET` and
     `POST /internal/tenant-warnings/dispatch?limit=50` with header `x-cron-secret: <secret>` (403 unless the secret is
     set and matches — disabled by default, no session needed, curl-friendly).

Both paths call the same idempotent `dispatchPending(limit)`.

## Verification
API: `tsc` clean; **500 tests** (+8 covering sent/skipped/failed/recorded resolution, no-recipient skip, throw→failed,
batch idempotency, and the env gate); `RESULT: PASS`. admin-web (unchanged): `tsc` clean; **93 tests**; `vite build` clean.

## Note
The send-time bodies are plain-text and templated minimally (`warningEmail` / `warningSmsBody`). If you want richer
templates per `warning_type`/`severity`, that's a small follow-up to those two pure functions.
