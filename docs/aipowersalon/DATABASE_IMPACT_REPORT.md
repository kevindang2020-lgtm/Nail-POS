# DATABASE IMPACT REPORT — AI PowerSalon (Phase 0)

Current: ~140 canonical tables (`kysely.types.ts`), 111 idempotent SQL migrations in `apps/api/db/migrations/`. New migrations are additive, start at **112+**, applied by sorted filename, integer-cents money invariant preserved.

## Domains already covered — REUSE (no new tables)
- **Identity/tenancy:** Tenants, Branches, Users, UserBranchAccess, Sessions/RefreshTokens, MfaFactors, PasswordResetTokens.
- **Customers/CRM:** Customers, CustomerAddresses, CustomerPreferences, CustomerNotifications, CustomerBlocks, CustomerReferrals, CustomerLoyaltyProfiles, CustomerFavoriteSalons/Techs, CustomerSocialProfiles, CustomerPhoneVerifications.
- **Catalog/inventory:** ServicesCatalog, ServiceCategories, InventoryItems (retail products), TechnicianServices.
- **Staff:** Technicians, GlobalTechProfiles, TechnicianShifts/Schedules/Statuses/BlockedTimes, TechSalonMemberships, TechnicianSkillChangeRequests, TechnicianNotifications/AuditLogs, TechPortfolioPhotos.
- **Booking/queue/serving:** Appointments, AppointmentServiceLines, PosQueueItems, PosTechQueueTickets, PosTechAppointments, Tickets, TicketServiceLines, TicketTipAllocations, TicketChangeRequests, TicketNumberCounters.
- **Payments/money:** Payments, PaymentAttempts, PaymentIntents, PaymentRefunds, PaymentSettlements, PaymentGatewayEvents, Chargebacks, Receipts, PosPaymentTerminals, TenantPaymentConfig; cash: CashDrawerSessions/Movements, CashPaymentConfirmations, TechCashHandoffs.
- **Loyalty/wallet/gift:** CustomerWalletLedger, LoyaltyRewards, LoyaltyRedemptions, GiftCards, GiftCardTransactions.
- **Subscriptions/AI/usage:** TenantSubscriptions, TenantAiPackages, TenantAiFeatures, TenantUsageLimits, TenantAppFlags.
- **Reminders/follow-ups:** ServiceFollowUpTasks, ServiceFollowUpTasks, DailyFollowUpSettings, DailyFollowUpGenerationRuns, NotificationDeliveryLogs, DevicePushTokens.
- **Devices (partial):** CustomerDisplayDevices/Sessions, GoCheckinDevices/Sessions/Logs, PosPaymentTerminals.
- **Audit (partial):** TechnicianAuditLogs, SettingsAuditLogs, OwnerAuditLog.
- **Platform ops:** TenantApplications, WebsiteLeads, SupportAccessSessions, Hardware* (billing/payoff/reconciliation), Expenses, Reviews, NailShowcase*.

## Genuinely missing — NEW migrations needed (additive, 112+)
| Domain | New table(s) (proposed) | Screens | Notes |
|---|---|---|---|
| Marketing | campaigns, campaign_sends, customer_segments | T15, S10 | attribution to tickets/payments |
| Promotions | promotions/offers, coupon_redemptions (confirm CustomerDeals reuse first) | T15, S11 | validation at checkout already partial |
| Communications | communication_threads, communication_messages, message_templates, opt_outs | T14, S12 | reuse NotificationDeliveryLogs for status |
| Reminders | generalize follow-ups → reminders, reminder_runs | S15 | extend existing engine, do not fork |
| Automation | automation_rules, automation_runs (DLQ/retry) | S16 | idempotent + quiet-hours + consent |
| Integrations | integrations, webhook_endpoints, webhook_deliveries | T19, S19 | per-tenant creds, masked secrets |
| Audit (unified) | audit_events (append-only) | S22, all | unify domain logs; immutable financial/security events |
| Devices (unified) | devices fleet (or a cross-table view) | T19, S20 | normalize display/checkin/terminal/printer |
| Payroll/commission | commission_entries, payroll_periods | T11, T17 | commission currently computed inline |
| Suppliers | suppliers, purchase_orders, purchase_order_lines | T12, S07 | reorder + low-stock |
| Customer membership/packages | memberships, membership_plans (confirm existing first) | T15, T09 | verify prior "membership/package" build before adding |

## Rules
- Every new table carries tenant_id (+ branch_id when branch-scoped), created_at, updated_at, created_by/updated_by where applicable; tenant filtering via `scoped()`.
- Verify a candidate (CustomerDeals, membership/package) is truly absent before adding — the duplication ban applies to tables too.
- Financial + security audit rows are append-only except lawful retention workflows.
