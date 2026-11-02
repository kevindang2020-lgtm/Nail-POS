# BOOKING_PAGE.md

> **Oct 10 2026 (Constitution 13 §388, BUILD_PLAN Phase 15):** `apps/booking-html` was REMOVED. Signed-in customers book in
> **customer-web → Book** (`BookScreen.tsx`, same `/customer/booking*` routes, plus phone verification and an idempotency key);
> the no-login page is `apps/booking-public` (below). The sections about `booking-html` are kept as history — recover the
> file with `git checkout 62a1875d -- apps/booking-html` if ever needed.
### `apps/booking-html/index.html` — the public online-booking page (single file)

## What it is
One self-contained HTML file (no build step, no framework) that lets a salon guest **create an account or sign
in, pick a service, technician and date, see real open times, and book** — against the EXISTING customer
booking API. No backend was added for it; it reuses `/customer/auth/register`, `/auth/login`,
`/customer/booking/options`, `/customer/booking/availability`, `/customer/booking`, and the two
`/customer/booking/verification/*` routes exactly as they are.

## How to deploy / point it at an API
Copy the file to any static host (or serve it from the marketing site). The API base is configurable —
never hardcoded: `?api=https://api.yoursalon.com` or set `window.APS_API_BASE` before the script runs.
Same-origin (served by the API host) needs no parameter at all. **Cross-origin use requires the page's origin in
`WEB_CORS_ORIGINS`** — the API sends credentialed cookies, which the browser discards otherwise.

## What it handles (all live-verified)
- **Register + sign in.** Registration takes the salon code (e.g. `PILOT01`), name, phone, email, password.
  Login uses `portal: 'customer'` + `identifier` — the customer portal is a role-FILTERED lookup; without the
  portal field the API runs the tenant branch and a guest cannot sign in.
- **Service / technician / date → real availability.** Unavailable slots render disabled; booked times
  disappear on the next load (verified: booking 09:00 dropped the open count from 19 to 17).
- **Phone verification (HTTP 428).** If the tenant's policy requires it, the page shows the MASKED phone,
  takes the code, supports resend, and retries the same booking after `verification/check` succeeds.
- **Honest failures.** 409 (slot just taken) reloads times and says so; 503 (verification required but
  unavailable) tells the guest to call the salon rather than pretending the booking worked.

## How it is protected from regressions
- **`check:html`** (gate 13) — this file is the third app in that gate: script parses, every element reference
  exists, API base stays configurable, no credentials. (Adding it taught the gate the `$('id')` idiom.)
- **`e2e:html`** — a full REAL-Chromium journey: register → options → availability → slot → book → 428 → code →
  verify → retry → confirmed, with the payload asserted **server-side** by the stub and call ORDER checked.
  Sabotage-proven: drop one field from the booking payload and the run fails.

## Live verification (Aug 3 2026)
Run against a real PostgreSQL 16 + the real API (not a stub): registered a fresh guest, listed the seeded
services, loaded availability, booked twice — **rows land in `pos_tech_appointments` (`booked`)** and the
confirmation shows service · date · time · technician.

## Two real defects this page's live run exposed (both fixed)
1. **The API could not boot** — `SmsReconciliationScheduler` was registered as a bare class whose defaulted
   `() => Date` parameter Nest cannot resolve. 6,091 unit tests never caught it because they construct services
   directly. Fixed by factory registration; now permanently gated by **`check:boot`** (gate 15), which
   instantiates the real AppModule after a rebuild — see below.
2. **Technician names rendered as `undefined`** — the API returns `fullName`, the page read `.name`. Fixed, and
   the harness stub now uses the real field name so the two cannot drift again.

## The gate that came out of this
**`check:boot`** — `npm run check:boot` rebuilds and instantiates the real Nest AppModule. `check:di` is a
STATIC token check (every injected token has a provider); it passes on a module that cannot actually be
constructed. A boot check script existed in the repo but was wired to nothing. It is now gate 15 and runs in
the CI security lane at CRITICAL. Sabotage-proven against the exact bug above.


---

# The NO-LOGIN guest page — `apps/booking-public/index.html`
### Aug 3 2026 — book with a name and a phone number, no account at all

## Which page do I use?
| | `booking-html/index.html` | `booking-public/index.html` |
| --- | --- | --- |
| Guest needs an account | **Yes** (register or sign in) | **No — nothing to sign into** |
| Trust comes from | session cookie | the **signed link** the salon generates |
| Best for | returning customers, wallet/loyalty later | a "Book Now" button on the website, Google/partner links, QR codes |
Both book into the SAME engine and land in `pos_tech_appointments`.

## How to create the link (owner/Super Admin)
1. Set `AI_BOOKING_LINK_SECRET` (and `PUBLIC_BOOKING_BASE_URL` for a ready-made URL) — SECRETS_REQUIRED.md.
2. `POST /super-admin/tenants/:tenantId/ai-booking/link` with `{ "source": "ONLINE_BOOKING", "ttlDays": 30 }`.
   Partner links use `PARTNER_BOOKING_LINK` + `partnerId`, and may restrict `allowedServiceIds`.
3. The response's `bookingUrl` is the page's address: `…/book?t=<token>&s=<salonId>`. Host the file at that path
   (add `&api=` if the API is on another origin, and put that origin in `WEB_CORS_ORIGINS`).
`t` is the credential — the API verifies its signature, expiry, and revocation server-side. `s` is only the
public salon id, used to list services through the existing public discovery endpoint.

## What it does
Lists the salon's services → guest picks a service and date → open times come from the signed availability
search → guest picks a time, types **first name, last name, mobile** → books. Every write sends `confirm: true`
(the API refuses unconfirmed writes) and a fresh **idempotency key**, so a retry can never double-book.

## Honest outcomes it renders (each a real API code, none invented)
`PHONE_VERIFICATION_REQUIRED` (this salon verifies numbers — call the salon) · `PHONE_VERIFICATION_UNAVAILABLE`
(refuses rather than skipping the check) · `INVALID_PHONE` · `APPOINTMENT_CONFLICT` (time just taken — reloads
times) · `SERVICE_NOT_BOOKABLE` (partner link restriction) · expired/revoked link (401) · rate limited (429).

## Safety properties (inherited, not invented)
No session, but not unprotected: signature + expiry + **per-tenant rate limiting** so one salon's link can never
exhaust another's budget, **targeted revocation** (kill one link without rotating the secret), partner service
allow-lists, and the phone-verification gate — the public link is precisely the channel that gate exists for.

## Protection from regressions
`check:html` (4th app) + a full **real-Chromium guest journey** in `e2e:html`: services → availability → slot →
details → refused-with-verification → retry → confirmed, asserting server-side that `confirm` and the
idempotency key are sent, and that **no login call happens**. Sabotage-proven (drop `confirm: true` → run fails).

## A real bug this page found (fixed, Aug 3 2026)
`AiBookingMutationService.mapError` did not know the three phone-verification errors, so every verification
refusal on the public link came back as **`INTERNAL_ERROR` — "The booking action could not be completed."** The
guest was told a server fault instead of the one thing they could act on, and the conversion funnel recorded
internal errors instead of the real reason. Now mapped to `PHONE_VERIFICATION_REQUIRED` /
`PHONE_VERIFICATION_UNAVAILABLE` / `INVALID_PHONE`, pinned by three tests.

## NOT VERIFIED
The end-to-end run against a real minted token was NOT executed here (it needs `AI_BOOKING_LINK_SECRET` set and
a link minted through Super Admin). The browser journey covers the page's behavior against the documented API
contract; the live-stack proof for the signed-link path remains for the developer — DEVELOPER_TASKS APS-011.
