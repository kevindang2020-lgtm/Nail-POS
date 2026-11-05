# Runbook — Twilio outage or a tenant's Twilio failing

**Symptom**: texts fail (`SMS_DELIVERY_FAILED`), booking OTP returns "verification unavailable" (503), provider health
for `twilio` shows errors / breaker OPEN; or ONE salon's sends fail while others are fine.

**Tell the two apart first (§96)**
* `providerHealth('twilio')` unhealthy, many tenants → **global**: check status.twilio.com. Booking still works (the
  verification policy degrades to "verification unavailable" without inventing success; POS bookings, checkout and
  payments are untouched — §133). Reminders / follow-ups stay queued with bounded, error-aware retry; receipts can be
  printed or emailed. Nothing to switch off; optionally the platform switch `sms.emergency_send_disabled` stops marketing.
* Provider healthy, one salon failing → **tenant integration ERROR**: Super Admin → tenant → Communications / Twilio:
  `last_validation_error` (e.g. 20003 authentication failed = wrong token; 21606 From not owned; 30007 carrier filtered),
  A2P status, number status, usage limit (hard limit reached?), opt-out of the recipient. Ask the owner to re-enter the
  Twilio credentials in POS Settings → Communications → Twilio (support never sees or types the token) and press Test SMS.

**Credential compromise (§184)**: disable the integration (Super Admin), the owner rotates the token in Twilio and
re-enters it, revoke sessions if staff accounts were involved, audit entries `tenant_messaging_credentials.*`, re-run
Test SMS / Test Verify, resume.

**Recovery**: the communications worker resumes queued jobs; delivery callbacks reconcile the ledger; nothing is re-sent
blindly after a restore (§183) — check `notifications.provider_id` before any manual resend.
