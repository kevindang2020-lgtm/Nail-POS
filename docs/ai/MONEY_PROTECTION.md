# AI Money Protection (six guides of Nov 2 2026, built Nov 3 2026)

Guides: AI Money Protection, Money Protection Alerts, Money Protection Investigations, Money Protection Rules & Detection, Money
Protection Settings, AI Fraud & Money Protection (the add-on page). Routes: `/tenant/ai/money-protection` (+ `/alerts`,
`/investigations`, `/rules`, `/settings`) and `/tenant/ai/fraud-protection`.

## Audit findings

| Area | Finding |
|---|---|
| Detection | **Never ran.** The code mentions a background worker; none existed. The only trigger was `POST evaluate` and no screen called it. The five reconciliation rules (memberships, gift cards, cash drawers) were not called even by that. |
| Evidence of monitoring | No run was recorded, so "no alerts" could not be told apart from "never checked". |
| Failed reads | A failed read of payments / tickets / attempts / reconciliation data / rule settings became "no activity" (no alerts) or "every rule on". The overview answered zeros when its query failed. |
| Alerts | No acknowledge / dismiss / reopen — an alert stayed NEW until it was put in an investigation. List: severity only, cursor "load more", no search, no dates, no totals. |
| Investigations | Status, assignment and resolution left no trail (notes only). |
| Settings | A change kept only the newest values — no before / after, no reason, no history; turning a critical rule off needed nothing. |
| Subscription | The add-on page's contradictory state was already fixed (see `AI_ASSISTANT_PAGES.md`). |

## What was built

- **Migration 778:** `money_protection_detection_runs` (every pass, scheduled or manual, with its outcome), `money_protection_events`
  (append-only decisions on alerts, investigations, rules), `money_protection_health_runs`.
- **Detection:** `MoneyProtectionCenter.runDetection` runs one recorded pass over all three layers (exact rules + normal-level
  comparison + reconciliation). "Run detection now" (manage_rules; one per 2 minutes per salon) and the scheduled pass
  (`money-protection-detection.scheduler.ts`: one durable `ai.money_protection.detect` job per subscribed salon per interval;
  **opt-in `AI_MONEY_PROTECTION_DETECTION_ENABLED=1`**, interval `AI_MONEY_PROTECTION_DETECTION_INTERVAL_MS`, default 15 min). A
  failed pass is recorded as failed. Detection reads money tables and raises alerts only.
- **Reads fail loudly:** the repository no longer swallows read errors in detection or rule settings.
- **`/pos/money-protection-center/*`:** `summary` (cards with one definition each; monitoring current / never checked / last run
  failed / stale / module off; whether detection is scheduled) · `alerts` (search: alert id, rule, ticket number, staff name — the
  rule's people and whoever took the payments — and customer name / phone with `customers.view`; status group, severity, kind, rule,
  which date, presets + From/To in salon time, sort, pages) · `alerts/detail` (evidence, the tickets / payments / staff it points at,
  history) · `alerts/action` (acknowledge · dismiss with a reason · reopen with a reason; optimistic `expectedStatus`; audited; never
  on an alert about your own activity) · `investigations` (search, status, severity, which date, sort, pages) ·
  `investigations/timeline` (notes + recorded decisions, newest first; linked alerts) · `rules` (all 15 with the salon setting,
  whether the layer is on, 30-day / open / dismissed counts, last alert) · `rules/save` (before → after recorded; a reason is
  required to turn a rule off or lower its severity; a stale edit is refused; audited) · `settings/history` · `detection/runs` ·
  `detection/run` · `check`.
- **Investigations** record opened / assigned / status changed / resolved (who, from → to) through the existing service.
- **Check AI Money Protection System:** subscription, detection layers on, detection scheduled, detection ran in the last day
  (never → FAILED), detection failures / stuck runs, payments arriving, critical rules off, critical / high alerts unreviewed over a
  day, dismissals without a recorded reason, card-number-shaped digits in evidence, case links, unassigned cases, settings changed
  before history was kept, tenant isolation, nothing moves money (automatic duplicate blocking off). Each says its part and when it
  last passed.
- **POS:** the five pages share `MoneyProtectionWorkspace` (titles and descriptions keep their keys): tabs, Run detection now, the
  check; the overview with a monitoring line and the detection runs; alerts with the detail (Vietnamese evidence worded from codes,
  the advisory explanation's language rules kept) and the three actions; investigations with the timeline, notes, moves and
  resolution; the 15 rules; settings with the rule editor (reason) and the change history. The add-on page reads the same center.
  EN/VI `mpx.*`, `fpx.*`.
- The old reads (`GET state`, `rules`, `settings`, `alerts`, `investigations`, `investigations/:id`) have no callers (on the
  unreached ledger; client methods removed and pinned). The old `POST settings/:ruleId` now goes through the same safe save.

## Tests

- `money-protection-center.pgtest.vitest.spec.ts` 12/12 on the real schema (never checked, recorded manual / scheduled / failed
  passes, rate limit, scope, every search source, filters, dates, pages, detail sources, actions incl. reason, stale, segregation,
  audit and "nothing moved", investigation timeline, rule save reason / stale / history, the check). Money Protection suite 99 passed
  (one fixture now applies the rule-settings migration — reads no longer swallow a missing table).
- POS: overview 3, alerts 7 (incl. the three Vietnamese / §120 explanation tests), investigations 3, rules 1, settings 2, add-on
  page 2, retired client methods 8.

## Decisions for Kevin

- Turn on scheduled detection in production (`AI_MONEY_PROTECTION_DETECTION_ENABLED=1`)? It is opt-in like the other heavy AI scans.
- The investigation `assign` route accepts any user id (not checked against the salon's staff). Restrict it to active staff of the
  branch?
