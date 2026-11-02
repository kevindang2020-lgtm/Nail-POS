# PRINT_FEATURES_REMOVED.md
### Owner decision, Jul 30 2026 — AI PowerSalon does not print schedules, queues, or service tickets

**To the developer taking over: this is not missing work. Do not build it. Do not wire it back.**

The owner (Kevin) has decided these features are not part of the product. Three POS controls were removed on
Jul 30 2026, and a permanent build gate now prevents them from returning.

## What was removed (4 controls, all in the POS)
| Control | Screen | File | What it did |
| --- | --- | --- | --- |
| **Print Schedule** | Booking | `apps/pos-web/src/screens/POSBookingScreen.tsx` | Opened the browser print dialog (`window.print()`) on the booking screen |
| **Print Queue** | Tech Queue | `apps/pos-web/src/screens/POSTechQueueScreen.tsx` | Opened the browser print dialog on the queue screen |
| **Print Service Ticket** | Serving | `apps/pos-web/src/screens/POSServingScreen.tsx` | Placeholder — displayed "Service ticket printing isn't connected yet" and did nothing |
| **Print Service Ticket** | Service Done | `apps/pos-web/src/screens/POSServiceDoneScreen.tsx` | Same placeholder |

No backend, route, service, repository, table, permission, or realtime event existed for any of them — they
were frontend-only. Nothing else changed; removal was four deleted lines.

## What is NOT affected — receipts still work
Checkout **receipt** delivery is a separate, wanted feature and is untouched, including the `print` receipt
channel in `POSCheckoutScreen.tsx` / `CheckoutTicketInner.tsx`. The gate below is written specifically so
receipts keep passing.

## The gate that keeps them out
`apps/api/scripts/check-no-print.mjs`, wired as **`npm run check:no-print`** — the 14th static gate, and part
of the `security:fast` lane that runs in CI on every push. It fails the build on:
1. any control label matching print + schedule / queue / service ticket / serve ticket / ticket list /
   tech queue / customer queue, in any app or shared package; and
2. any `window.print()` / `document.execCommand('print')` in a frontend — the mechanism itself.

The gate was verified by re-adding a Print Queue button and confirming it fails with the file and line number,
then removing it again and confirming green. It is not decorative.

## If someone asks for it later
That is a product conversation with the owner, not a developer decision. If the owner ever reverses this, the
reversal is: remove the gate from `GATES` in `scripts/security-audit.mjs` and from the gate list, delete
`check-no-print.mjs`, and build the feature properly (a print view is a real feature: layout, page breaks,
tenant branding, permissions) — not by restoring a `window.print()` call on a POS screen.

Related: ENGINEERING_RULES.md rule 17 · KNOWN_ISSUES.md (why "no print button" is not a bug) ·
REMAINING_WORK.md (explicitly not on the list).

### Re-confirmed Oct 26 2026
The Oct 23 200-Technician mandate (§6 / §54) asked for a Print Schedule control at 200 technicians. Kevin re-confirmed
this decision on Oct 26 2026: the POS still does not print schedules. The built implementation is parked in commit
02906764 and was backed out in b72d7d9c; `check:no-print` stays.
