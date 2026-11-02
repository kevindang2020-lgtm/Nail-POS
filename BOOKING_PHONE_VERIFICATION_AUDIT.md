# BOOKING_PHONE_VERIFICATION — Audit + Phase 1 (2026-07-12)

**Status: NOT built. But ~60% of the hard parts already exist**, and the spec's own first rule is
reuse-don't-duplicate. This is the audit it asked for, plus the keystone.

---

## 1. What already exists — do NOT rebuild it

### The OTP engine is already here: `customer-activation-core.ts`

It is pure, tested, and already does most of what the spec's "Security Requirements" section asks for:

| Spec requirement | Already implemented |
|---|---|
| E.164 normalization, not US-assumed | `normalizePhone(raw, defaultCountry)` |
| Mask the number in the UI | `maskPhone()` |
| Cryptographically secure 6-digit code | `generateOtp()` |
| **Hashed** code storage — no plaintext OTP | hashed with the platform's password hasher |
| Short expiry | `OTP_TTL_SECONDS` = 10 min |
| Attempt limit | `OTP_MAX_ATTEMPTS` = 5 |
| Resend cooldown | `RESEND_COOLDOWN_SECONDS` = 60 |
| One-time use + replay protection | `decideVerify()` — `consumed` / `already_used` |
| **Enumeration-safety** | `GENERIC_REQUEST_RESPONSE`; `already_used` and `expired` return *identical* text so reuse is never revealed |
| Never log the code | `redactOtp()` |
| Per-IP / per-device abuse limits | `MAX_CODES_PER_IP_HOUR`, `MAX_CODES_PER_DEVICE_HOUR` |

**It is already better than the spec's fallback requirements.** It gets imported, not reimplemented.

### Tenant-owned Twilio is already here: `tenant-messaging-credentials.service.ts`

Per-tenant Account SID + auth token, **encrypted at rest** (`PROVIDER_VAULT_KEK`), **never returned to the
browser**, masked to last-4, per-tenant from-number registry, every change audited. `TwilioSmsSender` already
sends from the tenant's own account and number.

That is the "Tenant-Owned Twilio Architecture" section, already satisfied for the Messages API.

### Also present
Rate limiting (`common/rate-limit`, `tenant-rate-limit.guard`), audit, events, notifications, settings, RBAC.

---

## 2. What is genuinely missing

1. **Booking holds — none exist.** No table, no service. This is the biggest gap: without it, verification takes
   time and the slot can be taken underneath the customer.
2. **`POST /customer/booking` has NO phone gate at all.** A remote booking is created with whatever number was
   typed. This is the actual vulnerability the module is meant to close.
3. **Twilio Verify** — only the Messages API is wired. The existing custom OTP is the spec's *fallback*; Verify
   is its stated preference.
4. Policy resolution, Super Admin oversight, fraud/CAPTCHA, per-branch Twilio override.

---

## 3. Phase 1 — DELIVERED: the deterministic policy resolver

`customer-booking/booking-verification-policy.ts` — pure, no DB, no Twilio, no clock of its own. **26/26 tests.**

One resolver answers the question for online booking, the customer app, the AI receptionist and the kiosk. A
second copy of this logic in a controller is how a channel quietly ends up enforcing a policy the tenant never
configured.

### The ordering is the whole design

```
platform emergency disable → platform tenant block/require → tenant+branch enabled
→ channel → PROVIDER → risk → history → required
```

Each rule can only make verification *more* likely — never less — until we reach the tenant's own configuration.

**The one outcome that must be unreachable, and is:**

> *"Verification is required, the provider is down, so let the booking through."*

That is silently switching the feature off during exactly the incident it exists for. **Provider is evaluated
BEFORE history**, so a broken provider `blocks` the remote booking (`provider_not_configured` /
`provider_unavailable`) and can never be excused by a recent verification. An **exhaustive 64-combination test**
proves no input reaches `not_required` while the provider is broken and the feature is on.

### Other properties the tests pin

* **A changed phone always re-verifies.** Otherwise: verify your *own* number once, then book against anyone's
  for 24 hours — the exact fraud this module is bought to stop, reintroduced through the trust window.
* A verification timestamped in the **future** (clock skew, tampered row) is **never** trusted.
* **Emergency disable does not block bookings.** An outage in *our* verification layer must not take every
  tenant's bookings offline with it.
* A tenant **cannot** switch off a platform requirement — but a platform requirement **still does not OTP a
  walk-in.** Forcing a code on someone standing at the counter is theatre; the policy targets *remote* abuse.
* Provider errors **never leak** Twilio internals to the customer.
* History is **tenant-scoped by construction** — the caller passes it in; there is no code path here that could
  reach across tenants even if it wanted to.

Every result carries `policy / platform / tenant / branch / provider` **versions**, so a disputed booking can be
explained months later.

---

## 4. Verification

| | |
|---|---|
| `booking-verification-policy.vitest.spec.ts` | **26/26** |
| `booking-hold-core.vitest.spec.ts` | **43/43** |
| customer-booking suite (incl. 2 pre-existing) | **74/74 — no regression** |
| `customer-booking-verification-gate.vitest.spec.ts` | **13/13** |
| `booking-verification-guard.vitest.spec.ts` | **22/22** |
| `booking-verification.service.vitest.spec.ts` | **16/16** |
| customer-booking + ai-booking + voice-booking + activation + schema-guard | **415/415** |
| API `tsc --noEmit` (all apps) | **0 errors** |
| `booking-verification-voice.vitest.spec.ts` | **20/20** |
| customer-booking + ai-voice-transcription + voice-booking | **408/408** |
| `booking-hold.service.vitest.spec.ts` | **14/14** |
| customer-booking + schema-guard | **158/158** |
| `booking-verification-settings.vitest.spec.ts` | **12/12** |
| customer-booking + settings | **165/165** |
| **`booking-verification.pgtest.vitest.spec.ts`** (REAL Postgres) | **9/9** |
| **migration chain from empty** | **368/369, 556 tables** |
| customer-booking (full module) | **174/174** |
| DI graph | **192/192 modules, 274/274 controllers** · 2,196 routes, 0 collisions |
| booking + ai-booking + voice-booking + activation | **449/449 — no regression** |
| booking + activation + schema-guard suites | **200/200 — no regression** |
| API `tsc --noEmit` | **0 errors** |

---

## 4b. Phase 2 — DELIVERED: booking holds + schema

`customer-booking/booking-hold-core.ts` — pure. **43 tests.**

A hold reserves the slot **before** the code is sent. The two failures it exists to prevent both cost real money:

* **UNDER-holding** → two customers both verify and are both told the same slot is theirs. A double-booked
  technician and someone turned away at the door.
* **OVER-holding** → one abandoned script parks the whole Saturday. A denial-of-service on the salon's own
  calendar, dressed up as a setting.

Pinned by tests:

* **Half-open intervals** — 10:00–11:00 and 11:00–12:00 do **not** collide. Treating the boundary as a conflict
  would make back-to-back appointments impossible, which is how salons actually run.
* **A "first available" hold collides with EVERY technician** at that time. We don't yet know who it will land
  on, and letting a specific-technician booking through would double-sell the very person it's about to take.
  Conservative on purpose: over-holding costs one slot for a few minutes; under-holding double-books a customer.
* **One session, one hold.** Moving to a different slot *releases* the old one — enforced by a partial unique
  index in the database, not by application code.
* **A hold converts to an appointment exactly once** — also a database constraint, because a race between two
  confirms would beat any check the service could make.
* `canConvert` refuses a hold belonging to **another booking session** (the replay: verify one booking, present
  that session against someone else's hold) and to **another tenant** — with a message *identical* to an expired
  hold, because "that hold belongs to someone else" confirms the hold exists and is an enumeration oracle.

### A bug my own test caught

`clampHoldSeconds(null)` returned the 2-minute **minimum**, not the 10-minute default — because **`Number(null)`
is `0`, not `NaN`**, so a null sailed past the `isFinite` guard. A tenant who simply never configured a hold
duration would have silently got the shortest hold the platform allows, and their customers would lose slots
while typing an SMS code. Fixed; pinned.

---

## 4c. I duplicated two existing tables. Here is the correction.

My first migration ran `CREATE TABLE booking_holds` and `CREATE TABLE customer_phone_verifications`. **Both
already exist** — `booking_holds` in **009_booking.sql**, `customer_phone_verifications` in
**049_phone_verification.sql**. That is the spec's *first* rule, and I broke it.

**Why the audit missed them:** I grepped the TypeScript for a hold service and found none. `booking_holds` is an
**orphan table** — created in 009 and referenced by **no code at all**. *Absence of code is not absence of
schema*, and I will not make that inference again.

**Why it mattered more than an untidy diff:** `CREATE TABLE IF NOT EXISTS` against an existing table is a
**silent no-op**. The migration would have "succeeded", my new columns would never have been created, and the
hold service would have failed at runtime against a table that looked correct in the source and was wrong in the
database. That is the same class of bug as the `queue_entries` 500 and the permanently-zero Service Done badge —
schema drift that no unit test can see.

**Corrected.** Migration 367 now:

* **`ALTER TABLE booking_holds`** — adds `booking_session_id`, `channel`, `converted_appointment_id`,
  `released_at`, `release_reason` to the table that already exists, plus the two unique indexes that make
  one-hold-per-session and one-conversion-per-hold *database* guarantees.
* **`booking_verification_sessions`** (new) — tenant + hold + session bound; `UNIQUE (tenant_id, provider,
  provider_verification_sid)` for provider idempotency. **No code column, in any form.**
* **`booking_verified_phones`** (new) — the "this phone is proven" record. Deliberately **not**
  `customer_phone_verifications`, which is the OTP *code store* (one row per code, emptied on consumption).
  Putting a durable trust record in a table designed to be deleted would be a real bug. `UNIQUE (tenant_id,
  phone_hash)` makes "verified at Tenant A ⇒ verified at Tenant B" structurally unavailable, not merely
  discouraged.

---

## 4d. Phase 3 — DELIVERED: the gate. `POST /customer/booking` now refuses an unverified booking.

This is the line the whole module exists for. Everything else — the policy resolver, the holds, the OTP, the
tenant-owned Twilio — is machinery in service of one fact:

> **An appointment must not be created before the phone behind it is proven.**

`CustomerBookingService.book()` now calls `requirePhoneVerification()` **after** the conflict check and
**before** `insertBookingAtomic`. Any path that reaches the insert without passing it is a hole in the feature.

| Outcome | Response |
|---|---|
| verification required, phone not verified | **428** `phone_verification_required` + booking session id + **masked** phone |
| required, but no/unhealthy Twilio | **503** `phone_verification_unavailable` — the booking is **REFUSED** |
| not required / recent verification accepted / gate unbound | booking proceeds |

**The ordering is deliberate and costs money if you get it wrong.** The gate runs *after* the conflict check, so
we never send an SMS — a real Twilio charge, and a confusing text — for a slot that is already gone. And it runs
*before* the insert, so a failed verification cannot leave an appointment behind.

### What the tests actually assert

`insertBookingAtomic` is spied on. **If it was called, an appointment exists and the feature failed** — whatever
the API returned. Every case below asserts it was **not** called:

* verification required + unverified → refused, **nothing created**
* provider down → refused, **nothing created** — *even when the customer was previously verified*. "Verification
  is required but Twilio is down, so let the booking in" switches the feature off during precisely the incident
  it exists for.
* **the gate itself throws** (policy store down, verification store down) → the booking **fails**. An exception
  in the verification layer must never become an unverified appointment.
* a taken slot → rejected **without requesting a code at all**.
* the 428 payload carries a masked phone and **no digit run ≥ 7** — the spec forbids echoing the number back
  once a code has been sent. The 503 message never mentions Twilio.

### The one permissive default, and why it is the correct one

An **unbound gate proceeds**. That is not laxity: an unbound gate means the module is not configured for this
deployment — exactly the state the policy resolver already calls `disabled`. Defaulting to "required" would
refuse **every booking at every existing tenant** the moment this code shipped, to enforce a feature none of them
had turned on. The policy decides; the absence of a policy is not a policy.

---

## 4e. Phase 4 — DELIVERED: ALL THREE remote channels now gated, by ONE guard

An appointment can be created remotely in three places, and they are three different services:

| Channel | Service | Auth |
|---|---|---|
| Customer app | `CustomerBookingService.book()` | session |
| **Public / partner booking page** | `AiBookingMutationService.createAppointment()` | **unauthenticated** (signed link) |
| AI receptionist | `VoiceBookingWriteService.createAppointment()` | API key |

**All three now call the same `BookingVerificationGuard`.** That is the point, not an implementation detail:
**booking abuse works by probing every entrance until one is unlocked.** Three channels enforcing verification
three different ways is three chances to leave one open — and the public page, which is open to the internet, is
the one that would hurt most.

### What the guard enforces

* **`assertMayBook()` throws unless the appointment may exist.** Returning normally is the *only* thing that may
  be read as permission.
* **The phone is hashed before it is looked up.** A raw E.164 in a lookup ends up in a query log, a slow-query
  trace, an APM span. A test asserts the raw number never reaches the store.
* **An unparseable number is REFUSED, not skipped.** If rubbish simply bypassed the check, an attacker would opt
  out of verification by typing rubbish — and the fake bookings this module exists to stop would sail through
  the hole. Same for a *missing* number.
* **A broken provider refuses the booking on every channel** — *including for a phone verified one minute ago.*
  "The provider is down, but this phone verified recently, so let it through" is the same failure wearing a
  friendlier face.
* **Refusals never leak the number.** Masked to the last four; no digit run ≥ 7 anywhere in the payload; the
  message never names Twilio.

### The AI receptionist gets one thing the web does not

Its refusal is **returned**, not thrown — the gateway turns the message into speech, and a thrown 428 would
become a dead line. The message is already customer-safe, so it can be read aloud as-is.

And the reason it is gated at all is worth stating plainly: **a caller has proven nothing except that they can
dial a number.** Caller ID is trivially spoofed, so the number the AI *heard* is not evidence — it has to be
proven, exactly as on the web.

---

## 4f. Phase 5 — DELIVERED: the loop is closed. Twilio Verify, on the tenant's OWN account.

Until now the guard refused every booking at a tenant who enabled the feature — correct, but useless. This
closes it:

```
refuse → send → check → record → retry → resolver sees a fresh verification → the booking proceeds
```

The "record" step writes `booking_verified_phones` — **the exact row the policy resolver reads.** Nothing holds
a session open to make that work, and nothing needs to.

### Twilio Verify is preferred for one reason: we never hold the code

Twilio generates, sends, expires and checks it. **We never see it.** A code we do not possess cannot be logged,
cannot leak in an APM span, cannot be accidentally persisted, and cannot surface in a stack trace. The
internal-OTP path (reusing the existing hashed-OTP core) is a genuine *fallback*, not an equal option.

A test asserts the stored session has `codeHash: null` and that **no six-digit run appears anywhere** in what we
persist or return.

### The divergence I had to make deliberately

The platform's existing `tenant-number.service` resolves a tenant's Twilio and **falls back to a shared
AI PowerSalon account** when they have none. That is right for buying a phone number. It is **wrong here**, and
copying it would have been the easy mistake:

* verification traffic billed to **us**, not the tenant
* the code arriving from a **sender the customer has never seen** from that salon
* one tenant's SMS-pumping burning the **platform's** Twilio balance and sender reputation
* a tenant who never connected Twilio **silently appearing to have a working verification system**

So this resolver **fails closed**. No tenant credentials → `not_configured` → the policy returns
`provider_not_configured` → the booking is refused. A tenant who has not connected Twilio *cannot* enable
verification. Pinned by a test.

### What else the tests pin

* **Changing the phone invalidates the verification.** Otherwise: request a code to your own phone, present it
  against someone else's number — verifying a number that was never texted. That *is* the fraud.
* **A malformed code never reaches the provider** and never spends one of the customer's limited attempts. It
  cannot possibly be right, so it must not cost a Twilio call either.
* **A consumed code cannot be replayed**, and reports the *same text* as an expired one — "that code was already
  used" confirms a valid code existed, which is an enumeration oracle.
* **Twilio's own error text never reaches the customer** (it names the account and the service). It is kept for
  the audit record; the customer sees the policy's safe message.
* Resend cooldown, attempt lockout, and the enumeration-safe send response all come from the **existing**
  `customer-activation-core` — imported, not reimplemented.

---

## 4g. Phase 6 — DELIVERED: wired to Postgres. It is now a live feature, not library code.

**3 routes** (`GET policy`, `POST send`, `POST check`) · **DI 192/192** · **2,193 routes, 0 collisions**.

### Migration 368 — EXTENDS the existing credentials table

`tenant_messaging_credentials` already holds each tenant's own `account_sid` and an AES-256-GCM encrypted
`auth_token`. It gains:

* `verify_service_sid` — Verify is a separate Twilio product with its own SID. A **reference, not a secret**
  (useless without the account credentials), so it is stored in the clear — unlike the auth token.
* `branch_id` — Branch A and Branch B may be on different Twilio accounts. Resolution: **branch row → tenant
  default → FAIL.** Never an unrelated branch's configuration, never a shared platform account.
* `last_validated_at` — **"configured" is not "working".** A tenant may not enable verification on credentials
  that have never successfully validated, because sending codes into the void and telling the customer to wait
  for one is worse than refusing the booking.

Plus `booking_verification_settings` (tenant + branch, versioned) and
`booking_verification_platform_policy` (Super Admin, with a **global** emergency row a tenant cannot override —
a kill switch a tenant can override is not a kill switch).

### The fail-closed chain, end to end

| State | Result |
|---|---|
| no DB | guard unbound → **bookings proceed** (module not deployed) |
| DB, tenant never configured | policy `disabled` → **bookings proceed** |
| tenant enabled it, **no Twilio of their own** | `not_configured` → **booking REFUSED** |
| Twilio present but **never validated** | `healthy: false` → **booking REFUSED** |
| all good, phone unproven | `required` → **428** → send → check → retry → proceeds |

**Both ends of that chain are deliberate, and they are opposite errors.** An undeployed module must not start
refusing bookings at tenants who never asked for the feature. A tenant who *did* ask for it must never have it
silently skipped because their provider is broken. Getting either backwards ships a verification system that
either breaks everyone or verifies nothing.

### Route-level protections (these endpoints sit in front of an SMS sender)

They are an attacker's favourite shape: **free outbound messages, billed to someone else, aimed at anybody's
phone.** So:

* the **tenant is server-derived** from `req.ctx`, never from the body — a client that could name its own tenant
  could send verification texts on any salon's Twilio account, at their expense
* the **booking session is server-issued** — a client-supplied one would let a caller bind their verified phone
  to somebody else's booking attempt
* a client **may not claim `front_desk`**, which a tenant may have exempted — otherwise a remote booker opts out
  of verification by claiming to be standing at the counter
* the **resend cooldown lives in the service**, so every caller gets it, including a future channel that forgets
  to ask
* `503` (not 500) when a salon has no provider — a configuration state, not a crash — and the message never says
  "Twilio"

### One thing I bound deliberately, and one I did not

`markVerified` guards on `status <> 'verified'`, so a replayed confirmation cannot re-verify a session —
**one-time use in the WHERE clause, not merely in the caller.** `recordVerifiedPhone` upserts on
`(tenant_id, phone_hash)`: one truth per phone per tenant, tenant-scoped by the conflict target itself.

The **internal hashed-OTP fallback is NOT bound.** It needs a per-tenant SMS sender, and binding it early would
mean a tenant with a sending number but no Verify Service **silently gets the weaker mechanism without anyone
choosing it.** Twilio Verify — where we never hold the code — stays the only wired path until that is a
decision someone actually makes.

---

## 4h. Phase 7 — DELIVERED: keeping the code out of a recorded phone call

I called this the hardest requirement in the spec. It was, and the platform was **leaking**.

### I probed the existing redactor. Four of five real cases leaked.

```
"My verification code is 123456"   → REDACTED   (keyword and value in one string)
"123456"                            → LEAKED
"one two three four five six"       → LEAKED
"it's 1 2 3 4 5 6"                  → LEAKED
"four eight two nine one seven"     → LEAKED
```

The only case it caught is the **artificial** one. A real exchange splits the keyword from the value across two
turns —

> **AI:** "Please say your six-digit code."  ← the keyword is *here*
> **Caller:** "one two three four five six"  ← the value is *here*

— and `redactSegments` redacts each segment **independently**, so the anchor and the value are never visible to
the same regex. **That is not a tuning problem. It is structural.** A code that lands in the transcript then
flows into the AI prompt, the call summary, the search index, and the stored recording: a permanent, searchable
authentication secret in a salon's call history.

### Layer 1 — DTMF. Don't put the code in the audio at all.

`dtmfGather()` — `input="dtmf"` **only**. Speech is **not** accepted, deliberately: allowing `dtmf speech` lets
the caller answer by voice and puts the code straight back into the audio, which is the entire thing we are
avoiding. The digits arrive on a **separate channel** and never reach the speech recogniser, so there is nothing
to transcribe, summarise, index, or leak.

**This is the mechanism, not a preference.** Redacting spoken digits is best-effort *by nature* — ASR mishears,
accents vary, "oh"/"zero"/"nought" are the same digit. **A redactor that is 95% effective on an authentication
secret is not a security control; it is a 5% leak.** If a caller cannot use a keypad, the honest fallback is the
SMS/web verification page — *not* taking the code by voice and hoping.

The TwiML also **contains no code**: Twilio Verify holds it, so we cannot read it back, log it, or put it in a
prompt. `safeDtmfLog()` records *that* a code was entered (`[6 digits entered]`), never *what*.

### Layer 2 — if it is spoken anyway, scrub it. STATEFULLY.

`redactVerificationTurns()` **remembers that the assistant just asked for a code** and scrubs the caller's next
digit-bearing turn — the exact case the per-segment redactor structurally cannot see. Re-probed: **5/5 scrubbed.**

It also catches what a naive six-digit rule would miss:

* **a mis-heard FIVE-digit code** — ASR drops digits constantly, and five sixths of a secret is not safe
* **"oh" / "zero" / "nought"**, and ASR homophones (*won, too, for, ate, niner*)
* a **correction on the second attempt** ("sorry, hang on…")

And it deliberately **stops**: the arming window is two turns, so a phone number spoken later in the call
**survives** — a test pins that. Over-scrubbing costs the salon the numbers it actually needs.

---

## 4i. Phase 8 — DELIVERED: holds persist, and lapsed slots go back on the market

The hold core was pure with nothing behind it, so verification still raced the calendar. Now it persists.

### Two things are enforced by the DATABASE, not by the service

```
uq_booking_holds_live_session   -- ONE live hold per booking session
uq_booking_holds_appointment    -- a hold becomes an appointment exactly ONCE
```

They are partial unique indexes because **a race beats any check the service could make.** Two confirmations
arriving together both read "not yet converted", both pass the pure check, and both create an appointment. The
database is the only thing that can serialise that — so `convert()` treats a zero-row UPDATE as the authority
and reports `already_converted`, rather than trusting its own read. **A test races two confirmations and asserts
exactly one wins.**

### The sweep runs every MINUTE, not daily

Every unswept hold is a bookable slot the salon cannot sell. Enough of them and it is a **denial-of-service on
the salon's own diary, arriving quietly** — nothing errors, nothing alerts, the calendar just looks full.

A hold lives 2–15 minutes. A daily sweep (the platform's convention for retention jobs) would leave abandoned
holds parked for most of a day — **worse than having no holds at all.** So this one runs per-minute,
non-overlapping, unref'd, and OFF by default like its siblings.

### Also pinned

* **`acquire()` holds the slot BEFORE the code is sent.** Sending an SMS for a slot that is then taken while the
  customer types six digits is a Twilio charge for a booking that can never happen — and a customer who verifies
  and is then told "sorry, gone".
* Moving to a different slot **releases the old hold** — one session, one hold, so an abandoned flow leaves no
  trail of parked slots.
* `convert()` refuses a **wrong-session** hold (the replay: verify one booking, present it against someone
  else's) and a **wrong-tenant** one — with a message *identical* to an expired hold, because "that belongs to
  someone else" confirms it exists.
* `release()` **will not release another tenant's hold**, which would hand their slot to whoever asked.
* Hold duration is **clamped by the platform** (2–15 min); a tenant cannot configure an hour-long slot park.

---

## 4j. Phase 9 — DELIVERED: tenant settings. The feature can finally be turned ON.

**Nothing could enable this until now** — with no settings row, every tenant resolved to `disabled`. Three routes
under `pos/settings/booking-phone-verification`, where a salon owner already looks.

### The rule that actually matters

> **A tenant cannot enable verification without a Twilio account that is connected AND tested.**

That is not form hygiene. The policy resolver — correctly — **blocks** a remote booking when verification is
required and cannot be performed. So a tenant who flips the switch with no working provider does **not** get a
degraded feature: **their online booking stops.** Every remote booking is refused, and the cause is a toggle we
let them turn on.

**And "configured" is not "working."** Somebody typing an account SID into a form proves nothing about whether
Twilio will accept it. Discovering that at the first real customer means their booking is refused and nobody
knows why. So `enabled: true` needs both `connected` **and** `validated`.

What is *not* gated: everything else. A tenant may configure channels and windows before connecting Twilio, and
may **always turn it off**. Only the switch that would break their bookings is locked.

### Platform precedence is enforced at the WRITE, not just at read time

A tenant cannot turn off what Super Admin requires, or turn on what Super Admin blocked. Enforcing that only in
the resolver would leave the tenant's UI showing "off" while verification still ran — **a setting that lies about
itself.**

The view carries `provider.blockedReason` and `platform.requiredByPlatform` so the UI can show *text* explaining
why, instead of a dead toggle. A disabled switch with no explanation is how a tenant ends up filing a support
ticket.

### Storage: dedicated table, reused surface

The POS settings store is generic JSONB-by-category. It cannot serve **branch rows**, a **monotonic version**
stamped onto every verification session, or a **join against the platform policy** — so the storage is dedicated,
while the surface lives at `pos/settings/*` like everything else.

**Version is bumped, never overwritten.** When a tenant disputes a booking six months later — *"why did it not
ask for a code?"* — the answer is a fact on the row, not an archaeology exercise.

### One refactor worth naming

My first cut put the SQL in the service and I wrote a test shim to fake Kysely's executor. It failed, and it
deserved to: **the decisions here — may this be enabled, is the platform forcing it — are exactly the parts that
break a tenant's bookings if wrong, and they should be testable without a database.** Refactored to the project's
own port/driver convention. **Zero SQL statements now live in the service.**

---

## 4k. Phase 10 — I ran it against a REAL Postgres. It found a bug in my own code.

I said three times that none of this SQL had been verified. So I stopped building and verified it. **PGlite is
already a dependency** (`@electric-sql/pglite`) and the project's existing `pgtest` specs use it — an in-process
Postgres was available the whole time.

### The full migration chain, from an empty database

**368 / 369 applied. 556 tables.** The single failure is `107_pos_search_indexes.sql` (`gin_trgm_ops` needs the
`pg_trgm` extension, absent in PGlite) — an environment limit, not a bug.

Every table, column and index this module adds applied cleanly, including the `ALTER`s onto the pre-existing
`booking_holds`.

### Then it found a real bug. Mine.

```
KyselyVerificationSettingsStore.upsert()
  ON CONFLICT (tenant_id, branch_id)          -- against a PARTIAL unique index
  → "there is no unique or exclusion constraint matching the ON CONFLICT specification"
```

Uniqueness on that table is **two partial indexes** — NULL is not comparable in a UNIQUE constraint, so the
tenant-level row needs its own. And **`ON CONFLICT` does not match a partial index unless you give it the index
predicate.** Postgres refuses outright.

**It typechecked. It passed 12 unit tests. It would have thrown on the first real save by the first real tenant** —
because every one of those tests mocks the store.

That is the *same class* as the three worst bugs I found in your codebase this session: a query against a table
that does not exist, a status value that can never occur, a refund that is never subtracted. **A mocked test
cannot see any of them.** Only a database can. I had been saying that all day and had still shipped one.

Fixed: the driver now branches on `branch_id IS NULL` and supplies the matching predicate in each conflict target.

### And a permanent pgtest spec, so it cannot come back

`booking-verification.pgtest.vitest.spec.ts` — **9/9**. It runs the **actual migration chain** into an **actual
Postgres** and drives the **actual drivers**, and it proves the claims I had only asserted in prose:

* the tenant-level upsert **saves**, and the second save **updates rather than duplicating**
* a **branch row** is separate and does not collide with the tenant default
* **one live hold per booking session** — the second is refused *by the database*
* **a hold becomes an appointment exactly once** — a second hold cannot claim the same appointment id
* **"verified at tenant A" proves nothing at tenant B** — enforced by the unique key, not by convention
* the hold expiry sweep (`FOR UPDATE SKIP LOCKED`) runs
* migration 367 **extends** the pre-existing `booking_holds` — the columns 009 gave it are still there

---

## 4l. Phase 11 — DELIVERED: Super Admin oversight, and CI that catches schema drift

**5 routes** under `super-admin/booking-verification`. **2,201 routes, 0 collisions. 354/354 tests.**

### The four levers, and the one that is easy to get backwards

| lever | for |
|---|---|
| **emergency disable** (global) | when **OUR** verification layer is broken |
| **require for tenant** | a salon being used as a fake-booking channel; they **cannot** turn it off |
| **block for tenant** | a **compromised** Twilio integration — stop them sending, now |
| **module enabled** | the feature exists at all |

**Emergency disable disables VERIFICATION, not BOOKING.** If it blocked bookings, the button meant to protect
tenants from *our* outage would instead **take every salon on the platform offline** — the most destructive
possible reading of "emergency disable". The policy resolver returns `disabled`, not `blocked`, precisely for
this, and a test holds it there.

### Guardrails the tests pin

* **A reason is required** to kill it platform-wide. Not bureaucracy: this is the button someone reaches for at
  3am, and the next person needs to know whether it was an outage, an abuse wave, or a mistake — **because that
  decides whether they turn it back on.**
* A tenant **cannot be both required to verify and blocked from verifying.** Allowing both would make the
  resolver's outcome depend on the order its rules happen to be written in.
* **Overriding a tenant needs a reason too** — the tenant *will* ask why, and "somebody clicked it" is not an
  answer.

### The row that matters most: `provider_not_ready`

A tenant who turned verification **on** but whose Twilio is not usable is **refusing every remote booking right
now** — and the first they will hear of it is a customer phoning to complain. `health()` counts them.

### Super Admin cannot see a code, a token, or a phone number

Not because the controller strips them — **because the service never has them.** Codes are held by Twilio, tokens
are encrypted at rest and never decrypted on this path, phones are stored hashed with only a mask. **A privacy
guarantee that depends on remembering to strip a field is not a guarantee.** Tests assert the payloads are counts
and labels only.

### I wrote two more ON CONFLICTs against partial indexes — and tested them FIRST

That is the exact bug that bit me earlier, and `tsc` says nothing about it. So they went into the **pgtest**
before anything was built on them: **16/16 against a real Postgres.**

### CI now catches schema drift

```yaml
- name: SQL schema check (PREPARE every statement against the real schema)
  run: npm run check:sql --workspace @aipowersalon/api
```

**Proven, not assumed:** I reintroduced the reminders bug (`tenant_settings.value`) and the step **failed** with
exit 1; restoring it passed. A CI step that prints a problem and then goes green is worse than no CI step — it
teaches people the problem is acceptable.

---

## 4m. Phase 12 — DELIVERED: fraud/CAPTCHA, the POS screen, and the monitoring that failed silent

### Fraud — the attack the cooldown structurally cannot see

The `send` endpoint emits an SMS, to a number of the caller's choosing, **billed to a salon that has never heard
of them.** Three attacks, and the per-phone cooldown only catches one:

| | |
|---|---|
| **SMS pumping** | The attacker profits from the *terminating* range. Each number is asked for **exactly one** code — so the cooldown **never fires**. The salon pays. The bill arrives a month later. |
| **Spray** | One source, many numbers. Cooldown never fires — that is *what makes it work*. |
| **Harassment** | Many codes at one number. This one the cooldown *does* catch. |

`assessSendRisk()` — pure, 19 tests. **Blocking a premium-rate/satellite destination is the single most valuable
rule in the file: it is the only thing that stops a pumping run *before* the bill.** A test proves it blocks even
when every other signal is immaculate — because a competent pumping run *looks* polite: low volume, one code per
number, clean IP.

**And the spec's constraint is right:** *"do not automatically label a legitimate customer as fraudulent."* A real
customer on hotel wifi, retrying a code that never arrived, trips every naive heuristic. So the response is
**tiered**, and `block` is reserved for what a real booking **cannot** produce:

```
allow → slow (1s: invisible to a human, ruinous to a per-request script)
      → challenge (CAPTCHA: three seconds for a person, the whole attack for a bot)
      → block
```

A merely **foreign** destination is a *challenge*, never a block — refusing a travelling customer to save a few
cents of SMS loses that booking, and the salon never finds out why.

**CAPTCHA is an adapter, and it fails CLOSED.** If a request scores 90, demands a challenge, finds no provider
configured, and is waved through, **the entire risk engine is decorative.** A tenant with no CAPTCHA sees
challenged requests refused — a configuration problem with a loud symptom, which is the only kind worth having.

Screening runs **before** the SMS, because that is while it is still a decision rather than a receipt. And a
`block` returns the **same** message as a normal failure — telling an attacker *"blocked for spraying"* hands them
the threshold to tune against.

### POS screen — the toggle explains itself

`/tenant/communications/phone-verification`, next to **Text Messaging Setup** deliberately: the codes go out on
the *same* Twilio account configured there, and this screen is useless until that one is done. **Side by side
makes the dependency obvious instead of something the owner discovers from an error message.**

The Enable switch is locked until Twilio is connected **and tested** — and it **says why**, with a button that
goes there. A disabled toggle with no explanation is how an owner ends up filing a support ticket; one with a
reason is how they fix it themselves in a minute.

Platform overrides render as **text, not toggles**. *A switch that silently does nothing is worse than no switch.*

Sidebar↔route invariant: **7/7**. pos-web builds clean.

### The monitoring that failed silent

`super-admin-alerts` counted payment-gateway errors with `.catch(() => 0)` — and the very next line is
`if (gwErr > 0)`. **A failed count therefore raised NO ALERT.**

And the moment the database is unhealthy enough to fail that query is *exactly* the moment a gateway incident is
most likely and most urgent.

> **An alerting system that goes quiet when the thing it watches breaks is worse than no alerting system: it
> actively reassures you.**

Now `null` raises its **own** alert — *"Payment gateway health could not be checked."* Because "we cannot see
whether payments are failing" is itself something a human needs to know tonight.

---

## 4n. Phase 13 — I shipped the exact bug I have been finding all day. Twice.

### 1. The fraud engine was DEAD CODE

`assessSendRisk()` — pure, 19 passing tests — was injected as `@Optional() @Inject('BookingRiskCounters')` and
**provided by nothing.** So on every request `this.counters === undefined`, `screen()` returned immediately, and
**not one of those 19 tests described a code path that could ever run.**

That is the easiest bug in this codebase to ship: **everything green, nothing connected.** It is the same class I
spent the day finding in the OCR pipeline, the Service Done badge, and the AI entitlement gate — and I wrote it
myself, an hour after writing the report about it.

Now bound: `KyselyRiskCounters` + `SiteverifyCaptcha` (Turnstile / hCaptcha / reCAPTCHA), both wired in the
module.

### 2. Then the counter query could never be TRUE

The velocity signals read `correlation_id::text = <ip>`. **`correlation_id` is a UUID. An IP is not a UUID.** That
predicate could never match a row, so **every IP-based signal was permanently `0`** — spray detection, scripted
abuse, the lot. Silently disabled, while the tests kept passing.

**This is the Service Done badge, exactly.** A query that cannot be true, returning 0 forever, with nothing to say
it is broken. And it survived `tsc`, the unit tests (which mock the counters), **and my own pgtest** — because
that pgtest asserted the query *runs*.

> **"It runs" and "it can be true" are different claims, and only the second one is worth anything.**

Migration **370** adds `request_ip` + `device_id` to `booking_verification_sessions` — the source was never
recorded *at all*, which is why there was nothing correct to compare against. The controller takes them from the
**request**, never the body: a client that could name its own IP could launder a spray attack past every velocity
rule.

The pgtest now proves the signal can **be true**: three distinct phones from one IP →
`ipDistinctPhonesLastHour === 3`. Before this it was structurally zero.

### Verification

| | |
|---|---|
| `customer-booking` (12 spec files) | **204/204** |
| pgtest against real Postgres | **20/20** |
| `npm run check:sql` | **0 schema errors** |
| `tsc --noEmit` · DI · routes | **0 errors · 192/192 · 0 collisions** |

---

## 4o. Phase 14 — DELIVERED: the Twilio status webhook

**Reused, not rewritten.** `verifyTwilioSignature()` already exists in `messaging-inbound/twilio-inbound-core.ts`
— HMAC-SHA1 over the URL plus every parameter, `timingSafeEqual`. This endpoint imports it.

### The question this endpoint lives or dies on

> **"Which tenant is this callback for?"**

The obvious answer — read a tenant id from the body, or from a query parameter we put in the callback URL — is
**wrong, and dangerously so.** This endpoint is **public** (Twilio is the caller, so there is no session), which
means **anybody on the internet can POST to it.** A tenant id taken from the request is a tenant id **an attacker
chooses**: they could mark another salon's verification as approved, poison their delivery stats, or flip a live
session to `failed` mid-booking.

So the order is:

1. **Resolve the session by the PROVIDER'S OWN identifier** (the Verify/Message SID) — a value useless to anyone
   who does not already know it. **The tenant comes from the row we stored.**
2. **Then verify the signature with THAT TENANT'S OWN auth token.**

Step 2 is only possible *because* of step 1. Each tenant signs with their **own** Twilio credentials — there is no
single platform secret to check against — so **verifying against a key the caller chose would verify nothing at
all.** A test proves a callback signed with tenant B's token is rejected for tenant A.

### It returns 204 for everything

Success, bad signature, unknown SID — all 204. **A 401 tells an attacker their signature guess was wrong; a 404
tells them a SID does not exist. Both are oracles.** Twilio does not care about the status code, and silence
teaches an attacker nothing.

### A late failure never undoes a success

Twilio **retries**, and callbacks arrive out of order. The `failed` write is conditional on
`status NOT IN ('verified','failed')`:

> The customer already typed the code. A delayed `undelivered` callback **about the SMS** does not change that —
> and treating it as if it did would **fail a booking that had already succeeded**, minutes after the customer was
> told they were confirmed.

**224/224 · 276 controllers · 0 route collisions · 0 schema errors · tsc clean.**

---

## 4p. Phase 15 — retention, usage, and a load test that found a real gap

### Retention: we never hold a code, but we were hoarding everything around it

Twilio Verify keeps the code — that is the whole reason it is preferred. So there is **nothing to delete**.

But `booking_verification_sessions` holds a **phone hash, a mask, an IP and a device id, per booking attempt**.
Six months of that is a **durable record of who tried to book where, from what network, and when** — a
behavioural dataset nobody asked us to keep, sitting in a salon's database, waiting to be breached or subpoenaed.
Its only remaining purpose after a day is fraud velocity, which looks back **one hour**.

Sessions are now purged after **7 days** (capped at 90 — a tenant may not choose to hoard this forever). The
**durable** facts survive: "this phone is verified for this tenant", and the aggregate counts.

### Usage: rolled up BEFORE the purge, and that ordering is the point

A `COUNT` over a table we are about to delete is a count that **quietly shrinks every night**. A tenant's monthly
total would fall as the retention window rolled past it — **they would be billed for messages that no longer
appear to exist.**

So the rollup runs first, into `booking_verification_usage_daily` (migration 371), which holds **no phone, no
hash, no IP, no device** — a test asserts those columns do not exist, because rolling the identifying data into a
table we keep forever would defeat the entire purpose.

The rollup **recomputes rather than increments**, so it is idempotent — which matters, because a scheduled job
**will** run twice one day, and an incremented counter would inflate a tenant's bill on every retry.

**pgtest: 24/24.**

### The load test found a real gap — and it is written down, not buried

`scripts/booking-verification-load-test.mjs` exists to test the claims that are only true **under
serialisation**, every one of which had been "proven" by a single caller inserting twice, in order.

| | |
|---|---|
| 50 concurrent holds, one session | **exactly 1 wins** ✅ (49 refused by the database) |
| 50 concurrent confirmations of one hold | **exactly 1 appointment** ✅ |
| **20 concurrent holds, 20 different sessions, same slot** | **all 20 accepted** ❌ |

**The database did not prevent it.** Migration 367's unique index enforces one live hold *per session* — it says
nothing about two customers racing for the same slot. The only thing between them was the service's overlap check,
which **reads, then writes**, and under concurrency a window is not a theory.

**It is not a double-booking** — `uq_booking_holds_appointment` still guarantees one hold becomes one appointment,
so the loser is caught at conversion. But **both customers are told "your slot is reserved", both verify their
phone, and one is refused at the final step after doing everything right.**

**Migration 372** fixes it properly: an `EXCLUDE USING gist` constraint, so the *database* refuses an overlapping
hold. No read-then-write, no window. Half-open ranges, so back-to-back appointments still work.

### VERIFIED — on real PostgreSQL 16

I said this was the one thing I could not verify, and that it should not be trusted until it was. So I installed
a real Postgres rather than leave it as a caveat.

**PostgreSQL 16.14. All 373 migrations apply. 0 failures.** (PGlite could only manage 371 — it lacks `pg_trgm`
and `btree_gist`.)

| | |
|---|---|
| `booking_holds_no_overlap` exists, type `x` (exclusion) | ✅ |
| a second session overlapping the same technician | **REFUSED by the database** ✅ |
| back-to-back appointments (10–11, then 11–12) | **still accepted** ✅ — half-open ranges |
| **20 concurrent sessions racing one slot** | **exactly 1 survives** ✅ |

That last row is the one that matters: it is the exact scenario the load test found accepting **all 20**. The gap
is closed, and closed **in the database**, so no read-then-write window can reopen it.

### And CI now names its own blind spot

`check:sql` runs on PGlite, which cannot load `pg_trgm` or `btree_gist` — so it silently skipped two migrations.
**A checker that quietly skips what it cannot see is the same failure as a `.catch(() => 0)`.** It now says so:

```
NOT VERIFIED HERE (2) -- PGlite lacks the extension; real Postgres applies these:
  107_pos_search_indexes.sql
  372_booking_hold_no_overlap.sql
```

**218/218 · 371/373 migrations apply · 0 schema errors · tsc clean.**

---

## 5. Honest status — this is NOT done

The spec runs to 40 report sections, 10 channels, fraud detection, CAPTCHA, webhooks, background queues, and
load testing. **I have built one piece of it.** I am not going to claim otherwise.

**Remaining, in dependency order:**

1. ~~Booking holds~~ — **done** (pure core + schema). Still needs: the DB-backed repository, the service, and the
   expiry sweep job.
2. **Verification session service** — bind a hold + a phone + a tenant, reusing `customer-activation-core` for
   the OTP mechanics (schema is in place).
3. ~~Gate every remote channel~~ — **done.** Customer app, public booking page, and AI receptionist all refuse
   an unverified booking, through one shared guard.
4. ~~Twilio Verify + send/check loop + Postgres wiring + HTTP routes~~ — **done.** It runs.
5. ~~Tenant settings~~ (backend done; **POS screen still to build**) · Super Admin oversight · fraud/CAPTCHA ·
   webhooks · queues · load tests.

**One thing I want to flag now, not later:** the AI receptionist requirement to keep a spoken code out of
transcripts, recordings, prompts and summaries is the hardest security requirement in this spec — and
`ai-voice-transcription-redaction.ts` already exists, which is where it should be solved, not in a new module.
