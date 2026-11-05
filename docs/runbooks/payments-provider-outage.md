# Runbook — payment provider outage (Fiserv / CardPointe / Clover unreachable or erroring)

**Symptom**: card payments fail or time out at several salons at once; System Operations shows the provider's circuit
breaker OPEN / error rate climbing (`providerHealth('cardpointe')`); `PAYMENT_STATUS_UNKNOWN` rising.

**First 5 minutes (no secret access needed)**
1. Super Admin → System Operations → provider health: is it ONE provider (global) or ONE tenant (`Tenant Integration = ERROR`, provider HEALTHY)? A single tenant → see "merchant support" below, not this page.
2. Check the provider's status page (CardPointe / Fiserv). If they are down, continue.
3. Super Admin → Kill switches → **Pause payments: cardpointe** (Constitution 7 §34). Every salon on that integration gets
   `MERCHANT_SUSPENDED`-class refusal ("Card payments … are paused") with nothing charged; cash, gift cards, booking,
   queue and service keep working (§148).
4. Post a platform announcement (Communications → Platform announcements) telling salons to take cash / gift card.

**While paused**
* Do NOT route the same card to another processor (§179). There is no automatic failover.
* Attempts that were mid-flight stay `processing` (PAYMENT_STATUS_UNKNOWN). The payment-attempt sweep retries the
  inquiry each tick and gives up honestly while the provider is down; nothing is auto-voided.

**Recovery**
1. Provider status green → Super Admin → Test connection on one tenant (inquireMerchant, no charge) → OK.
2. Release the kill switch. The resolver picks it up within 15 s.
3. Watch the sweep resolve the stranded attempts (`payment_attempt_sweep` log lines; Super Admin alerts for any
   `needs_review` = "charged at the processor, not recorded here" — resolve each with the salon, see
   payment-status-unknown.md).
4. Reconciliation: the next settlement webhook / deposit reconciliation will show whether anything settled during the
   outage that AIPowerSalon did not record.

**Merchant support (one tenant, provider healthy)**
Super Admin → Payment Gateways → the tenant: status (`active`?), underwriting, Verify credentials (which fields are
missing), Test connection (`merchantEnabled`?), Webhook events (`verified` recently?), last successful payment
(Payment Gateways table), terminals (Devices overview). Never ask for or view the secret — re-enter it if needed (Rotate /
Configure, step-up, audited).
