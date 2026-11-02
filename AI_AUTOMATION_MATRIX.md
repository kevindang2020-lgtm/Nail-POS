# AI & Automation — Deep-Chain Wiring Matrix (verified end-to-end)

Section: **AI & Automation**. All routes behind `@UseGuards(SuperAdminGuard)` (server-side `SUPER_ADMIN`).
**Confirmed platform-wide guard:** the admin-web frontend contains **no** OpenAI / Anthropic / Retell keys or
direct provider calls (clean scan) — all AI provider access is server-side only, per spec.

## Core items (full chain verified)

### 1. AI Insights
- `/ai-insights` → `AiInsightsScreen` → `superAdminAiApi`
- **GET/POST** `/super-admin/ai-insights` (incl. `bulk-assign`, `bulk-review`) →
  `SuperAdminAiInsightsController` (`SuperAdminGuard`) → service → `SuperAdminAiInsightsModule` (in AppModule)
- DB: migration **244** (ai_insights). Permission: `SUPER_ADMIN`. Insights are review/assign-gated. Tests:
  2 spec files. **Status: Complete.**

### 2. AI Reports
- `/ai-reports` → `AiReportsScreen` → `superAdminAiApi`
- **GET/POST** `/super-admin/ai-reports/*` (runs, schedules, deliveries) → `AiReportsController`
  (`SuperAdminGuard`) → service → `AiReportsModule` (imported in AppModule)
- DB: migrations **259** (ai_report_runs), **260** (ai_report_schedules), **261** (ai_report_deliveries).
- Permission: `SUPER_ADMIN`. Tests: **12 spec files**. **Status: Complete.**

### 3. Smart Reminders
- `/smart-reminders` (+ performance) → `SmartRemindersOverviewScreen` / `SmartRemindersScreen`
- **GET** `/super-admin/smart-reminders/*` → controller (`SuperAdminGuard`) → service (audit) →
  `SmartRemindersModule` (imported in AppModule)
- DB: migrations **103** (appointment_reminders), **126** (appointment_reminder_attempts).
- Permission: `SUPER_ADMIN`. Tests: 1 spec. **Status: Complete.**

### 4. Automation Rules
- `/automation-rules` → `AutomationRulesScreen` → `superAdminApi`
- **GET** `/super-admin/automation-rules/*`; sensitive **POST** `failures/:id/retry` (execution retry) →
  `SuperAdminAutomationController` (`SuperAdminGuard`) → service (**7 audit refs**) →
  `SuperAdminAutomationModule` (in AppModule)
- DB: migration **215** (automation_rules) + execution/failure history.
- Permission: `SUPER_ADMIN`. Audit: yes (retry/execution). Tests: 4 spec files. **Status: Complete.**

### 5. AI Usage & Configuration  (the 15 AI modules)
- `/ai-usage-configuration` → `AiUsageConfigScreen` → `superAdminAiApi`
- **GET** `/super-admin/ai-usage/*` (overview, prompts, providers, providers/status) and `/super-admin/ai/*`
  (packages, usage summary) → `SuperAdminAiUsageController` + `SuperAdminAiController` (`SuperAdminGuard`) →
  services (**4 audit refs** on ai module) → `SuperAdminAiUsageModule` + `SuperAdminAiModule` (in AppModule)
- Manages provider / model / `package_code` / usage / cost **server-side** for the 15 AI modules
  (ai_booking … ai_scheduling_optimizer). `ai_usage_logs.package_code` is non-nullable.
- DB: migrations **091** (ai_usage_logs), **093** (ai_usage_cost), **245** (ai_providers).
- Permission: `SUPER_ADMIN`. Tests: 5 (+1 ai). **Status: Complete.**

## Secondary items (routed + client-wired)
AI Receptionist, Reception Copilot, Tenant Messaging (Twilio), A2P 10DLC, Messaging Environment, AI Booking
Analytics, AI Customer Profile, AI Checkout Upsell, AI Forecasting, AI Business Assistant, AI Packages / Plans
/ Subscriptions, Usage Limits — each has a route → screen → `superAdmin*Api` client and a `super-admin-ai-*`
backend module (forecasting, checkout-upsell, customer-profile, ocr-receipt, review-reputation,
scheduling-optimizer, etc., all present in `apps/api/src`).

## Invariants confirmed
- **No direct AI-provider access from any frontend** (verified by scan); provider credentials + model config
  live server-side behind `SuperAdminGuard`.
- Automation rule executions/retries are audited; AI insights are review/assign-gated.
- `ai_usage_logs.package_code` non-nullable (usage always attributable to a package).
