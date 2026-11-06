# AI Business Reports + AI Business Alerts — Nov 3 2026

Routes: `/tenant/ai/business/reports`, `/tenant/ai/business/alerts`. API: `/pos/ai-business/center/*` (migration 781).
Reports stay in `ai_business_report_jobs` (338), rules in `ai_business_alerts` (337). Figures come from the canonical Sales
Report (`ReportsService`) through the existing AI Business tools — no second reporting engine.

## Audit

| Requirement | Status before | Evidence | Action |
|---|---|---|---|
| A period means its days | **BROKEN (everywhere)** | `KyselyReportsRepository.query` ignored `preset`: no from/to → the last 7 days. Every AI Business tool (daily brief, weekly, monthly, alerts' "today") asked by preset; the Sales Report screen sends `period`, which the controller dropped | `presetRange` in the reports repository (salon-local days, weeks from Monday) and `period` accepted as `preset`. Pinned in `reports-reconcile.pgtest` |
| Four report buttons + history | PARTIAL | Worked; history = 100 newest, no search / filters / pages; a read error showed "No reports yet" (swallowed `.catch`) | Center list + pages; errors surface |
| "completed" + "expired" | AMBIGUOUS | `expired` = the 7-day content window (`expires_at`), content kept but hidden — not a failed download | Generation status and availability shown apart |
| Which days a report covers | MISSING | Only the preset name was stored | Exact days + timezone + the Sales Report snapshot stored in the content |
| Verify Numbers | MISSING | — | Snapshot vs the Sales Report now, same days and scope: matched / changed (with reason) / cannot verify |
| Regenerate | MISSING | — | New report; the old one untouched |
| Double tap | MISSING | Every tap made a report | Same user + type + period within 15 s returns the same report |
| Report detail | PARTIAL | Raw JSON | Labelled headline figures + full data |
| Scheduled reports | MISSING — decision | No scheduler / delivery | Reported as "not set up" by the check |
| Alert rules (create, pause, delete, evaluate) | PARTIAL | Pause / delete errors swallowed; delete without confirmation; screen claimed "scheduled delivery runs server-side" (false) | Errors shown, confirmation, honest note |
| Alert history / incidents | MISSING | Evaluate only set two timestamps | `ai_business_alert_events`: value, threshold, sample, exact days, state change (triggered / recovered / unchanged / not evaluated), acknowledgement |
| Automatic evaluation, SMS / email delivery | MISSING — decision | `frequency` / `channel` stored, never acted on | Reported by the check; listed below |
| Root-cause advisor | MISSING | — | Deterministic: the existing price × volume bridge for money metrics, the appointment funnel otherwise; read-only, "not proof of cause" |
| Anomaly detection | MISSING | — | Opt-in check: yesterday vs the same weekday over 8 weeks, median + MAD, needs ≥ 4 comparable days |
| Health checks | MISSING | — | Check AI Business Reports / Alerts System (read-only, recorded, 30 s reuse) incl. "a period means its days" |
| All-my-salons (cross-tenant) | MISSING — not built | Branch comparison exists within a salon | Not built: needs an owner multi-tenant grant model |

## Tests

- `modules/analytics/src/ai-business/business-center.pgtest.vitest.spec.ts` — 10 on the real schema with the real Sales Report.
- `modules/reports/src/reports/reports-reconcile.pgtest.vitest.spec.ts` — +2 (preset = its days; `presetRange`).
- POS: `POSAiReportsScreen` (5), `POSAiAlertsScreen` (7 + 403), `posAiBusinessApi.retired` (6).

## Decisions for the owner

1. Scheduled reports (daily / weekly / monthly) — where should they be delivered (in-app only, or email)?
2. Automatic alert evaluation (hourly / daily as each rule says) and delivery by SMS / email — turn on, and to whom?
3. All-my-salons monitoring across separate salon accounts needs an owner grant model that does not exist yet.

## Business Alerts — newer guide (021905f4, received Nov 3 2026)
Built (Nov 3 afternoon):
- Rules are branch-scoped for read / pause / edit / delete; Evaluate Now uses the rule's own branch and time zone.
- Edit (name, threshold, period, minimum sample ≥ 1), Duplicate (a PAUSED copy), History per rule (the history filtered to one alert).
- Periods: Today, Yesterday, This week, This month, This quarter, This year — anything else is refused (it was read as the last 7 days).
- An evaluation whose numbers cannot be read is RECORDED as `failed` with the reason (migration 783) and counted in a Failed evaluations KPI.
- Deleting a rule with history archives it (migration 782); the history stays, the rule leaves the list, the health check ignores it.
- Health runs, the 30-second reuse and "last passed" are per branch.

Not built (each needs a decision or infrastructure that does not exist yet):
- Incidents (acknowledge → investigate → resolve, assignee, notes, snooze) — today an event can only be acknowledged once.
- Notifications (in-app inbox, email, the salon's own Twilio SMS) with cooldown, quiet hours, escalation and a delivery log.
- Severity / recipients / quiet hours fields, rule versions, Draft state, tabbed layout, SSE live refresh.
- Anomaly detection beyond net sales and tickets for yesterday; an AI-written explanation (the explanation is the measured bridge).

Built Nov 5 2026 (be799be): the background evaluator — every 5 minutes the active rules due on their own schedule (hourly / daily)
are evaluated as their creator (role permissions), recorded with source 'scheduled'; a departed creator is a recorded failed
evaluation. AI_BUSINESS_ALERTS_SCHEDULE=off stops it; the health check's Automatic evaluation reads the overdue rules.

Built Nov 6 2026 (Kevin: "continue finish all"; migration 826, `business-alert-incidents.ts`):
- Incidents: every triggered evaluation opens one — open → investigating → resolved (a note is required), snoozed for
  30 min … 24 h (wakes up open), reopen, assign to an active staff member, notes; versioned (stale screen → 409) and logged.
  The old Acknowledge moves an open incident to investigating. Incidents panel + incident dialog on the page.
- Notifications per rule: severity (info / warning / critical), channels (in-app → the Owner app Alerts inbox; email; SMS),
  recipients (default: the salon's owners and managers), quiet hours in salon time (email / SMS held, in-app lands),
  cooldown. Sent through the salon messenger; every attempt is a delivery row (sent / not sent + why / failed + why).
- Escalation: a critical incident still open 30 min after it opened is sent once more to the owners.
- The page no longer says delivery is not built; the health check's "Delivery channels" counts failed email / SMS
  deliveries in the last 7 days.
- Still not built: rule versions / Draft state, SSE live refresh of this page (it refreshes on action), anomaly metrics
  beyond net sales and tickets, an AI-written explanation (the measured bridge stays the explanation).
- Tests: `business-alert-incidents.pgtest` (9), `business-center.pgtest` rewritten to the new truth, POS screen tests (12).
