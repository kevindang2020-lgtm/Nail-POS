# REUSE & DUPLICATION MAP — AI PowerSalon (Phase 0)

Decision codes: **KEEP** (use as-is + align visuals) · **EXPAND** (extend existing) · **MERGE** (fold duplicates into one canonical) · **CONNECT** (wire existing FE↔BE) · **BUILD** (genuinely missing). No feature is rebuilt where a working implementation exists.

| Feature / module | Files found | FE | BE | API | Tables | Tests | Mock data? | Tenant-safe | Canonical | Action | Reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Check-In | pos-web POSCheckInScreen; api `check-in/*` | ✅ | ✅ | /pos/check-in | Appointments, PosQueueItems, Tickets | ✅ | no | ✅ | pos-web + api/check-in | KEEP+align | full, verified this session |
| Booking | POSBookingScreen; api `booking/*` | ✅ | ✅ | /pos/booking | Appointments, AppointmentServiceLines | ✅ | no | ✅ | same | KEEP+align | conflict-validated |
| Tech Queue | POSTechQueueScreen; api `tech-queue/*` | ✅ | ✅ | /pos/tech-queue | PosTechQueueTickets | ✅ | no | ✅ | same | KEEP+align | tiles wired today |
| Customer Queue | POSQueueScreen; api `queue/*` | ✅ | ✅ | /pos/queue | PosQueueItems | ✅ | no | ✅ | same | KEEP+align | Return Rate wired today |
| Serving | POSServingScreen; api `serving/*` | ✅ | ✅ | /pos/serving | Tickets, TicketServiceLines | ✅ | no | ✅ | same | KEEP+align | satisfaction/on-time wired |
| Service Done | POSServiceDoneScreen; api `service-done/*` | ✅ | ✅ | /pos/service-done | Tickets | ✅ | no | ✅ | same | KEEP+align | tips/rebooking wired |
| Checkout | POSCheckoutScreen; api `checkout/*` | ✅ | ✅ | /pos/checkout | Payments, PaymentRefunds, GiftCards, CustomerWalletLedger | ✅ | no | ✅ | same | KEEP+align | money paths race-safe |
| Payments core | api `checkout`, `payments`, `payment-*` | ✅ | ✅ | /pos/checkout, /webhooks | Payments, PaymentAttempts, PaymentIntents, PaymentSettlements, Chargebacks, Receipts | ✅ | no | ✅ | api/checkout+payments | EXPAND (T13 subsections) | Fiserv/Clover only; no Stripe/Square |
| Customers | POSCustomersScreen; api `customer*` | ✅ | ✅ | /pos/customers | Customers, CustomerNotes(Prefs/Notes), CustomerLoyaltyProfiles | ✅ | no | ✅ | pos-web | EXPAND (T10) | add segments/import/LTV |
| Team / Technicians | POSTechniciansScreen; api `technicians` | ✅ | ✅ | /pos/technicians | Technicians, TechnicianShifts/Schedules/Statuses, TechnicianServices | ✅ | no | ✅ | pos-web | EXPAND (T11) | add payroll/skills/approvals |
| Services & Products | POSServicesScreen + TenantInventoryScreen | ✅ | ✅ | /pos/services, inventory | ServicesCatalog, ServiceCategories, InventoryItems | ✅ | no | ✅ | merge to one screen | MERGE (T12) | two screens, one domain |
| Reports | POSReportsScreen; api `reports/owner` | ✅ | ✅ | /pos/reports, /owner | Tickets, Payments, Expenses | ✅ | no | ✅ | pos-web | KEEP+align (T17) | add report list rows |
| Cash mgmt | POSCashDrawer/Handoff; api cash | ✅ | ✅ | /pos/* | CashDrawerSessions/Movements, TechCashHandoffs | ✅ | no | ✅ | pos-web | KEEP (feeds T13/T18) | daily close |
| Loyalty / Wallet / Gift cards | api wallet, gift-card | ⚠️partial | ✅ | /pos/* | CustomerWalletLedger, LoyaltyRewards, LoyaltyRedemptions, CustomerLoyaltyProfiles, GiftCards, GiftCardTransactions | ✅ | no | ✅ | api/wallet | CONNECT+EXPAND (T15/S Loyalty) | ledger exists; needs UI surface |
| AI packages / subscriptions | admin AIPackages/AiSubscriptions; api `ai`, ai-billing | ✅ | ✅ | /ai, /super-admin | TenantAiPackages, TenantAiFeatures, TenantUsageLimits | ✅ | no | ✅ | api/ai | EXPAND (T16/S13–S16) | tenant AI Center + SA AI |
| Owner console | owner-web (20 screens) | ✅ | ✅ | /owner | Expenses, OwnerAlerts, OwnerAuditLog | ✅ | no | ✅ | reconcile into pos-web | MERGE/keep-companion | overlaps T18/T17/T02 |
| Super Admin shell | admin-web AdminLayout + 28 screens; api `super-admin` | ✅ | ✅ | /super-admin, /platform | Tenants, TenantSubscriptions, SupportAccessSessions, WebsiteLeads, TenantApplications, Hardware* | ✅ | no | ✅ | admin-web | **RESHAPE sidebar to S01 IA + EXPAND** | older IA; many S-screens missing |
| Devices | admin CheckInDevices/Hardware; api device/terminal | ⚠️partial | ✅ | /super-admin, /go-check-in | CustomerDisplayDevices, GoCheckinDevices, PosPaymentTerminals, DevicePushTokens | ✅ | no | ✅ | unify | BUILD unified fleet view (T19/S20) | tables exist, no fleet table/view |
| Audit | api audit logs; admin AuditLogs | ⚠️partial | ✅ | /super-admin | TechnicianAuditLogs, SettingsAuditLogs, OwnerAuditLog | ✅ | no | ✅ | unify | BUILD platform audit_events (S22) | domain logs only; no unified append-only store |
| Reminders / follow-ups | api follow-up engine | ⚠️partial | ✅ | /pos, /jobs | ServiceFollowUpTasks, DailyFollowUpSettings, DailyFollowUpGenerationRuns | ✅ | no | ✅ | api/follow-ups | EXPAND (S15) | rename/generalize to reminders |
| **Marketing campaigns** | — | ❌ | ❌ | — | — | — | — | — | NEW | BUILD (T15/S10) | genuinely missing |
| **Promotions / offers / coupons** | CustomerDeals (candidate) | ❌ | ⚠️ | — | CustomerDeals? | — | — | — | NEW | BUILD (T15/S11) | confirm CustomerDeals reuse, else new |
| **Communications inbox** | notifications plumbing only | ❌ | ⚠️ | /push | CustomerNotifications, NotificationDeliveryLogs | — | — | — | NEW | BUILD (T14/S12) | unified threads/messages missing |
| **Automation rules** | — | ❌ | ❌ | — | — | — | — | — | NEW | BUILD (S16) | missing |
| **Integrations / webhooks registry** | payment webhooks only | ❌ | ⚠️ | /webhooks | PaymentGatewayEvents | — | — | — | NEW | BUILD (T19/S19) | general registry missing |
| **Commission / payroll** | computed inline | ❌ | ⚠️ | /pos | (none dedicated) | — | — | — | NEW | BUILD (T11/T17) | no payroll period/commission tables |
| **Suppliers / purchase orders** | — | ❌ | ❌ | — | — | — | — | — | NEW | BUILD (T12/S07) | missing |

## Top duplication risks to resolve in Phase 1
1. **pos-web vs owner-web** overlap (Dashboard, Reports, Branch/Staff performance, Finance, Alerts, Audit). Canonical = pos-web tenant console; owner-web becomes a thin mobile companion that calls the same `/owner` + `/pos` services. Do not maintain two divergent report/finance implementations.
2. **admin-web sidebar IA** diverges from S01. Reshape the single `AdminLayout` NAV to the S01 order; keep existing extra modules under the correct S-group. Do not create a second SA shell.
3. **One shared component set.** pos-web and admin-web currently hand-style cards/tables. Phase 1 extracts canonical tokens + KpiCard/DataTable/ChartCard/FilterBar/Drawer/etc. used by both, with tenant vs SA variants — not per-module copies.
