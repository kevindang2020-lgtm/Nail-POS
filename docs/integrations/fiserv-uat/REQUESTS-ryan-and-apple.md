# Open items for Fiserv (Ryan) and Apple

The code is ready for each item below. What is still missing is a confirmation or an approval from outside the repo.
Send §1 to Ryan as written. §2 is the Apple steps. §3 is the run order once the answers are in.

Never paste a card number, CVV, password, merchant key, Bolt auth key or portal login into email, Postman, a ticket or
a screenshot. Send credentials only through Fiserv's secure channel, and rotate the UAT keys after they have been shared.

---

## 1. Email to Ryan (Fiserv / CardPointe)

**Subject:** AI PowerSalon: UAT setup questions (Clover Compact, surcharge, tips, Tap to Pay)

Hi Ryan,

We are ready to run the UAT validation scenarios. Before we do, we need these answers:

1. **Clover Compact on UAT.** Is our Compact boarded to the UAT MID on the Bolt UAT service, and what HSN is it under?
   Is it running the Bolt / Integrated Terminal app? We call `listTerminals`, then `connect` with `force:false`, then
   `authCard`.
2. **Amount format.** We send Bolt amounts as implied decimals (`"1000"` = $10.00). Is that right for our account on
   v3 `authCard`? Should we move to v4?
3. **Surcharge.** Is the MID enrolled in surcharging, and at what rate? Does the gateway add the fee and return
   `fee_amount` / `fee_type` / `fee_value` on `auth`? Our app applies only the fee the gateway returns. It never adds a
   flat percentage, and it never surcharges debit or prepaid cards.
4. **Tip adjustment.** For card-present tips added after the sale, should we use `capture` with a higher amount on an
   auth-only transaction, or a separate tip-adjust call? What is the maximum tip percentage before a re-auth is
   required?
5. **Stored credentials.** Please confirm the fields we send: `ecomind E` and `cof C` with `cofscheduled N` for
   customer-initiated charges, and `cof M` with `cofscheduled Y` for membership renewals. These cover cards saved
   with customer consent.
6. **Webhooks.** What signing scheme and header are used for the CardPointe event webhooks, and which events can we
   subscribe to?
7. **Tap to Pay on iPhone.** Which PSP and SDK does Fiserv support for Tap to Pay on iPhone with our MID
   (CommerceHub / FiservTTP)? What is the onboarding step on your side?
8. **Production.** After UAT passes, what does certification involve, and what do you need from us for the production
   MID and keys?

Thanks,
Kevin

---

## 2. Apple: Tap to Pay on iPhone entitlement

The manager-pay app keeps Tap to Pay switched off until the native plugin is present on iOS (`TapToPayNotProvisionedError`).
These steps are done in the Apple Developer account:

1. developer.apple.com → Account → request the **Tap to Pay on iPhone** entitlement
   (`com.apple.developer.proximity-reader.payment.acceptance`). The request names the PSP from item 7 above.
2. After approval, add the entitlement to the App ID and regenerate the provisioning profiles (development first).
3. In Xcode, add the entitlement to the manager-pay iOS target. Then build to a physical iPhone XS or newer running a
   current iOS. The simulator cannot run Tap to Pay.
4. Apple's review requires the Tap to Pay UX checklist, including the first-use education screen and the merchant
   terms acceptance. Production distribution needs a second approval, so submit the development build for that review.
5. Smoke test with a UAT card: one sale, then its void. Confirm that the amount the plugin reports matches the ticket.
   The adapter rejects any mismatch.

---

## 3. Run order after the answers arrive

| # | Step | Who | Command / place |
|---|------|-----|-----------------|
| 1 | Rotate UAT keys, then put them in a private Postman environment and the shell env only | Kevin | Fiserv portal |
| 2 | Gateway scenarios S1–S9, which save a sanitized evidence file | Kevin | `npm run uat:cardpointe -w apps/api -- --evidence uat-evidence.json` |
| 3 | Decline scenario, using an amount from Fiserv's RPCT table | Kevin | add `--decline-amount 1500.00` |
| 4 | Compact online check (S10) | Kevin | add the `BOLT_BASE_URL` and `BOLT_AUTH_KEY` env vars |
| 5 | Compact sale (S11): someone taps a UAT card | Kevin + device | add `--terminal-sale <HSN> --terminal-amount 1.00` |
| 6 | In the app: assign each Compact to a location (Devices), then take a POS **Card** payment | Front desk | POS → Checkout → Card → choose terminal |
| 7 | iPhone build with Tap to Pay, after Apple approval | Kevin | §2 |
| 8 | Attach `uat-evidence.json` to the validation form | Kevin | Fiserv Jotform |

The evidence file contains outcomes only: response codes, masked retrefs, amounts and fee fields. Production stays off
(`PAYMENTS_LIVE_MODE` unset, no `payment_platform_validations` row) until Fiserv certifies.
