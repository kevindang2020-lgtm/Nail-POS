# tech-web hardening — TechEditOptions type (preventive, locks a prior fix)

Typed `techApi.editOptions` — the payload behind the TicketDetail "Edit Live Ticket" modal, which was the source of this
sweep's most serious bug (the services array read with the wrong field names). It was still `any`, so the modal's reads were
unguarded. Now they're compiler-checked, which locks that fix against regression.

## What changed
- **New types in `techApi.ts`** mirroring the backend `serving.techEditOptions` shape:
  - `TechEditService` (`serviceId`, `name`, `categoryName`, `priceCents`, `durationMinutes`, `isAddOn`),
  - `TechPendingChangeRequest` (`id`, `requestType`, `oldValue?/newValue?.serviceName`, `status`),
  - `TechEditOptions` (`editable`, `lockedReason`, `ticketStatus`, `can {addService,changeService,removeLine}`,
    `approvalRequiredFor`, `categories`, `services[]`, `pendingChangeRequests[]`).
- **`editOptions` typed** `=> TechEditOptions` (was `any`).
- **`TicketDetailScreen` de-`any`-ed:** `edit` state → `TechEditOptions`, and the modal's pending-request and add-service map
  callbacks dropped their `(r: any)` / `(sv: any)`. `tsc` stays clean, confirming all ten `edit.*` reads
  (`editable`/`lockedReason`/`pendingChangeRequests`/`can`/`services`/`categories`) match the type.

## Incidental verification
While mapping the shape I confirmed the pending-change-request rows are camelCase end-to-end — the repo emits `requestType`,
`oldValue`, `newValue` (serving.kysely.repository.ts 82), with `serviceName` inside the snapshots — so the modal's
`r.requestType` / `r.oldValue?.serviceName` reads were already correct (no latent bug there).

## Verification
tech-web `tsc` clean, **74 tests pass** (14 files, incl. the existing TicketDetail test that locks the original fix),
`vite build` clean. (admin-web 151, pos-web 75, owner-web 85, customer-web 136, backend 603 / PASS — all unchanged; types only.)
