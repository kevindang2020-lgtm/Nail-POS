# `ai_queue_assignment` — spec vs code (Oct 6 2026, tree 7301539f)

Verdict: **PARTIAL, about 35%.** The engine, alerts, auto-assign safeguards, 21 tenant routes + 1 Super Admin route and one
POS screen exist. Several features look finished but do not work in production (requested-technician preference,
appointment protection, stuck-record detection). The POS Queue and Tech Queue screens run their own recommenders and never
call the AI engine.

Path legend: AQ = `modules/ai/src/ai-queue-assignment/`, Q = `modules/queue/src/queue/`, TQ = `modules/queue/src/tech-queue/`,
MIG = `apps/api/db/migrations/`, POS = `apps/pos-web/src/`.

## What the spec asks for
One shared queue/technician state model across check-in, appointments, walk-ins, Customer Queue, Tech Queue, Serving, Service
Done and Checkout; versioned, audited, idempotent transitions. Hard rules first (branch, clock-in, skill, capacity, break,
blocked, appointment reservation, station, locks), then weighted ranking (preference, rotation/fairness, workload, appointments,
multi-service, groups). Output = best technician + alternates, score, confidence, ETA, conflicts, warnings, required action,
rule/config/model/prompt versions. Plain-language explanations (an LLM may phrase, never decide). Staff accept / reject /
override / lock with feedback. Detection of long waits, unassigned customers, congestion, stuck records, late appointments +
safe repair. Auto-assignment off by default, tenant/branch opt-in, exclusions, kill switches, full audit. Realtime, concurrency,
durable tenant-partitioned jobs, notifications, analytics, branch comparison, exports. Surfaces: POS, Owner, Tech, Customer /
kiosk, Super Admin.

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Schema | recommendations, candidates, decisions/feedback | DONE | MIG 331; `packages/database/src/kysely.types.ts:6659-6666` |
| Schema | rotation state | PARTIAL | MIG 332 policy column only; `last_served_tech` never read |
| Schema | alerts + settings | PARTIAL | MIG 333/335 per-branch only, 4 alert types, unversioned, no tenant defaults |
| Schema | repair actions | DONE (log only) | MIG 334 |
| Schema | queue version, status history, groups, locks, technician status/skills/availability, congestion/stuck tables, rule versions, usage | MISSING | `pos_queue_items` has no version column (MIG 026); `pos_queue_audit` exists but is never written |
| Schema | one active entry / no duplicate assignment | PARTIAL | MIG 503 unique indexes; compare-and-set Q `queue.kysely.repository.ts:444-470`; no per-technician overlap constraint |
| Services | hard-rule gate | PARTIAL | AQ `eligibility.ts` 9 rules; blocked/station/lock/max-concurrent never supplied; branch check vacuous (Q `queue.service.ts:100` gives every technician the caller's branch) |
| Services | ranking, alternates, confidence, versions | DONE | AQ `engine.ts:61-100` (config version not recorded) |
| Services | requested / previous technician | BROKEN | Q `queue.service.ts:97,103` read fields `detail()` never returns (Q `queue.kysely.repository.ts:182-191`) → always null |
| Services | preference levels, language, accessibility | MISSING | — |
| Services | appointment protection | BROKEN | AQ `adapters.ts:108` parses `start_time` ('HH:MM' text) → NaN → every appointment skipped |
| Services | late arrival / grace | MISSING in practice | `arrivalStatus()` only called from tests |
| Services | rotation (5 policies) | PARTIAL | AQ `rotation.ts`; fixed-order/first-available get no data (`availableInMinutes` hard-coded null, `adapters.ts:89`) |
| Services | workload balancing | PARTIAL | active count sees a 20-row page |
| Services | multi-service / groups / simulation | PARTIAL / MISSING | one technician must cover every category; no groups; no simulation |
| Services | wait / unassigned detection | PARTIAL | AQ `detection.ts` manual scan, first 20 entries, alerts never auto-resolve |
| Services | congestion | PARTIAL | AQ `congestion.ts:18-35` hard-coded thresholds |
| Services | stuck records | BROKEN | Q `queue.kysely.repository.ts:128` sets `updatedAt` to now; detector checks statuses that don't exist (AQ `congestion.ts:65-71`) |
| Services | repair workflow | PARTIAL | AQ `alerts.service.ts:92-102` records only; queue state never changed |
| Services | auto-assignment | PARTIAL | AQ `auto.ts`, `service.ts:197-218`: off by default, confidence floor, per-run cap, branch kill switch. Missing exclusions, scheduler, tenant-wide kill switch, delay, scopes |
| Services | decisions | PARTIAL | AQ `service.ts:127-139` records but does not assign; no idempotency |
| Services | explanations | DONE | AQ `explanation*.ts`, AiPlatform task `queue.explain_recommendation` (wording "is the best match" is forbidden by the spec, `explanation.ts:14`) |
| Services | analytics / branch comparison / exports | PARTIAL / MISSING | decision analytics only; `ai_queue_assignment.export` never used |
| Services | notifications, background jobs, config audit, domain events | MISSING | realtime only (`tooling/architecture-tests/baseline.json:148` moduleDirectEmissions) |
| Routes | 21 `/pos/ai-queue-assignment/*` + `GET /super-admin/ai-queue-assignment/overview` | DONE | AQ `controller.ts:30-132`, `superadmin.controller.ts` |
| Routes | overview, queue views, reorder, lock/unlock, availability, branch comparison, usage, job retry, exports | MISSING | no reorder anywhere in Q |
| Permissions | 8 keys | DONE | `packages/permissions/src/rbac.ts:119-121` |
| Permissions | role matrix | PARTIAL | MANAGER view only (183); FRONT_DESK/RECEPTION none (196-197) |
| UI | POS AI screen | PARTIAL | POS `screens/POSAIQueueAssignmentScreen.tsx`: alerts, rotation, auto toggle/run/kill, raw queue-entry-ID lookup (137); no accept/reject, overview, history, thresholds; 5 routes in `unreached-routes.baseline.json` |
| UI | POS Queue / Tech Queue | PARTIAL | not connected to the engine; Tech Queue "Send Break" placeholder (POS `POSTechQueueScreen.tsx:205`) |
| UI | Owner / Tech / Customer / kiosk | PARTIAL (pre-existing) | no AI-specific additions; no alternate-technician approval |
| UI | Super Admin oversight screen | MISSING | admin-web never calls `/super-admin/ai-queue-assignment` |
| Realtime | 7 events registered | PARTIAL | `packages/realtime-contracts/src/realtime-core.ts:57-60,202-208`; decision events dropped (names not in emitter mapping `adapters.ts:67-71`) |
| AI package | canonical `ai_queue_technician_assignment`, fail-closed gate, prompt v1, SUGGEST_ONLY | DONE | `modules/ai/src/ai/ai-catalog.ts:25`, AQ `entitlement.ts` |
| AI package | platform kill switch / feature flag / usage | PARTIAL | `ai.auto_actions` never read by auto-run; platform feature key `ai_queue_assignment` (MIG 471:27) never read |
| Tests | 11 spec files (~70 cases), PGlite repository isolation | PARTIAL | no API/controller, realtime, adapter-integration, concurrency, load or E2E tests; `assignmentInputs` untested |

## Parallel implementations (the spec forbids these)
1. Four technician recommenders: Queue "Best Match" (Q `queue.kysely.repository.ts:237-244`), Tech Queue best match (TQ
   `tech-queue.kysely.repository.ts:302-314`, ignores the requested technician), "Auto Balance" (Q `queue.service.ts:167-195`,
   used by POS `POSQueueScreen.tsx:135` and `POSTechQueueScreen.tsx:170-183`), and the AI engine. Only the engine checks
   breaks, appointments and capacity.
2. Two detection engines: `modules/super-admin/src/super-admin-queue/live-queue-core.ts` (30/45/60 min, own
   `congestionScore`/`evaluateStuck`) vs the AI module (10/20/30/45).
3. Three auto-assign switches: `queue_assignment_settings.auto_enabled` (real), `queueWorkflow.autoAssign`
   (`modules/tenants/src/settings/settings.dto.ts:133`, defaults TRUE, unused), `autoAssignTechnicianEnabled`
   (Q `queue.dto.ts:56,60`). Rotation configured twice (`queueWorkflow.assignBy` vs `rotation_state.policy`).

## Bugs
1. Requested/previous technician never reaches the engine (above).
2. Appointment protection never fires ('HH:MM' parse); lookup uses the server's UTC date
   (`modules/appointments/src/tech-appointments/tech-appointments.kysely.repository.ts:37`).
3. Stuck detection dead (`updatedAt` always now; wrong status vocabulary).
4. Scan / auto-run / workload see only 20 active entries (Q `queue.service.ts:94,111` → `query()` paginates at 234); `loadAll` loads the branch's whole history each call.
5. Auto-run can overwrite an existing assignment: AQ `adapters.ts:17` omits `expectedTechnicianId`; status `'assigned'` counts as assignable (Q `queue.service.ts:202`); Auto Balance apply (190) same.
6. Auto-assign ignores a conflicting requested technician (AQ `auto.ts:18-26`) and the platform `ai.auto_actions` switch (`modules/super-admin/src/super-admin-kill-switches/kill-switches.ts:37`).
7. POS AI screen likely fails on load: `GET /rotation-policy` returns a bare string (AQ `controller.ts:106-110`) → `res.json()` throws (POS `api/posAIQueueAssignmentApi.ts:42`) inside the initial `Promise.all`; the screen test mocks it.
8. Decision realtime events silently dropped (AQ `service.ts:137`).
9. Resolved alerts still listed with a "Resolve" button (screen 104-107).
10. Drag-drop sends no `expectedTechnicianId` (POS `POSTechQueueScreen.tsx:158`); Send Break placeholder though a break API exists (`api/posLiveTechnicianScheduleApi.ts:34-35`).
11. Auto Balance preview wrong: `loadByTech` never filled (Q `queue.service.ts:172-173`), requested technician forced null (177).
12. Super Admin overview: "tenantsEnabled" counts branch rows (AQ `superadmin.repository.ts:42-43`); reads a `provider_error` status AiPlatform never writes.
13. Auto-assignments logged as `'accepted'` (AQ `service.ts:213`) inflating acceptance rate.
14. Empty branch context: every technician fails `wrong_branch`; `''` into UUID `branch_id` errors (AQ `controller.ts:13`).
15. Queue audit lives in memory (Q `queue.service.ts:38,54-56`).
16. `AI_QUEUE_ASSIGNMENT_RECONCILIATION.md` cites stale paths (guard is `apps/api/src/common/ai-queue-assignment-registration.guard.vitest.spec.ts`; catalog `modules/ai/src/ai/ai-catalog.ts`).

## Build order (dependencies first)
1. Data plumbing: return requested/previous technician from detail; parse 'HH:MM' + `appt_date` in the branch zone; real
   `updated_at`; drop the 20-row cap, include in-service/done entries; feed `availableInMinutes`, rotation index, shift end.
2. Consolidate the four recommenders onto the engine; retire duplicate auto-assign toggles / rotation configs; unify detection
   thresholds with the Super Admin live-queue core.
3. Schema: queue version + status history, assignment locks, versioned tenant/branch settings, more alert types, reviewer.
4. Decisions act through the queue's assign with `expectedTechnicianId` + idempotency key.
5. Auto-assign: close the overwrite race, exclusions, `ai.auto_actions`, tenant-wide kill switch.
6. Domain events, per-tenant background workers (scan, auto-resolve, auto-run), notifications; audit config/kill-switch/lock changes.
7. Role matrix (MANAGER, RECEPTION); UI (rotation-policy JSON, per-customer panel with accept/reject, overview/history/settings,
   Queue + Tech Queue on the engine, Send Break, drag-drop expected technician); Super Admin screen; analytics/exports/groups;
   tests (adapter integration, API, realtime isolation, concurrency, load, E2E).
