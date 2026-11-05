# FRONTEND_BACKEND_GAPS.md
### Where the frontend and backend don't fully meet — measured, both directions

## 1. What the gates already guarantee (so you don't re-audit it)
- **Zero dead controls**: `check:dead-client` fails on any frontend API-client method with no caller, and the
  Jul-27 per-screen audit + fake-control detectors removed every button that didn't really act.
- **Zero orphan calls**: `check:crosswire` proves every one of the frontends' API calls (1,941 at last full
  count) matches a real route — a frontend cannot call an endpoint that doesn't exist.
- **Zero unreached screens**: `check:nav` + `check:unreached` prove every screen is navigable.
So the classic gap classes are structurally closed. What remains is the two honest lists below.

## 2. Backend exists, frontend doesn't call it (wire-or-document set)
`UNUSED_ROUTE_INVENTORY.md` catalogs every route with no static frontend caller — mostly: super-admin depth
endpoints kept for parity, export/report variants, and API surface built for flows whose UI consolidated. Rule:
**wire it or keep it documented — never delete silently** (removals must go through the inventory with a note).
When adding a screen, check the inventory first: the endpoint you need may already exist (reuse-first).

## 3. Frontend shows documented sample data (owner-gated backing)
Each of these renders labeled sample/placeholder content with an on-screen footnote, because the real data
source is credential- or decision-gated:
| Screen / panel | Why | Unblocks when |
| --- | --- | --- |
| POSAccountScreen — subscription/usage side panels | Billing display finalization pending owner pricing decisions | SMS pricing + plan pricing set |
| SMS billing — provider cost column | Provider cost honesty: zero recorded ≠ $0.00 | Twilio creds + real traffic |
| Push delivery status detail | No live provider | APNs/Firebase creds |
| Live processor settlement figures | Sandbox only | Fiserv production onboarding |
The gate suite forbids UNLABELED fake data — if you find sample content without a footnote, that IS a bug; file
it in KNOWN_ISSUES.md.

## 4. Device-only verification pending hardware
Touch-target/viewport work for the ASUS V470 27" POS is code-complete and audited at 1920×1080, but the
physical-device checklist (in the ASUS migration notes) needs a human at the actual screen. Same for iOS
Face-ID flip and store-build smoke tests (Mac required).

## 4b. Removed rather than wired (Jul 30 2026)
Two "Print Service Ticket" controls (Serving, Service Done) displayed a not-connected message and did nothing —
the exact fake-control class this document exists to eliminate. Rather than wiring them, the owner decided the
product does not print service tickets; they and the two `window.print()` controls (Print Schedule, Print Queue)
were deleted and are now gate-blocked. See PRINT_FEATURES_REMOVED.md.

## 5. How to close a gap
Backend-first gaps: build the screen against the EXISTING route (inventory §2), add the client method (the
dead-client gate will force you to actually wire it), pin with a screen test. Sample-data panels: replace the
labeled block with the real fetch once the blocker clears — the footnote text tells you which one.
