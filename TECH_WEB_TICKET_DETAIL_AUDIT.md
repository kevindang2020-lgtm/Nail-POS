# tech-web hardening — TicketDetailScreen (broken Edit-Live-Ticket flow fixed)

Pivoted to tech-web and started with its largest, highest-value untested screen: `TicketDetailScreen` (255 lines) — the
technician's core working surface (the accept → start-service → service-done state machine, the Edit Live Ticket modal, plus
add-note and request-cancel). It had no test and a **serious functional bug** in the live-edit flow.

## Bug — the Edit modal read the wrong service-line fields, breaking every line action
The same `services` array is rendered in two places. The main services card reads the correct fields (`s.id`, `s.name`,
`s.priceCents`). The Edit modal, however, cast each line to `any` and read `l.serviceLineId` / `l.serviceName` /
`l.serviceId` / `l.isAddOn`. Verified at the source: the backend ticket-detail mapper
(`tech.kysely.repository.ts` line 178) returns each line as `{ id, name, priceCents, durationMinutes, status }` — and the
client type `TechTicketServiceLine` matches. There is **no** `serviceLineId`/`serviceName`/`serviceId`/`isAddOn` on a ticket
line (those names belong to other DTOs), and `editOptions` has no `lines` array — its `services` field is the catalog.

So at runtime, inside the Edit modal:
- service-line **names rendered blank** (`l.serviceName` was undefined);
- the per-line React `key` was `undefined`;
- clicking **Change** opened the change panel for **every** line at once (`chgLine === undefined` is true for all);
- and worst, **Mark Done / Remove / Change Service all sent `undefined` as the service-line id** —
  `patchLine(ticketId, undefined, …)`, `removeLine(ticketId, undefined)`, `changeService(ticketId, undefined, …)` — so a
  technician literally could not complete, remove, or change a line from the live-ticket editor (the calls hit
  `…/service-lines/undefined` and failed). The catalog-side reads (`sv.serviceId` for Add / Change-to) were already correct.

**Fix:** the modal now reads the real line fields — `l.id` (the service-line id, used by `PATCH/DELETE
/tech/tickets/:id/service-lines/:lineId` and the change-request `lineId`) and `l.name` — the change-to dropdown excludes the
current service by name, and the unavailable `isAddOn` decoration was dropped. The map callback is now **typed**
(`services.map((l) => …)` instead of `(l: any)`), so the compiler enforces correct line fields and prevents this exact
regression. `tsc` passes and no stray wrong-field reads remain.

## Verified clean (no change)
The accept/start-service/service-done state machine selects the right primary action per status; `act()`/`runEdit()` reload
after each mutation; Add-Service/Add-Add-On use the catalog `serviceId` correctly; add-note and request-cancel guard empty
text and target the right endpoints; load errors render an alert.

## Tests added (9)
Renders the ticket; accept (assigned); start-service (accepted); service-done via the confirm modal; **edit modal renders
the real line name and sends the real line id on mark-done (fix)**; **edit modal remove sends the real line id (fix)**;
add a note (internal); request a cancellation; load error.

## Verification
tech-web `tsc` clean, **42 tests pass** (8 files), `vite build` clean. (admin-web 151 / clean, owner-web 53 / clean, pos-web
75 / clean, backend 603 / PASS — all unchanged; the fix was client-side.)

## Remaining in tech-web (untested)
LoginScreen, MoreScreen, NotificationsScreen, QueueScreen, SettingsScreen, TechEarningsScreen, TechFollowUpsScreen,
TechProfileScreen, TechScheduleScreen, TechDeleteAccountScreen, and the static Privacy/Terms screens.
