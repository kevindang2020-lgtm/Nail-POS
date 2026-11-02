// bookingFeed.ts — M4 (Oct 24 2026): read one change-feed SWEEP of the Booking board. The server pages a busy minute's
// changes (`hasMore` + a continuation cursor) instead of answering RESYNC_REQUIRED above 50 rows; the board follows the
// pages at once and scopes its refresh over every row of the sweep. `resync` = the board should reload its snapshot
// (more pages than `maxPages` — the server also bounds a sweep and answers RESYNC_REQUIRED past its last page).
export interface FeedPage<Row> { appointments: Row[]; cursor: string; hasMore?: boolean; /** set by the API client (bytes on the wire) */ __bytes?: number }
export interface FeedSweep<Row> { rows: Row[]; cursor: string; pages: number; bytes: number; resync: boolean }

export async function readFeedSweep<Row>(get: (cursor: string) => Promise<FeedPage<Row>>, cursor: string, maxPages = 10): Promise<FeedSweep<Row>> {
  let r = await get(cursor);
  const rows = [...r.appointments];
  let bytes = r.__bytes ?? 0, pages = 1;
  while (r.hasMore && pages < maxPages) {
    r = await get(r.cursor);
    rows.push(...r.appointments); bytes += r.__bytes ?? 0; pages++;
  }
  return { rows, cursor: r.cursor, pages, bytes, resync: !!r.hasMore };
}
