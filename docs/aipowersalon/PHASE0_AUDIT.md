# AI PowerSalon — Phase 0 Audit (reference build package)

Per CLAUDE_MASTER_BUILD_PROMPT §2.3/§2.4: audit BEFORE implementation. Honest status; no claims of completion.

## Baseline verification (this session, REAL)
- api: tsc clean · 623 tests (90 files) pass
- pos-web: tsc clean · vite build OK · 84 tests (31 files) pass
- Earlier-verified: admin-web 168 · owner-web 85 · tech-web 74 · customer-web 136 · customer-display 26
- Canonical shell: apps/pos-web/src/shell/POSLayout.tsx (no duplicate sidebar/topbar/layout).
- Real stack proven this session: Postgres + 109 migrations + seed; API boots; OWNER login 200; /pos/overview/state returns real data.

## Reference → existing code map (44 screens)

### Tenant (T01–T21)
| Ref | Screen | Existing code | Status |
|---|---|---|---|
| T01 | Dashboard/Overview | POSOverviewScreen.tsx (default route) | EXISTS — align to ref |
| T02 | Analytics | POSDashboardScreen.tsx / Reports | PARTIAL |
| T03 | Check-In | POSCheckInScreen.tsx | EXISTS |
| T04 | Booking | POSBookingScreen.tsx | EXISTS |
| T05 | Tech Queue | POSTechQueueScreen.tsx | EXISTS |
| T06 | Customer Queue | POSQueueScreen.tsx | EXISTS |
| T07 | Serving | POSServingScreen.tsx | EXISTS |
| T08 | Service Done | POSServiceDoneScreen.tsx | EXISTS |
| T09 | Checkout | POSCheckoutScreen.tsx | EXISTS |
| T10 | Customers | POSCustomersScreen.tsx | EXISTS |
| T11 | Team | POSTechniciansScreen.tsx | EXISTS |
| T12 | Services & Products | POSServicesScreen.tsx + TenantInventoryScreen.tsx | EXISTS |
| T13 | Payments & Money | POSCashDrawerScreen.tsx + payments | PARTIAL |
| T14 | Communications | POSMessagesScreen.tsx | EXISTS |
| T15 | Marketing & Growth | — | MISSING/STUB |
| T16 | AI Center | FeaturePage / AI modules | PARTIAL |
| T17 | Reports | POSReportsScreen.tsx | EXISTS |
| T18 | Management | TenantLocationsScreen + settings | PARTIAL |
| T19 | Devices & Integrations | CheckInDevices (admin) / — | PARTIAL |
| T20 | Account | POSSettingsScreen.tsx | PARTIAL |
| T21 | Help Center | ComingSoon | MISSING/STUB |

### Super Admin (S01–S23)
| Ref | Screen | Existing code | Status |
|---|---|---|---|
| S01/S02 | Overview/Dashboard | DashboardScreen.tsx | EXISTS |
| S03 | Analytics | PlatformReportsScreen | PARTIAL |
| S04 | Branches | TenantsScreen / SuperAdminOwnersScreen | PARTIAL |
| S05 | Users & Roles | UsersRolesScreen.tsx | EXISTS |
| S06 | Services | — | MISSING |
| S07 | Products | — | MISSING |
| S08 | Appointments | — | MISSING |
| S09 | Payments & Transactions | HardwarePaymentsScreen / PaymentGateways | PARTIAL |
| S10 | Marketing & Campaigns | — | MISSING |
| S11 | Promotions & Offers | — | MISSING |
| S12 | Communications | — | MISSING |
| S13/S14 | AI Insights/Reports | AiSubscriptions / AIPackages | PARTIAL |
| S15 | Smart Reminders | — | MISSING |
| S16 | Automation Rules | — | MISSING |
| S17 | General Settings | SettingsScreen.tsx | EXISTS |
| S18 | Billing & Subscription | BillingScreen.tsx | EXISTS |
| S19 | Integrations | — | PARTIAL |
| S20 | Devices Management | CheckInDevicesScreen / HardwareScreen | EXISTS |
| S21 | Security & Compliance | — | MISSING |
| S22 | Audit Logs | AuditLogsScreen.tsx | EXISTS |
| S23 | Help Center | — | MISSING |

## Summary
- ~13/21 tenant screens EXIST and need a fidelity pass to the reference; ~8 are partial/missing.
- ~9/23 super-admin screens EXIST; the rest are partial/missing (Super Admin is less complete than Tenant).
- This is an alignment + gap-fill effort on an existing app — NOT a from-scratch build, and NOT a one-turn job.

## Recommended phase plan (one phase per chat, behind its test gate)
1. **Phase 1 — Tenant shell + T01 Overview** exact fidelity (logo, sidebar 248px, topbar, KPIs, all panels). [shell already aligned this session]
2. **Phase 2 — Tenant daily-ops T03–T09** (Check-In→Checkout) fidelity + workflow wiring + tests.
3. **Phase 3 — Tenant T10–T14** (Customers, Team, Services&Products, Payments, Communications).
4. **Phase 4 — Tenant T02,T15–T21** (Analytics, Marketing, AI Center, Reports, Management, Devices, Account, Help).
5. **Phase 5 — Super Admin shell + S01–S05**.
6. **Phase 6 — Super Admin S06–S23** (build missing screens against the SA shell).
Each phase: scan → implement → typecheck + build + tests → screenshot vs reference → then next.
