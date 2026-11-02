# Inventory · Products · Suppliers · Membership Overview · Discounts — screen rebuilds (Oct 29 2026)

This work follows seven guides: *Inventory*, *Products*, *Suppliers*, *Membership* and *Discounts*, plus two copies of *Stock Alerts*. Both Stock Alerts copies match the guide already built in fa525ba4, so nothing new was needed for them.

Routes covered (all in the Front Desk POS, EN + VI):

* `/tenant/inventory`
* `/tenant/products`
* `/tenant/inventory/vendors`
* `/tenant/customers/memberships`
* `/tenant/services/discounts`

Safety constraints held throughout:

* Nothing was pushed; K-12 steps 1–5 are still open.
* No secrets, no live payments, no SMS or email sends, no seeded production data.
* Two records that look alike are never merged.
* Live coupons were not edited, converted or reseeded.

## Why the photos showed what they showed

These causes were found by investigation, not assumed.

### Inventory: the 11 / 20 / 171 / 128 figures

* **Mixed counts.** The KPIs mixed the cached `inventory_location_stock` columns, so On Hand 11, Open 20 and Unopened 171 could disagree with each other.
  * Counts now come from the bottle records (`inventory_units`), and the screen flags any drift.
  * **Recount** rebuilds the cached row and records a correction movement.
* **Expiring 128.** This counted bottles, not products, and it included bottles that had already expired.
  * Expiring Soon now means within 30 days and not yet expired.
  * Expired bottles are counted separately.
* **"Pending Imports".** This figure was actually the pending technician bottle reports, and it is now labelled that way.

### Suppliers: "0 suppliers" next to a draft purchase order

* **Count and list disagreed.** `listVendors` returned active suppliers only, but the purchase-order list joined suppliers regardless of state.
  * A deactivated supplier therefore kept its name on its POs but dropped out of the count.
  * Both now use one definition: the card shows active suppliers, with inactive and preferred counts beside it.
* **Dash instead of zero.** Open PO Value showed "—" when the value was $0. It now shows $0.00.
* **Unreadable expected date.** The PO `expected_date` (a DATE column) was serialised as a midnight-UTC timestamp. It is now sent as `YYYY-MM-DD`.

### Membership: Service Packages lit up in the sidebar

* The nav item `svc-packages` routed to `/tenant/customers/memberships`, the same route as Memberships, so the router highlighted both.
* It now routes to `/tenant/services/packages`, which already redirects.

### Membership: $0.00 revenue with 2 active members

This can be correct and the screen now says so. Custom pricing, a trial, a complimentary membership or no charge being due yet all produce $0 collected.

### Discounts: Redemptions card vs history

* The Redemptions card keeps the coupon counters Promotions shows: `deals.redemption_count`, which is incremented when a ticket is paid and decremented on a void or refund.
* The ledger (`deal_redemptions`) gives the history.
* If the two ever differ (for example, a legacy backfill), the card says how many events the history holds. It never changes stored numbers to make them match.

## Definitions (on screen, in the APIs and in the tests)

### Inventory

* **Snapshot cards** (Products, Bottles, Open, Unopened, Low, Out, Expiring, Pending reports, Inventory Value) describe the stock *now*. A selected period never changes them.
* Each of the eight tabs has its own search, period and date field, and its own paging (newest first).
* **Last Used By** follows the Stock Alerts definition: latest effective use by `occurred_at DESC, id DESC`.

### Products

* **Need Reorder** = on hand ≤ reorder level.
* **Retail Value** = Σ on hand × retail price. Cost value is shown only to roles with `inventory.cost.view`.
* SKU and barcode must be unique within the salon (`PRODUCT_SKU_TAKEN` / `PRODUCT_BARCODE_TAKEN`).

### Suppliers

* **Total Suppliers** = active suppliers.
* **Active POs** = approved, ordered or partial.
* **Open PO Value** = Σ of the active POs; drafts are shown apart.
* **Brands** = the salon's brands, with how many have no supplier.
* Duplicate warning: on create, or when the name, phone or email changes, a match triggers `409 SUPPLIER_DUPLICATE` listing the matches. Saving anyway needs an explicit confirmation.

### Membership

These are snapshot cards (right now):

* **Total** = current memberships (not canceled, cancelled or expired).
* **Active** = status `active`.
* **Expiring Soon** = a term end, or a cancel-at-period-end, within the next 7 days.

These are this-month cards (in the salon's time zone):

* **Revenue** = succeeded membership payments settled this month.
* **Canceled This Month** = `canceled_at` this month.

How the period applies:

* A period filters the event lists only: Activity, Payments and Benefit Redemptions.
* On Members, a period filters only the chosen date field (enrolled, created, renewal, expiration or canceled).
* Payments totals: **Collected** = succeeded, **Refunded** = refunded, **Net** = collected − refunded. Failed charges are counted but never collected.

### Discounts

Each coupon's **lifecycle** is derived from the Promotions status plus its dates and its cap: active, scheduled, paused, draft, expired, exhausted or archived. The cards:

* **Active Discounts** = usable now.
* **Percent-Off / Fixed-Amount** = counted over the Live & Scheduled list (active, scheduled, paused and draft), as the card says.
* **Redemptions** = all-time confirmed uses.
* **Expiring Soon** = active or scheduled coupons ending within 7 days. Coupons with no end date or already ended never count.

The ledger states:

* **Confirmed** = `redeemed` or `partially_reversed`, meaning the ticket was paid.
* **Pending** = `applied` to an unpaid ticket. These are never counted.
* **Released** = given back before payment.
* **Reversed** = voided or refunded.

**On a $100 ticket** is illustrative only. It is the rule's own maths on an eligible $100 subtotal (shared `ruleDiscount`), with any cap applied, and $0 when $100 misses the minimum purchase.

## What was built

### Inventory (`/tenant/inventory`)

* The page scrolls vertically, never sideways.
* Kept: the nine cards and the eight tabs (All Inventory, Technician Reports, Purchase Orders, Transfers, Counts, Catalog, Recipes, Alerts), plus Refresh, Scan Receipt, Add Product, Add Stock, Bottles and Edit.
* One search box covers product, SKU, barcode, colour, brand, category, supplier name or phone, supplier SKU and PO number.
* Calendar: Today, Week, Month, Year and Custom, with a date-field selector.
* Each tab pages on the server, newest first. Last Used By appears in the table.
* The product overlay has six tabs: Overview, Pricing, Inventory (bottles grouped by identical attributes), Suppliers, Technician Usage and History. It supports edit, archive / restore and Recount.

### Products (`/tenant/products`)

* Kept: the three cards, the columns, Add Stock and Archive.
* Added:
  * One search box.
  * Filters for lifecycle, status, brand, category and supplier.
  * Ten sort orders.
  * Seven date fields with a period.
  * Numbered pages.
  * The same details overlay as Inventory.
  * Duplicate SKU / barcode checks.
  * A CSV export of every matching row (audited).

### Suppliers (`/tenant/inventory/vendors`)

* One bounded screen with no page scroll at 100 % zoom.
* Four cards with their scopes.
* Two workspaces:
  * **Directory**: primary contact; search that also matches contact phones in any format; status, brand and sort filters.
  * **Orders**: readable expected date; a "no supplier (legacy)" filter; Link to supplier.
* Supplier details tabs: Overview, Contacts, Supplied Products, Purchase Orders, Receiving History and Notes.
  * Shown as a split panel at widths of 1440 px and above, and as an overlay below that.
  * Includes the contacts editor (one primary contact), product links with supplier SKU, and Restore.

### Membership Overview (`/tenant/customers/memberships`)

* The content pane scrolls vertically.
* Kept: the five cards, Membership Plans, Active Members (each row with Manage), Membership Activity, the four analytics panels and all ten Quick Actions (shown under every tab).
* Added a **phone-first search**. It matches:
  * phone in any format (`8565551234`, `(856) 555-1234`, `856-555-1234`, `+1 856 555 1234`)
  * name, email, member number, customer or membership ID, and plan
  * exact ID and phone matches are listed first
* Typing on Overview opens Members.
* Calendar: Today, Week, Month, Year and Custom (month calendar), with the date field it filters.
* Six tabs: Overview, Members, Plans, Payments, Benefits and Activity, each with independent numbered paging.
* Card clicks land on the matching tab and filter (for example, Expiring Soon opens Members filtered to expiring).
* **Member Details** has four tabs: Overview, Billing, Benefits and Activity & audit.
  * **Overview:** identity with masked phone and IDs, plan version, lifecycle (enrolled, period, next billing, ends, pause window and limit, cancellation requested vs effective), billing summary, and the customer's other memberships listed separately.
  * **Billing:** that membership's payment ledger.
  * **Benefits:** per-cycle allowance, used this cycle, remaining, used in total, and credit expiry, plus redemptions with ticket and technician.
  * **Activity & audit:** the activity log plus the management audit (who, from → to, reason).
  * State-aware actions: Manage (the existing MembershipManageModal), Customer Profile and Send Reminder.
* Manage Discounts now also opens Discounts & Promotions, so there is no second rule engine.
* The Service Packages highlight is fixed.

### Discounts (`/tenant/services/discounts`)

* The page scrolls vertically only when it has to.
* Kept: the five cards (each with its scope, clickable as a filter), the coupon explanation, **Manage in Promotions**, and **Live & Scheduled Discounts** with its seven columns (Code masked, Discount, On a $100 Ticket, Min Purchase, Valid, Usage as "n of max used · left" or "Unlimited", Status).
* Added:
  * Refresh and Export (CSV, codes and phones masked, requires `pos.marketing.manage`).
  * One search box covering:
    * the exact code (hashed with the tenant, so the code itself is never returned)
    * the last four characters, name or description, and ID
    * applicable service (via `deal_services` only)
    * a redeeming customer or a wallet-code holder, by name or by phone in any format
  * Each match says which field it matched on.
  * Lifecycle and type filters.
  * Calendar with date field: created, starts, ends or modified.
* Three tabs:
  * **Discounts.**
  * **Redemption History:** confirmed by default, with pending, released, reversed and all states; date/time, customer with masked phone, code, ticket and technician, eligible subtotal, discount, final amount, status; newest first and paged; searchable by phone, `#ticket`, code or redemption ID.
  * **Performance:** per coupon over a redemption period, with confirmed uses, customers, savings, average, reversed, uses left and *linked* ticket sales (labelled as not incremental).
* The **Discount Details** overlay has six tabs:
  * Overview, with usage
  * Eligibility (min purchase, new / member only, days, hours, stacking, code required, advanced rules counted)
  * Validity & Limits (window, usage, per customer, cap, budget, codes issued / active / wallet)
  * Applicable Items
  * Customer Redemptions, paged
  * Audit History (`deal_versions`)

## API, schema and files

### Migration 717 (`717_suppliers_contacts_products.sql`)

Expand-only and idempotent. It adds:

* Supplier profile columns: trade name, code, address, notes, preferred, minimum order, currency and `deactivated_at`.
* `inventory_vendor_contacts`, with one active primary contact per supplier.
* `inventory_vendor_products`, unique per tenant, supplier and product, with a supplier SKU.

The ownership registry was regenerated.

### Inventory read models

* `modules/inventory/src/inventory-screen.repository.ts` and `.controller.ts`: `GET /tenant/inventory/screen/*`
* `suppliers-screen.repository.ts` and `.controller.ts`: `/tenant/inventory/suppliers/*`
* Writes reuse `InventoryService`, which gains: vendor full profile and duplicate check, restore, contacts, product links, linking a legacy PO to a supplier, product restore and recount, and the SKU / barcode uniqueness check.

### Memberships

`modules/memberships/src/membership-lists.ts` gains:

* `period()`
* Extended members, activity and payments lists
* `redemptions`
* `plans-list`
* `members/:id/detail`

### Discounts

`modules/deals/src/salon-promotions/discounts-screen.ts` adds the repository and controller for `GET /pos/discounts`:

* `/kpis`
* `/redemptions`
* `/performance`
* `/:dealId`
* `/export`
* `/export/redemptions`

Everything requires `pos.marketing.view`; the exports require `pos.marketing.manage` and run on the async-export contract. The controller is registered in `SalonPromotionsModule`.

### Error codes

Ten new error codes, in `packages/api-contracts` and the POS errors namespace:

* `SUPPLIER_DUPLICATE`
* `SUPPLIER_CODE_TAKEN`
* `VENDOR_EMAIL_INVALID`
* `VENDOR_PHONE_INVALID`
* `VALUE_NOT_WHOLE_NUMBER`
* `CONTACT_NAME_REQUIRED`
* `CONTACT_NOT_FOUND`
* `VENDOR_PRODUCT_NOT_LINKED`
* `PRODUCT_SKU_TAKEN`
* `PRODUCT_BARCODE_TAKEN`

### POS screens and supporting files

Screens rebuilt:

* `TenantInventoryScreen.tsx`
* `POSProductsScreen.tsx`
* `TenantSuppliersScreen.tsx`
* `POSMembershipsScreen.tsx`
* `POSDiscountsScreen.tsx`

New components and API clients:

* `components/InventoryKit.tsx`
* `api/posInventoryScreenApi.ts`
* `api/posDiscountsApi.ts`
* `api/posMembershipsApi.ts` (extended)

Other front-end changes:

* `shell/tenant-nav.tsx` (the Service Packages route fix).
* `styles.css`: the `.inv2`, `.prd`, `.sup`, `.mos` and `.dsc` blocks.
* i18n namespaces `ns/inventory`, `ns/membership` and `ns/discounts`. The Vietnamese strings are listed for review in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`, section A42.
* `inventoryApi.recipeServices` and `alertFeed` were removed; their only callers were the old screens.

## Verification (exact commands)

### Real-schema pgtests

Run with `FST_PG_TEMPLATE=aps bash tooling/full-system-test/unit-standin/run.sh $PWD <spec>`:

| Spec | Result |
|---|---|
| `modules/inventory/src/inventory-screen.pgtest.vitest.spec.ts` | 22 / 22 |
| `modules/memberships/src/membership-lists.pgtest.vitest.spec.ts` | 8 / 8 |
| `modules/deals/src/salon-promotions/discounts-screen.pgtest.vitest.spec.ts` | 6 / 6 |
| product-usage regression | 15 / 15 |
| retail-sale-reversal regression | 4 / 4 |

* The new Membership cases cover:
  * phone search in four formats, plus email, member number, ID and plan
  * period with date field; an invalid range is refused
  * canceled / expired filters and last payment status
  * payments with totals; redemptions; plan list
  * Member Details, including cross-tenant 404
* The Discounts cases cover:
  * the five cards and lifecycles
  * newest first, clamped pages, masked codes; the full code never appears in a response
  * exact / partial code, service and phone search; a cross-tenant negative
  * confirmed / pending / reversed history
  * performance reconciling with the history
  * details, and a CSV with no full phone or code

### Browser E2E

These run the real bundle against the real controllers and SQL on a seeded test database:

| Command | Result |
|---|---|
| `node tooling/catalog-one-screen/interact.mjs e2e3` (Products, Inventory, Suppliers, Discounts) | **33 / 33**; Discounts re-run after the fix 7 / 7 (`dsc-e2e`) |
| `node tooling/customers-one-screen/interact.mjs mos-e2e` (Loyalty, Retention, Membership) | **34 / 34** |

The Membership steps check that:

* Expiring Soon → the count matches the card.
* Phone search in four formats finds the member from Page 5.
* Similar names stay separate.
* Numbered pages are newest first.
* A period does not move the cards.
* Custom Range uses the month calendar and matches the server count.
* Member Details shows a masked phone and all its tabs.
* The sidebar highlights Memberships and not Service Packages.

### Screen fit

`node tooling/catalog-one-screen/measure.mjs` checks four viewports (1920×945, 1536×729, 1440×765, 1366×633) for pilot:en, pilot:vi and empty:en. Results are in `tooling/*/results/`.

* **Inventory, Products, Suppliers:** 72 / 72 PASS (`results/final`).
* **Discounts:** 36 / 36 PASS (`results/dsc-final`). The first run found the Vietnamese table running sideways at 1440 and 1366; fixed in 70f7d2a6 by letting cells wrap and moving the row Redemptions shortcut into Details below 1600 px.
* **Membership (all six tabs, on the customers harness):** 72 / 72 PASS (`results/mos-final`).
* The criteria:
  * no sideways scroll anywhere
  * Suppliers has no page scroll at all
  * the top modules are painted on arrival
  * pagers and Quick Actions can be reached by scrolling
  * 0 touch targets under 44 px
  * no console errors

### Gates

`node tooling/ci/run-gates.mjs`:

* Newly green after fixes: tenant, list-queries, raw-sql-inputs, error-codes, error-text, audit-writers, async-exports, response-exposure, silent-catch, as-any, dead-client, openapi, attack-surface, i18n, pos-i18n and vi-glossary.
  * The openapi manifest and the attack-surface document were regenerated, and the app error catalogues re-synced.
* Still failing — these fail exactly as they did on the untouched tree, because this sandbox has no full `node_modules` and no type checker:
  * check:sql, types-drift, sql-identifiers, lint, api-contract, strict-bodies-types, actor-stamp and unique-tenant-review
  * architecture tests, frontend builds and app types
  * check:db-ownership: the registry was regenerated with the standin loader. Its two remaining violations, `retention_sms_*` with no domain, pre-date this work.

### Not verified here

* **Unit tests:** rewritten for the new screens but **not run**, because the sandbox has no jsdom or React Testing Library. Files:
  * `POSDiscountsScreen(.403).test.tsx`
  * `POSMembershipsScreen.test.tsx`
  * `POSProductsScreen(.403).test.tsx`
  * `TenantInventoryScreen.addlink.test.tsx`
  * `TenantSuppliersScreen.test.tsx`
  * shared mocks in `screens/_invmocks.test-helpers.ts`
* **Type check:** not run (tsc unavailable). esbuild bundles the POS cleanly.

## Out of scope / follow-ups

* **Checkout coupon maths, stacking, concurrency and refunds** belong to the deals engine. They were not changed here, and the details overlay only explains them. Its existing pgtest (`engine/deals-engine.pgtest`) covers holds, payment redemption, void / refund reversal and the last place under contention.
* **Membership enrolment, renewal, dunning and benefit posting** use the existing modals and billing services unchanged. Reminder sending is still the existing preview → confirm flow.
* **Vietnamese:** a native-speaker review of section A42 is pending.
* **Pre-existing gate debt:** the retention tables with no domain in `overrides.json`, and the `status.invoice.void` glossary warning.
