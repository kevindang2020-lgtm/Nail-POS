// bookingRelevance.ts — 200-technician mandate §21/§22/§61 (found by the M5 large-salon pilot, Oct 24 2026).
//
// The Booking board shows ONE page of 12 technician columns for ONE date. Every booking-screen realtime event used to
// reload the whole board — the 12-column day grid included — even when the change was for technician #150 while page 1
// was on screen, or for another date entirely. With 200 technicians a busy (or noisy) technician kept every open board
// re-fetching its grid. These pure rules decide how much of the board a change can touch:
//
//   'skip'    the change names a date and it is not the board's date            → nothing on screen changed
//   'partial' the change names its technician(s) and none of them is on screen  → the list / counts may change
//                                                                                 (off-screen metadata), never the grid
//   'full'    anything else — a visible technician, an appointment the grid is showing now (it may have just moved
//             OFF a visible column), no technician (first available), or an event that does not say which technician
//             or date it is about (never guess: an unknown change reloads everything, as before)
//
// The event payloads carry ids and scheduling facts only (§22/§95) — `technicianId`, `technicianIds`, `date`.
export type BookingRefreshScope = 'skip' | 'partial' | 'full';

export interface BoardView { date: string | null; visibleTechnicianIds: readonly string[]; visibleAppointmentIds?: readonly string[] }

const RANK: Record<BookingRefreshScope, number> = { skip: 0, partial: 1, full: 2 };
/** the wider of two scopes (a burst of events refreshes as much as its widest member needs) */
export function widerScope(a: BookingRefreshScope | null | undefined, b: BookingRefreshScope): BookingRefreshScope {
  return a == null || RANK[b] > RANK[a] ? b : a;
}

function techIdsOf(p: Record<string, unknown>): string[] | null {
  const ids: unknown[] = [];
  if ('technicianId' in p) ids.push(p.technicianId);
  if (Array.isArray(p.technicianIds)) ids.push(...p.technicianIds);
  if (!ids.length) return null;                                   // the event does not say → unknown
  if (ids.some((x) => typeof x !== 'string' || !x)) return null;  // first available (null) touches every column
  return ids as string[];
}

/** How much of the board one change touches. `change` = an event payload or a changed appointment row. */
export function bookingChangeScope(change: unknown, view: BoardView): BookingRefreshScope {
  if (!change || typeof change !== 'object') return 'full';
  // a realtime frame's payload is the §12 envelope ({ eventId, eventType, …, data }); a change-feed row is the row itself
  const raw = change as Record<string, unknown>;
  const p = (typeof raw.eventId === 'string' && raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>;
  if (typeof p.appointmentId === 'string' && view.visibleAppointmentIds?.includes(p.appointmentId)) return 'full';
  const date = typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.date) ? p.date.slice(0, 10) : null;
  if (date && view.date && date !== view.date) return 'skip';
  const ids = techIdsOf(p);
  if (!ids) return 'full';
  const visible = new Set(view.visibleTechnicianIds);
  return ids.some((id) => visible.has(id)) ? 'full' : 'partial';
}

/** The scope of a batch of changes (the change feed's rows on a safety tick): the widest one; nothing → 'skip'. */
export function bookingChangesScope(changes: readonly unknown[], view: BoardView): BookingRefreshScope {
  let out: BookingRefreshScope = 'skip';
  for (const c of changes) { out = widerScope(out, bookingChangeScope(c, view)); if (out === 'full') break; }
  return out;
}

/** A realtime event's scope on the board: a queue change that names no appointment (a walk-in joined / moved) touches
 *  only the waitlist and the counts → 'partial'; everything else by its technician and date (bookingChangeScope). */
export function bookingEventScope(event: string, payload: unknown, view: BoardView): BookingRefreshScope {
  if (event === 'queue_updated') {
    const o = (payload ?? {}) as { appointmentId?: unknown; data?: { appointmentId?: unknown } };
    if (!(o.data?.appointmentId ?? o.appointmentId)) return 'partial';
  }
  return bookingChangeScope(payload, view);
}
