# Twilio — the one communications domain, and production onboarding (§56–§93, §129, §189)

## Architecture

```
business event (appointment.confirmed, checkout.completed, queue.ready, …)
   ↓
Communications domain  modules/communications  (NotificationsService / TenantMessenger = THE send path; reminders;
                        end-of-day follow-ups; receipts; campaigns; consent + opt-outs; usage ledger)
   ↓
Tenant messaging configuration  tenant_messaging_credentials · tenant_messaging_numbers · tenant_a2p_registrations
   ↓
Twilio adapter  packages/notifications (TwilioSmsSender, Verify client, inbound signature + STOP/HELP keywords,
                twilio-numbers-client, twilio-a2p-client, twilio-trusthub-client)
   ↓
Twilio account / subaccount → Messaging Service → number → customer
```

Only `packages/notifications` and the three Twilio clients under `modules/communications/src/tenant-*` name
`*.twilio.com`; no business module imports the Twilio SDK (none is installed; the architecture test refuses it).
Provider calls go through `instrumentedFetch('twilio')` (15 s timeout, circuit breaker, metrics).

### Tenant configuration (§58–§60) — `tenant_messaging_credentials`

| column | meaning |
|---|---|
| `account_mode` (639) | `tenant_owned` (the salon's own Twilio account — every existing row) or `platform_managed` (reserved for a platform-provisioned subaccount; same columns, same adapter — §57: no second engine) |
| `account_sid`, `auth_token_enc` | sealed with the PROVIDER key; never returned (reads expose SIDs, `auth_token_last4`, validation state) |
| `messaging_service_sid` (639) | the salon's Messaging Service (MG…) — when set, every send names it instead of a bare From (§60) |
| `from_number` | the salon's number when there is no Messaging Service |
| `verify_service_sid`, `api_key_sid`, `api_key_secret_enc` | Twilio Verify for booking OTP (§74) |
| `branch_id` | a branch row beside the salon default (branches inherit the default) |
| `last_validated_at`, `last_validation_error`, `config_version` | Test Verify / Test SMS outcomes; §168 versioning |

Shared platform sender (`TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM` env) is used only for salons with no own account; even then
the SENDER is the salon's: its A2P Messaging Service once the campaign is VERIFIED, else its active registered number.

### Phone numbers (§59) — `tenant_messaging_numbers`
`phone_number` (unique platform-wide), `provider_phone_number_sid` (PN…), `purpose` (general_sms / booking / marketing / voice),
`status` (pending / active / suspended / released), `branch_id`. A number belongs to ONE salon: `POST /tenant/messaging/number/register`
with another salon's number is refused; `number/buy` purchases under the salon's own account (or the shared ISV account),
wires the inbound webhook and registers the number.

### A2P 10DLC (§71–§73) — `tenant_a2p_registrations`
Super Admin drives TrustHub: customer profile → brand → campaign (on the salon's Messaging Service) → number attached;
statuses mirror Twilio's (`secondary_profile_status`, `brand_status`, `campaign_status`, `number_sid`). The tenant sees
Business Information, use case, sample messages, opt-in method, terms/privacy URLs, brand + campaign status in POS
Settings → Notifications (`notifications-reminders/a2p-status`). Messaging readiness (`messaging-readiness.service`) marks
SMS ACTIVE only when the number + registration are ready; otherwise the screens say "Messaging setup required" (§73, §133)
and `TWILIO_NOT_CONFIGURED` / `TWILIO_A2P_NOT_READY` are the error codes.

## Workflows (§65, §74–§93)

| Use case | Where | Notes |
|---|---|---|
| Booking OTP (Verify) | `modules/booking/src/customer-booking/booking-verification.*` | hold → session → send → check → finalize; TTL 10 min, 5 attempts, 60 s resend cooldown, per-IP (10/h) and per-device (5/h) caps, session + phone bound, one-time; codes never logged; `OTP_INVALID` / `OTP_EXPIRED` / `OTP_RATE_LIMITED` |
| Confirmation / reminders | `modules/communications/src/reminders` | tenant-configurable lead times; half-open window per run — an appointment created inside a window skips that reminder (§88–§89), never a burst of overdue ones |
| Check-in / queue ready | queue + end-of-day modules through TenantMessenger | optional per tenant |
| Receipts | checkout `checkout-receipt-messenger` | display/POS asks → receipt record → TenantMessenger → Twilio; the display never calls Twilio (§92) |
| Review requests | `communications` review policy | no review gating (§93) |
| Marketing campaigns | `campaigns` | consent + opt-outs respected, platform limits (daily caps, quiet hours, spacing), **cost preview + confirmation** for ≥ 50 recipients (§81) |
| Opt-out / HELP | `messaging-inbound` (`POST /webhooks/twilio/sms/inbound`) | STOP/UNSUBSCRIBE/CANCEL/END/QUIT → `notification_opt_outs` (suppression), START/YES/UNSTOP re-opt, HELP answered per policy (§68–§69) |
| Delivery status | `POST /webhooks/twilio/sms/status` | signature-verified; status, delivered_at, `provider_error_code`, `segment_count` (§86–§87) |

Consent (§66–§67): transactional messages follow the service relationship; marketing requires the customer's marketing
consent (`customers` consent fields + opt-out suppression); purpose is stamped on every ledger row (`purpose`).

## Usage, billing, limits (§76–§82, §109–§110, §173–§174)

* **Two ledgers, two cost models** (§76): `sms_usage_records` = Verify / OTP usage (packages, included counts, overage,
  `provider_cost_micros`); `notifications` = plain SMS with `segment_count` (639/640 — Twilio `num_segments` on send,
  `NumSegments` on the callback). The tenant SMS plan view reports the verification balance and "Text messages this
  month … N segments" side by side; rows the carrier never sized are reported as *unknown*, never counted as one.
* Plans are data-driven (`sms_verification_packages`: included count, overage price, hard limit); marketing segment price
  is `platform_settings.sms.marketing_segment_price_cents` (unpriced → the preview says so).
* Alerts at 75/90/100 % (`sms-entitlement` thresholds) and per-tenant daily limits (`tenant_messaging_limits`).
* Rate limits: OTP per phone/IP/device; campaign caps + quiet hours; tenant monthly/daily SMS limits; the platform
  emergency send switch (`sms.emergency_send_disabled`).
* The queue (§83, §120–§122): the communications worker (`PROCESS_ROLE=worker`) drains reminders/follow-ups/campaigns
  under `runAsSingleOwner`; appointment writes never wait on Twilio; a failed send is `communication = FAILED` with
  bounded, error-aware retry — the appointment stays valid (§84–§85).

## Production onboarding (§129)

1. **Account**: Kevin's Twilio account (platform) — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (an E.164 number
   or a Messaging Service SID) in the API environment; `PUBLIC_API_BASE_URL=https://…` (the API refuses to start in
   production with a half-configured sender or an http base — `integrations-production-config.ts`).
   A salon with its own account: POS Settings → Communications → Twilio: Account SID, Auth Token, From, optional
   Messaging Service SID, Verify Service SID (+ API key); **Test SMS** / **Test Verify** record `last_validated_at`.
2. **Messaging Service**: Super Admin → tenant → A2P → *Create campaign* creates the salon's Messaging Service (or paste an
   existing MG… into the salon's credentials). Sends use it as soon as the campaign is VERIFIED.
3. **Phone number**: POS Settings → Communications → Phone number → search by area code → **Buy** (inbound webhook wired
   automatically) or **Register** an owned number. One salon per number.
4. **A2P registration**: Super Admin → tenant → A2P: provision the secondary customer profile (business info the owner
   filled in), submit the brand, submit the campaign, attach the number, **Refresh** until `VERIFIED`. Carrier review is
   external (BLOCKED_EXTERNAL) — see `A2P_10DLC_REGISTRATION_KIT.md` for the exact business data Twilio wants.
5. **Callback URLs** (Twilio console / Messaging Service): inbound `https://<api>/api/v1/webhooks/twilio/sms/inbound`,
   status `https://<api>/api/v1/webhooks/twilio/sms/status` (also `TWILIO_STATUS_CALLBACK_URL`), Verify webhooks
   `…/webhooks/twilio/booking-verification`. Signatures are verified with the account's (or subaccount's) auth token.
6. **Templates / policies**: POS Settings → Notifications: reminder lead times, templates (EN/VI), review-request policy,
   quiet hours; consent wording on the booking page.
7. **Test message**: POS Settings → Communications → Test SMS to an authorized number (counted in the ledger if sent).
8. **Go-live validation** (§189): subaccount/credentials configured ✓ · Messaging Service ready ✓ · number active ✓ ·
   A2P VERIFIED ✓ · webhook signatures validated (a status callback shows `verified` in the Twilio webhook counters) ✓ ·
   consent configured ✓ · STOP tested (reply STOP → suppressed) ✓ · OTP tested (book with a real phone) ✓ ·
   transactional SMS tested (confirmation) ✓ · delivery callback tested (`delivered` on the ledger row) ✓ · rate limits
   tested (10 OTP requests → `OTP_RATE_LIMITED`) ✓ · usage billing tested (segments appear in the tenant plan view) ✓.

Credential ownership (§185): **tenant_owned** rows are the salon's (support cannot rotate them; the salon re-enters);
the shared/platform sender and any `platform_managed` subaccount are AIPowerSalon's (rotate in env / Super Admin, audited).
Secrets are never shown — there is no "View Auth Token" anywhere (§162).
