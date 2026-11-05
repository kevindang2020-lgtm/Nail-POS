# Payment gateway — Fiserv / CardPointe UAT setup (Sep 27 2026)

Fiserv's ISV integration lead issued UAT credentials on Aug 27 2026 (REST gateway, Bolt integrated terminal, CardPointe
portal, a Clover order ID). **They live in the encrypted per-salon gateway settings or in Railway variables — never in
this repository, a document, or a chat.**

## What was proven on Sep 27 2026 (from this codebase's sandbox)
- REST gateway `https://isv-uat.cardconnect.com/cardconnect/rest`: `inquireMerchant` → enabled, site `isv`, processor
  `RPCT` (the amount-driven emulator), AVS/CVV not enforced. A $1.00 test-card sale (card-not-present) was **approved**
  and its **void approved** — "make sure you can communicate with our gateway" is done.
- Bolt terminal `https://bolt-uat.cardpointe.com/api`: the Authorization header is the raw key; `listTerminals` returned the
  two registered HSNs; `ping` demands a session (connect first — which the client does); `connect` fails until the Clover
  is online (register it with the order ID from the email, then power it on).

## Configure a salon (Super Admin → Payment Gateways → Configure Gateway)
| Field | UAT value |
|---|---|
| Processor / environment | fiserv / sandbox |
| Base URL | `https://isv-uat.cardconnect.com/cardconnect/rest` (the suffix is fine — the client strips it) |
| Merchant ID | the MID from the email |
| REST username / password | from the email (write-only; encrypted at rest) |
| Terminal API base (Bolt) | `https://bolt-uat.cardpointe.com/api` |
| Terminal Authorization key | the Auth Key from the email (write-only; encrypted at rest) |
Then **Test Connection** — it now performs a real, charge-free `inquireMerchant` round trip and shows what the merchant supports.

Pair the Clover in **POS → Devices → Pair terminal**, entering its **HSN** (each HSN is one device; the email listed two).
The customer-display / terminal capture path addresses the device by that HSN.

Alternative for staging only: the env fallback (`PAYMENTS_ALLOW_ENV_FALLBACK=1`, `CARDPOINTE_BASE_URL`, `CARDPOINTE_MERCHID`,
`CARDPOINTE_USERNAME`, `CARDPOINTE_PASSWORD`) — a transition aid, not the per-salon model.

## Fiserv's stated requirements — where each is met
- **CNP must carry `ecomind: "E"`** — every REST-gateway charge sends it by default (`CardPointeClient`); the customer app's
  pay-from-phone, wallet top-up and membership renewals are all card-not-present.
- **Cardholder name, AVS, CVV as best practice** — name/address/postal are sent when known (`AuthorizeInput`); CVV when the
  tokenizer supplies it.
- **Stored Credential Transaction Framework** (saved tokens reused later) — `cof` / `cofscheduled` are sent: customer-chosen
  saved card = `C` / `N`; membership renewal = `M` / `Y`; `cofpermission: 'Y'` is available for the first stored transaction.
- **Ongoing sandbox testing** — `npm run uat:cardpointe` (apps/api) runs inquireMerchant → $1.00 sale → void, and
  `--decline-amount <x.xx>` exercises an emulator decline from Fiserv's response-code table. Run it before the validation form
  (https://form.jotform.com/232564140390046) and after any gateway change.

## Card entry in the customer app — the hosted iFrame tokenizer (PCI)
The customer app's **Add card** form is now the salon's CardSecure hosted iFrame tokenizer
(`https://<site>.cardconnect.com/itoke/ajax-tokenizer.html`, derived from the salon's gateway host by
`GET /customer/payment-methods/tokenizer`). The card number, expiry and CVV are typed on the gateway's own page; the app
accepts only a CardSecure token (16 digits beginning with 9) posted from that exact origin, and sends only the token + last 4 +
expiry to the API. The app CSP allows frames from `https://*.cardconnect.com` and nothing else.

**Found and fixed on the way:** the old form sent the RAW card number to the API as the "token" and the API stored it — a
PCI DSS violation the moment real cards were used. The API now refuses any Luhn-valid 13–19 digit value that is not a
CardSecure token. Two tests had encoded the bug (one asserted the raw number was sent; one stored a test-card number as the
token); both were rewritten.

### Cleaning up any card numbers already stored
If the old customer-app form was ever used with real cards, run (from apps/api, against production):
`DATABASE_URL=… node scripts/purge-raw-card-numbers.mjs` — a DRY RUN that counts, per salon, saved cards whose "token" is
really a card number (same rule as the API; nothing is printed or changed). `--apply` deletes exactly those rows in one
transaction; those customers re-add their card through the secure form.

### The salon's hardware-plan card (owner app)
Same model: the owner types the card into the PLATFORM gateway's CardSecure iFrame (the plan is charged through
AIPowerSalon's own Fiserv merchant, `CARDPOINTE_BASE_URL`), via `GET /owner/hardware-payment/tokenizer`. The old screen
asked the owner to paste a "card token from your secure payment field" that did not exist, and the API's guard
(`/^\d{13,19}$/`) refused every real CardSecure token — so hardware autopay could not have worked with real cards. Both fixed.

## Amount-driven declines (RPCT emulator)
Any amount from **$1000.00 to $1999.99**: the last three digits of the whole-dollar amount are the response code. Verified
on Sep 27 2026: `$1500.00` → respstat C, respcode 500 "Decline"; `$1116.00` → respcode 116 "Not sufficient funds". Run
`npm run uat:cardpointe -- --decline-amount 1500.00` (apps/api) to include one in the evidence.

## Membership auto-billing
Wired to the real gateway (member's saved default card, `cof M` + `cofscheduled Y`) **only when `MEMBERSHIP_AUTOBILL_ENABLED=1`**.
Off by default: it charges real cards without the customer present. Turn it on per environment deliberately.
