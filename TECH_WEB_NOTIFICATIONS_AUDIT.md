# tech-web hardening — NotificationsScreen (verified clean)

Audited the technician notifications list — real rows from `technician_notifications`, with an unread dot, a mark-all-read
badge, and a tap-through to the referenced ticket. It checks out.

## Verified clean
- **The screen is self-typing against the client, and the client matches the repo exactly.** `data` is typed
  `Awaited<ReturnType<typeof techApi.notifications>>`, so every read is compiler-checked against the client's declared shape —
  and that shape (`{ items: { id, type, title, body, reference, readAt, createdAt }[]; unread }`) is produced verbatim by the
  repo, which maps the snake_case columns to those camelCase keys (`readAt: r.read_at ? ISO : null`, `createdAt: ISO`, etc.;
  tech.kysely.repository.ts). `unread` is derived server-side as the count of unread items — so the badge count, the per-row
  unread dot (`!n.readAt`), and the ticket deep-link (`n.reference`) all read real fields.
- `markNotificationsRead()` ↔ `POST /tech/notifications/read` (defaults to marking all), then reloads; the relative-time
  helper floors at 0 so a future timestamp can't render a negative age; honest loading / empty / error states; rows without a
  reference are inert rather than dead links.

No bug. **5 tests** added: render (titles/bodies + the single unread dot + the `Mark all read (1)` badge); mark-all-read
clearing the badge after reload; tapping a referenced row deep-linking to its ticket; the empty state; and the error path.

## Verification
tech-web `tsc` clean, **63 tests pass** (12 files), `vite build` clean. (admin-web 151, pos-web 75, owner-web 69,
customer-web 113, backend 603 / PASS — all unchanged; typed screen, only new tests added.)

## Sweep status
Still **10 fixes** (admin-web 6, owner-web 3, pos-web 1, tech-web 1). tech-web coverage now includes earnings, queue, profile,
ticket detail, follow-ups list and notifications. Remaining tech-web: Settings, Schedule, More, Login, TechFollowUps actions,
and static legal/delete screens.
