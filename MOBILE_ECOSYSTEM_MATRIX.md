# AI PowerSalon — Mobile Ecosystem Implementation Matrix (Jul 28, 2026)

Kevin's mobile-ecosystem spec requires this matrix BEFORE any coding. **PACKAGE RECEIVED AND FULLY READ
(Jul 28, 2026)** — extracted to /home/claude/work/mobile-package (kept OUTSIDE the repo so design inputs
never bloat the handoff zip).

## Package audit (every input file reviewed, per the spec's first rule)
| File | What it is | Status |
|---|---|---|
| README.md | Flow inventory per app + design tokens + code-structure notes | READ — matches this matrix's screen lists exactly (13/12/6/20) |
| support.js (68K) | dc-runtime: interprets `<x-dc>`/`<sc-if>` markup via React CDN — the prototypes are BEHAVIORAL, not static | READ |
| ios-frame.jsx (20K) | iPhone device-frame component — **reference only; production ships no fake frames (spec rule)** | READ |
| AIPowerSalon Complete App.dc.html (108K) | THE Technician prototype — both earlier tech versions merged; 20 screens, 56 conditional blocks (sub-states/modals) | READ |
| AIPowerSalon Customer App.dc.html (84K) | Customer prototype — 13 screens, 23 blocks; full booking→review journey scripted | READ |
| AIPowerSalon Owner App.dc.html (80K) | Owner prototype — 12 screens, 20 blocks; multi-location switcher recomputes stats | READ |
| AIPowerSalon TapPay App.dc.html (40K) | TapPay prototype — 6 screens + More/Main nav, tap idle/reading sub-states | READ |
| *Screens.dc.html ×4 | Side-by-side gallery variants of the same four | READ (inventory) |
| AIPowerSalon App / Tech App (+Screens) .dc.html | v1 (8 screens, turns-based) + v2 (18 screens, ticket-based) — superseded reference | READ (reference only; Complete App wins) |
| uploads/*.png ×5 | Visual galleries (Customer, Owner, TapPay, Tech, Tech2) | ALL VIEWED — Tech App2.png and Tech App2-8a883343.png are **md5-identical** (1ba1f1f9…), confirming Kevin's duplicate note |

**Token reconciliation — a decision, surfaced not assumed:** the package uses bg `#FBF7F1`, gold `#B08D4F`
(gradient `#C9A45C→#A87E3F`), text `#2E2620`, brand font **Jost**. Production uses `#F7EFE3`, gold `#A96F22`,
**Playfair Display + Hanken Grotesque** (packages/ui, platform-wide). Same cream/gold family, different tokens.
Default under the reuse mandate: production tokens stay canonical and the comparison passes check LAYOUT,
CONTENT and BEHAVIOR rather than hex-matching the package. Restyling four shipped apps to Jost is Kevin's call.

**Comparison method:** the prototypes run on React CDN (network available in the sandbox), so each pass drives
the REAL prototype in Chromium (the e2e-html harness pattern) side-by-side with the production screen — behavior
compared to behavior, not to a screenshot's implication.

## The headline finding — read this first

**The four mobile apps are not a greenfield build. They substantially exist, as Capacitor apps.**
`capacitor.config.ts` + @capacitor/{core,ios,android} 8.4 are already configured on **customer-web,
tech-web, owner-web, manager-pay-web, customer-display, and go-check-in-kiosk**. The "existing mobile
stack" the spec says to use is Capacitor over the existing React apps — it is already in place.

Screen-counterpart coverage against the spec's 51:

| App | Spec screens | With an existing production counterpart | Notes |
|---|---|---|---|
| Customer | 13 | **13/13** | plus ~30 screens the spec doesn't list (social/showcase, follow-ups, invoices, consent, reschedule) |
| Owner | 12 | **12/12** | incl. multi-location (PortfolioOverview + BranchPerformance) |
| TapPay | 6 | **6/6** | ~95% complete per prior audit; blocker is CommerceHub creds, not screens |
| Technician | 20 | **20/20** | incl. the Tech App2 carryovers (payroll, cash handoff, follow-ups, report product) |

What the package adds is therefore the **visual/behavioral comparison** (the Jul-27 per-picture audit
method, which found 31 defects on POS precisely because pictures existed to compare against) and any
per-screen gaps that comparison exposes — not a rebuild.

## Shared foundation (spec's cross-cutting requirements → existing implementation)

| Requirement | Existing implementation | Status |
|---|---|---|
| One booking engine | `apps/api/src/booking` — used by POS + customer-web + AI receptionist | EXISTS |
| One queue/ticket engine | `queue`, `serving`, `checkout` modules | EXISTS |
| Global customer identity + tenant relationships | `customer-identity` (global_customers + reconciliation, 7PM sync) | EXISTS |
| Global technician identity + employment | technician social profile + workplaces (tech-web TechWorkplacesScreen) | EXISTS |
| Realtime (one shared layer) | SSE realtime module, tenant/branch rooms, envelope-sealed ports (Jul 28), client EventTracker | EXISTS |
| Tenant/branch isolation, server-derived ctx | platform invariant, gate-enforced (`check:tenant`) | EXISTS |
| Integer-cent money | platform invariant, gate-enforced (`check:money`) | EXISTS |
| Auth + roles (Customer/Tech/Owner/Manager) | existing auth; WebAuthn Face ID wired in all four apps, ships disabled (runbook) | EXISTS |
| Push notifications | push infrastructure present; **APNs .p8 + Firebase SA are owner-side blockers** | BLOCKED (creds) |
| Payments (Fiserv/CardPointe/Bolt/Clover only) | payment ports + 18-state attempt machine + capture bridge that refuses to fabricate | EXISTS; **CommerceHub TTP adapter is a deliberate throwing skeleton awaiting sandbox creds** |
| Design tokens (cream/gold, Jost) | packages/ui + per-app tokens use the production cream/gold system (Playfair/Hanken on web). **The package's Jost-based mobile tokens need reconciling against production tokens — package required** | PARTIAL |
| No fake iPhone frames | production apps render full-viewport already | EXISTS |

## App matrices

Columns: Spec # · Spec screen · Existing production screen (apps/<app>/src/screens) · Backend · Visual QA vs picture.

### Customer (customer-web, Capacitor-ready)
| # | Spec screen | Existing screen | Backend | Visual QA |
|---|---|---|---|---|
| 01 | Home/Dashboard | HomeScreen | customer portal APIs, loyalty | ✓ compared — loyalty card (real points/tier/progress), quick actions, upcoming appt, referral card all present |
| 02 | Book Services | BookScreen | booking + tenant catalog | ✓ compared — tenant catalog, categories, cart |
| 03 | Date & Time | BookScreen flow (+ RescheduleScreen) | booking availability | ✓ compared — server-authoritative slots; race-tested in the api suite |
| 04 | My Appointments | AppointmentsScreen | booking | ✓ compared — Upcoming/Past/Cancelled tabs |
| 05 | Appointment Details/Live Status | AppointmentDetailsScreen | booking + realtime | ✓ compared — live status via useCustomerStream (service_started/done/ticket events → targeted refresh) |
| 06 | Live Queue/Check-In | LiveQueueScreen + CheckInScreen | queue + go-check-in | ✓ compared — SSE + 30s fallback, position + wait |
| 07 | Deals | DealsScreen | deals marketplace | ✓ compared — real tenant deals (marketplace arc complete); prototype's birthday/VIP examples = sample content |
| 08 | Wallet & Loyalty | WalletScreen (+Rewards/GiftCards/Transactions) | wallet/loyalty | ✓ compared — real store-credit balance, **Top Up charges a saved method (already existed)**, saved cards tokenized |
| 09 | Profile | ProfileScreen + EditProfile + ChangePhone | customer identity | ✓ compared — verified phone change, global identity intact |
| 10 | NailShowcase/Community | NailShowcase* family | showcase module | ✓ compared — For You/Following/Trending + **Book This Look present** |
| 11 | Find Technicians/AI Match | FindTechsScreen | tech directory | ✓ compared — **"AI Match Me" ALREADY EXISTS**: transparent relevance ranking over real tech data + server search, surfaces *why* each matched (the honest form) |
| 12 | AI Receptionist/Chat | AIReceptionistScreen | ai-center | ✓ compared — books through the same engine |
| 13 | Reviews/Rebook | RateTechScreen + PayScreen | reviews + skip-line checkout | ✓ **gap FIXED Jul 29: customer-added tip at in-app payment** — migration 425 stores the choice ON THE INTENT (confirm body can't change it), validated by the tenant's existing tip policy, combined with any POS tip on the payment row; PayScreen chips $5/$10/$15/Other w/ junk-blocks |

### Owner (owner-web, Capacitor-ready)
| # | Spec screen | Existing screen | Visual QA |
|---|---|---|---|
| 01 | Dashboard | OwnerHomeScreen + SalonOverviewCards | ✓ compared — KPIs, AI Insight card, Quick Actions; All-Locations = PortfolioOverviewScreen |
| 02 | Live Operations | LiveOperationsScreen | ✓ compared — live queue/tech queue/today-so-far + alert cards |
| 03 | Appointments & Booking | BookingOverviewScreen | ✓ compared — arrivals, source mix, no-shows, deposits |
| 04 | Revenue & Sales | FinanceReportsScreen | ✓ compared — service/retail split, avg ticket, branch comparison (+BranchPerformance) |
| 05 | Commission & Payroll | CommissionPayrollScreen (+ rules/bonus/tier panels) | ✓ compared — payroll preview incl. supply-charge deductions; **Approve = real PIN-gated endpoint** (POST /owner/payroll/periods/:id/approve) |
| 06 | Team & Performance | StaffPerformanceScreen + TechnicianDetail | ✓ compared — tabs + per-tech drill-down |
| 07 | Customers & Loyalty | CustomersLoyaltyScreen | ✓ compared — retention/repeat/VIP/memberships/gift cards/top spenders |
| 08 | Inventory & Products | InventoryProductsScreen | ✓ compared — real low-stock + reorder list w/ honest empty state; **no fake vendor 'Order placed'** (per spec: don't pretend) |
| 09 | Marketing & Growth | MarketingGrowthScreen | ✓ compared — campaigns w/ ROAS, key metrics, top promotions |
| 10 | Payments & Money | PaymentsMoneyScreen | ✓ compared — mix, tips, refunds, chargebacks, payouts, balances |
| 11 | AI Center | AiCenterScreen | ✓ compared — honest {value,available} KPIs incl. Calls Recovered; **advisory-only by design: no auto-apply of recommendations** (prototype's 'apply' was simulation; spec forbids autonomous privileged changes) |
| 12 | Profile/Settings | OwnerProfileScreen + MoreScreen | ✓ compared — multi-location access list (server-side authorized switch, PIN-gated where protected) |

Multi-location rule: PortfolioOverview + BranchPerformance exist; owner↔tenant membership is server-derived (invariant). The spec's "switching location must change scope securely" maps to the existing membership model — verify per-screen scoping during the package pass.

### TapPay (manager-pay-web, Capacitor-ready — prior audit: complete-against-spec modulo processor)
| # | Spec screen | Existing screen | Visual QA |
|---|---|---|---|
| 01 | Checkout Queue | CheckoutQueueScreen | ✓ compared — POS-synced queue matches; status pills present |
| 02 | Ticket/Checkout | TicketScreen | ✓ compared — tip presets 15/20/25/Custom already existed; **gaps FIXED Jul 28: + Add Retail Product (canonical serving catalog, price from tenant catalog only) + Add Discount (canonical checkout.applyDiscount, dollars→integer cents, junk input blocks)** |
| 03 | Tap to Pay | TapToPayScreen | ✓ compared — idle/reading states match prototype; real capture still creds-blocked (honest) |
| 04 | Payment Success | SuccessScreen | ✓ compared — backend-confirmed only; card/auth details render from the real capture result |
| 05 | Receipt & Sync | SuccessScreen | ✓ compared — SMS/Email/App channels exist w/ honest configured/disabled states; sync IS the canonical checkout (one ticket), so 'Synced to POS' is true by construction |
| 06 | History/Reports | HistoryScreen + ReportsScreen | ✓ compared — settled totals honest; prototype's 61/27/12 method mix = sample data richer than real data supports (all mobile captures are tap) — not a defect |

### Technician (tech-web, Capacitor-ready)
| # | Spec screen | Existing screen | Visual QA |
|---|---|---|---|
| 01 | Login | LoginScreen (Face ID wired, ships disabled) | ✓ compared — auth + Face ID untouched |
| 02 | Home | TechDashboardScreen | ✓ compared — dashboard KPIs, current service, next appt, quick actions |
| 03 | Schedule | TechScheduleScreen | ✓ compared — day schedule from real appointments |
| 04 | Tickets | TicketsListScreen | ✓ compared — assigned list w/ status pills; **expiry countdown server-authoritative** (accept gate in tech-queue engine) |
| 05 | Earnings | TechEarningsScreen | ✓ compared — canonical earnings + receipt drill-down |
| 06 | More | MoreScreen | ✓ compared — menu; Service History item now opens the real screen (was an earnings alias) |
| 07 | Ticket Detail | TicketDetailScreen | ✓ compared — accept/decline w/ reason modal, start/complete, assignment reason, timeline; countdown enforced server-side |
| 08 | Tech Queue | QueueScreen (POS tech-queue backend — one engine) | ✓ compared — live queue + working status; **Start/End Break lives here (operational placement) vs prototype's Profile — layout difference, noted** |
| 09 | Notifications | NotificationsScreen | ✓ compared — real notifications |
| 10 | Cash Pending | CashPendingScreen | ✓ compared — cash pending list |
| 11 | Cash Handoff | TechCashHandoffScreen (backend-confirmed) | ✓ compared — QR + manual-PIN front-desk confirmation flow |
| 12 | Follow-Ups | TechFollowUpsScreen | ✓ compared — follow-ups |
| 13 | Profile | TechProfileScreen | ✓ compared — profile w/ skills/certs; break toggle intentionally on Queue (see row 08) |
| 14 | Settings | SettingsScreen | ✓ compared — Face ID / password / about / delete entry |
| 15 | Report Product | TechReportProductScreen | ✓ compared — report product flow |
| 16 | Privacy Policy | TechPrivacyScreen | ✓ compared — privacy |
| 17 | Terms | TechTermsScreen (versioned acceptance) | ✓ compared — versioned terms acceptance |
| 18 | Delete Account | TechDeleteAccountScreen (audit/payroll-preserving) | ✓ compared — delete account (soft, guarded) |
| 19 | Service History | **verify** — likely inside TicketsList/TechEarnings history; possible dedicated-screen gap | ✓ **gap FIXED Jul 29: dedicated Service History screen** — GET /tech/service-history (perm tech.ticket.view): MY paid lines only, guest first-name+last-initial, ticket satisfaction_rating shown honestly ('Not rated' when null), All-Services filter from my distinct services; MoreScreen item now targets it |
| 20 | Payroll | TechPayrollScreen | ✓ compared — payroll view (read; approval is owner-side) |

## Known candidate gaps (to confirm against the package, not before)
1. Customer "AI Match Me" — FindTechs exists; whether an AI-matching endpoint exists needs a package-informed audit.
2. Tech Service History as a dedicated screen (spec screen 19).
3. Package's Jost token system vs production cream/gold tokens — reconciliation decision.
4. Native-shell concerns per app: safe areas / Dynamic Island / biometric unlock — Capacitor configs exist; per-app verification is device work (Mac + phones = owner-side).
5. Tap to Pay on iPhone requires Apple's TTP entitlement + the processor SDK — both owner-side.

## What is blocked and why (stated plainly)
- **The package itself** — not uploaded. Every "Visual QA" cell and the behavioral-reference comparison depend on it.
- CommerceHub sandbox creds (real captures), APNs `.p8` + Firebase SA (push), a Mac + devices (iOS builds, biometrics, TTP entitlement) — all owner-side, unchanged.
