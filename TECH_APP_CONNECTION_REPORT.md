# TECH_APP_CONNECTION_REPORT.md

`apps/tech-web/` (workspace `aipowersalon-tech-web`) connects to the real backend via `src/api/techApi.ts` →
`apps/api/src/tech/` (`/tech/*`).

## Wired flows + endpoints (`apps/api/src/tech/tech.controller.ts`)
- Today/Home, Schedule, Tickets, Ticket Detail: `/tech/me/...`, `/tech/tickets`, `/tech/tickets/:id`.
- Accept / Start service / Service done: `/tech/tickets/:id/{accept,start-service,service-done}`.
- **Live ticket edit:** `/tech/tickets/:id/{edit-options, service-lines (POST/PATCH/DELETE), change-requests (POST/GET),
  add-addon, notes}` — see TECH_LIVE_TICKET_EDIT_REPORT.md.
- Earnings: `/tech/earnings`, `/tech/earnings/detail`. Notifications: `/tech/notifications`(+read).
- Queue/More/Skills/Status(breaks/available): `/tech/{queue/state, more/state, skills, status/*}`.

## Isolation + permissions
Every tech action resolves the technician from the authenticated session and enforces ticket **ownership** (tenant +
assigned technician) plus `tech.ticket.*` permissions; edits are audit-logged. A realtime isolation test confirms one
technician's event never lands in another technician's room (`apps/api/src/tech/tech-realtime.vitest.spec.ts`).

## Status
Builds clean; tech + serving tests pass (part of 405). Live HTTP smoke of the add-line recalc is recommended next
(needs a seeded assigned ticket) — see REMAINING_BLOCKERS.md.
