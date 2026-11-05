# Screens vs. your pictures — itemized audit (Overview + Booking)

Audited **every element** in the Overview design picture against `apps/pos-web/src/screens/POSOverviewScreen.tsx`.
Patches are in **`patches/`**, split into four independent pieces — see **`patches/APPLY-GUIDE.md`**.

## Already matching — no change needed
- **All 8 KPI tiles**, in the picture's order: Today's Check-ins · Waiting Guests · Walk-ins · Active Services ·
  Ready for Checkout · Today's Revenue · Average Ticket · Staff On Duty — each with the picture's sub-line
  (est. wait, % of check-ins, In Progress, vs yesterday, % on duty) and each clickable to the right screen.
- **All 13 panels**: Arrivals & Check-In Queue · Live Tech Queue · Service Flow Overview · Ready for Assignment ·
  Ready for Checkout · Today's Appointments · Customer Communications · AI Insights · Revenue Trend ·
  Technician Performance · Customer Retention · Payment Mix · Inventory Alerts · Quick Actions.
- **Service Flow's five stages**: Waiting → Ready for Assignment → In Progress → Ready for Checkout → Completed.
- **Communications tabs**: Reminders · Messages · Missed Calls, each with the live count in brackets as the
  picture shows ("Missed Calls (3)").
- **Badges**: Live · In Progress · New · Low Stock.
- **Table columns**: Time, Guest, Service, Status, Wait, Action, Technician, Current Service, Time Left, Amount.

## Fixed by the patch
| # | Element | Was | Now (picture) |
| --- | --- | --- | --- |
| 1 | KPI tile | Today's Check-**I**ns | Today's Check-**i**ns |
| 2 | KPI tile | Walk-**I**ns | Walk-**i**ns |
| 3 | KPI tile | Staff **o**n Duty | Staff **O**n Duty |
| 4 | Arrivals panel link | Open Check-In | **View Full Queue** |
| 5 | Tech Queue panel link | Open Tech Queue | **View Full Tech Queue** |
| 6 | Appointments panel link | Open Booking | **View Full Calendar** |
| 7 | Communications panel link | Open Messages | **View All Communications** |
| 8 | AI Insights panel link | Open AI Center | **View All Insights** |
| 9 | Quick Action | New Check-**I**n | New Check-**i**n |
| 10 | Quick Action | Walk-**I**n | Walk-**i**n |

Four tests pinned the old strings; each was **rewritten to pin the new wording**, not deleted.

## Differences left alone deliberately — your call
- **Quick Actions: the code has 9, the picture has 7.** The two extras — **Send Message** and **Open Cash
  Drawer** — came from an earlier reference image and are fully wired. Deleting working controls to match a
  picture is a product decision, so they stay until you say otherwise. (A stale test title claimed "10 quick
  actions" while listing 9; corrected to 9.)
- **Chart rendering** (Revenue Trend line, the Customer Retention and Payment Mix donuts) is styling, not
  structure — it cannot be compared from source against a picture. Needs eyes on the rendered page.

## Verified this session
`git apply --check` clean on a pristine clone · `POSOverviewScreen.test.tsx` **13/13 passed** ·
`tsc --noEmit` **0 errors**.

## NOT verified
The deployed site. The live pages have never been inspected from here, so anything about how the real Overview
*renders* — spacing, colours, icon circles, chart shapes, real data — is unknown. One screenshot of the live
screen closes that gap.

## Before applying — base note
Generated against the **July 2026 snapshot** (the bundle in this folder), the only tree available in this
session. The canonical tree is your developer's **Power-Salon-main + merge diff**, and your rule is that this
work merges INTO his tree. So: check his `POSOverviewScreen.tsx` first — where it already matches the picture,
his version wins and nothing needs doing. If the patch does not apply, every change above is a plain string
replacement that takes a minute by hand.


---

# Booking screen — picture vs. code

## Already matching — no change needed
All **8 KPI tiles** · Day/Week toggle with date navigation · the four filters (Services, Technicians, Statuses,
Sources) · the technician-column timeline with **drag-and-drop rescheduling** · the **Booking Assistant**
(New Booking / Walk-in tabs, customer search, service, technician, date, time, add-ons, notes, running total) ·
the **Customer Preview** phone panel with Confirm Booking · Waitlist / Standby · Available Technicians · and the
whole bottom row: Upcoming Appointments, Channel/Source Mix, Service Mix, Booking Conversion, AI Insights,
Quick Actions.

## Fixed by the patch
| # | Element | Was | Now (picture) |
| --- | --- | --- | --- |
| 11 | Quick Action | Add Walk-**I**n | Add Walk-**i**n |
| 12 | Assistant button | Book **a**ppointment | Book **A**ppointment |

## Also built (the two picture items that were missing)
**13. "More Filters" — built on three filters the API already implemented and no screen ever surfaced.** The
booking query has always accepted `branchId`, `depositStatus` and `conflictOnly`; the server filters on them.
The button now opens a panel with Branch (only when the tenant has more than one), Deposit status
(required / paid / none) and a Conflicts-only checkbox, plus Clear. Nothing invented, no fake control: every
control drives the real query. The button shows a count of active extra filters, so a hidden filter can never
silently skew the board.

**14. "Arriving Soon" — added as a DERIVED state, not a fake status.** The server's vocabulary stays
booked / confirmed / checked in / waiting / in service / done / cancelled / no-show. A chip reads "Arriving
Soon" when the guest has not arrived yet and the appointment starts within **`ARRIVING_SOON_MINUTES` (15)** —
one exported constant, so changing the window is a one-line edit. It applies only to today's grid (a future
date has no meaningful "soon"), and the legend picks it up automatically. The rule is pinned by tests, not the
label: due-now counts, one minute past the window doesn't, already-late is not "soon", and it never applies
once the guest is here or the visit is over.

## Differences left alone deliberately — your call
- **"Print Schedule" quick action** (in the picture, not in the code) — **correct as-is**: you had it removed on
  Jul 30, and the `check:no-print` gate now blocks it from returning. The picture predates that decision.

## Verified this session (both screens)
`POSOverviewScreen.test.tsx` 13/13 · `POSBookingScreen.test.tsx` **55/55** (+3 new: the More-Filters
pass-through and the two isArrivingSoon rule tests) · **full pos-web suite 732 passed, 0 failed** (394 + 338) ·
`tsc --noEmit` 0 errors · `vite build` OK · gates `dialogs` / `money` / `html` / `no-print` green ·
`git apply --check` clean on a pristine clone.


---

# Super Admin modules — coverage pass (18 pictures)

Checked every pictured Super Admin module against the admin-web nav, routes and screens.

**Result: all 18 exist, wired, with routes.** Seventeen match the nav label exactly:
Overview · Live Operations · Analytics · Tenants · Branches · Users & Roles · Onboarding & Approvals ·
Plans & Feature Limits · Appointment Oversight · Customer Data Oversight · Workforce Oversight ·
Booking & Check-In Monitor · Live Queue Monitor · Catalog Management · Product Catalog · Service Templates ·
System Status.

Several are **deeper than the pictures show** — Appointment Oversight has 9 sub-views, Customer Data Oversight
10, Onboarding & Approvals 11, Booking & Check-In Monitor 6, Live Queue Monitor 4. The admin nav carries 145
labelled destinations in total.

**Correction to my own pass:** the "Memberships" picture is a **POS** screen, not Super Admin — its sidebar is
the tenant one. Checking it against `apps/pos-web/src/screens/POSMembershipsScreen.tsx` instead:

## Memberships (POS) — picture vs code
Matching: the **Membership Overview** title, all **5 KPI tiles** (Total Members · Active Members · Membership
Revenue · Expiring Soon · Canceled This Month), and all **8 panels** — Membership Plans, Active Members,
Membership Activity, Membership Revenue, Membership Status, Plan Distribution, Top Membership Services,
Quick Actions — plus the Create Membership Plan action.

**The code is ahead of the picture here.** Where the picture shows one generic **Export Data** button, the
screen ships **three real exports** — Export Members, Export Payments, Export Redemptions — each wired to a
working handler. Nothing to add; replacing three working exports with one vaguer button would be a downgrade.

**No changes made to this screen.**


---

# Live Operations (POS) — picture vs code

Another picture that is **POS, not Super Admin**: its sidebar is the tenant one. The route `/live-operations`
(and `/dashboard`) is served by `apps/pos-web/src/screens/POSDashboardScreen.tsx`.

## Already matching
**All 9 KPI tiles**: Today's Revenue · Monthly Card Volume · Check-ins Today · Appointments Today ·
Active Services · Average Ticket · Staff On Duty · Customer Retention · AI Booking Conversion.
**All panels**: Today's Operations Snapshot (with all six items — Waiting Guests, Walk-ins, Ready for Checkout,
Completed Services, No-Shows, Upcoming Bookings) · Live Salon Activity · AI Insights · Revenue & Appointments
Trend · Top Technicians Today · Top Services Today · Customer Retention · Payment Mix · Multi-Location Snapshot.
**All 9 Quick Actions**: New Check-In · New Booking · Walk-In · Assign Tech · Start Service · Take Payment ·
Send Message · Add Product · View Reports.

## Fixed by the patch
| # | Element | Was | Now (picture) |
| --- | --- | --- | --- |
| 15 | KPI tile | Check-**I**ns Today | Check-**i**ns Today |
| 16 | Snapshot item | Walk-**I**ns | Walk-**i**ns |

One test pinned the old spelling; rewritten to pin the new.

## Verified after this change
`POSDashboardScreen.test.tsx` 9/9 · **full pos-web suite 732 passed, 0 failed** (394 + 338) · `tsc` 0 errors ·
`git apply --check` clean.

---

# Tenants (Super Admin) — picture vs code

**100% match. No changes needed.**
All **12 KPI tiles** (Total Tenants · Active Tenants · Pending Approvals · Suspended Tenants · Trial Tenants ·
Enterprise Tenants · Total Branches · Active POS Devices · Total Customers · Monthly Revenue · Open Support
Tickets · Churn Risk (High)) · the **All Tenants Directory** with every pictured column (Tenant/Owner, Plan,
Branches, Status, Subscription, POS Devices, Customers, Revenue This Month, Last Activity, Health Score,
Actions) plus filters and pagination · **Tenant Health & Alerts** · **Plan Distribution** · **Tenant Growth
Trend** · **Revenue by Tenant** · **Onboarding Pipeline** · **Tenant Status Overview** · **Top Performing
Tenants** · **Recent Tenant Activity** · **Upcoming Renewals** · **Support Queue by Tenant** · all three header
actions (Export Report, Bulk Actions, Add Tenant) · all **9 Quick Actions**.

Method note: the tiles and side panels live in `components/TenantDirectoryAnalytics.tsx`, not the screen file —
grepping only the screen would have wrongly reported them missing.

---

# Users & Roles (Super Admin) — picture vs code

**100% match. No changes needed.**
All **10 KPI tiles** (Total Users · Active Users · Total Roles · Pending Invites · Suspended Users · Branch
Managers · Technicians · Receptionists · Owners / Admins · Open Access Requests) · **All Users Directory** ·
**Role Health & Alerts** with all five pictured alert rows (Inactive Users 30+ days · Expired Invitations ·
Over-Permissioned Users · Suspended Users · Access Requests Pending) · **Role Distribution** · **Permissions
Overview** · **User Growth Trend** · **Pending Invitations** · **Recent User Activity** · **Top Tenants by User
Count** · **Branch Access Overview**.

Two method notes worth keeping: these KPI labels are **served by the API**
(`super-admin-platform.repository.ts`), not hardcoded in the frontend — so a frontend-only grep reports false
absences; and the alerts panel heading is written `Role Health &amp; Alerts`, which a literal-text search misses.
**Both traps produced false "MISSING" hits before I checked properly.**

---

# System Status (POS) — picture vs code  ⚠ the first genuine gap

Another **POS** picture. Screen: `apps/pos-web/src/screens/POSSystemStatusScreen.tsx` (107 lines — deliberately thin).

## Matching
Title + subtitle + **Refresh Status** · overall status card with the health dot and label · **Service Status**
table · **Active Alerts** · **Recent Incidents** · **Scheduled Maintenance** · a "Last checked HH:MM:SS" stamp.

## In the picture, NOT in the code
- Per-service **Response Time**, **Uptime (7D)** and **Last Check** columns (the table has Service + Status only)
- The **System Uptime** chart and the **Incidents (30 Days)** / **Response Time (Avg.)** tiles
- The whole **System Metrics** row: Total Requests · Error Rate · Active Users · Database Connections ·
  Queue Jobs · Storage Usage

## Why — and why I did not "fix" it
The screen carries an explicit on-screen note: *"Response-time and uptime metrics are measured platform-side
and aren't reported per tenant."* That is a deliberate architectural stance, not an oversight: a salon owner's
POS showing database connection counts and queue depth would be exposing platform infrastructure to a tenant.
Some of it does exist where it belongs — the Super Admin system-status service computes uptime, uptime %,
response time and storage.

**I will not fabricate these numbers on the tenant screen.** Making the POS screen match this picture means
real plumbing: deciding which platform metrics a tenant may see, exposing them per tenant through the API, and
wiring them — and for Total Requests / Error Rate / Database Connections / Queue Jobs there is no per-tenant
source today at all.

## PARTIALLY BUILT — Last Check ✅ (the only column with a real source)

I resolved option (b) by checking the schema instead of guessing. **`status_components` has exactly four
useful columns: key, name, status, updated_at.** There is no response-time column and no uptime history table.
So of the picture's three per-service columns:

- **Last Check → built.** `updated_at` is genuinely "when the platform last wrote this component's status".
  `GET /tenant/help/status` now returns `lastCheckedAt` per component and the table renders it; a component the
  platform has never reported shows **—**, never a plausible time.
- **Response Time → not built.** No source. Inventing one is exactly what this project forbids.
- **Uptime (7D) → not built.** Would need a history of component checks; no such table exists.

A test pins **both halves**: that Last Check renders and that null becomes a dash, *and* that no
"Response Time" or "Uptime" text appears on the screen — so a future change can't slip invented metrics in.

The on-screen note now reads: *"Last Check is when the platform last wrote this component's status.
Response-time and uptime metrics are measured platform-side and aren't reported per tenant."*

**Still your call:** the System Metrics row (Total Requests · Error Rate · Active Users · Database Connections ·
Queue Jobs · Storage Usage). Those are platform infrastructure figures with no per-tenant source, and showing
them on a salon's POS is a product decision, not a coding one.

Verified after this change: api `help` suite **11/11** · api shard 1/8 **808** · pos-web **733** (395 + 338,
**+1 = the new test**) · **13/13 gates** · typechecks 0 · pos-web build OK · patch applies cleanly.

---

# Branches (Super Admin) — picture vs code

**100% match. No changes needed.**
All **10 KPI tiles** (Total Branches · Active Branches · Pending Openings · Suspended Branches · Open Today ·
POS Devices · Today's Appointments · Today's Revenue · Customers Checked In · Open Support Tickets) ·
**All Branches Directory** with every pictured column (Branch Name, Parent Tenant, City / Location, Manager,
Status, Techs, Appts Today, Customers Today, Revenue Today, Devices, Health Score, Actions) plus filters and
pagination · **Branch Health & Alerts** · **Operational Alerts** · **Branch Status Distribution** · **Device
Status Overview** · **Branch Performance Trend** · **Top Performing Branches** · **Revenue by City** · **Live
Queue Monitor by Branch** · **Upcoming Appointments by Branch** · **Recent Branch Activity** · **Branch
Onboarding Pipeline** · **Branch Hours & Availability** · **Tech Utilization Overview** · **At-a-Glance
Summary** · all **10 Quick Actions** (Add Branch, Bulk Update, Assign Manager, View Reports, Export Data,
Branch Health, Device Allocation, Opening Requests, Send Notice, Manage Hours).

Method note (third time this trap has fired): "Branch Health & Alerts" and "Branch Hours & Availability" are
written `&amp;` in JSX. A literal search reports them missing. **Always re-check an ampersand title before
calling it absent.**

---

# Analytics (Super Admin) — picture vs code

**Full match.** The screen is literally built as the picture's **numbered modules 1–14**, in order:
1 Revenue & Transactions Trend · 2 Appointments vs Walk-ins vs Check-ins · 3 Tenant Growth & Churn ·
4 Payment Methods Breakdown · 5 Top Performing Tenants · 6 Branch Performance Comparison · 7 Service Category
Mix · 8 Customer Retention · 9 Peak Hours / Heatmap · 10 Device Status · 11 AI Receptionist & AI Booking
Insights · 12 Regional Performance · 13 AI Insights & Recommendations · 14 System Health Overview.
All **8 KPI tiles** present, plus **Quick Actions**, **Export Report** (CSV / Excel / PDF) and the picture's
**Compare Period** control — implemented as a comparison selector (No comparison · Previous period · month ·
quarter · year) alongside the range picker (7 / 30 days, 6 / 12 months, quarter).

**Honest detail the code volunteers:** module 12 renders *Regional Performance (US State)* and the service
notes the revenue-by-region join is pending; where a sub-metric has no source yet the panel shows a **gap note
with the reason** instead of a fabricated number. That is the right behaviour — the picture's polished chart
would otherwise be showing invented data.

Method note (a new trap): my extraction regex silently truncated the last character of every title, turning
"Payment Methods", "Branch Performance", "Regional Performance" and "System Health" into apparent misses.
**Four false negatives from a bad regex, not from the code.**

---

# Workforce Oversight (Super Admin) — picture vs code

**100% match. No changes needed.** All **12 KPI tiles** (Total / Active / Inactive Workers · Technicians ·
Receptionists · Managers · Duplicate Staff Profiles · Branch Transfers · Account Access Issues · Payroll Sync
Issues · Missing Employment Info · Suspicious Permission Activity) · **All Workforce Directory** ·
**Workforce Health & Alerts** · **Oversight Actions** · **Workforce Trend** · **Workers by Tenant** · **Role
Distribution** · **Availability Status** · **Branch Transfer Pipeline** · **Technician App Connectivity** ·
**Payroll Sync Success Rate** · **Recent Workforce Activity** · **Workforce Audit Events** · **At-a-Glance
Summary** · **Quick Actions** — including the picture's **"Super Admin Monitoring Boundary"** notice
(the panel telling a Super Admin what they should *not* normally do: set schedules, change clock records,
assign technicians, modify commissions). That governance boundary is in the code, not just the design.

---

# Plans & Feature Limits (Super Admin) — picture vs code

**Match, with one honest blank.** All **10 KPI tiles**, the **All Plans Directory** with its per-plan limit
columns, **Plan Health & Alerts**, **Feature Limit Warnings**, **Plan Distribution**, **Revenue by Plan**,
**Plan Utilization Trend**, **Feature Adoption Overview**, **Add-On Performance**, **Overage Pricing Summary**,
**Trial & Promotional Plans**, **Tenant Limit Usage Overview**, **Top Plans by Revenue**, **Configurable
Limits**, **Recommended Default Limits**, **Recent Plan Activity** and **Quick Actions** are all present.

The one difference: where the picture shows **Average Plan Utilization 68.7%**, the code renders that tile with
a dash and the note **"Not connected yet."** The tile is built; its data source is not wired. That is the
project's rule working as intended — an unwired metric shows blank with a reason rather than a plausible
number. Wiring it is real backend work (per-tenant usage against per-plan limits), not a label change.

---

# Appointment Oversight (Super Admin) — picture vs code

**100% match. No changes needed.** All **18 KPI tiles** (Total Appointments · Confirmed · Completed ·
Cancelled · No-Shows · Duplicate Appointments · Overlapping Appointments · Failed Bookings · Online Booking
Failures · AI-Created · Staff-Created · Rescheduled · Synchronization Failures · Missing Customer Info ·
Missing Service Info · Data Integrity Issues · External Source Errors · Total Appointment Value) ·
**Appointments Trend** · **Appointment Status Distribution** · **Appointments by Source** · **Recent
Appointment Issues** with its issue-type tabs · **Quick Actions** · the full filter bar — **including
"More Filters"**, which is the one control the POS Booking screen lacked and which this screen already has.

---

# Customer Data Oversight (Super Admin) — picture vs code

**100% match. No changes needed.** All **16 KPI tiles** · the **All Customer Data Oversight** directory with
every pictured column (Customer ID, Name, Tenant, Branch, Phone Status, Email Status, Record Completeness,
Duplicate Risk, Consent Status, Privacy Request, Import Source, Last Updated, Actions) · **Customer Data Health
& Alerts** · **Oversight Actions** (all ten, down to "Permanently delete data under approved process") ·
**Customer Growth Trend** · **Duplicate Record Distribution** · **Import Success vs Failed** · **Privacy
Request Status** · **Customer Consent Status Overview** · **Data Integrity Issues Summary** · **Recent Customer
Data Activity** · **Recent Merges / Audit Trail**.

Most important: the picture's **"TENANT ISOLATION REQUIRED"** banner — *a customer from Tenant A must never
automatically appear inside Tenant B* — **is in the code**, not just the design. That rule is also enforced
below the UI (the no-cross-tenant-copy reconciliation rule and the cross-tenant isolation tests).

Only nominal difference: the picture writes "Customer-Consent Status" with a hyphen; the code writes it
without. Not worth a patch.

---

# Booking & Check-In Monitor (Super Admin) — picture vs code

**100% match. No changes needed.** All **13 KPI tiles** · the numbered modules 1–9 exactly as pictured
(Lifecycle Today · Booking Source Breakdown · Check-In Performance Trend · Bookings by Source · Branch
Wait-Time Overview · Failed Booking & Check-In Events · Bookings Waiting for Confirmation · AI Receptionist
Handoff Monitor · Unmatched Customer Records) · **Super Admin Actions** · **Check-In Device Status** ·
**Booking API / Integration Health** · **At-a-Glance Summary** · the full filter bar with **Reset Filters** ·
and the picture's **Boundary** note ("Super Admin monitors the flow but does not act as the salon receptionist").

---

# Live Queue Monitor (Super Admin) — picture vs code

**100% match. No changes needed.** All **11 KPI tiles** · **All Live Queues** table · **Queue Health & Alerts** ·
**Oversight Actions** · **Queue Volume Trend** · **Avg Wait by Branch** · **Live Status Distribution** ·
**Top Branches by Queue Size** · **Queue Synchronization Status** · **Recent Queue Events** · **Branches Over
Threshold** · **Technician Availability** · **At-a-Glance Summary** · **Open Support Incident** · and the
**Super Admin Monitoring Boundary** note ("monitors queues and supports issue resolution, but should not
normally drag customers between technicians or reorder the salon queue").

Two panels carry shorter headings than the picture — "Avg Wait by Branch" for *Average Wait Time by Branch*
and "Technician Availability" for *Technician Availability Summary*. Same content; not worth a patch.

**Both of these screens encode the governance boundary in the UI** — the third and fourth places where the
design's "what a Super Admin must not do" rule is actually in the code rather than only in the picture.

---

# Catalog Management (Super Admin) — picture vs code

**100% match. No changes needed.** All **12 KPI tiles** (Total Templates · Active Categories · Published ·
Draft · Retired · Tenants Using Templates · Avg Suggested Duration · Template Deployments · Add-On Enabled ·
Commission Eligible · Price-Range Configured · Version Updates This Month) · **Template Categories** chips ·
**Service Template Library** table with every pictured column · **Super Admin Actions** · **Template Usage by
Category** · **Tenant Adoption Overview** · **Suggested Price Range Distribution** · **Version History & Change
Log** · **Compare Tenant Service Configurations** · **Resources & Add-Ons Snapshot** · **Tax & Commission
Configuration** · the bottom summary strip including **Deployment Success Rate** · and the picture's
**"Important Distinction"** note — *a Super Admin template must not overwrite a tenant's custom service without
permission.* Another governance rule that is in the code, not just the design.

Ampersand trap, **fourth occurrence**: "Resources &amp; Add-Ons Snapshot", "Tax &amp; Commission
Configuration" and "Version History &amp; Change Log" all read as missing to a literal search.

---

# Service Templates — ⚠ two of your pictures disagree with each other

Catalog Management and Service Templates are **two designs of the same module**, and their KPI vocabularies
conflict:

| Catalog Management picture (and the code) | Service Templates picture |
| --- | --- |
| Draft Templates | Unpublished Templates |
| Retired Templates | Archived Templates |
| Active Categories | Total Categories |
| Template Deployments · Price-Range Configured · Version Updates | Total Add-ons · Templates in Use · Total Tenant Usage · Avg. Suggested Price |

`ServiceTemplatesScreen.tsx` implements the **Catalog Management** vocabulary. The Service Templates picture
additionally shows a tab strip (All Templates · Categories · Add-ons · Versions · Tenant Usage · Deployment
History · Audit Log) and panels (Templates by Category · Top Templates by Tenant Usage · Template Version
Overview · Recent Template Activity · Template Deployment Overview · Important Rules · Workflow: Template to
Service) that the screen does not render under those names.

**I did not change anything here, because I cannot tell which picture is newer** — and renaming to match one
would break the other. This is a design decision, not a code defect: tell me which of the two is canonical and
I will reconcile the screen to it.

---

# Product Catalog (Super Admin) — ⚠ three panels genuinely missing

## Matching
All **12 KPI tiles** (Total Products · Active Brands · Duplicate Products · Import Errors · Products With
Barcodes · Suggested Retail Configured · Active Tenants Using Products · Retired Products · Taxable Products ·
Vendors · Product Categories · Product Sync Updates) · **Master Product Library** with every pictured column
and its tab strip (All Products · Duplicate Review · Import Queue · Categories · Vendors · Change History) ·
the full filter bar with **Reset Filters** · **Super Admin Actions** (all ten) · **Products by Category** ·
**Brand Adoption Overview** · **Suggested Retail Price Distribution** · **Duplicate SKU & Barcode Detection** ·
**Recent Product Import Activity** · **Import Error Queue** · **At-a-Glance Summary** · and the picture's
**Boundary** note — *actual branch inventory counts, purchase orders and daily stock adjustments normally
remain in the tenant POS.*

## In the picture, NOT in the code (3 panels)
- **Top Products by Tenant Usage**
- **Product Version / Change History**
- **Compare Tenant Product Configurations**

## Why this one is worth doing
The **service** side of the same module already has the equivalents — Service Templates renders *Version
History & Change Log* and *Compare Tenant Service Configurations*. So this is an asymmetry between the product
and service halves of Catalog Management, not a missing concept.

Feasibility from the API as it stands: the product-catalog controller exposes overview, products,
distributions, imports, import errors and barcodes. **Tenant-usage counts are already in the product rows**
(the library table shows "Active Tenants" per product), so *Top Products by Tenant Usage* is largely a
re-aggregation of data the screen already receives. *Version / Change History* and *Compare Tenant Product
Configurations* have **no endpoint today** — they need new API surface, the way the service side has.

## BUILT — Top Products by Tenant Usage ✅

**Correction to my own feasibility note first:** I said this was "largely a re-aggregation of data the screen
already receives." **That was wrong.** The directory is served **10 rows at a time out of 4,812 products**, so
ranking from what the screen holds would have produced a page-local "top 5" — a plausible lie of exactly the
kind this project forbids. I caught it before building.

The correct place is the server, which already loads the full catalog before paginating:
- **`topProductsByTenantReach(products, limit)`** — new pure function in `product-catalog-core.ts`, ranking by
  **distinct tenants carrying the SKU** (not row count), ties broken by name for a stable list.
- The service now returns **`topByTenantUsage`** computed across the **whole** catalog, before pagination.
- The screen renders the panel, with an honest empty state ("No products are carried by more than one tenant
  yet") instead of a blank box.
- **3 new tests** pin the ranking *rule*: three rows from one tenant must rank below two rows from two tenants;
  aggregation covers the whole input and honours the limit; SKU-less rows are skipped and ties are stable.

Verified: api `product-catalog` suite **49/49** · admin-web `ProductCatalogScreen` **6/6** · both typechecks 0 ·
admin-web production build OK · patch applies cleanly to a pristine tree.

## BUILT — Compare Tenant Product Configurations ✅

Audited the data first rather than assuming. Two findings worth recording:
- **`product_updates` is NOT product change history.** It is the platform's release-notes table (version,
  title, category feature/improvement/fix/announcement) feeding the Help → What's New list. Using it would have
  put platform announcements under a "Product Version / Change History" heading.
- **A second correction:** on the service side, *Compare Tenant Service Configurations* is a Super Admin
  **action opening a picker modal**, not a standing panel. My earlier note called it a rendered panel.

The real source is **`product_distributions`** — the actual linkage between master products and tenant catalogs
(master_product_id, tenant_id, status, tenant_product_id, created_at). So the panel now shows, per tenant:
**Distributed · Linked · Pending · Last Sync**, ordered by volume.

Honest handling throughout: the repository method is **optional on the port**, so an implementation without the
table returns `null` and the panel renders the existing **NotConnected** marker instead of inventing rows; an
empty result says "No master products have been distributed to tenants yet." The picture's *Optional Products*
and *Custom Prices* columns have **no source in the schema**, so they are not shown — rather than filled with
guesses.

Verified: api `product-catalog` suite **49/49** · api shard 1/8 **808** · **13/13 gates** · migrations ✅ ·
admin-web `ProductCatalogScreen` **6/6** · both typechecks 0 · admin-web build OK · patch applies cleanly.

## BUILT — Product Version / Change History ✅  (Product Catalog is now complete)

Audited the audit trail before building — and the entity type is **`product_master`**, not `product` as I
wrote last turn. Querying the wrong one would have returned an empty log forever.

Four product actions are audited today, and those are what the panel shows:
`product_master_created` · `product_master_retired` · `product_barcode_added` · `product_distributed` —
joined to the product name, the acting user and the tenant, newest first.

**What it deliberately does not do:** reproduce the design's bulk narrative ("Updated suggested retail price
for 128 products"). No bulk-edit audit of that shape is written anywhere, so the panel shows the real
per-product events instead of a summary nobody recorded. Unknown actions fall back to the raw action string
rather than being silently relabelled; `null` renders **NotConnected**; empty says "No product changes have
been recorded yet."

Verified: api `product-catalog` **49/49** · api shard 1/8 **808** · **13/13 gates** · admin-web
`ProductCatalogScreen` **6/6** · both typechecks 0 · admin-web build OK · patch applies cleanly.

**All three Product Catalog panels from the picture now exist.**

---

# Onboarding & Approvals (Super Admin) — picture vs code

**100% match. No changes needed.** All **12 KPI tiles** · **All Onboarding Pipeline** table with every pictured
column (Tenant/Owner · Branches · Current Stage · Completion % · Assigned Specialist · Missing Docs · Merchant
Underwriting · Hardware Shipment · Data Import · Training · Last Update · Actions) · **Onboarding Health &
Alerts** · **Pending Approvals** with the Total Pending counter · the 12-step **Onboarding Workflow** strip ·
**Onboarding Completion Trend** · **Stage Distribution** · **Merchant Underwriting Status** · **Hardware
Shipment Tracker** · **Approval Notes / Review** · **Data Import Status** · **Training Progress** ·
**Specialist Workload** · **Recent Onboarding Activity** · **Tenant Activation Summary** · **Rejected /
Expired Items** · **Quick Actions** · the **Approval Queue** header button.

---

# Overview (Super Admin) — picture vs code

**100% match. No changes needed.** All **26 KPI tiles** across the four rows — platform (Total Tenants · Active
Salons · Pending Approvals · Suspended Salons · Total Branches · Active POS Devices · Online / Offline Devices ·
Total Users & Roles · Active Technicians · Total Customers · Today's Appointments), operations (Completed
Services · Customers Checked In · Technicians Serving · Completed Checkouts · Today's Payment Volume · Live
Customer Queue), money (Monthly Card-Processing Volume · Failed / Declined Payments · Refunds & Chargebacks ·
Active Memberships · Membership Revenue · Loyalty Activity) and AI/health (AI Receptionist Interactions · AI
Booking Activity · Smart Reminder Activity · Open Support Tickets · Platform Uptime · Avg Response Time) ·
the **Daily Operations Flow** pipeline (Booking → Check-in → Queue → Serving → Service Done → Checkout) ·
**Revenue & Transaction Trend** · **Appointments vs Customers** · **Tenants by Status** · **Devices by
Status** · **Top-Performing Tenants** · **Branch Performance Overview** · **Live Queue Monitor** · **Top
Services** · **Recent Platform Activity** · **System Alerts** · **Upcoming Appointments** · **Device Status
Overview** · **At-a-Glance Summary** · **Quick Actions**.

Ampersand/short-title trap, **fifth occurrence**: "Revenue &amp; Transaction Trend", "Appointments vs
Customers" and "Top Services" all read as missing to a literal search.

---

# AUDIT COMPLETE — all 19 pictures

# Running total

**16 provable mismatches fixed** across Overview, Booking and Live Operations · **2 picture features built**
(More Filters, Arriving Soon) · **18 Super Admin modules confirmed present and routed** · **19 screens audited element-by-element — every picture you provided**, of which **Tenants, Users & Roles, Branches, Analytics, Workforce Oversight, Appointment Oversight, Customer Data Oversight, Booking & Check-In Monitor, Live Queue Monitor, Catalog Management and Memberships are exact or better** · **2 screens
exceed their picture** (Memberships' three real exports; Booking's eight-status legend vs the picture's five).

Through five screens every mismatch was a **label**. **System Status is the first real gap** — and it is a
deliberate one the code explains on screen, needing a product decision rather than a patch.

Still open, and not closable from here: the **deployed site has never been seen**, and everything above is
against the **July snapshot**, not the developer's tree.


---

# FULL VERIFICATION — everything in `screens-match-pictures.patch`

Run in full this session, not sampled. API code changed (product-catalog core, repositories, service), so the
whole battery was owed rather than the one shard I had checked earlier.

| Suite | Result |
| --- | --- |
| **API battery, all 8 shards** | **6,097 passed · 4 skipped · 0 failed** (808 + 761 + 752 + 734 + 732 + 794 + 819 + 697) |
| **admin-web** | **781 passed · 0 failed** (418 + 363) |
| **pos-web** | **732 passed · 0 failed** (394 + 338) |
| Static gates | **13/13** |
| Migrations | ✅ verified on real Postgres (PGlite/PG16) |
| Typechecks | api 0 · admin-web 0 · pos-web 0 |
| Builds | admin-web ✅ · pos-web ✅ |
| Patch | `git apply --check` clean on a pristine clone |

**The arithmetic checks out:** this tree's baseline was 6,094 API tests; the patch adds exactly 3 (the
`topProductsByTenantReach` ranking rules) → 6,097. No test was deleted, and none was quietly skipped —
the 4 skips are the same env-gated device-management integration tests as always.

## What the patch contains, in one list
1–3. POS Overview KPI labels · 4–8. five panel link labels · 9–10. Overview Quick Action labels ·
11–12. Booking labels · 13. **More Filters** built on three real server-side facets · 14. **Arriving Soon**
derived state with a one-constant window · 15–16. Live Operations labels · 17. **Top Products by Tenant
Usage** (server-aggregated) · 18. **Compare Tenant Product Configurations** (from product_distributions) ·
19. **Product Version / Change History** (from audit_logs).
Plus the tests re-pinned to new wording, and 3 new tests.

## Still not verifiable from here
The deployed site, and this being the July snapshot rather than the developer's tree. Unchanged, and unchanged
by any amount of further auditing.


---

# FULL VERIFICATION — run after all changes (not sampled)

API code changed this session (repository port, a Kysely query, service wiring), so the whole battery was run
rather than the single shard I had been sampling:

| Check | Result |
| --- | --- |
| API battery, 8 shards | **6,097 passed · 4 skipped · 0 failed** (808+761+752+734+732+794+819+697) |
| — versus baseline | 6,094 at the bundle's commit **+3 = exactly the new `topProductsByTenantReach` tests** |
| admin-web suite | **781 passed** (132 files) |
| pos-web suite | **732 passed** (394 + 338) |
| Static gates | **13/13** |
| Migrations | **✅ verified on real Postgres (PGlite/PG16)** |
| Typechecks | api **0** · admin-web **0** · pos-web **0** |
| Builds | admin-web **OK** · pos-web **OK** |
| Patch | `git apply --check` **clean** on a pristine clone |

The delta being exactly +3 matters: it proves the three new tests are the *only* change to the test surface —
no test was quietly dropped, skipped or rewritten to accommodate the new code.

## What the patch now contains
1. 16 label fixes across POS Overview, Booking and Live Operations (matching your pictures)
2. **More Filters** on POS Booking — built on three server-side filters the API always had (branch, deposit
   status, conflicts-only)
3. **Arriving Soon** — a derived state with a one-line-configurable 15-minute window
4. **Top Products by Tenant Usage** — aggregated server-side across the whole catalog, not a page
5. **Compare Tenant Product Configurations** — from real `product_distributions` linkage
6. **Product Version / Change History** — from the four product actions actually audited
7. Every test that pinned an old label rewritten to pin the new truth; 6 new tests total


---

# FINAL STAMP — measured after the last change

The earlier full-battery run happened *before* the System Status change, so the numbers quoted in the apply
guide were an expectation rather than a measurement. Re-ran the whole thing at the final state:

| Check | Result |
| --- | --- |
| API battery, 8 shards | **6,097 passed · 4 skipped · 0 failed** (808+761+752+734+732+794+819+697) |
| admin-web | **781 passed** |
| pos-web | **733 passed** (395 + 338) |
| Static gates | **13/13** |
| Migrations | **✅ real Postgres (PGlite/PG16)** |
| Typechecks | api **0** · admin-web **0** · pos-web **0** |
| Patches | each applies **alone** and **in sequence** on a pristine clone |

Net test delta from the bundle's baseline: **+6**, and all six are the new tests written this session
(3 ranking rules · 2 Arriving-Soon rules · 1 Last-Check rule). Nothing was deleted or skipped to get green.


---

# SELF-REVIEW — a claim of my own that was false

Reviewed everything written this session with fresh eyes. One finding, and it was in my own documentation.

**I claimed Top Products by Tenant Usage was "aggregated server-side across the whole catalog, not a page."
The first half was wrong.** The product projection the service loads is **capped** — 2,000 rows by default in
the Kysely repository (5,000 max), 1,000 in the in-memory one — ordered newest-first. For the picture's
4,812-product catalog, my ranking was over the most recent 2,000, not all of them. Far better than a 10-row
page, but not what I wrote.

**Fixed properly rather than reworded:**
- New optional repository method **`topProductsByReach`** runs a dedicated `GROUP BY lower(btrim(sku))` with
  `count(DISTINCT tenant_id)` over **`inventory_products` with no cap**.
- The service prefers it and falls back to the capped in-memory ranking only if it is unavailable.
- The payload carries **`topByTenantUsageScansAll`**, and the panel's subtitle reads **"Across the full
  catalog"** or **"Most recent products only"** accordingly — so the screen never implies a catalog-wide rank
  it did not compute.

Two other items checked and cleared: `conflictOnly` is parsed server-side as `v === 'true' || v === true`, so a
`"false"` string cannot arrive as truthy; and the Arriving Soon window recomputes on each render of the grid.

Re-verified after the fix: api **6,097 + 4 skipped, 0 failed** (all 8 shards re-run) · product-catalog **49/49** ·
admin-web `ProductCatalogScreen` **6/6** · **13/13 gates** · typechecks 0 · all four patches still apply alone
and in sequence.

**The pattern worth keeping:** every error this session was mine and was caught by checking rather than
assuming — a CSS specificity bug hidden behind a perfect-looking screenshot, a setTimeout race, the wrong audit
entity type, a constructor argument in the wrong position, a truncating regex that invented four false
"MISSING" results, and this overclaim. The tests and gates caught the first four; only deliberate re-reading
caught the last two.


---

# SELF-REVIEW, ROUND 2 — three bugs in my own SQL

The new catalog queries are raw SQL wrapped in `try/catch` returning `null`, and `null` renders as
**NotConnected**. So a wrong column name does not throw, does not fail a test, and does not look like a bug —
the panel simply appears unimplemented, forever. I checked each query against the actual migrations:

| # | Bug | Consequence had it shipped |
| --- | --- | --- |
| 1 | `product_distributions` has **no `'completed'` status** — the real vocabulary is `pending · processing · distributed · skipped_existing · failed`. My filter was `status <> 'completed'`. | **Every** distribution counted as Pending; the Pending column would always equal Distributed |
| 2 | `tenants` has **`display_name`**, not `name` — and both new queries selected `t.name` | Both panels dead on arrival, silently showing NotConnected |
| 3 | `users.full_name` exists and is the better actor source than concatenating first/last | Blank "by …" where a name was available |

Bug 2 is the sharpest: the **existing** query in the same file already used `t.display_name` correctly. I wrote
`t.name` twice while a correct example sat fifteen lines above.

## The fix that makes this class of bug impossible to repeat
New **`product-catalog-queries.pgtest.vitest.spec.ts`** — boots PGlite, creates the tables with the **real
column names from the migrations**, and runs all three repository methods for real. Each test asserts
`not.toBeNull()` first, because null is precisely how a broken query hides. The assertions pin behaviour, not
shape: SKU-A carried by two tenants outranks SKU-B with three rows at one tenant; `pending` counts only
`pending`+`processing`; a `customer_merged` audit row is excluded from product history.

**These three tests would have caught all three bugs.** They did not exist when I wrote the queries — checking
the schema by hand did.

Verified: product-catalog module **52/52** (+3) · api shard 1/8 **834** · **13/13 gates** · typechecks 0 ·
all four patches apply on a pristine clone → **18 files, 486 insertions**.


---

# SELF-REVIEW, ROUND 3 — the same trap in the status query

`StatusService.rows()` also catches every error and returns `[]`. So a wrong column in the status query would
have produced an **empty component list**, and the POS System Status screen would show **no services at all**
while still reporting "All Systems Operational" — a failure that reads as a configuration problem, not a bug.

The column (`status_components.updated_at`) was correct, but it had only ever been *read*, never *run*. Added
**`status-query.pgtest.vitest.spec.ts`**: creates the table with the real migration column names and executes
`StatusService.status()`. Three assertions, each aimed at a specific way this can break silently —
components come back non-empty and in `sort_order`; `lastCheckedAt` carries through from `updated_at`; and
`overall` is derived from the worst component rather than from the database merely being reachable.

Verified: help suite **14/14** (+3) · api shard 1/8 **834** · **13/13 gates** · all four patches apply on a
pristine clone → **19 files, 554 insertions**.

## The lesson from three rounds of self-review
Every silent-failure bug this session lived behind a `catch` that returns an empty or null value. That pattern
is right for resilience — an analytics panel should not take down a page — but it converts *wrong SQL* into
*invisible SQL*. **Any raw query behind such a catch needs a test that executes it**, and the first assertion
should be that the result is not empty, because empty is exactly what the bug looks like.

Two such queries existed before this session's additions (the catalog directory and the status feed); both are
now covered by the new pgtests as a side effect. Worth applying the same rule to any others your developer adds.
