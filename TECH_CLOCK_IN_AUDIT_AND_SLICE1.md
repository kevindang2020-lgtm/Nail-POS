# Technician Clock-In/Out on Go Check-In — audit, plan, and Slice 1

You asked me to check whether this is finished and fix the bugs. The honest finding after auditing the real code:
**it isn't finished — the PIN-based technician clock-in is largely unbuilt.** So this is a build, not a bug-fix. Below is
what actually exists, what's missing, the plan, and the first (security-critical) slice, already built and verified.

## What already exists (and is reusable)
- **Customer** check-in on Go Check-In — the kiosk UI (`customer-display/GoCheckIn.tsx`) and its public backend
  (`go-check-in` module: sessions, phone lookup, appointment/walk-in check-in). This is the customer flow, not the
  technician one.
- **A POS/manager time-clock** — `time-clock` module at `/pos/time-clock` with a screen in pos-web. A manager clocks a
  technician in/out **by technicianId**, permission-gated (`pos.technicians.manage`). Its service already uses
  **authoritative server time** and has a **duplicate guard** ("already clocked in" / "not clocked in"). This is
  reusable as the actual attendance write underneath a PIN flow.

## What's missing (the spec's actual ask)
- **No Clock PIN exists anywhere** — no table, no hash, no concept. (So there's nothing using phone-suffix digits to
  "upgrade," either — it simply isn't there yet.)
- No **technician clock-in mode** on the Go Check-In device.
- No PIN-driven **identify / attendance-status / clock-in / clock-out** kiosk endpoints.
- No **manager clock-PIN reset** or **timecard adjustment** endpoints.

## Plan (vertical slices, security foundation first)
1. **Secure Clock PIN foundation** — hashed per-technician PIN + rate-limited verify. ✅ **done, this delivery.**
2. Persistence (kysely repo) + DI module, and **identify-by-PIN**: scan the device branch's active technicians, match
   the entered PIN against candidate hashes → exactly one match, else a safe "no match" / "duplicate match" (never a
   technician list).
3. Kiosk **endpoints** (device/session-token bound) wiring to the **reused** time-clock service, with an idempotency key
   so a double-tap can't create duplicate punches.
4. **Clock-out guard**: block when the technician has an active service / open ticket, with a clear reason.
5. Go Check-In **UI**: mode selector + numeric keypad + the real technician card (avatar, shift, status).
6. **Manager** clock-PIN reset + timecard adjustment (preserve the original, add an adjustment record + reason + audit).
7. **Multi-salon**: attendance always recorded under the device's server-bound tenant/branch.

## Slice 1 (built + verified): secure Clock PIN foundation
Self-contained domain primitive with **no HTTP surface yet** — nothing half-exposed.
- **Migration `398_technician_clock_pins.sql`** — a `technician_clock_pins` table keyed by `(tenant_id, technician_id)`.
  It stores a **hash only** (never plaintext), plus rate-limit state (`failed_attempts`, `locked_until`). Tenant-scoped,
  so a global technician working at several salons has a distinct PIN per tenant — matching "global account shared,
  attendance salon-specific."
- **`clock-pin-core.ts`** (pure) — PIN must be exactly four digits; trivially-guessable PINs (`0000`, `1234`, …) are
  refused at set-time; and a rate-limit state machine locks the PIN for 15 minutes after 5 wrong attempts (and resets
  the counter after the lock, so it's not permanently one-away).
- **`TechnicianClockPinService`** — `setPin` validates then **hashes with the same vetted hasher used for passwords**;
  `verifyPin` refuses to compare while locked, advances the lockout on a wrong PIN, and clears it on success. It returns
  a generic result (`no_pin` / `mismatch`) so a caller can surface a safe error without revealing whether a PIN exists.

### Verified (in-sandbox)
api **`tsc` 0**, **`check:sql` passes** (migration parses), and the module's tests pass **10/10**: format + weak-PIN
policy, the lockout state machine (locks at the threshold, unlocks after the window), hash-stored-not-plaintext,
correct-vs-wrong verification, the no-PIN case, an end-to-end lockout-then-recovery, and tenant scoping.

## Honest remaining limitations
This is Slice 1 of 7 — the secure foundation. The technician cannot yet clock in from a device: the identify-by-PIN
lookup, the kiosk endpoints + UI, the clock-out active-service guard, and the manager reset/adjust flows are the next
slices (all listed above). Nothing here is wired to HTTP yet, by design — the PIN primitive is proven first, then
exposed.
