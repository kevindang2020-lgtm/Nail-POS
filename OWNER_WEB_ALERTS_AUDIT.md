# owner-web hardening — AlertsScreen (verified clean)

Audited Module 6: a list of `owner_alerts` with a status filter, where each open alert exposes Ack / Resolve / Dismiss that
POST and update the row in place. A mutation surface, so the risk was the in-place update — it checks out.

## Verified clean
- **Every action returns a full alert, so the in-place update is sound.** `act()` replaces the row with the value returned by
  the action and then re-filters on `updated.status`. All three actions are typed `Promise<OwnerAlert>` client-side
  (`/owner/alerts/:id/{acknowledge,resolve,dismiss}`) and server-side they funnel through one helper —
  `transitionAlert(): Promise<OwnerAlert>` — which returns the repo's mapped, updated alert (owner.service.ts 527–537). So the
  replaced row always carries a real `id`, `status`, `severity`, `title`, and `createdAt`; it never blanks or vanishes
  unexpectedly, and resolving/dismissing an alert correctly drops it from a narrower filter (or flips it to a status pill under
  "All").
- **No `any` anywhere** — the list is typed `OwnerAlert[]`, so the field reads are compiler-guarded (unlike the screens that
  carried the earlier field bugs).
- Actionability is correct (Ack only for `new`; Resolve/Dismiss for `new`/`acknowledged`/`in_progress`; a status pill
  otherwise); failures leave the row untouched; realtime alert events refetch; honest loading / 403 / empty states.

No bug. **6 tests** added: render (actions for open alerts, status pill for closed); acknowledge updating in place from the
returned row; dismiss dropping a row's actions for a status pill; the filter-tab reload (`{ status }`); the empty state; and a
friendly 403 with Retry.

## Verification
owner-web `tsc` clean, **69 tests pass** (15 files), `vite build` clean. (admin-web 151, pos-web 75, tech-web 58, customer-web
113, backend 603 / PASS — all unchanged; typed screen, only new tests added.)

## Sweep status
Still **10 fixes** (admin-web 6, owner-web 3, pos-web 1, tech-web 1). owner-web coverage now spans the money screens, the home
and booking dashboards, and alerts. Remaining owner-web: StaffPerformance, BranchPerformance, TechnicianDetail, Audit, More,
Login, and the static legal/delete screens — all read-only or low-logic.
