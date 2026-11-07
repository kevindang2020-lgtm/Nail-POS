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

## Kevin's four decisions (delegated to Claude, Nov 7 2026) — what was picked
1. **Health checkers** — screen fit: every page already has profile menu → *Check this screen*. Data: built where a wrong
   number costs money and nothing else checks it — **Cash Drawer → Check drawer** (read-only): the activity adds up to
   Expected in Drawer; today's count (or changed since); earlier days never counted; counts waiting for a manager's
   sign-off; opening float set. The other money pages already carry their own reconciliation signals (End-of-Day
   difference strip, Tips snapshot-mismatch flags, Transactions definitions, Refunds "Needs Review"); Loyalty has its own
   check. No per-page checker was added where it would only repeat those.
2. **Daily Closeout** — no button that links a page to itself. Instead Cash Drawer and End-of-Day Cash (the Daily
   Closeout) open each other **for the same business day** (`?date=`): the drawer leaves technicians' cash to the
   closeout, so the two are read together.
3. **Purchase Orders** — one workspace: Inventory → Purchase Orders already had everything the old standalone page did
   (create, approve, receive, cancel, lines) plus search, dates, pages and receipts. The old page, its two tests and its
   API file are removed; `/tenant/inventory/purchase-orders` redirects there, and every Reorder (Stock Alerts, Products,
   Inventory, Suppliers) opens a draft prefilled with product, quantity and supplier, as before. The menu item stays.
4. **Vietnamese** — all new Cash Drawer strings reviewed against the POS's existing terms (Két tiền, Tiền lẻ đầu ca,
   Chốt ca ngày); nine reworded for consistency ("Lịch sử ngăn kéo" → "Lịch sử két tiền" beside "Hoạt động két tiền").
   They keep their `// DRAFT — Kevin reviews` marks so your review list stays complete; they ship as they are.

Still not covered: real SUNMI hardware (touch, Android keyboard, browser bars) — everything here is desktop Chromium at
the SUNMI viewport sizes.

## Vietnamese DRAFT for Kevin
`cdr.*` in `apps/pos-web/src/i18n/ns/money.vi.ts` (96 strings, each marked `// DRAFT — Kevin reviews`).
