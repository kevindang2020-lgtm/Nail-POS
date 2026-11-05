# AIPowerSalon — A2P 10DLC Registration Kit (per-salon template)

Carrier registration content for sending salon SMS (appointment reminders, check-in/queue updates, promotions) over
10-digit local numbers in the US/Canada. **This is the canonical text your onboarding reuses for each salon** — fill the
`[[bracketed]]` fields per tenant; everything else is fixed/recommended and written to pass review on the first pass.

> **Why this matters:** unregistered A2P traffic is hard-blocked (error 30034). Brand approval is fast (often minutes);
> **campaign review takes ~10–15 business days**, so register early. The single biggest rejection cause is a weak
> opt-in / message-flow description — this kit gets that right.

---

## 0. You are an ISV — register per salon, never share a campaign

AIPowerSalon is an **ISV**: a salon's customers receive texts that appear to come from **that salon**, not from
AIPowerSalon. Carrier rules therefore require **each salon to have its own Brand + Campaign in its own Twilio
subaccount**. Sharing one campaign across salons violates carrier policy — one salon's complaint would jeopardize every
salon's delivery. (Your A2P orchestrator already follows the per-tenant model; this kit is the content it submits.)

**One-time platform prerequisites (AIPowerSalon parent account):**
- Upgrade the Twilio account out of trial (trial accounts **cannot** complete A2P registration).
- One **subaccount per salon**; provision the salon's 10DLC number(s) there and use a **per-salon API key** (not parent
  credentials) for all calls on its behalf.
- Choose the salon's **Brand type**:
  - **Standard** (salon has an EIN) — best throughput and daily caps; use this whenever possible.
  - **Sole Proprietor** (salon is an individual/no EIN) — ~1 msg/sec, 1,000 T-Mobile msgs/day cap.
  - **Low-Volume Standard** — only if the salon will never exceed ~6,000 msgs/day; can be upgraded later via a support case.

---

## 1. Brand registration (per salon) — TCR usually approves in minutes

| Field | Value to submit |
|-------|-----------------|
| Legal business name | `[[Salon legal name — MUST match EIN/IRS records exactly, not the marketing name]]` |
| EIN / Tax ID | `[[Salon EIN]]` (omit + use Sole Proprietor if none) |
| Business type | `[[private / public / non-profit / sole-proprietor]]` |
| Business address | `[[Salon street address]]` |
| Website URL | `[[Salon site OR the salon's page on aipowersalon.com — must be LIVE and publicly reachable, not staging/404]]` |
| Registration country | US (or CA) |
| Contact | `[[Salon owner first/last name]]`, `[[email]]`, `[[mobile]]` |

> Respond to the brand **OTP verification within 24 hours** or the brand stalls. Each Standard brand gets a Trust Score
> that sets its per-campaign throughput and T-Mobile daily cap.

---

## 2. Campaign registration (per salon) — the part reviewers scrutinize

### Use case: **Mixed**
Salons send transactional + informational + (often) promotional messages, so register **Mixed** (one campaign covers all
three). A salon that will *only* ever send appointment reminders can use a single informational use case, but Mixed is the
safe, flexible default.

### Campaign description (paste, fill the name)
> `[[Salon Name]]` sends recurring SMS to its own customers who have opted in: appointment confirmations and reminders,
> check-in and queue-status updates while they wait, service-ready notifications, and occasional promotions or loyalty
> offers. Messages are sent only to customers who provided their mobile number and consented during online booking,
> in-salon check-in, or at the front desk. All messages identify the salon and include opt-out instructions.

### Sample messages (submit at least these — they must match the use case *exactly*)
**Appointment (informational / express consent):**
1. `[[Salon Name]]: Hi [Name], confirming your [Service] appointment on [Date] at [Time]. Reply C to confirm or R to reschedule. Reply STOP to opt out, HELP for help.`
2. `[[Salon Name]]: Reminder — your appointment is tomorrow at [Time]. See you then! Reply STOP to opt out.`

**Check-in / queue (transactional):**
3. `[[Salon Name]]: You're checked in — #[N] in line, about [X] min wait. We'll text when your station is ready. Reply STOP to opt out.`
4. `[[Salon Name]]: Your station is ready! Please head to the front desk. Reply STOP to opt out.`

**Promotional (only if the salon will send marketing — requires the separate express-written opt-in below):**
5. `[[Salon Name]]: Treat yourself — 20% off any gel manicure this week. Book: [[booking link]]. Up to 4 msgs/mo. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`

### Message flow / opt-in description (THE #1 rejection field — 40–2049 chars; paste + fill)
> Customers opt in to texts from `[[Salon Name]]` by checking an **unchecked** box labeled "Text me appointment reminders
> and updates" when booking online at `[[salon booking URL]]`, by opting in on the in-salon check-in screen after
> entering their phone number, or by giving their number at the front desk where printed signage requests consent. The
> checkbox and signage display: "I agree to receive recurring automated SMS from `[[Salon Name]]` (appointment reminders,
> check-in and service updates; up to ~6 msgs/month). Msg & data rates may apply. Reply STOP to opt out, HELP for help.
> Privacy Policy: `[[privacy URL]]`." Opting in is **never required** to book an appointment or pay. Screenshot of the
> online opt-in checkbox: `[[public image URL]]`. Photo of the in-salon opt-in signage/screen: `[[public image URL]]`.

This single paragraph satisfies all four required elements: (1) clear opt-in method with no pre-checked box, (2) message
frequency, (3) "Msg & data rates may apply," (4) public links to the opt-in mockups. **The mockup links must be live and
publicly viewable** — reviewers open them.

### Other campaign fields
- **Embedded links?** Yes (booking/reschedule links). **Embedded phone numbers?** Yes (the salon's phone).
- **Age-gated content?** No. **Direct lending / loans?** No.
- **Opt-out** keyword STOP and **HELP** keyword must be honored (see §3).
- **Privacy Policy + Terms URLs:** `[[privacy URL]]`, `[[terms URL]]` — must be live and must contain the elements in §4.

### Marketing-only requirement (if the salon sends promotions)
Promotional consent is **separate** from appointment/transactional consent — a customer who opted into reminders has
**not** consented to marketing. Collect a distinct, **express-written** marketing opt-in that names the salon, states
frequency, "Msg & data rates apply," and opt-out instructions. Keep transactional and marketing opt-ins as separate
checkboxes.

---

## 3. Required STOP / HELP auto-replies (configure on the Messaging Service)
- **STOP / UNSUBSCRIBE / CANCEL / END / QUIT** → stop all messages + reply once:
  `[[Salon Name]]: You're unsubscribed and won't receive more texts. Reply START to resubscribe.`
- **HELP / INFO** → reply:
  `[[Salon Name]]: Appointment & check-in texts. Up to ~6 msgs/mo. Msg & data rates may apply. Call [[salon phone]] or [[support email]]. Reply STOP to opt out.`
- **START / UNSTOP** → resubscribe + confirm.

(Twilio's Advanced Opt-Out on the Messaging Service can enforce these automatically; keep the salon's name in the text.)

---

## 4. Privacy Policy & Terms — mandatory contents (reviewers check)
The `[[privacy URL]]` (or an SMS terms page) must state, in plain language:
- Program/brand name and description (the salon's SMS program).
- "Message and data rates may apply."
- Message frequency / "recurring messages."
- Customer support contact (phone + email).
- **HELP and STOP opt-out instructions, in bold.**
- Link to the privacy policy (how phone numbers are used; **not shared/sold for marketing by third parties**).
- "Carriers are not liable for delayed or undelivered messages."

> A reusable SMS-terms snippet hosted at `aipowersalon.com/sms-terms?salon=[[id]]` (or the salon's own site) satisfies
> this for every tenant — generate it from the salon's name/phone/email at onboarding.

---

## 5. Pre-submit checklist (avoids the common rejections)
- [ ] Legal name **exactly** matches EIN records (not the marketing/DBA name).
- [ ] Website + privacy + opt-in mockup links are **live and public** (no localhost/staging/404).
- [ ] Opt-in box is **not** pre-checked, and opt-in is **not** required to book or pay.
- [ ] Sample messages include the **salon name** and **STOP/HELP**, and match the Mixed use case.
- [ ] Message-flow field is ≥40 chars and includes frequency + "Msg & data rates may apply" + public mockup links.
- [ ] Marketing opt-in (if used) is a **separate** express-written consent.
- [ ] STOP/HELP/START auto-replies configured on the Messaging Service.
- [ ] Account is **out of trial**; salon number lives in the salon's **subaccount**; per-salon API key in use.

---

## Action items this kit surfaces for the product
Verified against the current code — the consent foundation is solid, and the two gaps below have now been addressed in-app:

1. **Foundation (good):** customer-web has **separate** `smsOptIn` and `marketingOptIn` toggles (`SettingsScreen` /
   `EditProfileScreen`, persisted via `PATCH /customer/profile`) plus a `PrivacyPolicyScreen`. Separate transactional vs
   marketing consent is exactly what carriers require — don't merge them.
2. **DONE — disclosure text tightened.** The Settings consent toggles now carry the full disclosure (message types,
   **frequency**, **"Msg & data rates may apply,"** **STOP/HELP**). Still worth doing: surface the same opt-in at the
   **booking** point of collection, not only in settings.
3. **DONE — check-in kiosk now captures SMS consent.** The new-customer step shows an **unchecked** disclosure-complete
   consent checkbox; the choice threads through to set the customer's `marketing_sms_opt_in` (explicit opt-in only —
   default stays false, and the box never blocks check-in). In-salon check-in is now a truthful opt-in channel for §2.
4. **TODO (you) — host the mockups + SMS terms publicly.** Screenshot the opt-in checkbox + any in-salon signage and
   publish an SMS-terms page (templated per salon from `aipowersalon.com`) so the §2/§4 links are live for reviewers.
5. **TODO (you) — wire STOP/HELP/START** auto-replies on each salon's Messaging Service (§3).

Items 4–5 are the remaining steps (both external/Twilio-side) to convert this content into an approved campaign. Items 2
and 3 — the in-app opt-in capture and disclosure — are done. Everything above is ready to paste; the bracketed fields and
items 4–5 are the only gaps left.
