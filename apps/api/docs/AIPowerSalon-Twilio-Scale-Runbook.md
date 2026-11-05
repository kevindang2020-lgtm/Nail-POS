# AIPowerSalon — Twilio & 10,000-Tenant Deployment Runbook

_Last updated: 2026-07-05. Covers the SMS messaging loop (send → inbound opt-out → delivery receipts) built in
Reception Copilot Slices 11/12/18/19, plus the scale posture from Slice 17. The AIPowerSalon-side details (env vars,
endpoints, tables) are exact — they reflect what is in the codebase. The Twilio-side process reflects Twilio's current
public docs; verify against the Console before you register, since Twilio's flow changes over time._

---

## 0. TL;DR — what unblocks messaging today

Set these and messaging goes from honest-mock to live, **no code change**:

| Env var | Purpose | Built in |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Account (or subaccount) SID | Slice 11 |
| `TWILIO_AUTH_TOKEN` | Auth token — also verifies inbound/status webhook signatures | Slices 11/18/19 |
| `TWILIO_FROM` | Sending number (E.164) — **shared today; see §4 for per-tenant** | Slice 11 |
| `TWILIO_STATUS_CALLBACK_URL` | `https://<public-api>/webhooks/twilio/sms/status` — enables delivery receipts | Slice 19 |

Webhooks to configure on your Twilio number(s)/Messaging Service:
- **Inbound SMS** → `https://<public-api>/webhooks/twilio/sms/inbound` (records STOP/START opt-out per tenant)
- **Status callback** → `https://<public-api>/webhooks/twilio/sms/status` (records delivered/failed)

Until `TWILIO_AUTH_TOKEN` is set, both webhooks **refuse** every request (security-first: they won't trust an
unverified POST). Until `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM` are set, outbound SMS uses the mock sender and the Copilot
honestly flags the result as degraded.

---

## 1. What is already built (so you know the seams)

- **Outbound**: `NotificationsService.send()` → `TwilioSmsSender` (direct REST to `api.twilio.com/.../Messages.json`).
  Meters SMS credits, enforces opt-out, logs every attempt. Mock fallback returns an `SM-MOCK-…` sid when no creds.
- **Draft templates**: deterministic reminder / running-late / ready / thank-you / reschedule, enriched with the
  customer's real appointment (no LLM needed).
- **Inbound opt-out**: signature-verified `POST /webhooks/twilio/sms/inbound` → resolves the `To` number to a tenant
  via the `tenant_messaging_numbers` registry → records STOP/START through the existing opt-out state.
- **Delivery receipts**: signature-verified `POST /webhooks/twilio/sms/status` → flips the message log
  sent → delivered / failed, with `delivered_at`.
- **Number registry**: `tenant_messaging_numbers` (phone_number UNIQUE → tenant). Populate with
  `TwilioInboundService.registerNumber(tenantId, phoneNumber)` when a number is assigned to a salon.

Migrations involved: 307 (idempotency ledger), 308 (module-scoped audit index), 309 (number registry),
310 (delivered status).

---

## 2. The architecture decision you must make first (ISV model)

AIPowerSalon sends SMS **on behalf of your salon customers**, which makes you an **ISV** in Twilio's terms — not a
direct sender. US carriers require **A2P 10DLC** registration; unregistered 10-digit-long-code traffic is blocked.

Twilio's recommended ISV structure (their "architecture type #1") is:

```
Twilio Account (AIPowerSalon)
├─ Primary Customer Profile (Business Identity = "ISV Reseller or Partner")   ← one, must be APPROVED first
├─ Subaccount → Salon A → Secondary Customer Profile → Brand → Campaign → Messaging Service → Number(s)
├─ Subaccount → Salon B → Secondary Customer Profile → Brand → Campaign → Messaging Service → Number(s)
└─ … one per tenant
```

Key consequences at 10k tenants — **plan for these, they are not optional**:

- **Every salon needs its own Brand + Campaign.** Brands are usually approved by The Campaign Registry (TCR) within
  minutes; **Campaigns currently take ~10–15 days** to review. That review latency is the gating factor for onboarding
  a new salon to live SMS — build it into your onboarding SLA.
- **Per-registration fees apply** (Brand + Campaign, one-time and/or monthly). Budget these per tenant.
- **Sole Proprietor vs Standard Brand**: salons without a Tax ID (some small businesses) may use the cheaper/lighter
  Sole Proprietor path with lower throughput; salons with an EIN must use Standard. You'll need to collect each
  salon's business info either way.
- **Automate it via the TrustHub / A2P APIs**, not the Console, at this scale. Twilio exposes ISV registration
  endpoints (Customer Profiles → Brands → Campaigns) so you can build salon self-registration into your onboarding
  flow. This is a real build item on your side (not in the Copilot scope) — treat it as its own project.
- **Numbers attach to Campaigns via a Messaging Service** ("Service"), not directly. Buy the number, create/choose the
  salon's Messaging Service, add the number as a Sender, and point that Service's inbound + status webhooks at the URLs
  in §0.

> Verify current fees, review times, and API shapes in the Twilio Console before committing — these change. Twilio also
> offers Toll-Free verification (separate, generally faster) as an alternative to 10DLC for some use cases.

---

## 3. Opt-out: Twilio + app, and why you want both

- **Twilio side (primary enforcement)**: enable **Advanced Opt-Out** on each Messaging Service. Twilio then auto-honors
  STOP/START at the carrier level and won't deliver to an opted-out number — this is your compliance backstop and it
  works even if your app is down.
- **App side (state sync, built)**: your inbound webhook records the same STOP/START into `notification_opt_outs`, so
  `NotificationsService.send()` also refuses opted-out numbers and your staff UI reflects reality. This keeps the two
  in sync and means the Copilot never even attempts a blocked send.

> Gotcha (from Twilio's ISV docs): **restructuring accounts into subaccounts resets Twilio-managed opt-out lists.** If
> you migrate an existing shared setup into per-tenant subaccounts, export the current opt-out list first and re-import,
> or you risk texting people who opted out. Your app-side `notification_opt_outs` table is a second source of truth that
> helps here.

---

## 4. The shared-number limitation (fix before real scale)

**Today** the send path uses a single `TWILIO_FROM` for all tenants. That is fine for a 2–3 salon pilot but is wrong
for 10k tenants because:

1. **A2P**: each salon is its own Brand/Campaign; a shared number can't represent all of them.
2. **Inbound routing**: the inbound webhook resolves `To` → tenant. If every salon shares one number, every inbound
   `To` is identical and the tenant can't be determined.
3. **Reputation blast radius**: one salon's spam complaint degrades the shared number for everyone.

**The target**: one (or more) number **per tenant**, each registered in `tenant_messaging_numbers`. The registry and
the inbound/status webhooks are already built for this. The two remaining integration pieces are on your side:

- **Provision-and-register**: when a salon's number is purchased/assigned, call
  `registerNumber(tenantId, phoneNumber)` (already implemented) so inbound resolves correctly.
- **Send from the tenant's own number**: the send path must choose the salon's `from` number instead of the global
  env. This is a focused change to the SMS sender config (resolve per-tenant `from` from the registry) — small, and a
  natural next slice **once numbers are provisioned per tenant**. Flag me when you're there and I'll wire it.

---

## 5. Delivery receipts

1. Set `TWILIO_STATUS_CALLBACK_URL` = `https://<public-api>/webhooks/twilio/sms/status`.
2. The sender automatically attaches `StatusCallback` to each message (only when that env is set — no receipts
   requested otherwise).
3. Twilio POSTs status transitions; the webhook (signature-verified) flips the log sent → delivered / failed and
   stamps `delivered_at`. Failed/undelivered store a `failure_reason` of `provider_failed` / `provider_undelivered`.

Use this to build deliverability dashboards and to alert on rising failure rates per tenant (a leading indicator of a
number-reputation problem).

---

## 6. Voice / AI phone receptionist (separate track)

The **AI phone receptionist** is a different feature from SMS and from the staff Copilot. Its go-live (Retell + Twilio
voice numbers, `RETELL_*` and voice webhook env, `VOICE_WRITE_TOOLS_ENABLED`) is documented separately in
`apps/api/docs/ai-receptionist/GO_LIVE_RUNBOOK.md`. Don't conflate the two: SMS uses `TWILIO_FROM` + the webhooks
above; voice uses the Retell/voice provisioning path. They share a Twilio account but nothing else.

---

## 7. AI provider key (intent & drafting refinement)

Intent detection and message drafting run **deterministically today** (no key needed). When you set an AI provider key,
they can be upgraded to LLM-backed via the existing `AiAssistantService` (which already falls back to a mock when no key
is present). That's a clean, ~1-slice change — say the word once the key is in place. Nothing about scale or Twilio
depends on it.

---

## 8. 10,000-tenant scale checklist

### Done in code (verified)
- Tenant/branch identity is **server-derived everywhere** — never from client input.
- Hot queries are **indexed and bounded**: cross-tenant Copilot-usage rollup uses `idx_audit_events_module_occurred`
  (migration 308) and defaults to a 30-day window; idempotency ledger and settings rows have unique indexes; the
  number registry is indexed by number and tenant.
- The **per-action settings read is cached** (30s TTL, size-capped, invalidated on write) so a busy tenant doesn't hit
  the DB on every action.
- Every mutation is **confirm-gated, idempotent, and audited**.

### Owner/ops — configure in your deployment (NOT in the repo; can't be validated from code)
1. **Database**
   - Connection pooling (PgBouncer or platform equivalent) sized for your instance count × pool size.
   - Read replicas for the heavy read surfaces (Super Admin rollups, communications inbox); route reads there.
   - Monitor slow queries; the audit table grows fastest — consider partitioning `audit_events` by month at volume.
2. **Caching / coordination**
   - Replace the per-instance settings cache with **Redis** for cross-instance invalidation (today a settings change
     propagates to other instances within the 30s TTL — acceptable for toggles, not for anything requiring instant
     global consistency).
3. **Horizontal scale**
   - Run the API stateless behind a load balancer; nothing in the messaging/Copilot path holds local state beyond the
     TTL cache.
   - Background work (reminders, exports, any future queue) should run on dedicated workers, not the request path.
4. **Per-tenant fairness (noisy-neighbor)**
   - Add **per-tenant rate limits / quotas** on the Copilot action + chat endpoints and on outbound SMS, so one tenant
     can't exhaust shared capacity or your Twilio throughput. (The voice gateway already has a rate-limit pattern you
     can mirror.)
   - Enforce Twilio's per-number throughput (MPS) limits per tenant; queue and pace outbound.
5. **Twilio at scale**
   - Per-tenant numbers + Messaging Services (§2, §4).
   - Automate Brand/Campaign registration via the A2P APIs during salon onboarding; surface the ~10–15 day campaign
     review as a status in your onboarding UI.
   - Monitor per-number delivery/failure rates (from §5) and error codes; rotate/replace numbers with damaged
     reputation.
6. **Observability**
   - Alert on: SMS failure-rate spikes per tenant, opt-out spikes, webhook signature-verification failures (possible
     misconfiguration or abuse), and Copilot `ACTION_DISABLED` / permission-denied rates.

---

## 9. Go-live sequence (recommended)

1. **Pilot (shared number, 2–3 salons)** — set `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM`, register that one number, point
   both webhooks at it, enable Advanced Opt-Out. Send → deliver receipt → reply STOP → confirm opt-out end to end.
2. **A2P registration** — complete your Primary Customer Profile (ISV), then register the pilot salons' Brands +
   Campaigns; attach numbers via Messaging Services.
3. **Per-tenant numbers** — build provision-and-register into onboarding; switch the send path to per-tenant `from`
   (flag me for that slice).
4. **Scale infra** — Redis, pooling, replicas, per-tenant quotas (§8) before broad rollout.
5. **Ramp** — onboard tenants in batches, watching the per-tenant deliverability + opt-out dashboards.

---

## 10. Honest boundaries

- I built and tested the AIPowerSalon-side messaging loop and the code-level scale hardening. The items in §8's
  "owner/ops" list and the A2P registration in §2 are **deployment and account configuration** — real work, but not
  something that can be written or validated from inside the repo, so they're documented here rather than faked.
- Twilio's fees, review timelines, and registration APIs change; confirm the specifics in the Twilio Console/docs at
  the time you register.
