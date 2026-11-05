# AI PowerSalon — AI Receptionist Production-Readiness Checklist

Single go-live reference, consolidating all build phases. Everything below is grounded in verified runs, not claims.
Last verified: 2026-07-04.

## 1. What is built and wired

**Tenant workspace (pos-web) — 9 screens, real data, no dead buttons:**
Command Center, Front Desk agent list + Create-Agent draft flow + provisioning progress modal, Business Setup + FAQs,
Calendar (reuses the POS booking day-grid — not a second calendar), Calls + detail drawer, Follow-Ups, Settings.

**Backend (apps/api/src/voice-booking):**
- Booking Gateway: nine API-key endpoints, idempotency, 19-code error taxonomy, buffer-aware availability, handoff.
- Tenant read/write API (`tenant/ai/receptionist/*`), TenantAuthGuard, server-derived tenant/branch scope.
- Services: agents (+versions), follow-ups, FAQs, settings, durable provisioning jobs.
- Runtime call path (pre-existing, verified): Retell webhook → `RetellVoiceAdapter.verifyWebhook` (X-Retell-Signature)
  → `voice-booking.controller` → `VoiceCallOutcomeService.record`; handoff-callback → follow-up (idempotent).
- Provisioning/management seam (`VoiceProvisioningPort` / `TelephonyProvisioningPort`) with LIVE adapters:
  `RetellVoiceProvider` (create-retell-llm → create-agent, update/delete/webhook) and `TwilioTelephonyProvider`
  (search/purchase/assign/release). Both verified against current provider docs, tested with mocked HTTP.
- Audit: high-risk actions emit events via the shared `AuditService`.

**Super Admin (admin-web):** existing AI Receptionist screen (keys, calls, analytics, gateway health) + new
cross-tenant Platform Fleet rollup (`super-admin/voice/fleet`).

## 2. Verification status (fresh runs)

| Target      | Tests            | Type-check | Build | Lint  |
|-------------|------------------|-----------|-------|-------|
| apps/api    | 2797 / 2797 (440 files) | 0 errors | clean | clean |
| pos-web     | 313 / 313 (69 files)    | 0 errors | clean | clean |
| admin-web   | 722 / 722 (119 files)   | 0 errors | clean | clean |

- Migrations 301–306 apply cleanly in sequence (ON_ERROR_STOP) on Postgres 16; all tables land.
- Real-Postgres proofs recorded for: idempotency gate, agent isolation + version uniqueness, follow-up open-call
  dedupe, FAQ insert, settings upsert, provisioning active-job dedupe, cross-tenant isolation across all stores,
  and the fleet aggregates.

## 3. Security & isolation posture (verified)

- Tenant/branch identity is always server-derived (`req.ctx`); never read from client body/query.
- Every receptionist query is tenant-scoped (`WHERE tenant_id`); every INSERT lists `tenant_id` first.
- Cross-tenant suite proves Tenant B cannot read/mutate Tenant A's agents, follow-ups, FAQs, settings, or
  provisioning jobs (reads empty, mutations NotFound). Confirmed on real Postgres across all five tables.
- List queries are bounded (calls ≤ 50; follow-ups default 200 / max 500; agents & FAQs ≤ 500).
- Cross-tenant reads exist in exactly one place — the SuperAdminGuard-protected fleet rollup — and it returns
  aggregate counts only, never per-tenant rows.
- Provider adapters never leak secrets in `status()`; provider errors map to typed errors; webhook signature
  verification uses constant-time compare with a replay window.

## 4. Go-live sequence (operational — the remaining work)

The code path is complete; these steps require your provider accounts and cannot be done in-repo:

1. Create Retell and Twilio accounts.
2. Set environment variables (§5).
3. Issue a `vk_live_` integration key from the Super Admin → AI Receptionist screen.
4. In pos-web AI Front Desk: create an agent (draft), then Provision (drives the Retell adapter → agent ready).
5. Connect a Twilio number and assign it to the agent (Twilio adapter).
6. Place a test call; confirm the appointment appears in POS Booking.
7. Activate. Monitor via Command Center + Super Admin Platform Fleet.

## 5. Environment variables

| Variable | Purpose |
|---|---|
| `RETELL_API_KEY` | Retell auth; presence flips the voice provider to the live adapter |
| `RETELL_DEFAULT_VOICE_ID` | Default agent voice |
| `RETELL_WEBHOOK_SIGNING_KEY` | Verify inbound Retell webhooks |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio auth; presence flips telephony to the live adapter |
| `TWILIO_FROM` | Default Twilio sender |
| `AI_RECEPTIONIST_VOICE_WEBHOOK_URL` | Inbound VoiceUrl set on number assign |
| `VOICE_WRITE_TOOLS_ENABLED=true` | Arm booking actions (else handoff-only) |
| `BOOKING_BUFFER_MINUTES` (default 5) | Availability buffer for customer/voice paths |

With none set, the provider seam honestly reports not-connected with a specific reason; no real calls occur.

## 6. Rollback & emergency controls

- Disable per tenant: receptionist Settings → Enable AI Receptionist off.
- Pause one agent: Front Desk → Pause (agent stops; draft preserved).
- Handoff-only mode: unset `VOICE_WRITE_TOOLS_ENABLED` (answers/handoff continue; no booking mutations).
- Revoke integration key: Super Admin → AI Receptionist → revoke (session-scoped).
- Release a number: Phone path → release (confirmation + audit).
- Nothing requires deleting production records to disable the service.

## 7. Known limitations (honest)

- Live provider actions require the accounts above; until then provisioning fails honestly at the provider step.
- Provisioning runs in-process (durable, pollable state); a dedicated worker/queue is recommended at scale.
- POS buffer = tenant settings; customer/voice buffer = env (`BOOKING_BUFFER_MINUTES`), aligned at 5 by default but
  not unified (documented; unifying needs the customer-booking port to read tenant settings).
- Transcripts/recordings are not stored by the outcome store; the Calls detail says so rather than showing a player.
- Google Reviews and the live-audio (WebRTC) test console are provider-gated and not built.

## 8. Final checklist

- [x] Tenant workspace screens built, wired, tested
- [x] Booking Gateway + runtime call path verified
- [x] Live Retell + Twilio adapters (tested, docs-verified)
- [x] Durable provisioning job (honest failure when not connected)
- [x] Tenant isolation proven (unit + real Postgres) across all stores
- [x] Bounded queries
- [x] Audit logging on high-risk actions
- [x] Super Admin fleet oversight
- [x] Migrations apply cleanly in sequence
- [x] api / pos-web / admin-web green (tests, tsc, build, lint)
- [ ] Retell + Twilio accounts created (owner)
- [ ] Env vars set (owner)
- [ ] `vk_live_` key issued (owner)
- [ ] Test call placed; appointment confirmed in POS (owner)
- [ ] Agent activated (owner)
