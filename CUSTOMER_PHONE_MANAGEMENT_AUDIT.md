# customer_phone_number_management — AUDIT + Phase 1

**Status:** audited; canonical core built and tested (32/32). Not done — see §5.

---

## 1. The audit produced one finding that determines the entire design

```sql
-- migration 366
customer_identities.normalized_phone  TEXT NOT NULL UNIQUE
```

…and it is **the login credential**:

```ts
// auth-user.kysely.repository.ts
select * from customer_identities where normalized_phone = $1   -- this is how a customer signs in
```

Meanwhile `customers.normalized_phone` is **not** unique.

At first this looks like a **contradiction** with the spec's *"support shared family phone numbers."* It is not.
It is **the resolution**:

| | |
|---|---|
| **Identity phone** | a **CREDENTIAL**. Unique, because two accounts on one login is an ambiguous login. Changing it changes *how somebody signs in* — so it demands verify-first, reauthentication, token rotation. |
| **Customer phone** | a **CONTACT NUMBER**. Not unique, and must not be. **This is where shared family phones live.** |

A mother and daughter at one salon share a contact number; **only one of them has an app login on it.** Keeping
those two things apart is the whole architecture. Conflating them would either break family bookings or hand an
attacker somebody else's login.

## 2. What exists

* **`customer_identities` + `customer_identity_links`** — the central directory (identity → tenant → user →
  customer). Exists, and is the thing to synchronise to.
* **`customer_booking_phone_verification`** — the module built earlier today: tenant-owned Twilio, hashed OTP,
  `booking_verified_phones`, policy resolver. **This plugs into it; it does not duplicate it.**
* **`customer-activation-core`** — E.164 normalization, masking, secure OTP, hashing, attempt limits,
  enumeration-safety. Imported, not rewritten.

## 3. What does NOT exist

**No code anywhere updates a customer's phone number.** Not from the POS, not from the app. A repo-wide search for
an update path found exactly one hit, and it was for *branch manager* contact details.

`customers` has no verification status, no version column, no phone history. The spec's status model —
`active_verified` / `pending_verification` / `replaced` / … — has nothing to build on. This is **green-field.**

## 4. Phase 1 — DELIVERED: the canonical core (32/32)

The spec's first rule is the right one:

> *"Do not allow each frontend to update customer phone numbers independently using separate business logic."*

Two frontends with two rule sets is two rule sets that **drift**, and the fraud moves to whichever drifted first.
So `customer-phone-core.ts` is **pure**, and the same functions answer for the receptionist and the customer.

### The rules that matter, and why

**An unverified number CAN be texted, but CANNOT complete a booking.**
Obvious once said, easy to get wrong. If an unverified number could not be texted, it could never *become*
verified — the verification SMS is exactly the message it must be allowed to receive. But if it could satisfy the
booking gate, **the phone-change flow would be a way around the entire verification module**: change your number
to the victim's, and book as them without proving anything.

**A manually confirmed number is NOT an SMS-verified one.**
It produces `active_unverified` and the label *"Manually confirmed — OTP not completed"*. Calling it "SMS verified"
would **launder a manager's judgement into cryptographic evidence**. It is usable, and it is honest about never
having been proven — and it therefore **cannot complete a booking verification either.**

**A verified change is never lost.**
A sync failure *after* activation goes to `synchronization_failed` — **retryable, and still `isProven`**. The
customer answered the SMS; that fact is banked. A crashed job does not un-happen it, and sending them back to the
start would make them re-verify a number they already proved, **for a failure that was never theirs.**

**Duplicates are classified, never auto-merged.**
A salon's customer list is *full* of shared numbers — a mother books for her daughter, a husband's number is on his
wife's record. **Auto-merging destroys real people's histories**; refusing the update outright makes the salon
unable to record the truth. So: same name → `probable_duplicate` (flagged, not merged). Different name →
`phone_in_use`, and staff are *asked* whether it is a family phone. Three people → **a manager**, because a
receptionist under time pressure should not be deciding whether that is a family or a mess.

The warning **masks the other customer's name** (`Bob D.`) and carries **no phone number** — a duplicate warning
must not become a customer directory.

**The customer app verifies FIRST. This is the whole safety argument.**
The customer is **alone with their phone**. If they mistype a digit and we swap the number immediately, we have cut
them off from their own account **and from every future code — including the one that would let them fix it.** The
old number stays live until the new one answers.

Staff-assisted may save `pending_verification`, clearly labelled — the customer is *standing right there*, a
receptionist who mistypes can retype, and the salon needs to record what it was just told even if the SMS never
arrives.

**Neither flow can make an unproven number `active_verified`.** That line does not move.

**A receptionist cannot manually confirm, resolve a duplicate, or merge.** **Platform support cannot edit a
tenant's customer at all** — support goes through the audited support workflow, where it can be seen.

---

## 5. Phase 2 — DELIVERED: schema + the canonical service (57/57)

### Migration 373

| | |
|---|---|
| **`customer_phones`** | the status model. `customers` had a single `normalized_phone` and **no status at all** — and a boolean cannot express the difference between *"verified"*, *"we have not asked yet"*, and *"we asked and it failed"*, which demand completely different behaviour. |
| **`customer_phone_update_sessions`** | one attempt to change a number. **This is what a code is BOUND to** — without it, a code sent for one change could complete a different one, which is the replay the spec names by hand. |
| **`customers.record_version`** | optimistic locking. |
| **`tenant_customer_phone_settings`** | per-tenant policy. |

**Constraints that carry real weight:**

* `uq_customer_phones_one_active` — **one active number per customer.** A customer with two "active" numbers is a
  customer whose booking codes go to a **coin toss.**
* `uq_customer_phones_one_pending` — one pending number. Otherwise two half-finished updates race and **an old
  code completes a newer change.**
* `uq_cpus_one_open` — one open update per customer, same reason.

The old number is **not deleted** — it is marked `replaced` and points at what replaced it, so historical
appointments keep their original contact reference.

### The canonical service

The spec's first rule is right, so it is the design: **one service, both frontends.** The receptionist and the
customer call the *same* code, and the difference between them is **one parameter** the pure core turns into a
policy — not a second implementation.

**Reused, not rewritten:** normalization/masking/hashing ← `customer-activation-core`; the six-digit code and
tenant-owned Twilio ← the **booking-verification module built earlier today** (Twilio Verify holds the code; we
never possess one).

### What the tests pin

* **Starting an update never touches the active number.** There is no path from `start()` to activation without a
  proven code.
* **A stale profile screen is REFUSED, not allowed to clobber.** Two receptionists, two tills, one customer, one of
  them looking at a screen from five minutes ago. The error carries the *current* version so the UI can refresh
  rather than guess.
* **The code is bound to the session.** You cannot open an update for your own number and have the code sent to
  someone else's, and you cannot check a code against a different number.
* **A missing Twilio does not destroy the update** — the pending number survives and the send is resumable.
  Twilio being down is not the customer's fault.
* **A verified change is never lost.** A sync failure still activates the number and reports
  `synchronization_failed` (retryable). A **stale record** refuses rather than clobbers — *and the verification
  survives*, because the customer really did prove that number.
* **Manual confirmation is a JUDGEMENT, not proof.** OFF by default · managers only (**a receptionist is exactly
  who a social engineer calls**) · a reason required · produces `active_unverified` and the label *"OTP not
  completed"*, **never "SMS verified"** — labelling a manager's judgement as cryptographic evidence is how the
  manual path quietly becomes the normal path.
* **Audits carry a MASKED number.** A full phone number in an audit message is a phone number in a log aggregator,
  a slow-query trace, and a support ticket.
* **Duplicate warnings mask the other customer's name** — a warning must not become a directory.

### A failing test taught me a real guarantee

My first draft called `verify()` without ever calling `sendCode()`. The service **refused** — correctly. Accepting
a code for a verification that was never initiated would let a caller *"verify"* a number **nobody ever texted**,
which is the whole control turned inside out. It is now pinned as its own test.

---

## 6. Honest status — NOT done

Built: the **pure core** (32/32) · **migration 373** · **the canonical service** (57/57 total). tsc clean, 0 schema
errors.

Not built:

1. **The Kysely drivers** — `PhoneStore` and `SyncPort` are interfaces with no implementation. **Nothing persists
   yet.**
2. **Synchronisation** — tenant customer, central identity, caller-ID/AI-receptionist lookup, reminders. Plus the
   **background retry** for the `synchronization_failed` state the core already models.
3. **Routes, POS UI, customer-app UI, tenant settings, Super Admin oversight.**
4. **The identity-phone change is the sharp one**, and is deliberately still not built: it is a **login
   credential**, so it needs reauthentication, token rotation, and a security notification to the **old** number.
   Getting it wrong is **account takeover**, not bad UX — and it is the one piece here I would not rush.
