# Checkout Upsell Assistant Settings — implementation report (guide 17, Nov 2 2026)

**Route:** `/tenant/ai/checkout-upsell/settings` (POS, EN/VI).
**Module:** `modules/checkout/src/ai-checkout-upsell` (migration 342).

The assistant is a settings and intelligence layer only. Ticket lines, enrollment, redemption, gift cards, bookings and payments stay with their own services, and each needs staff confirmation.

## Audit

| Area | State | Evidence |
|---|---|---|
| Settings layers: platform → salon → location → device → user, disabled-wins | Verified | `ai-checkout-upsell-settings.ts` `resolveSettings` |
| Total cap wins over the per-category caps | Verified | `applyFatigueLimits` stops at `maxTotal` |
| Confirmation-gated, idempotent mutations through domain services | Verified | `ai-checkout-upsell.service.ts`, idempotency store |
| Service add-ons and memberships produce real cards | Verified | `ServicesAddOnCatalogAdapter`, `MembershipRecoAdapter` |
| **Retail products, loyalty enrollment, loyalty redemption, gift cards, rebooking** | **Dependency-blocked (dormant)** | `ai-checkout-upsell.module.ts`: the empty read adapters return nothing |
| Settings read | **Broken → fixed** | It failed *open* |
| Settings save | **Broken → fixed** | See below |
| Settings history, activity, health | **Missing → built** | — |

## Defects fixed

1. **Settings failed open.**
   - `layers()` swallowed every error (`.catch(() => [])`), and so did the service (`.catch(() => ({}))`).
   - So an unreadable settings table resolved to the platform defaults: enabled, with every category on. That held even for a salon that had switched the assistant off.
   - Now checkout gets `enabled: false, disabledAtLevel: 'settings_unreadable'`. Checkout itself is untouched.
   - The settings page shows an error with Retry, never the defaults labelled "Enabled".
2. **A category toggle baked the resolved values into the salon's row.**
   - The page sent back the whole effective set: platform defaults plus the branch, device and user layers.
   - After any toggle, a later platform default change no longer reached the salon. A branch override also became the salon value.
   - Now the page sends only the changed key, and the server merges it into the stored layer.
3. **Disable then Enable wiped every category and limit.**
   - `{ enabled }` was written with `tunables: null`.
   - Now the merge keeps every field that is not in the patch.
4. **No concurrency protection, and the write was not atomic.**
   - The save did a delete then an insert with no transaction, so a crash between them lost the row.
   - Now one transaction takes an advisory lock and applies `expectedVersion`. A stale save gets 409 `UPSELL_SETTINGS_VERSION_CONFLICT`, and the page explains and reloads.
5. **Out-of-range values were silently clamped.**
   - Now `UPSELL_SETTING_OUT_OF_RANGE` (400) is returned for:
     - negative, fractional or non-numeric values;
     - a non-boolean flag;
     - an unknown key.
6. **The 403 message never showed.** The page looked for "403" in the message text. It now reads the error status.
7. **No settings history.** The audit row held only `{ level, enabled }`. Now every save appends a before/after row with the changed keys, actor and role to `ai_checkout_upsell_settings_history`.

## What was added

- **Settings save.** `PUT settings/:level` now merges, is versioned (`expectedVersion` is in the strict body) and writes history.
- **Settings read.** `GET settings` now also returns:
  - `sources`: which layer each value comes from;
  - `salon`: the stored row, version and time saved;
  - `platformDefaults`.
- **`/pos/ai-checkout-upsell/center/*`** — read-only, needs `pos.ai_checkout_upsell.view`, and is not behind the package gate.
  - **`GET summary`** (the status row):
    - Effective state: enabled, disabled, subscription restricted or unknown, with the reason.
    - Subscription.
    - The seven categories, each with **on** and **connected**.
    - The three limits, with their sources.
    - The version.
    - 30-day counts kept apart: generated, accepted, applied, dismissed.
    - Last check.
  - **`GET activity`** (Suggestion Activity):
    - Search by ticket number, offer, category, status or ID prefix.
    - Customer name or phone is searchable only with `customers.view`; otherwise those fields are null.
    - Filters: category and status.
    - Dates: presets, or a From/To range in salon local time, validated.
    - Pages: 10, 25, 50 or 100 rows, newest first, with `id` as a stable tie-break.
  - **`GET history`** (Settings History): each change as before → after, the actor, newest first. You can search by key, actor or role.
  - **`POST check`** (Check Checkout Upsell System):
    - Read-only; at most one run every 30 seconds; results stored in `checkout_upsell_health_runs`.
    - It checks:
      - settings are readable
      - the assistant is on
      - the subscription
      - **categories are connected** (names each switched-on category with no data source)
      - limits are valid
      - the add-on catalog
      - recent suggestions
      - **nothing applied without staff**
      - applied cards have a result
      - no double apply
      - stale open cards
      - tenant isolation
      - settings history
      - no side effects
- **Migration 773:**
  - adds `version` to the settings table;
  - creates the history table;
  - adds the activity index;
  - creates the health runs table.
- **POS** (all strings are `ucx.*`, EN and VI):
  - The original controls are kept: Disable/Enable, the seven categories, the three limits, and Decision 27's two value caps.
  - New on the page:
    - the version saved;
    - an effective-state, categories, limits and health row;
    - a "Not connected yet" chip on dormant categories;
    - where a value comes from when it is not the salon's own;
    - the total-cap note;
    - a Disable confirmation saying checkout and billing are untouched.
  - Below the controls are three tabs: Suggestion Activity, Settings History and System Health.

## Tests

- **`upsell-center.pgtest.vitest.spec.ts`** — 12 tests on the real schema. They cover:
  - merge and no baking;
  - Disable/Enable keeps the categories and limits;
  - version conflict and no-op saves;
  - range refusals;
  - history rows;
  - fail-closed reads;
  - status row and connected flags;
  - activity search, customer gating and dates;
  - history listing;
  - health failures, reuse and isolation.

  Sabotage checks: removing the merge, or making the read fail open, turns tests red.
- **The existing module suite** passes: 12 files, 58 tests.
- **`AICheckoutUpsellSettingsScreen.test.tsx`** — 7 tests. The Decision 27 test was rewritten to expect "only the changed key + version". The rest cover the toggle, the Disable confirmation, 409 and 403, the unreadable state, the three tabs, and Vietnamese.

## Left for a decision

- **Retail products, loyalty enrollment and redemption, gift cards, and rebooking** have no read adapter yet. They are dormant, so their switches cannot produce a card. The page and the health check now say so. Wiring them needs real reads from:
  - inventory, by branch and stock;
  - the loyalty ledger;
  - gift-card stored value;
  - Booking availability.
- **The settings PUT sits behind `@RequiresAiPackage`**, like the whole controller. With `AI_ENTITLEMENT_ENFORCEMENT=enforce`, a salon whose subscription lapsed could not switch the assistant off. Should settings writes be exempt from the package gate?
