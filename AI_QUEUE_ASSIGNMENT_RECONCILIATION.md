# AI_QUEUE_ASSIGNMENT_RECONCILIATION.md

> **Re-verified Oct 10 2026 (BUILD_PLAN Phase 15).** Every claim below still holds; only the file locations moved when
> the AI domain became `modules/ai` (Constitution 13): the catalog is `modules/ai/src/ai/ai-catalog.ts` (one queue
> package, `ai_queue_technician_assignment`, sortOrder 3), the entitlement gate is
> `modules/ai/src/ai-queue-assignment/ai-queue-assignment-entitlement.ts` (`const PACKAGE = 'ai_queue_technician_assignment'`),
> the guard spec is `apps/api/src/common/ai-queue-assignment-registration.guard.vitest.spec.ts` (4 tests, passing Oct 10;
> its repo scan now walks every code root — the API, `modules/*`, `packages/*` — and exempts only the mapping table
> `modules/ai/src/ai/ai-module-registry.ts`, where `ai_queue_assignment` is the MODULE id mapped to the canonical catalog
> code). The sidebar item is `apps/pos-web/src/shell/tenant-nav.tsx` (`/tenant/ai/queue`, `aiPackageCode:
> 'ai_queue_technician_assignment'`, permission `ai_queue_assignment.view`). Migrations 331–335 are unchanged. The
> "four packages" wording below refers to the September merge and is kept as written.

## History

An early queue-assignment arc registered a **second** AI catalog package, `ai_queue_assignment`, alongside the
canonical `ai_queue_technician_assignment`. That split entitlement checks and tenant subscriptions across two
codes for the same feature. Package B's "2026-07-09 — Transfer verification + duplicate-package reconciliation"
removed the duplicate and repointed everything at the canonical code; B carried that corrected state into this
merge as the canonical base.

## Merged state (verified fresh)

- `apps/api/src/ai/ai-catalog.ts` is **byte-identical across all four packages** and contains exactly one queue
  package: `ai_queue_technician_assignment` (sortOrder 3, operations).
- The entitlement gate (`ai-queue-assignment-entitlement.ts`) checks `PACKAGE = 'ai_queue_technician_assignment'`
  and is fail-closed (any error / missing / expired subscription → not entitled).
- Migrations 331–335 (B's numbering, unchanged in the merge) hold the queue-assignment schema, including the
  334 repair and 335 auto-assignment tables.
- The tenant surface is `POSAIQueueAssignmentScreen` at `/tenant/ai/queue`; the sidebar item carries
  `aiPackageCode: 'ai_queue_technician_assignment'`.
- The RBAC permission names `ai_queue_assignment.*` (view/recommend/assign/override/manage_rules/manage_auto/
  resolve_alerts/export) are **permission strings, not catalog codes** — a different namespace; they are correct
  and unchanged.

## The executable guard (new in this merge)

`apps/api/src/ai-queue-assignment/ai-queue-assignment-registration.guard.vitest.spec.ts` (4 tests) pins the
invariant so the duplicate cannot silently return:

1. Every catalog code is registered exactly once (no double-registration of ANY code).
2. Exactly one queue package exists and it is the canonical code; `isAiPackageCode('ai_queue_assignment')` is false.
3. The entitlement gate checks the canonical code (source-level assertion).
4. No api source file uses the retired quoted code `'ai_queue_assignment'` as a package code (repo scan,
   excluding rbac permission names and this guard itself).
