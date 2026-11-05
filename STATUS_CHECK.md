# AI PowerSalon — Status check across everything you sent

> **Historical status check (Jul 29 2026) — superseded Oct 10 2026 (BUILD_PLAN Phase 15).** Current state lives in
> `CONSTITUTIONS_STATUS_2026-10-08.md`, `BUILD_PHASES_REPORT.md` and `docs/PROGRAMME_DOD_STATUS.md`; the entry point is
> `START-HERE.md`. Re-checked against the code on Oct 10:
> - **Platform health table** — July figures. Today: 558 migrations at the start of Phase 15 (`apps/api/db/migrations`; Phase 15 adds a few), 2,878 routes
>   (`apps/api/openapi/manifest.txt`, `check:openapi`), every gate in `tooling/ci/run-gates.mjs`.
> - **"Honestly still open" item 1, `customer_phone_number_management` — now built:** the customer-app screen
>   (`apps/customer-web/src/screens/ChangePhoneScreen.tsx`), tenant settings (`/pos/settings/customer-phone`, per
>   branch), Super Admin oversight (`apps/admin-web/src/screens/CustomerPhoneOversightScreen.tsx`,
>   `/super-admin/customer-phone/oversight`), and the login-phone change (`POST /customer/profile/phone/login-number`,
>   `modules/booking/src/customer-phone/customer-phone-app.controller.ts`: re-authentication with the current password,
>   a number already proved by SMS, the OLD number notified before the change, every session revoked after it).
> - **`tenant_safety_community`** — completed in BUILD_PLAN Phase 8 (see `SAFETY_COMMUNITY_PHASE1.md` note); the
>   "161/161 tests · 25 routes" figures are July's.
> - Paths: since Constitution 13 most backend code is in `modules/*/src`, not `apps/api/src`.
> The July text below is kept as written.


I measured rather than assumed. Here is what is actually finished, and what I fixed.

---

## Platform health (measured now)

| | |
|---|---|
| `tsc --noEmit` (API + all 5 web apps) | **0 errors** |
| `npm run check:sql` (every raw SQL statement vs the real schema) | **0 errors** |
| DI graph | **193/193 modules reachable, 279 controllers** |
| Route table | **2,210 routes, 0 collisions** |
| Migrations | **372/374 on PGlite · 373/373 on real PostgreSQL 16** |

---

## The five specs

| Module | Status |
|---|---|
| `customer_booking_phone_verification` | **Built.** Gated on all 3 remote channels, tenant-owned Twilio, DTMF + transcript redaction, holds, fraud/CAPTCHA, Super Admin oversight, webhooks, retention. |
| `customer_phone_number_management` | **Built** (canonical service, schema, drivers, POS flow). **Customer-app screen + Super Admin oversight still open.** |
| Multi-Salon Owner Platform (image 1) | **Built.** Salon switcher, portfolio overview, Super Admin owner panels, Add Salon, Invite User. |
| `tenant_safety_community` | **Verified. 161/161 tests, 25 routes, 30 files.** See below. |
| AI Receptionist | **Built** (voice-booking, DTMF verification, transcript redaction). |

---

## What I FOUND UNFINISHED and fixed today: the Technician login (images 2 & 3)

I checked your image against the code, item by item. **It was 9 of 12 short.**

```
MISSING  Welcome Back            MISSING  Face ID
MISSING  TECHNICIAN APP          MISSING  Today's Schedule
MISSING  Email or Mobile         MISSING  Client Queue
MISSING  Remember Me             MISSING  Earnings
                                 MISSING  Secure technician access
```

**Now 12 / 12.** tech-web builds clean, **97/97 tests pass.**

### The important part: Face ID was REUSED, not rebuilt

Your spec says it plainly — *"Do not build a second biometric authentication system. Use my existing Face ID code."*

You already had a **complete, correct one** in the customer app:

```
customer-web/src/auth/faceid.ts          native biometrics OR WebAuthn, per platform
customer-web/src/auth/native-faceid.ts   iOS Keychain
customer-web/src/api/webauthn.ts         → /auth/webauthn/* (backend already exists)
```

And its own header already states the rule that matters:

> **"a biometric success is not authentication"**

The native path revalidates the unlocked token against the backend; the WebAuthn path has its signature verified
server-side. **Neither can mint a session on the client.** So a stolen phone with a spoofed face still gets
*nothing* unless the server agrees the technician is active, employed, and assigned to that salon.

I ported those three files into `tech-web` **unchanged** and wired the button. Building a second biometric system
would have meant a second set of those rules — **and the weaker one is the one an attacker would use.**

### Three decisions worth naming

* **`authApi.me()` IS the revalidation.** The biometric unlocks a token; the *server* then says whether it still
  belongs to an active, employed, assigned technician. **A technician who left last week still has their face.
  They do not still have a session.**
* **A cancelled Face ID is not a failed login.** Showing it as an error trains people to ignore real errors.
* **The Face ID button only appears when the platform can actually do it.** A button that always shows and always
  fails teaches people the feature is broken.
* **The security footer claims something, so it has to be true.** It is: httpOnly-cookie or Keychain-bound
  sessions, a biometric that cannot mint one, and an employment re-check on every sign-in. I did not add claims
  about encryption or controls the platform does not implement.

**Every existing flow was preserved** — salon code, MFA, branch selection, password reset, native token storage.

---

## `tenant_safety_community` — audited, and it holds up

**161/161 tests · 25 routes · 30 files.** I checked whether the spec's *required proofs* are actually asserted, not
just whether tests exist. They are, including the hard ones:

* *"a community post can **NEVER** auto-deny service (hard invariant)"*
* *"**BLOCKS** payment card + SSN (cannot publish)"* · *"REDACTS + flags customer phone and email"*
* *"a private incident is **NEVER** visible to another tenant (no moderation case)"*
* *"a moderator reaches a private incident **ONLY** under an explicit audited case"*
* *"the moderator who removed the post **cannot decide the appeal** against it"*
* *"the model never sees raw customer PII — only the redacted text"*
* *"private incident never auto-promotes to advisory"*
* identity-prober detection pauses search entirely

---

## The bug I hunt most — and a checker that was lying about it

The most common bug in this repo is a module that is **built, fully tested, and never wired.** An `@Optional()`
dependency with no provider fails **silently**: the feature never runs, forever, and **every test still passes**,
because the unit tests construct the service by hand. `tsc` cannot see it — the token is a string.

**I have shipped it twice.** So I scanned the whole API: **34 injected tokens, 201 providers, 1 flagged.**

`CustomerBookingService` carried `@Inject('BookingVerificationGate')` for a dependency the module supplies
**positionally via `useFactory`** — which Nest ignores for factory-created providers. It was **inert, but it was a
lie in the code**: the next person to read it would conclude the gate was unwired and either "fix" a working thing
or assume the whole feature was dead. Removed.

### And then the checker itself turned out to be blind

I wrote `check:di`, it said OK — so I tried to **prove** it by deliberately unwiring the fraud engine.

**It still said OK.**

Its comment-stripping regex hit a `/*` inside a string literal, opened a fake block comment, and **swallowed the
real code — including the `@Inject` it was looking for.** It was reporting a green light on a codebase where I had
just cut a wire.

> **A checker that reports OK when it is blind is worse than no checker: it is a green light with the wires cut.**

Fixed (skip comment *lines*, which cannot misfire), and then **proven**: unwire the fraud engine → **exit 1, names
the token**; restore → passes. **Now in CI.**

**I only found it because I tried to break it instead of trusting it.**

---

## Honestly still open

1. **`customer_phone_number_management`** — the customer-app screen, tenant settings, and Super Admin oversight.
   And the **identity-phone change**, deliberately unbuilt: `customer_identities.normalized_phone` is a **login
   credential**, so changing it needs reauthentication, token rotation, and a notification to the *old* number.
   Getting it wrong is **account takeover**, not bad UX.

2. ~~`tenant_safety_community`~~ — **audited and it holds up.**

3. **The thing I keep saying, and mean:** roughly **7,000 lines** were written across these modules and **no human
   has read any of it.** Before more surface area, run `npm test` and read the diffs.
