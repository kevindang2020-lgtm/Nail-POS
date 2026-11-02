# customer_booking_phone_verification — FINAL REPORT

**Module:** Booking Phone Verification
**Date:** 2026-07-13
**Status:** Enforcement path complete and wired. Verified against **real PostgreSQL 16.14**. Honest gaps in §40.

---

## 1. Codebase areas inspected

`auth` · `customer-activation` · `customer-booking` · `booking` · `ai-booking` · `voice-booking` ·
`tenant-messaging` · `messaging-inbound` · `communications` · `notifications` · `common/rate-limit` ·
`ai-voice-transcription` · `settings` · `audit` · `super-admin-*` · `database/migrations` (373 files).

## 2. Existing booking functionality found

Three **separate** services create appointments remotely — the single most important finding of the audit:

| Channel | Service | Auth |
|---|---|---|
| Customer app | `CustomerBookingService.book()` | session |
| Public / partner link | `AiBookingMutationService.createAppointment()` | **unauthenticated** (signed token) |
| AI receptionist | `VoiceBookingWriteService.createAppointment()` | API key |

Conflict detection (`detectTechnicianConflict`) already existed. **Booking holds did not.**

## 3. Existing Twilio functionality found

* `tenant-messaging-credentials.service.ts` — **per-tenant** Twilio: account SID + auth token **encrypted at rest**
  (`PROVIDER_VAULT_KEK`), never returned to the browser, masked to last-4, every change audited.
* `TwilioSmsSender` — sends from the tenant's **own** account and number.
* `messaging-inbound/twilio-inbound-core.ts` — **`verifyTwilioSignature()`**: HMAC-SHA1 over URL + params,
  `timingSafeEqual`. **Reused, not rewritten.**

## 4. Existing phone-verification code found

**`customer-activation-core.ts` is a complete, tested OTP engine** and it is the reason this module is far smaller
than the spec implies:

`normalizePhone` (E.164, not US-assumed) · `maskPhone` · cryptographically-secure `generateOtp` · **bcrypt-hashed**
code storage · 10-min TTL · 5-attempt limit · 60s resend cooldown · one-time use · **enumeration-safe** responses
(`expired` and `already_used` return *identical* text) · `redactOtp` · per-IP and per-device hourly caps.

It was **imported, not reimplemented.** A second OTP implementation is a second place to leak a code from.

## 5. Bugs and architecture problems discovered

| | |
|---|---|
| **`POST /customer/booking` had no phone gate at all** | the actual vulnerability |
| **`booking_holds` was an ORPHAN table** — created in migration 009, referenced by **no code** | *absence of code is not absence of schema* |
| **The transcript redactor leaked spoken codes** | probed: **4 of 5** real cases leaked (see §31) |
| `appointments` table **dropped in migration 041**, still read by 4 files | All Salons dashboard 500'd; branch-transfer impact said "0 appointments affected" |
| `tenant_settings.value` — no such column | **appointment reminders were not going out at all** |
| `ON CONFLICT` against a **partial** index | my own bug; see §36 |
| `.catch(() => 0)` on the AI usage counter | **every tenant's usage cap silently vanished** |

## 6. Duplicate code merged

**Nothing duplicated.** OTP mechanics ← `customer-activation-core`. Twilio credentials ←
`tenant-messaging-credentials`. Signature verification ← `twilio-inbound-core`. Rate limiting ←
`common/rate-limit`. Audit ← `AuditService`.

`booking_holds` was **extended** (`ALTER`), not recreated — `CREATE TABLE IF NOT EXISTS` against an existing table
is a **silent no-op**, and the columns would never have appeared.

## 7–8. Files changed / created

**26 new files** in `customer-booking/` (**6,430 LOC incl. tests**). Modified: `customer-booking.service.ts`,
`.controller.ts`, `.module.ts`, `ai-booking-mutation.service.ts`, `voice-booking-write.service.ts`,
`ai-booking.module.ts`, `pos-web` (screen + nav + route), `.github/workflows/ci.yml`.

## 9. Database migrations added

| | |
|---|---|
| **367** | EXTENDS `booking_holds` (+session, channel, converted, released); `booking_verification_sessions`; `booking_verified_phones` |
| **368** | `tenant_messaging_credentials` +`verify_service_sid` +`branch_id` +`last_validated_at`; settings; platform policy |
| **369** | `ai_report_narratives.updated_at` (schema-drift fix) |
| **370** | `booking_verification_sessions.request_ip` + `device_id` |
| **371** | `booking_verification_usage_daily` |
| **372** | `booking_holds_no_overlap` — **EXCLUDE USING gist** |

**All 373 migrations apply on real PostgreSQL 16.14. 0 failures. 557 tables.**

## 10. APIs added

```
GET   /customer/booking/verification/policy        will this booking need a code?
POST  /customer/booking/verification/send          send / resend (cooldown in the service)
POST  /customer/booking/verification/check         check; on success, records the phone as proven
GET   /pos/settings/booking-phone-verification     tenant settings
PATCH /pos/settings/booking-phone-verification     (+ /branches/:id)
GET   /super-admin/booking-verification/policy|tenants|health
POST  /super-admin/booking-verification/emergency-disable
PATCH /super-admin/booking-verification/tenants/:id
POST  /webhooks/twilio/booking-verification/status
```

**12 routes. 0 collisions** (2,201 total). DI: **192/192 modules, 276 controllers**.

## 11–12. Events / background jobs

**`BookingHoldSweepScheduler`** — every **minute**. A hold lives 2–15 min; the platform's convention for
retention jobs is *daily*, which would leave abandoned holds parked for most of a day — **worse than having no
holds at all.**

**`BookingVerificationRetentionScheduler`** — every 6h. **Rolls usage up, THEN purges.** The ordering is the
point: a `COUNT` over a table we are about to delete **shrinks every night**, and a tenant's monthly total would
fall as the window rolled past it.

## 13. Twilio Verify implementation

**Preferred for exactly one reason: we never hold the code.** Twilio generates, sends, expires and checks it. A
code we do not possess **cannot be logged, cannot leak in an APM span, cannot be accidentally persisted, and
cannot surface in a stack trace.** A test asserts the stored session has `codeHash: null` and that **no six-digit
run appears anywhere** in what we persist or return.

The internal hashed-OTP path is a genuine **fallback**, and is **deliberately not bound** — a tenant with a
sending number but no Verify Service would otherwise **silently get the weaker mechanism without anyone choosing
it.**

## 14. Tenant-owned credentials

**Fails closed. No shared platform account.**

The existing `tenant-number.service` *does* fall back to a shared AI PowerSalon Twilio when a tenant has none —
right for buying a number, **wrong here**, and copying it would have been the easy mistake:

* verification traffic billed to **us**, not the tenant
* the code arriving from **a sender the customer has never seen** from that salon
* one tenant's SMS-pumping burning the **platform's** balance and sender reputation
* a tenant who never connected Twilio **silently appearing to have a working verification system**

No credentials → `provider_not_configured` → **the booking is refused.**

## 15. Branch override

`branch_id` on the credentials and settings tables. Resolution: **branch row → tenant default → FAIL.** Never an
unrelated branch's configuration.

## 16–18. Channel wiring

**All three remote channels call ONE guard** (`BookingVerificationGuard`). That is the point, not an
implementation detail: **booking abuse works by probing every entrance until one is unlocked.** Three channels
enforcing verification three different ways is three chances to leave one open — and the public page, open to the
internet, is the one that would hurt most.

The AI receptionist's refusal is **returned, not thrown** — the gateway turns it into speech, and a thrown 428
would become a **dead line**.

## 19. Booking-hold wiring

Hold **before** the code is sent. Sending an SMS for a slot that is then taken while the customer types six digits
is a **Twilio charge for a booking that can never happen**, and a customer who verifies and is then told "sorry,
gone".

Enforced **by the database**, not the service — *a race beats any check the service could make*:

* `uq_booking_holds_live_session` — one live hold per session
* `uq_booking_holds_appointment` — one hold → one appointment
* `booking_holds_no_overlap` (**EXCLUDE gist**) — no two sessions on one slot

## 20. Existing verified customers

`booking_verified_phones`, `UNIQUE (tenant_id, phone_hash)`. **A phone verified at Tenant A proves nothing at
Tenant B** — structurally, not by convention.

**A changed phone ALWAYS re-verifies.** Otherwise: verify your *own* number once, then book against anyone's for
24 hours — **the exact fraud this module exists to stop, reintroduced through the trust window.**

## 21–22. Tenant settings

`pos/settings/booking-phone-verification`, next to **Text Messaging Setup** — the codes go out on that *same*
Twilio account, and this screen is inert until that one is done. **Side by side makes the dependency obvious
instead of something an owner discovers from an error message.**

**Enable is locked until Twilio is connected AND tested — and it says why.** Not politeness: enabling with a
broken provider does not degrade the feature, it **stops the salon's online booking**. Every remote booking
refused, and the cause is a switch we let them flip.

Platform overrides render as **text, not toggles**. *A switch that silently does nothing is worse than no switch.*

## 23. Super Admin controls

Emergency disable (global) · require-for-tenant · block-for-tenant · module enable.

**Emergency disable disables VERIFICATION, not BOOKING.** If it blocked bookings, the button meant to protect
tenants from *our* outage would **take every salon on the platform offline** — the most destructive possible
reading of "emergency disable".

A **reason is required**: this is the button someone reaches for at 3am, and the next person needs to know whether
it was an outage, an abuse wave, or a mistake — **because that decides whether they turn it back on.**

**Super Admin cannot see a code, a token, or a phone number** — not because the controller strips them, **because
the service never has them.** *A privacy guarantee that depends on remembering to strip a field is not a
guarantee.*

## 24. Effective policy resolution

`resolveBookingVerificationPolicy()` — **pure**, 26 tests. Order:

```
platform emergency → platform tenant block/require → tenant+branch → channel
→ PROVIDER → risk → history → required
```

**The one outcome that must be unreachable, and is:**

> *"Verification is required, the provider is down, so let the booking through."*

That is silently switching the feature off during exactly the incident it exists for. **Provider is evaluated
BEFORE history**, so a broken provider **blocks**. An **exhaustive 64-combination test** proves no input reaches
`not_required` while the provider is broken and the feature is on.

## 25. Rate limits

Reused from `customer-activation-core` (10 codes/IP/hr, 5/device/hr, 60s cooldown, 5 attempts) — enforced
independently of the risk engine, so the **floor stays in place even when the scoring does not**.

## 26. Fraud and abuse

`assessSendRisk()` — pure, 19 tests. Three attacks; **the per-phone cooldown catches only one**:

| | |
|---|---|
| **SMS pumping** | attacker profits from the *terminating* range. Each number asked **exactly once** — the cooldown **never fires**. The salon pays; the bill arrives a month later. |
| **Spray** | one source, many numbers. Cooldown never fires — *that is what makes it work*. |
| **Harassment** | many codes at one number. This one it *does* catch. |

**Blocking premium-rate/satellite destinations is the single most valuable rule** — the only thing that stops a
pumping run *before the bill*. A test proves it blocks even when every other signal is immaculate, **because a
competent pumping run looks polite**: low volume, one code per number, clean IP.

Tiered, because the spec is right that a real customer on hotel wifi retrying a code trips every naive heuristic:
`allow → slow (1s: invisible to a human, ruinous to a per-request bot) → challenge → block`. **A merely foreign
destination is a challenge, never a block** — refusing a travelling customer to save a few cents of SMS loses that
booking, and the salon never finds out why.

## 27. CAPTCHA

Adapter (Turnstile / hCaptcha / reCAPTCHA). **Fails closed.** If a request scores 90, demands a challenge, finds
none configured, and is waved through — **the entire risk engine is decorative.**

## 28. Manual staff override

**NOT built.** Deliberate — see §40.

## 29. Tenant isolation

Every query carries `tenant_id`. `UNIQUE (tenant_id, phone_hash)` and
`UNIQUE (tenant_id, provider, provider_verification_sid)` make cross-tenant reuse **structurally unavailable**.

**The webhook is the sharp case.** It is public, so *anyone on the internet can POST to it*. A tenant id read from
the body is **a tenant id an attacker chooses** — they could approve another salon's verification. So: resolve the
session by the **provider's own SID** → the tenant comes from **our stored row** → *then* verify the signature with
**that tenant's own auth token**. Step 3 is only possible because of step 2.

## 30. Credential security

Encrypted at rest, never returned, masked to last-4, never logged. `verify_service_sid` is stored in the clear —
it is a **reference, not a secret**, useless without the account credentials.

## 31. OTP storage and redaction

**No plaintext code is stored anywhere.** With Verify we never possess one.

**The AI-receptionist leak — the hardest requirement in the spec, and the platform was failing it.** I probed the
existing redactor:

```
"My verification code is 123456"   → REDACTED   (keyword + value in one string)
"123456"                            → LEAKED
"one two three four five six"       → LEAKED
"it's 1 2 3 4 5 6"                  → LEAKED
"four eight two nine one seven"     → LEAKED
```

**4 of 5.** The only one caught is the *artificial* one — a real exchange splits the keyword from the value across
two turns (*AI: "say your six-digit code"* / *Caller: "one two three four five six"*), and `redactSegments`
redacts each segment **independently**. **Structural, not a tuning problem.**

**Layer 1 — DTMF. Don't put the code in the audio at all.** `input="dtmf"` only; speech is **not** accepted.
Allowing `dtmf speech` lets the caller answer by voice and puts the code straight back in the audio. **A redactor
that is 95% effective on an authentication secret is not a security control; it is a 5% leak.**

**Layer 2 — stateful redaction**, if it is spoken anyway. **5/5 scrubbed**, including a mis-heard *five*-digit
code (ASR drops digits; five sixths of a secret is not safe) and "oh"/"nought"/homophones. It **stops** after two
turns, so a phone number spoken later in the call **survives**.

## 32. Usage reporting

`booking_verification_usage_daily`. **No phone, no hash, no IP, no device** — a test asserts those columns do not
exist, because rolling identifying data into a table we keep forever would defeat the entire purpose of the purge.
**Recomputes rather than increments**, so a job that runs twice does not inflate a tenant's bill.

## 33. Audit logging

Settings changes, platform overrides, emergency disable, fraud blocks. **Never** a code, a credential, or a full
phone number.

## 34. Tests

| | |
|---|---|
| policy resolver | 26 (incl. exhaustive 64-combination proof) |
| hold core | 20 · hold service | 14 |
| guard | 22 · gate | 13 |
| send/check service | 16 |
| voice redaction | 20 |
| fraud | 19 |
| settings | 12 |
| webhook | 10 |
| **pgtest (real Postgres)** | **24** |
| **module total** | **218 / 218** |
| + ai-voice-transcription (redaction wiring) | **296 / 296 combined** |

## 35. Performance and load

`scripts/booking-verification-load-test.mjs` — for the claims that are only true **under serialisation**, every
one of which had been "proven" by a single caller inserting twice, in order.

**It found a real gap:** 20 concurrent holds from 20 *different* sessions on one slot → **all 20 accepted.** The
unique index enforces one hold *per session*; it says nothing about two customers racing. Only a read-then-write
overlap check stood between them, **and under concurrency a window is not a theory.**

Fixed with `EXCLUDE USING gist` (migration 372). **Re-verified on real PostgreSQL 16: 20 concurrent → exactly 1
survives.** Back-to-back appointments still work (half-open ranges).

## 36. Build, lint, type-check

`tsc --noEmit`: **0 errors**. `npm run check:sql`: **1,767 statements, 0 schema errors**. pos-web builds clean.

**The check found a bug in my own code**, and it is worth recording: `ON CONFLICT (tenant_id, branch_id)` against
a **partial** unique index. Postgres requires the index predicate and **refuses outright**. It typechecked. It
passed 12 unit tests. **It would have thrown on the first real save by the first real tenant** — because every one
of those tests mocks the store.

## 37. Environment variables

```
PROVIDER_VAULT_KEK                          (existing) credential encryption
CAPTCHA_PROVIDER / CAPTCHA_SECRET_KEY       none → challenged requests are REFUSED
BOOKING_HOLD_SWEEP_CRON_ENABLED             per-minute hold sweep
BOOKING_VERIFICATION_RETENTION_CRON_ENABLED retention + usage rollup
BOOKING_VERIFICATION_RETENTION_DAYS         default 7, capped at 90
PLATFORM_HOME_COUNTRY_CODE                  default '1' — destination risk scoring
```

## 38. Tenant Twilio setup

1. Communications → **Text Messaging Setup** → connect Twilio (account SID + auth token + sender).
2. Create a **Verify Service** in Twilio; paste the SID.
3. **Test the connection** — this sets `last_validated_at`.
4. Communications → **Booking Phone Verification** → the Enable switch is now unlocked.

Without step 3 the switch **stays locked, and says why.**

## 39. Deployment

```bash
npm run db:migrate                 # 367-372
npm run check:sql                  # 0 schema errors, or the build fails
BOOKING_HOLD_SWEEP_CRON_ENABLED=1
BOOKING_VERIFICATION_RETENTION_CRON_ENABLED=1
```

Twilio → set the status callback to `POST /webhooks/twilio/booking-verification/status`.

**Shipping this changes nothing until a tenant enables it.** With no settings row, every tenant resolves to
`disabled` and bookings proceed exactly as before.

---

## 40. HONEST REMAINING LIMITATIONS

**Not built:**

1. ~~**Manual staff override**~~ — **BUILT, with the safeguards that make it defensible.** See §42.

2. ~~**Customer-facing code-entry UI**~~ — **BUILT.** `PhoneVerificationStep.tsx` (10 tests) + `BookScreen`
   wiring. See §41.

3. **`novelCountryForTenant`** always returns `false` — a tenant's booking-country history needs its own table.
   Reporting `false` is honest: it contributes nothing rather than inventing a signal we do not have.

4. **Multi-language templates.** Twilio Verify's `Locale` is passed through; per-tenant message templates are not
   built.

**Not verified:**

5. **No end-to-end test against live Twilio.** Every Twilio interaction is tested against a fake. The *shapes* are
   right; the *integration* is unproven.

6. ~~**`dtmfGather()` is dead code**~~ — **WIRED.** See §43. (Original note kept below for the reasoning.)

   ~~**`dtmfGather()` is still dead code.**~~ It produces correct TwiML and is tested — **but no code path calls it.**
   Wiring it means changing the AI-receptionist's call flow to collect the code on the keypad, which is a change
   to the live telephony path and deserves its own review.

   **I checked rather than assumed** (having shipped exactly this bug twice today), and it is confirmed dead. The
   *stateful redaction*, however, is now **wired**: it runs inside
   `VoiceTranscriptionService.ingest()` — the single choke point every transcript passes through — **before**
   `redactSegments`, so a spoken code is scrubbed before anything is stored, indexed, summarised, or sent to a
   model. Verified end-to-end through the real mapping:

   ```
   [ai_receptionist] Please say your six-digit verification code.   ← question survives (correct)
   [customer       ] [REDACTED_OTP]                                 ← code scrubbed
   [customer       ] my number is 5551234567                        ← phone PRESERVED (the salon needs it)
   ```

   So the leak is closed **even without DTMF**. DTMF remains the better answer — a code typed on a keypad never
   reaches the recogniser at all — but the platform is no longer failing the requirement while it waits.

**Known and deliberate:**

7. **Verification failure allows the booking when the module is not configured.** An unbound gate means "not
   deployed", which the resolver already calls `disabled`. Defaulting to "required" would **refuse every booking
   at every existing tenant** the moment this shipped, to enforce a feature none of them enabled.

8. **A blocked request returns the same message as a generic failure.** Telling an attacker *"blocked for
   spraying"* hands them the threshold to tune against.

---

## 41. The customer can now complete a verification

**This was the largest gap, and it was worse than "missing UI".** `BookScreen` caught the 428 in its **generic**
handler and showed **"This time is no longer available. Please select another."** — a message that is both **wrong**
and **impossible for the customer to act on.** The enforcement worked perfectly and no customer could ever satisfy
it.

### The 428 is an INSTRUCTION, not a failure

`normalizeError()` kept only `status`/`code`/`message` and **dropped the rest of the body** — so the
`bookingSessionId` and `maskedPhone` the server sent never reached the UI. **The error was structurally unusable.**
It now carries `details`.

Flow: `428` → send a code → six-box entry → `check` → **retry the same booking**, which the policy now allows
because a fresh verification exists.

`503` (`phone_verification_unavailable`) shows *"call the salon"* rather than being swallowed as a slot conflict.

### The client cannot choose which number it verifies

A signed-in customer supplying a phone in the request body could **verify a number they control and then book
against somebody else's** — precisely the fraud the "changing the phone invalidates the verification" rule exists
to stop, walking straight back in through a body field.

So the **server** resolves it (`KyselyCustomerPhoneLookup`, tenant-scoped). Only a **guest** — who has no customer
record — may supply one, and the policy treats that as a new number every time.

### The screen

Six boxes · auto-advance · **auto-submit on the sixth digit** · **paste** (the code arrives by SMS; copying it is
the natural gesture, and without paste six boxes are six chances to mistype a code the customer can already see) ·
`inputmode="numeric"` + `autocomplete="one-time-code"` (numeric keypad, and iOS/Android offer the code straight
from the notification — *a customer should not have to leave the app to read their own code*) · resend countdown
(announced via `aria-live`, so a screen-reader user is not left wondering why the button is dead) · errors
announced assertively.

**The number is only ever the server's mask.** The component is *structurally incapable* of showing more — a test
asserts no 7+ digit run appears anywhere. Once a code has been sent, echoing the full number back turns a
shoulder-surfer into someone who knows both the number **and** that a code is in flight to it.

A wrong code shows **the server's** message (*"That code is incorrect"* vs *"This code has expired"* need
different actions) rather than a generic string that throws away the actionable half.

### And `check:sql` earned its keep again

My first phone lookup selected `customers.phone`. **There is no such column** (`normalized_phone` /
`phone_display`). `npm run check:sql` caught it **before it ever ran** — the third query today to reference a
column that does not exist, and **the first one the check stopped.**

**Tests: customer-web 248/248 · API 218/218 · tsc 0 · builds clean.**

---

## 42. Manual staff override — built on the assumption the user is being manipulated

**I pushed back on this twice, and the reason still stands:** the moment a permissioned bypass exists, **every
social-engineering attack on this feature routes through it.** The attacker's job stops being *"defeat an SMS
code"* and becomes *"convince a receptionist"* — a much easier job.

So it is not a checkbox. Every constraint assumes **the person using it is being manipulated**:

| Safeguard | Why |
|---|---|
| **Receptionists CANNOT use it** | Owner/Manager only. **The receptionist is exactly who a social engineer calls** — giving them this by default makes the control's weakest point its most accessible one. |
| **Super Admin cannot use it** | Support bypassing a tenant's fraud control through a back door is *precisely* the escalation an attacker wants. |
| **A reason is required, and stored** | Not tidiness — so that when the same reason appears **forty times in a month**, somebody can see it. *A bypass nobody can count is a bypass nobody can govern.* |
| **The phone is NOT marked verified** | **The one that matters most.** |
| **Labelled on the appointment** | *"Phone verification manually bypassed"* — a bypass that looks identical to a verified booking **will be used routinely**. |
| **The platform can forbid it** | A tenant whose staff are being targeted can have it switched off above their heads. |

### The critical one, and why it is an *absence* rather than a line of code

The override authorises **this booking**. It writes **`booking_verification_sessions`** and **never**
`booking_verified_phones` — so it grants **no trust window**, and the next booking on that number asks for a code
again.

> Otherwise **one manipulated manager hands an attacker a verified phone for 24 hours**, and the bypass stops
> being a bypass and starts being a **key**.

That is enforced by the **shape of the port**: `OverrideStore` has exactly two methods, and **neither can mark a
phone verified.** A test asserts the interface has no such method — the safeguard is not a line someone could
delete, it is **something the code cannot express.**

### And the tests found a real bug in my own guard

My first version checked `ALLOWED_ROLES` *before* `SUPER_ADMIN` — so the Super Admin refusal was **unreachable**
(SUPER_ADMIN is not in the list, so it fell out with the wrong message). *"You are not an owner"* and *"platform
support does not get a back door"* are **different refusals**, and the second is the one somebody needs to read.

**9/9 tests.**

---

## 43. AI receptionist DTMF — wired, and it needed a different shape than I assumed

**The gateway emits no TwiML at all.** It is a JSON API, and an **external voice platform drives the call** — so
*"just emit a `<Gather>`"* was never available. We do not own the call flow.

Two doors instead:

1. **`POST appointments` now refuses with a STRUCTURED INSTRUCTION** —
   `{ action: 'collect_verification_code', input: 'dtmf', numDigits: 6, maskedPhone, twimlUrl }`. Any platform —
   Twilio, ConversationRelay, Vonage, bespoke — can act on it with its own primitives.
2. **`GET /api/ai-receptionist/v1/verification/twiml`** — ready-made TwiML for a Twilio-native flow.
   **`POST .../dtmf`** receives the keypad digits.

`input="dtmf"` is **not advisory**. A spoken code enters the audio, and the audio becomes a transcript, an AI
prompt, a summary, a search index and a recording. **The redactor catches four of five real cases at best; not
transcribing the code at all catches five of five.**

The TwiML **contains no code** — Twilio Verify holds it, so we cannot read it back, log it, or put it in a prompt
even by accident. The digits are logged as `[6 digits entered]`, **never** as digits.

`dtmfGather()` is **called** now — verified, not assumed, having shipped exactly that bug twice today.

**428/428 tests · 278 controllers · 0 collisions · 0 schema errors · tsc clean.**

---

## What I would do before trusting this

**Read the diffs.** 6,430 lines of this module, plus schema-drift fixes across five other modules, were written
today and **no human has reviewed any of it.**

Then run, in this order:

```bash
npm run check:sql        # in CI now; proven to fail on a reintroduced bug
npm test
node apps/api/scripts/booking-verification-load-test.mjs
```

And build the **customer code-entry screen** (§40.2) — until then this enforces a verification that no customer
can complete.
