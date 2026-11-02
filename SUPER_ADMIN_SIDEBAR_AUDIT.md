# Super Admin Sidebar Audit (verified)

Every row below was verified against `apps/admin-web/src/shell/AdminLayout.tsx` (nav) and `apps/admin-web/src/App.tsx`
(routes). **Dead links: 0** — all 71 sidebar paths resolve to a declared route (78 `<Route>` entries). The nav is a
**superset** of the official 40-item list: every official item is present and correctly sectioned; extras (Platform
Dashboard, Report Builder, Website Leads, Hardware suite, AI Receptionist, etc.) are additional wired modules.

Backend wiring for these routes was separately verified live this session: all 313 Super Admin GET endpoints were hit
against a real Postgres and returned real data with **0 server errors**.

| # | Section | Official item | Route | Status |
|---|---|---|---|---|
| 1 | Platform Overview | Overview | `/dashboard` | Present, routed, real-data |
| 2 | Platform Overview | Live Operations | `/live-operations` | Present, routed, real-data (KPIs + monitor + health) |
| 3 | Platform Overview | Analytics | `/analytics` | Present, routed |
| 4 | Tenant Management | Tenants | `/tenants` | Present, routed |
| 5 | Tenant Management | Branches | `/branches` | Present, routed |
| 6 | Tenant Management | Users & Roles | `/users-roles` | Present, routed |
| 7 | Tenant Management | Onboarding & Approvals | `/onboarding` (+11 submenu) | Present, routed |
| 8 | Tenant Management | Plans & Feature Limits | `/plans` | Present, routed |
| 9 | Operations Oversight | Appointment Oversight | `/appointment-oversight` (+9 submenu) | Present, routed |
| 10 | Operations Oversight | Customer Data Oversight | `/customer-data-oversight` (+9 submenu) | Present, routed |
| 11 | Operations Oversight | Workforce Oversight | `/staff` (+7 submenu) | Present, routed |
| 12 | Operations Oversight | Booking & Check-In Monitor | `/booking-checkin` (+6 submenu) | Present, routed |
| 13 | Operations Oversight | Live Queue Monitor | `/queue-management` (+4 submenu) | Present, routed |
| 14 | Operations Oversight | Catalog Management | `/services` | Present, routed |
| 15 | Operations Oversight | Service Templates | `/service-templates` | Present, routed |
| 16 | Operations Oversight | Product Catalog | `/product-catalog` | Present, routed |
| 17 | Payments & Revenue | Payments & Transactions | `/payments-transactions` | Present, routed |
| 18 | Payments & Revenue | Merchant Accounts | `/merchant-accounts` | Present, routed |
| 19 | Payments & Revenue | Settlements & Deposits | `/settlements-deposits` | Present, routed |
| 20 | Payments & Revenue | Chargebacks & Disputes | `/chargebacks-disputes` | Present, routed |
| 21 | Payments & Revenue | Revenue & Refunds | `/platform-reports` | Present, routed |
| 22 | Business Management | Marketing & Campaigns | `/marketing-campaigns` | Present, routed |
| 23 | Business Management | Promotions & Offers | `/promotions-offers` | Present, routed |
| 24 | Business Management | Loyalty Programs | `/loyalty-programs` | Present, routed |
| 25 | Business Management | Communications | `/communications` (+inbox) | Present, routed |
| 26 | Business Management | Memberships | `/membership-programs` | Present, routed — **labeled "Membership Programs"** (minor label delta; `/memberships` redirects here) |
| 27 | AI & Automation | AI Insights | `/ai-insights` | Present, routed |
| 28 | AI & Automation | AI Reports | `/ai-reports` | Present, routed |
| 29 | AI & Automation | Smart Reminders | `/smart-reminders` (+performance) | Present, routed |
| 30 | AI & Automation | Automation Rules | `/automation-rules` | Present, routed |
| 31 | AI & Automation | AI Usage & Configuration | `/ai-usage-configuration` | Present, routed |
| 32 | System Settings | General Settings | `/settings` | Present, routed |
| 33 | System Settings | Billing & Subscriptions | `/subscriptions` (`/billing` redirects here) | Present, routed |
| 34 | System Settings | Integrations | `/integrations` | Present, routed |
| 35 | System Settings | Device Management | `/devices-management` | Present, routed |
| 36 | System Settings | Security & Compliance | `/security-compliance` | Present, routed |
| 37 | System Settings | Audit Logs | `/audit-logs` (+browse) | Present, routed |
| 38 | Support | Support Center | `/support-access` | Present, routed |
| 39 | Support | System Status | `/system-status` | Present, routed |
| 40 | Bottom status | All Systems Operational | footer badge | **Now wired to real `/super-admin/system-health`** (was hardcoded) — see below |

## Ordering (now conformed)

The 8 sidebar **sections already matched** the official order. Within each section, the official items are now placed
**first, in the exact official order**, with the extra working modules preserved immediately after (none removed —
per the rule against deleting wired code). Reorder applied to Platform Overview, Tenant Management, Payments & Revenue,
Business Management, and AI & Automation; Operations Oversight, System Settings, and Support were already conformant.
Verified after reorder: `tsc` clean, **0 dead links** (71/71 nav paths routed), shell/Live-Ops/Dashboard tests 22/22.

## Remaining minor delta (not a defect)

- **#26 label:** shown as "Membership Programs" rather than "Memberships". Left intentionally: the *page itself* is
  titled "Membership Programs" (its KPIs read "Total Membership Programs", etc.), so renaming only the nav label would
  create a nav-vs-page mismatch. The official `/memberships` path already redirects to `/membership-programs`.

## Fixes applied this pass

1. **`DashboardScreen` quick action "Open Live Operations"** now links to `/live-operations` (was `/platform-dashboard`).
2. **Footer platform-status badge (#40)** was a hardcoded "All Systems Operational" string. It is now derived from the
   real `GET /super-admin/system-health` probe: `All Systems Operational` only when health reports ok; otherwise
   `Degraded`, `Database Outage`, `Status Unavailable`, or `Checking status…` — never a fabricated "Operational".

## Verification (fresh this pass)

- Backend DI: `DI_GRAPH_OK`. admin-web `tsc`: clean. admin-web production build: success.
- admin-web tests: **740/740 passing** (127 files, 3 shards). Shell + Live Operations + Dashboard: 22/22.
- API: DI + build clean; a fresh API vitest shard ran 669/669. (Full ~5,700-test API suite exceeds a single run window.)
