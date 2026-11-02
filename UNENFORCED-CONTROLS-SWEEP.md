# Configured-but-unenforced controls — sweep results

**Why this sweep exists.** Three findings in a row were the same class — a setting an owner or Super Admin can change
that nothing consults (`campaign_limits`, Skip-the-Line `requireFrontDeskApproval`, `settings_updated`). Each was
found by accident, so every `*_settings` table was swept deliberately: **23 tables, 150 configurable columns.**

**Method, and its corrected limits.** A column is flagged when no code reads it to make a decision (storage, DTOs,
tests and pure mapping lines excluded). The first pass scanned the API and the `*-web` apps only. **That was a blind
spot:** six standalone client apps (the kiosk, customer display, check-in admin, three booking pages) were never
scanned, and two conclusions drawn without them were wrong — see "Retracted" below. The final classification was
re-run across all 12 apps / 879 client files.

## Fixed (real, verified, mutation-tested)
| Control | What was wrong | Patch |
|---|---|---|
| Technician `app_enabled` | Display-only: a technician whose app was switched off could keep using the tech app. Now refused on the `tech/*` API surface; the POS stays usable. | 18 (+14) |
| End-of-day follow-up timezone | Read a table nothing writes, so every salon ran on the New York clock. Now reads `branches.timezone`. | 18 (+14) |

## Retracted — I claimed these were broken and they were not
| Control | The truth |
|---|---|
| Check-in `show_wait_estimate` | The kiosk receives all settings and checks this before displaying. Customers were never shown a hidden estimate. A server-side withhold was added as defence in depth, labelled as such. |
| Check-in `confirmation_timeout_seconds` | Honoured by the customer display (how long the confirmation screen stays up). |

## Resolved as inert — each names a feature that does not exist
Both were left as "needs Kevin" until closer reading showed there is nothing to enforce:

| Control | Finding | Resolution |
|---|---|---|
| Check-in `customer_linking_enabled` ("Customer profile linking") | There is **no linking operation**. A central-directory match only pre-fills the form; the kiosk then creates a brand-new local customer, so no cross-tenant association is ever created. Showing a central match at all is governed by `central_lookup_enabled`, which **is** enforced. | Label now reads "(not active yet — no feature uses this)". |
| Technician `pin_enabled` ("PIN sign-in") | Reads as PIN sign-in to the tech app, which does not exist. The only technician PIN is the kiosk clock PIN; tying the toggle to it could stop technicians clocking in. | Hint now reads "Not active yet — no sign-in method uses this setting." |

If either feature is built later, the toggle is already stored and waiting; wire it then and remove the label.

## Harmless — no screen can set them (orphaned schema), and nothing depends on them
- `store_hours_settings` — all 17 per-day columns. Nothing writes the table; the live hours live elsewhere.
- `customer_phone.require_reauthentication` — re-authentication is hardcoded as always required, so this column
  could only ever fail toward MORE security.
- `daily_follow_up.create_mode` — round-tripped on save with no control to change it; the unbuilt `after_checkout`
  option is unreachable.
- `deal_settings` stacking/edit flags (3), `queue_assignment` wait thresholds (4), `checkout.default_tip_percents_json`,
  Skip-the-Line `auto_send_prompt_on_service_done` and `require_tech_confirmation_for_cash` — no client configures
  them. Candidates for removal in a schema cleanup, not for enforcement.

**Tally of 33 candidates:** 2 fixed · 2 retracted · 2 inert with truthful labels · 27 orphaned or inert. **Nothing outstanding.**
