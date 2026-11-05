# AIPowerSalon — Messaging, Copilot & A2P Go-Live Runbook

Single authoritative checklist for taking the multi-tenant Twilio messaging loop, the AI Reception Copilot, the A2P
10DLC/ISV registration automation, and the scale-hardening (§8) work to production. Every step below maps to code that
is already built, tested, and verified in the repo — this document is the *operator's* remaining work: real values,
real accounts, and one deliberate database operation.

Baseline at time of writing: **api 2939/2939**, **pos-web 321/321**, admin-web building clean; migrations **301–313**
apply in sequence.

---

## 0. What's already done (no action needed)

- Multi-tenant send / inbound STOP-START-HELP / delivery receipts, keyed off each tenant's registered number.
- Per-tenant Twilio credentials, AES-256-GCM encrypted; per-tenant webhook-signature verification.
- AI Reception Copilot with deterministic drafts that become LLM-polished automatically when a provider key is set.
- A2P/ISV registration automation: business profile (TrustHub) → brand → campaign → messaging service → number.
- Readiness screens, per-tenant number provisioning, cross-instance Redis cache seam, audit partitioning tooling.

---

## 1. Set environment variables

Set these in the API's runtime environment. The Messaging Environment screen (Step 3) verifies each one; nothing here
is ever displayed back after being set.

Required for sending:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — shared/ISV account. The auth token also verifies inbound + status
  webhook signatures for numbers on the shared account.
- `TWILIO_FROM` — shared default sending number, E.164 (e.g. `+18565551234`).

Required for the full loop:
- `TWILIO_STATUS_CALLBACK_URL` — e.g. `https://api.aipowersalon.com/webhooks/twilio/sms/status` (delivery receipts).
- `PROVIDER_VAULT_KEK` — **≥32 chars**; encrypts per-tenant Twilio auth tokens at rest. Required before any salon can
  store its own credentials.
- `PUBLIC_API_BASE_URL` (or `APS_API_BASE`) — public base URL; used to render the webhook URLs on the readiness screen
  and to set each purchased number's inbound webhook.

For A2P registration automation (only if registering brands/campaigns via the app):
- `TWILIO_ISV_EMAIL` — an email you own; receives TrustHub status updates.
- `TWILIO_PRIMARY_PROFILE_SID` — your approved ISV Primary Customer Profile (`BU…`).
- `TWILIO_SECONDARY_PROFILE_POLICY_SID`, `TWILIO_A2P_POLICY_SID` — override only if Twilio's documented defaults change.

For LLM-polished Copilot drafts (any one enables it; priority openai → anthropic → gemini):
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`.

For cross-instance cache (multi-node only):
- `REDIS_URL` — when set, the Copilot settings cache is shared across nodes; unset = per-process cache (unchanged).

All of the above are documented inline in `.env.example`.

---

## 2. Point Twilio webhooks

For each number that will send/receive (shared-account numbers and any salon's own-account numbers), set in the Twilio
Console (or via the API at purchase — the app does this automatically when it buys a number):

- **Inbound SMS** → `<public-api>/webhooks/twilio/sms/inbound`
- **Status callback** → `<public-api>/webhooks/twilio/sms/status`

Salons on their own Twilio account use the same two paths; inbound/status signatures are verified with that account's
token automatically (the AccountSid on the callback selects the right tenant's token).

---

## 3. Verify configuration (Super Admin)

- **Messaging Environment** (`/messaging-environment`): status dot + per-item checklist (E.164 from-number,
  `PROVIDER_VAULT_KEK` ≥32, ISV Primary Profile shape) and copy-able webhook URLs. Also shows the **AI Reception
  Copilot** card — green = drafts will be LLM-polished via the detected provider; amber = drafts fall back to templates
  (still functional).
- Confirm the checklist is green for the required items before going further.

---

## 4. Onboard a salon's messaging (per tenant)

Super Admin → **Twilio Setup** (`/tenants/:tenantId/messaging`), or the salon's own **Text Messaging Setup** in POS
(`/tenant/communications/messaging-setup`):

1. (Optional) Enter the salon's own Twilio credentials — account SID + auth token (encrypted with `PROVIDER_VAULT_KEK`)
   + from number. Leaving this blank means the salon sends on the shared account.
2. **Phone number** section: search by area code and **Buy** a number, or **Register** a number the salon already
   owns. Buying under the salon's own account also sets it as that account's from-number. Once registered, send / inbound
   routing / receipts key off it automatically.
3. **Send test SMS**: enter a phone number and send a live diagnostic through the salon's resolved account. A returned
   SID confirms the credentials + number work end to end.

---

## 5. A2P 10DLC registration (per tenant)

Super Admin → **A2P 10DLC Registration** (`/tenants/:tenantId/a2p`). Campaign review at TCR is ~10–15 business days,
surfaced here as status. **Use Mock mode to dry-run without fees first.**

1. **0 · Business profile (TrustHub)**: enter legal name, EIN/Tax ID, address, industry, authorized representative →
   **Create secondary profile**. This runs the full TrustHub sequence (Secondary Customer Profile + A2P profile bundle)
   and auto-fills the bundle SIDs. Requires `TWILIO_ISV_EMAIL` + `TWILIO_PRIMARY_PROFILE_SID`.
2. **1 · Inputs**: brand type, use case, campaign description, sample messages, message flow (opt-in, 40–2049 chars),
   privacy policy + terms URLs. Toggle **Mock** for a dry run.
3. **2 · Submit & track**: **Submit brand** → wait for APPROVED (**Refresh status**) → **Submit campaign** →
   **Attach number** (the `PN…` SID). The progress rail shows brand/campaign status.

> Before a real (non-mock) submission, confirm the two Policy SIDs and the business-info Attribute keys against your
> Twilio account's current "Gather Business Information" docs — these occasionally change and cause rejections.

---

## 6. Validate the live loop

1. Send a message (Copilot draft or reminder) from the salon's number.
2. Reply **STOP** from the recipient → the tenant records opt-out; **START** re-subscribes; **HELP** returns help text.
3. Confirm the delivery receipt flips the notification to `delivered` (needs `TWILIO_STATUS_CALLBACK_URL`).
4. Set an AI provider key and confirm a Copilot draft shows the "AI-polished" indicator.

---

## 7. Scale hardening (§8)

- **Cross-instance cache**: set `REDIS_URL` on multi-node deployments — Copilot settings are then shared and
  invalidations propagate across nodes. No code change needed.
- **Per-tenant rate quotas**: already enforced via `tenant_messaging_limits` (monthly/daily SMS/email/push with
  soft/hard/approval) in the send pipeline, plus each AI package's per-tenant usage limit. Configure limits per tenant
  as needed.
- **Connection pooling**: handled by pg/Kysely; tune pool size via your deployment's env.
- **audit_events partitioning** — DELIBERATE, run in a maintenance window when the table warrants it:
  1. Pause writers (or tolerate a brief swap). The script runs in one transaction and rolls back cleanly on failure.
  2. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/maintenance/audit_events_partition.sql`
  3. Verify counts: `SELECT (SELECT count(*) FROM audit_events) AS new, (SELECT count(*) FROM audit_events_legacy) AS legacy;`
  4. When satisfied: `DROP TABLE audit_events_legacy;`
  After conversion, the app keeps the current + next 2 months' partitions provisioned automatically on boot (safe no-op
  until the table is partitioned). For very large tables (>10M rows), backfill in batches instead of one INSERT.
- **Read replicas**: infrastructure — provision replica servers + a read/write router at the deployment layer. No
  in-repo artifact.

---

## Endpoint reference

- Inbound / status webhooks: `POST /webhooks/twilio/sms/inbound`, `POST /webhooks/twilio/sms/status`
- Readiness: `GET /super-admin/messaging/readiness`, `GET /super-admin/ai/readiness`
- Per-tenant credentials: `GET/PUT /super-admin/tenants/:id/messaging-credentials`, test `POST …/test`; self-service
  under `/tenant/messaging/credentials`
- Numbers: `GET …/number`, `GET …/number/search`, `POST …/number/buy`, `POST …/number/register` (super-admin and
  `/tenant/messaging/number/*` self-service)
- A2P: `GET/PUT/POST /super-admin/tenants/:id/a2p[/inputs|/business-info|/provision-profile|/brand|/campaign|/number|/refresh]`

## Migration reference (this arc)

307 copilot action ledger · 308 audit module/occurred index · 309 tenant messaging numbers · 310 delivery status ·
311 tenant messaging credentials · 312 tenant A2P registrations · 313 A2P business info. (audit partitioning is the
deliberate `db/maintenance/` script, not an auto-applied migration.)

## Owner-only checklist (the genuinely-remaining work)

- [ ] Funded Twilio account; env vars set (Step 1); readiness screen green (Step 3).
- [ ] Approved ISV Primary Customer Profile; `TWILIO_PRIMARY_PROFILE_SID` + `TWILIO_ISV_EMAIL` set.
- [ ] Twilio Policy SIDs + business-info fields confirmed against your account.
- [ ] Number webhooks pointed at the two paths (Step 2).
- [ ] AI provider key set (optional; enables draft polish).
- [ ] `REDIS_URL` set on multi-node deployments (optional).
- [ ] audit_events partitioning run in a maintenance window when warranted (optional).
