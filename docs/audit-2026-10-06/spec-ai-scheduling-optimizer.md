# `ai_scheduling_optimizer` — spec vs code (Oct 6 2026, tree 7301539f)

Verdict: **PARTIAL, roughly 15–20%.** A solid, well-tested library of pure deterministic functions plus a thin API/UI
skeleton. Almost all integrations are absent, and the core review → apply path is broken (every decision answers 409).

Path legend: SO = `modules/ai/src/ai-scheduling-optimizer/`, SAM = `modules/super-admin/src/super-admin-ai-scheduling-optimizer/`,
POS = `apps/pos-web/src/`, MIG = `apps/api/db/migrations/`.

## What the spec asks for
A deterministic (OR / heuristic) scheduling engine over the existing booking, technician, forecast and queue systems; the LLM
only writes explanations. Gap detection, better-time options, idle/wait reduction, overbooking / double-booking /
understaffing detection, busy-hour forecasts, staffing + open/close recommendations, duration learning and hierarchy,
multi-service and group scheduling, buffers, locks, before/after simulation. Workflow: recommendation states → staff
review → customer approval (original kept until approved) → apply through the booking service with holds, idempotency and
optimistic locking. Automation off by default, safe-action allowlist, tenant/branch/module/platform kill switches. POS
calendar indicators + ~13 optimizer pages, Owner/Tech/Customer apps, AI receptionist (options + holds), Queue Assignment,
realtime, per-tenant durable jobs, notifications, exports, audit, usage/cost metering, Super Admin oversight with audited
time-limited support mode. ~30 tables, ~30 services, ~30 APIs, ~40 events.

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Schema | 14 optimizer tables | PARTIAL | MIG 345 (`kysely.types.ts:6372-6385`); tenant code uses recommendations, change applications, settings (read-only); runs read only by Super Admin and never written; 9 tables never touched (impacts, decisions, proposals, duration stats/recs, staffing coverage, availability recs, conflicts, gaps, rule versions) |
| Schema | FKs, status CHECKs, indexes, version use | MISSING | 345 has no FKs/CHECKs; `version` never incremented |
| Schema | shifts, breaks, time off, holds, locks, stations, equipment | PARTIAL | technician_schedules, technician_blocked_times, booking_holds (372), pos_stations exist; no time-off, no appointment locks, no equipment |
| Schema | appointment version + no-overlap | DONE | MIG 482 |
| Schema | usage records | MISSING | runs never metered |
| Services | interval core, service chaining | DONE | SO `ai-scheduling-core.ts` |
| Services | hard-constraint gate | PARTIAL | pure gate complete (SO `ai-scheduling-constraints.ts:45-98`); production passes `techShifts:[branchHours]`, `breaks:[]`, `timeOff:[]`, no stations/buffers/group (SO `ai-scheduling.data-adapter.ts:60-65`); `generate` never runs the gate but stores `hardConstraintsChecked:true` (`ai-scheduling.service.ts:82`) |
| Services | soft objectives, fallback | PARTIAL | SO `ai-scheduling-optimizer.ts:9-79`; `gapLeftoverMin:0`, `techUtilizationPct:0` hard-coded (data-adapter 68-71); `ruleBasedFallback` never called; weights unsaveable |
| Services | scopes | PARTIAL | single-appointment options only; `optimizeTechnicianDay` (optimizer 87) unexposed; no run service |
| Services | gap detection | PARTIAL | `detectGaps` (SO `ai-scheduling-detection.ts:16`) only in `currentMetrics` with `breaks=[]` → lunch counts as a gap; no endpoint |
| Services | overbooking / conflict / understaffing | MISSING at runtime | `detectConflicts` (44), `detectUnderstaffing` (78) never called |
| Services | busy-hour forecast | PARTIAL | `BusyPeriodForecastAdapter` (SO `ai-scheduling.module.ts:33-46`) flag only; needs `reports.view` (`busy-period.service.ts:13`) so front desk always gets "unavailable"; no no-show risk |
| Services | staffing / availability recommendations | MISSING | — |
| Services | utilization | PARTIAL, duplicated | SO `ai-scheduling-stats.ts:59` |
| Services | duration stats / hierarchy | PARTIAL (pure) | stats 9-85; no reader, no job |
| Services | multi-service / group | MISSING | all services summed into one block (data-adapter 54); `checkServiceOrder` unused |
| Services | buffers / locks | PARTIAL | booking's single `bufferMinutes`; locked = checked_in/in_progress/completed only (SO `ai-scheduling.booking-read.adapter.ts:13`); no lock API |
| Services | simulation | BROKEN | `simulateProposed` returns client-supplied `proposed.afterMetrics` (data-adapter 96-101) |
| Services | human review workflow | BROKEN | state machine needs generated → review_required → review_in_progress (SO `ai-scheduling-workflow.ts:21-36`); rows stored `generated` (`ai-scheduling.kysely.repository.ts:19`), no route advances them → accept/reject/return always 409 INVALID_STATE |
| Services | customer approval / proposals | MISSING | `createProposal`, `recordCustomerDecision` (workflow 58-73) unused |
| Services | apply through booking | PARTIAL | SO `ai-scheduling-application.ts:37-63` idempotent, calls `booking.reschedule` / `assignTechnician` |
| Services | settings (tri-state, kill switches, allowlist) | PARTIAL | resolver works (SO `ai-scheduling-settings.ts:66-86`); `PUT settings` ignores its body (controller 41); config version hard-coded 1 (service 84) |
| Services | controlled automation | MISSING | `evaluateAutomation` (application 70) never called; `ai.auto_actions` never read |
| Services | LLM explanation | MISSING | task `schedule.explain_suggestion` + prompt registered (`ai-task-registry.ts:128`, `ai-prompt-registry.ts:107`) never invoked; `explanation` always null |
| Services | booking holds | MISSING | `options` never creates a hold (`customer-booking/booking-hold-core.ts` unused here) |
| Services | audit | BROKEN | sink calls `AuditService.log` (module 70) — only `record()` exists (`modules/audit/src/audit.service.ts:11`); `?.log?.()` silently no-ops |
| Services | usage / cost metering | MISSING | entitlement guard logs denials with `usageAmount: 0` |
| Services | jobs, notifications, exports | MISSING | — |
| Routes | GET settings, GET recommendations, POST options, POST generate, POST :id/accept|reject|return|apply, PUT settings | PARTIAL | SO `ai-scheduling.controller.ts:25-41`; no DTO validation; list `total=items.length`; `options` returns `{id, score}` only (service 68) |
| Routes | overview, gaps, conflicts, understaffing, busy hours, staffing, utilization, durations, availability, runs, partial-accept/edit/dismiss/feedback, proposals, rollback, lock, analytics, usage, exports, retry | MISSING | — |
| Routes | Super Admin overview + tenants/:id?reason= | PARTIAL | SAM controller; no retry/disable/rollback/fallback |
| Permissions | view / manage / apply | PARTIAL | all map to `booking.view`/`booking.manage` (`packages/permissions/src/security-core.ts:52`); TECHNICIAN holds `booking.manage` (rbac 198) so can generate/accept/apply; `ai.scheduling.approve` (`ai-feedback.ts:84`) granted to no role |
| UI | POS workspace | PARTIAL | POS `screens/POSAISchedulingOptimizerScreen.tsx` (App.tsx:324): KPIs + list with accept/return/reject (always fail); 7 of 10 tabs static placeholders (131-137); no generate/apply/settings; `apply`/`generate`/`options` dead client methods (`dead-client-methods.baseline.json:94-96`) |
| UI | booking calendar | MISSING | only an LLM "Optimize schedule" button (POS `POSBookingScreen.tsx:1232`) |
| UI | Owner / Tech / Customer | MISSING | — |
| UI | Super Admin | PARTIAL | `apps/admin-web/src/screens/AiSchedulingOptimizerOversightScreen.tsx`; metrics misleading |
| Realtime / events | — | MISSING | no `schedule.*`, `booking.hold_*`, `technician.*_updated` in `packages/events/src/event-contract.ts` |
| AI package | catalog ($39, 1000 runs), plan bundle, module registry, task mapping, feature row (471:26) | DONE | `ai-catalog.ts:26`, `ai-plans.ts:24`, `ai-module-registry.ts:44`, `ai-platform.ts:129` |
| AI package | `@RequiresAiPackage` | PARTIAL | controller 20, observe mode; enforce mode would also block deterministic options/validation (spec says those stay) |
| Tests | pure logic | DONE | 10 vitest files in SO + SAM core spec |
| Tests | service / controller / API / isolation / holds / concurrency / realtime / e2e / load | MISSING | — |

## Parallel implementations
1. LLM "optimizer" button (POS `POSBookingScreen.tsx:1232`) → `POST /ai/:code` (`ai-assistant.controller.ts`) with the
   "You suggest schedule adjustments…" role (`ai-prompts.ts:18`), passing no schedule data (forbidden by the spec).
2. Four utilization formulas: `modules/workforce/src/tech-utilization/tech-utilization.ts` (labelled canonical), SO stats 59,
   `modules/queue/src/tech-queue/tech-queue.dto.ts:126`, client-side `POSBookingScreen.tsx:425`.
3. Gap detection twice (booking day-grid open ranges vs `detectGaps`); understaffing heuristic in
   `modules/analytics/src/dashboard/dashboard.kysely.repository.ts:270`.
4. Option/technician finders that bypass the optimizer: `reception-copilot-context.service.ts:275`,
   `voice-booking.service.ts:63`; a second availability engine `customer-booking/availability.ts` (its header says it does not
   enforce shifts or blocked times).
5. Ad-hoc Super Admin support gate (SAM core 47-53; role hard-coded `super_admin` (service 76), expiry never stored) beside
   the canonical `support_access_sessions`.
6. Two nav entries labelled "AI Scheduling Optimizer" (POS `shell/tenant-nav.tsx:216,253`); `/tenant/ai/scheduling` opens
   the package page, not the optimizer.

## Bugs (beyond the table)
- Super Admin "Auto actions applied" counts every manual application (SAM service 69); enabled tenants / runs always 0.
- Recommendations filter sent as `{query}` which does not match the client signature (POS `api/posAiSchedulingOptimizerApi.ts:12` vs `api/client.ts:52`).
- `techBranches` returns the session branch (booking-read 44-46): with no branch every candidate fails the gate.
- Branch users can see null-branch recommendations (kysely 53). Migration 345's header says "324_…".
- `COMPLETE_MODULE_WIRING_MATRIX.md:18` "Fully connected" overstates the state.

## Build order
1. Foundation bugs: audit `.log`→`.record`; recommendations enter review (create as `review_required` or add submit/start
   routes); `apply` uses stored `proposed_state` + `expectedVersion` snapshot and stops marking non-accepted rows failed;
   version the retry key; conditional status updates; server-side simulation + hard-constraint check in `generate`;
   server-derived "touches confirmed appointment"; `PUT settings` writes, rule/config versions.
2. Own permission capabilities (configure / approve / apply); grant `ai.scheduling.approve`.
3. Data feed: per-technician shifts, breaks, blocked times, time-off model, stations, buffers, per-service blocks, group size,
   manual/deposit locks, duration hierarchy; reuse canonical workforce utilization and booking open ranges.
4. Optimization-run service writing runs/gaps/conflicts/impacts/decisions; wire gap/conflict/understaffing/technician-day;
   read routes.
5. Duration history job → duration, staffing, availability recommendations with approval.
6. Customer proposals + approval (routes, customer-web, notifications).
7. Holds in `options`, full option payload, AI receptionist + Reception Copilot on `findOptions`.
8. Outbox events + realtime, per-tenant jobs (expiry, retries). 9. LLM explanations + usage metering. 10. Automation runner
   + kill switches. 11. UI (tabs, settings, generate/apply/proposals, calendar indicators, remove LLM button; Owner/Tech/
   Customer). 12. Super Admin (metrics, canonical support sessions, actions). 13. Tests (service, API, isolation,
   concurrency, e2e, load), exports, metrics.
