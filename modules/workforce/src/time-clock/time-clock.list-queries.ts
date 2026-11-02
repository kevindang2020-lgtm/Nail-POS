// time-clock.list-queries.ts — the declared query parameters of GET /pos/time-clock/state (Constitution 5 §47–§52;
// @ListQueries on time-clock.controller.ts). 200-technician §2 (Oct 27 2026): the day's roster is paged on the server —
// page / pageSize (max 48), search (name, accent-insensitive), state (clocked_in | on_break | clocked_out | off | on_clock).
import type { ListQuerySpec } from '@aipowersalon/database';

export const TimeClockControllerListQueries = {
  state: { filters: { state: { type: 'text' } }, limitParams: ['pageSize'], maxLimit: 48, search: { params: ['search'] }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
