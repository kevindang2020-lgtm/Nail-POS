# Payment gateway — verification against Fiserv's onboarding email (Sep 27 2026)

Every requirement in the Aug 27 email, checked against the code AND against Fiserv's UAT through the real code path
(`apps/api/src/payments/gateway-uat.live.vitest.spec.ts`, run with the credentials in the environment only). Credentials are
in no file of this repository.

| Fiserv requirement / item | Where it lives | How it was verified | Status |
|---|---|---|---|
| Base URL `…/cardconnect/rest` | `CardPointeClient` strips the suffix, per-tenant `base_url` | Live: the value pasted as-is → inquireMerchant, sale, void all 200 | **Verified live** |
| MID + REST username/password | Super Admin → Payment Gateways; sealed with `PAYMENT_ENC_KEY` | Live: `upsertConfig` → row holds no plaintext; `resolve` builds the processor; Test Connection = live inquireMerchant (enabled, RPCT) | **Verified live** |
| "Make sure you can communicate with our gateway" | `npm run uat:cardpointe` | Live: PASS inquireMerchant, PASS $1.00 sale, PASS void, PASS $1500 decline (respcode 500) | **Verified live** |
| Sandbox test cards, future expiry | UAT script + live spec use 4111… / 12-29 | Live: approved | **Verified live** |
| RPCT amount-driven declines | `--decline-amount` ($1000–$1999 → last 3 digits) | Live: $1500 → C/500 "Decline", $1116 → C/116 "Not sufficient funds"; the processor reports `declined`, not an error | **Verified live** |
| `ecomind: "E"` on eCommerce (CNP) | default on every `authorizeAndCapture` | Unit (5 client tests) + live sale carried it | **Verified** |
| Cardholder name, AVS, CVV | `AuthorizeInput.name/address/postal/cvv` → `name/address/postal/cvv2` | Unit; live sale sent name + postal (UAT MID has AVS/CVV off, so the emulator returns Y/P) | **Verified** |
| Stored Credential mandate (token reuse) | `cof` / `cofscheduled` / `cofpermission` / `profile` | Live: membership renewal charged a saved CardSecure token with `cof M` + `cofscheduled Y` → approved, then voided; customer-chosen saved cards send `C`/`N` (unit) | **Verified live** |
| Hosted iFrame Tokenizer | `GET /customer/payment-methods/tokenizer`, `GET /owner/hardware-payment/tokenizer`; customer-web + owner-web iframes; CSP `frame-src *.cardconnect.com` | Live: the salon's tokenizer URL answers HTTP 200 HTML; screen tests: token accepted only from that origin, raw numbers refused; API refuses PANs | **Verified** (the iframe UI itself needs a browser — see below) |
| Bolt P2PE base `https://bolt-uat.cardpointe.com/api/` + Auth Key | Super Admin panel (sealed), `CardPointeBoltClient` | Live: **BUG FOUND AND FIXED** — the client doubled `/api` when given Fiserv's base (HTTP 404). Now: connect reaches Bolt; listTerminals shows the two HSNs; each is "No request queue registered" = offline | **Verified up to the device** |
| HSN per terminal | POS → Devices → Pair terminal (HSN field) | Unit (pairing form + repository) | **Verified** |
| Clover registration (order ID) | Physical device | Cannot be done from the repo | **Waiting on Kevin** |
| Postman collection, CardPointe portal login | Not part of the app | — | n/a |
| Ongoing sandbox testing after validation | `npm run uat:cardpointe`; the live spec | Repeatable; both green today | **In place** |
| Validation form | https://form.jotform.com/232564140390046 | Kevin, with the script output | **Waiting on Kevin** |

## What "100 %" honestly means here
- Everything the code can prove without a physical terminal is proven live, through the same classes production runs.
- **Not provable from this sandbox:** a card tapped on the Clover (Bolt `authCard`) — the device is not registered/online yet;
  the iframe rendering inside the customer/owner apps in a real browser (the URL, origin rule and message handling are
  tested; the page answers).
- **Found by this verification and fixed:** the Bolt base-URL doubling. Without it, pairing a terminal and taking a card at
  the POS would have failed with a 404 the moment the device came online.

## Re-run the proof
```
# in apps/api — credentials from Fiserv's email, in the shell only
PAYMENT_ENC_KEY=<any 64-hex> CARDPOINTE_UAT_BASE_URL=… CARDPOINTE_UAT_MERCHID=… CARDPOINTE_UAT_USERNAME=… \
CARDPOINTE_UAT_PASSWORD=… BOLT_UAT_BASE_URL=… BOLT_UAT_AUTH_KEY=… BOLT_UAT_HSN=… npx vitest run src/payments/gateway-uat.live
CARDPOINTE_BASE_URL=… CARDPOINTE_MERCHID=… CARDPOINTE_USERNAME=… CARDPOINTE_PASSWORD=… BOLT_BASE_URL=… BOLT_AUTH_KEY=… \
  npm run uat:cardpointe -- --decline-amount 1500.00
```
