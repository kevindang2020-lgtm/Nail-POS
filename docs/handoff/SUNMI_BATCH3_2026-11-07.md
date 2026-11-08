# SUNMI batch 3 — Communications, Team, Technicians, Loyalty (Nov 7 2026)

Kevin's 20 PDFs (SUNMI FLEX 3 addenda + original guides). Every addendum allows vertical page scroll and forbids
sideways scroll, module removal, CSS scale or forced zoom. All work is additive; nothing removed.

## Pages certified (registered in `apps/pos-web/src/shell/module-registry.json`, `scroll: 'page'`)

| Key | Route | Guide |
|---|---|---|
| phone-verification | /tenant/communications/phone-verification | BOOKING_PHONE_VERIFICATION_3 |
| loyalty-network | /tenant/customers/loyalty?view=network | GLOBAL_LOYALTY__REWARDS + Global__Tenant_Earning_Rules |
| messaging-setup | /tenant/communications/messaging-setup | TEXT_MESSAGING_SETUP__SMS_READINESS |
| followup-settings | /settings/follow-ups | END-OF-DAY_FOLLOW-UPS |
| follow-ups | /follow-ups | FOLLOW-UP_QUEUE |
| reminders | /tenant/communications/reminders | Appointment_Reminders |
| email | /tenant/communications/email | Email_Management__Delivery_Center |
| sms-inbox | /tenant/communications/sms | Communications__SMS_Inbox (13 KPIs, 6 lower modules, 7 Quick Actions) |
| phone | /tenant/communications/phone | Phone__Messaging__Text_Messaging_Setup (Account / A2P / SMS / Verify / Voice kept separate) |
| team | /tenant/team/members | TEAM_MANAGEMENT (8 KPIs, 8 lower panels, Profile Overlay, Finder, One-Day Shift Editor, Data Alerts) |
| technicians | /technicians | TECHNICIANS_MANAGEMENT_CENTER (Profile Overlay, Qualified & Available Finder, Service Mapping Assistant) |
| tech-appointments | /tech-appointments | TECH_APPOINTMENTS (9 KPIs) |
| tech-schedule | /technicians/schedule | LIVE_TECHNICIAN_SCHEDULE (6 KPIs) |
| commission | /tenant/reports/commission | COMMISSION_REPORT (5 KPIs; F1/F2 discrepancy review, F3 export audit) |
| performance | /tenant/team/performance | TEAM_PERFORMANCE_3 (F5 0–5 vs 0–100 rule) |
| ai-usage, setup-health | /tenant/ai/usage, /tenant/management/setup-health | Unfinished_POS_Modules_Setup |

Retention, tech-queue and the loyalty program view were already registered (batches 1–2) and re-verified.
Five_Unfinished_Features F1–F5 all exist in code (commissionReview.tsx, report-export.ts, dateShiftEditor, composite score).

## Code changes

- `packages/database/src/list-query.ts`: accepts the legacy `sort: { allowed, default }` shape (+ test).
- Phone verification: health panel shows the six checks as "Not checked yet" before the first run; panels no longer capped at 640 px.
- Follow-up queue: status tabs (All / Unsent / Sent / Skipped) mirroring the KPI filters (+ test).
- Touch sizes: technician picker 44 px, email test controls 44 px, follow-up tabs 44 px.
- SMS inbox: `ci-kpis`, `ci-tools`, `ci-mods` test ids so the registry can count 13 KPIs / 6 modules / 7 actions.
- `FinanceKit` PeriodBar: `period-presets` test id; replaces the dynamic `preset-today` registry id the static check could not see.
- `tooling/ci/check-pos-module-registry.mjs` is now a gate (was standalone — that is how two stale ids slipped past batch 2);
  baseline `tooling/ci/pos-module-baseline.json` created.
- Harness: `MODULE_SET=batch3` (17 pages), included in `all`.
- New VI strings marked `// DRAFT — Kevin reviews` (bookverify namespace).

## Verification (this session)

- Batch 3 at 1920×945 / 952 / 1032, EN + VI: 102/102.
- Batch 3 at 1536×864, 1440×900, 1366×768, 1280×720: 136/136 responsive, no sideways scroll.
- All 55 pages at the three SUNMI sizes: 330/330.
- Gates: all 57 gates + 23 audits pass. Registry: 54 pages, 436 modules present.
- POS: 386 files / 2120 tests pass. Modules: all 27 suites pass. API: 3279 pass (138 skipped).

## Not verified

- Real SUNMI hardware / Android WebView CSS viewport — still needs a physical unit.
- No live Twilio, SMS, email or token purchase was run (staging rules).

## Follow-up (same day): preservation matrix

The addenda require a preservation matrix (feature → route → component → API → status → regression test).
`tooling/e2e/pos-preservation-matrix.mjs` generates `docs/handoff/SUNMI_PRESERVATION_MATRIX.md` from the registry:
54 pages, 436 rows, 0 missing. Its `--check` mode is a gate, so the matrix cannot go stale. Touch targets: the screen
check already fails any control whose hit area is under 44 px; batch 3 has 0 such controls (smaller visible buttons
carry padded hit areas). Gates: 57 + 24 audits pass.
