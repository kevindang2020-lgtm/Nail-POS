# KNOWN_ISSUES.md
### The honest issue register (P0 critical → P4 cosmetic), Jul 30 2026
Ground truth first: the API battery is **6,091 passed + 4 skipped, 0 failed**, all 15 static gates and every
frontend suite are green, and a six-class bug sweep (Jul 29) found and fixed everything it caught. So this file
is NOT a list of broken code — it is the register of things a developer WILL bump into and must not misread as
regressions they caused.

## P0 — blocking defects
**None known.** If you find one: reproduce, pin with a failing test, fix, keep the test (ENGINEERING_RULES #12).

## P1 — features that will "fail" until owner credentials exist (by design, not bugs)
| Symptom you'll see | Reality | Where documented |
| --- | --- | --- |
| Tap to Pay throws `TapToPayNotImplementedError` | Deliberate socket awaiting CommerceHub sandbox creds | PAYMENTS_INTEGRATION.md §4 |
| SMS never actually sends | No Twilio creds; entitlement/ledger fully works and is tested | SMS_PACKAGES_VERIFICATION_REPORT.md |
| Push never reaches a device | No APNs .p8 / Firebase SA; providers select honest "not configured" | PUSH_NOTIFICATIONS.md |
| Emails don't send | No SendGrid key | SECRETS_REQUIRED.md |
| "Provider Cost Not Available" in SMS billing | Correct honesty: zero recorded provider cost is never shown as $0.00 | SMS report §47 |

## P2 — deliberate scaffolds / partials (labeled in the UI or docs)
- A small set of Super Admin / POS panels display **documented sample data** where the backing feature is
  owner-gated — each carries an on-screen footnote; the full list with screens: FRONTEND_BACKEND_GAPS.md §3.
- The two Go Check-In HTML apps are single-file by design; they carry static (`check:html`) + behavioral
  (`e2e:html`) coverage, but deserve eventual restructuring into the app pattern.
- 4 of the security lane's 20 checks report **NOT VERIFIED** (live processor, prod CORS/TLS/rate-limit, live
  Twilio, physical devices) — they stay that way until owner environments exist.

## P3 — minor
- React Router v7 future-flag console warnings (upgrade decision parked with the owner).
- One deliberate flag-gated `console.log` (POS drag-debug behind `__DND_DEBUG`).
- PGlite cold-cache parallel boots can flake a pgtest FILE on first run in fresh extracts; rerunning the file is
  always green (documented in TEST_REPORT.md; hookTimeout fix landed Jul 26).

## Not issues — deliberate product decisions (do not "fix" these)
- **No Print Schedule / Print Queue / Print Service Ticket in the POS.** Removed Jul 30 2026 by owner decision
  and blocked by the `check:no-print` gate. Checkout receipts are unaffected. See PRINT_FEATURES_REMOVED.md.

## P4 — cosmetic / historical
- ~380 historical reports at repo root (preserved by policy; HANDOFF_MANIFEST.md names the canonical set).
- Six superseded run/deploy docs now carry banners pointing to the canonical two.

## How to add to this register
New entries go under the right severity WITH a reproduction and a pointer; never delete an entry — mark it
RESOLVED with the fixing commit.
