# Technician Skills / Helper / Earnings / Tip Allocation — completion report (spec §25)

Built in phases against the existing AIPowerSalon monorepo. The guiding principle throughout was **reuse, don't
duplicate**: much of the financial core already existed and was deep-audited, so the work was to fill the genuine gaps
and wire them end to end, never to rebuild a second engine, ticket system, or payroll path.

## 1. Existing skill + ticket-assignment code found
- `technician_services` (`{tenant, branch, technician_id, service_id, is_primary}`) — the canonical technician↔service
  eligibility mapping; already skill-gates assignment (tech-appointments derives eligibility from it).
- `ticket_service_lines.technician_id` — per-line technician ownership already exists, with per-line commission
  snapshots, amounts, and start/complete/status.
- `technician_skills` (coarse `skill_group` tag) and a skill change-request approval workflow.

## 2. Existing modules reused
The compensation engine (`compensation-engine.ts`), the compensation snapshot + tip-allocation persistence, the
refund/void reversal engine (`compensation-adjustments.ts`), serving's per-line technician edits + change-request
workflow, the realtime emitter, the settings (`tenant_settings`) store, and the technician-identity resolver.

## 3. Manager skill-setting UI / config
Already present: `PATCH /pos/technicians/:id/services` and `:id/skills` (permission `pos.technicians.skills.edit`,
audited) configure eligibility; a change-request workflow approves into `technician_services`.

## 4. Qualified-technician lookup (built)
`GET /pos/technicians/qualified?serviceId=` (manager) and `GET /tech/help-requests/qualified?ticketId=&serviceLineId=`
(technician), plus a server-authoritative `isQualified` gate. Reuses `technician_services` — no new table.

## 5. Request-Help workflow (built)
`technician_help_requests` (migration 400) + `TechnicianHelpService.createRequest` — validates the ticket is open, the
line is on the ticket, the helper is qualified (backend-enforced), no self-help, no duplicate — then notifies the helper
in realtime and audits.

## 6. Helper acceptance workflow (built)
`accept` / `decline` — atomic status transition (a duplicate accept can't double-handle); **accept reassigns the service
line to the helper**, which is what carries the helper's per-line earnings; decline notifies the primary. Both audited +
realtime.

## 7. Service-line ownership
Per-line `technician_id` (existing) is the ownership record; reassignment flows through the help workflow + serving's
change-request history.

## 8. Service earnings allocation
Per service line via the canonical engine — each technician's production base is only the lines they performed; never
combine-and-divide. (Existing, audited; reused unchanged.)

## 9. Discount allocation
Ticket discount allocated across lines proportionally by price (largest-remainder, exact cents), recording per-line
discount + net. (Existing; reused.)

## 10. Commission calculation
Per-line commission snapshot → the one engine (no second engine in checkout). (Existing; reused.)

## 11. Combined-tip 50/50 rule (built)
Default for exactly two technicians is now `equal` (50/50) at the single tip-method chokepoint; explicit/customer-directed
methods still win; odd cents split deterministically (`1501 → 751/750`). Earnings stay per-line.

## 12. More-than-two-technician policy (built)
Configurable salon policy (`GET`/`PUT /owner/compensation/tip-policy`): proportional by earnings by default, equal only
when explicitly enabled. Stored in `tenant_settings`, read on the compute path, audited.

## 13. Checkout review (built)
`GET /pos/checkout/tickets/:ticketId/technician-split` + the `ReviewTechnicianSplit` panel, shown when more than two
technicians participate — per-technician service earnings + tip allocation (with names) before payment. Read-only.

## 14. Post-payment adjustment controls
Lock-after-payment already freezes the snapshot + tip allocations. Refund reversals (§21, below) create **approval-pending**
adjustment entries with reason + requester — never rewriting the frozen snapshot.

## 15. Technician App changes (built)
`HelpRequestsCard` (incoming requests → accept/decline, realtime) on the dashboard; `RequestHelpModal` (pick line →
qualified helper → reason → send) on the ticket detail.

## 16. Real-time synchronization (built)
`technician_help_requested` / `_accepted` / `_declined` and `ticket_line_technician_assigned` events registered +
mapped to the serving / tech-queue / checkout / overview boards; helper notified on request, primary on decline.

## 17. Reporting changes
No change needed — verified non-double-counting: reconciliation invariants guarantee total tip = paid tip and total
attribution = eligible service total; reports read per-line snapshots (revenue counted once).

## 18. Super Admin oversight
Reuses existing audit-log + oversight surfaces; every help action, tip-policy change, and refund reversal writes an
audit entry.

## 19. Database migrations
`400_technician_help_requests.sql` (this feature). The technician time-clock work in the same tree adds `398`/`399`.

## 20. Frontend files changed
tech-web: `api/techApi.ts`, `components/HelpRequestsCard.tsx`, `components/RequestHelpModal.tsx`, `screens/TechDashboardScreen.tsx`,
`screens/TicketDetailScreen.tsx` (+ tests). pos-web: `api/posCheckoutApi.ts`, `components/ReviewTechnicianSplit.tsx`,
`components/CheckoutTicketInner.tsx` (+ tests).

## 21. Backend files changed
`technician-help/*` (new module), `technicians/*` (qualified lookup), `compensation/*` (tip policy, refund reversal
wiring), `checkout/*` (split preview, refund reversal hook), `realtime/realtime-core.ts`, `database/kysely.types.ts`,
`tech/tech.module.ts`, `app.module.ts`.

## 22. Fresh type-check results
`tsc --noEmit`: **0 errors** (api, tech-web, pos-web).

## 23. Fresh test results
compensation **95**, checkout **119**, technicians **28**, technician-help **16**, realtime **18** (api); tech-web help
components + pos-web review component suites all green. No existing tests weakened or removed.

## 24. Fresh DI-check results
`check:di` **PASS** (plus `check:sql`, `check:public`, `check:nav` **PASS**).

## 25. Fresh lint results
The project's gate suite (`check:di` / `check:sql` / `check:public` / `check:nav`) passes; these are the repo's enforced
checks. A standalone ESLint pass was not separately run.

## 26. Fresh build results
`vite build`: **PASS** (tech-web, pos-web).

## 27. Honest remaining limitations (refinements, not missing safety)
- **Partial-refund** per-line reversal: only a full refund auto-reverses attribution; a partial refund needs per-line
  refund detail the refund API doesn't carry.
- **Closed-period auto-routing**: refund reversals are created approval-pending (safe for any period state); routing to a
  future period automatically needs the payroll-period-paid signal wired (the engine already supports it).
- **Rich per-service skill attributes** (skill level, assist-only, certification/expiry): the eligibility mapping is
  service-level; the richer attributes in spec §2 are not modelled (add only if a phase needs assist-only gating).
- **Migrations `398`/`399`/`400`** must be applied in your environment; they are contiguous, uniquely numbered, and the
  runner tracks applied files by name (safe to re-run).
