# SUNMI FLEX 3 — batch 2 (Kevin's 20 PDFs of Nov 7 2026)

Each PDF = a SUNMI addendum (≈22 pages: device contract, module-preservation registry, layout, KPIs, tests) in front of
the original screen guide. 19 screens (the two Stock Alerts PDFs are two versions of one guide; Membership Overview was
already done in batch 1 and was re-certified).

## Result
Real stack (built POS, API on PG16, seeded PILOT01), `MODULE_SET=batch2 node tooling/e2e/pos-vi-one-screen.mjs`:
**114/114** certified checks — 19 pages × 1920×945 / 1920×952 / 1920×1032 × English + Vietnamese, every registered
module present (and in view on one-screen pages), no panel that failed to load. Fallback sizes 1536×864, 1440×900 and
1366×768: no sideways scroll, nothing missing (114/114). Memberships (batch 1): 6/6.

| Page | Route | Fit policy (from its addendum) | What changed |
|---|---|---|---|
| Services & Products | /services | one main vertical scroll (§01 says so) | registered 14 modules; quick actions say why when disabled |
| Service Categories | /tenant/services/categories | one screen | registered |
| Service Pricing | /tenant/services/pricing | one screen | registered (tab strip id) |
| Add-Ons | /tenant/services/add-ons | one screen | registered |
| Discounts | /tenant/services/discounts | one screen | registered |
| Products | /tenant/products | vertical scroll allowed (§02) | registered |
| Inventory | /tenant/inventory | vertical scroll + 8 tabs (§01) | registered (AI assistant + tab strip ids) |
| Suppliers & Purchasing | /tenant/inventory/vendors | one screen | **the Supplier Directory failed to load** ("newest is not a sort order here") — fixed in list-query for all 15 lists with a `sort` filter; registered |
| Stock Alerts + Technician Usage | /tenant/inventory/alerts | one screen | registered |
| Membership Overview | /tenant/customers/memberships | one screen | batch 1, re-certified |
| Payments & Money | /tenant/payments/overview | one screen | **8 KPIs were 6 + 2**: Phone Management's unscoped `.pm-*` CSS overrode the 4 × 2 grid — scoped; registered |
| Transactions | /tenant/payments/transactions | one screen | registered |
| **Cash Drawer** | /cash-drawer | one screen | **rebuilt** (below) |
| End-of-Day Cash | /cash-handoffs | one screen | registered |
| Refunds & Voids | /tenant/payments/refunds-voids | one screen | registered |
| Split Payments | /tenant/payments/split-payments | one screen | registered |
| Tips & Gratuity | /tenant/payments/tips | one screen | registered |
| Gift Cards | /tenant/customers/gift-cards | one screen | registered |
| Payment Terminals | /tenant/devices/payment-terminals | one screen | registered; capture-mode control says why when disabled |

## Cash Drawer (the one screen still on the old layout)
Kept every working piece (float, cash in / out, count & reconcile, bills and coins, manager sign-off, drawer history with
its overlay, AI Money Protection) and added what the addendum asks for:
- session header: date · register · status · Refresh · **Export** (the ledger as listed, CSV, no phone numbers);
- five equal KPIs; **Variance reads "Pending count"** until a count exists — never a verified $0.00;
- three equal operational cards side by side; bills and coins in their own dialog;
- **Cash Drawer Activity** — new `GET /pos/cash-drawer/activity`: every cash event of the register (opening float, cash
  sales, cash refunds, cash in / out) from the same rows as the drawer's math, so the ledger's in − out equals Expected
  in Drawer; columns Business Date · Movement / Reference · Customer / Employee · Ticket / Session · Cash In · Cash Out
  · Status / Actions; one search (customer, phone digits — never returned —, #ticket, employee, reason); the drawer's
  day or Today / Week / Month / Year / Custom; newest-first server pages sized to the room left; detail overlay; Void
  on manual movements; Drawer History as the second tab;
- AI Fraud / Money Protection last, after the activity and its pages (original guide).
Verified: pgtest (7 cases, incl. another salon's cash never shows, voids leave the totals, paging), 14 screen tests,
real stack with 8 seeded cash sales ($410.69 ledger = Cash Sales = Expected).

## Not built (recommendations in the addenda, not requirements)
- Per-page "one-click health checker" for DATA (catalog integrity, KPI reconciliation…). The screen-fit part exists for
  every page: profile menu → **Check this screen** (ScreenCheckDialog). Loyalty has its own data check.
- End-of-Day Cash "View Daily Closeout": this page IS Daily Closeout in the navigation (`/cash-handoffs`); there is no
  separate closeout report to link to.
- The standalone Purchase Orders page (`/tenant/inventory/purchase-orders`) has no PDF of its own; purchasing lives in
  Suppliers & Purchasing (which has it). Kept as is; it passes the fit check.
- Real SUNMI hardware: everything above is a desktop Chromium at the SUNMI viewport sizes. Touch, the Android keyboard
  and the browser bars need the device.

## Vietnamese DRAFT for Kevin
`cdr.*` in `apps/pos-web/src/i18n/ns/money.vi.ts` (70 new strings, each marked `// DRAFT — Kevin reviews`).
