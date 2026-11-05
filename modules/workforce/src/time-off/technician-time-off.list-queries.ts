// technician-time-off.list-queries.ts — the declared filters of the time-off list endpoints (@ListQueries; Constitution 5
// §47–§52). status ∈ pending | approved | rejected | cancelled (checked again in the service); from / to bound the window
// (the service applies them; a span over 400 days is refused).
import type { ListQuerySpec } from '@aipowersalon/database';

export const TechTimeOffListQueries = {
  list: { filters: { status: { type: 'enum', values: ['pending', 'approved', 'rejected', 'cancelled'] } }, search: false, dateRange: { maxDays: 400 } },
} satisfies Record<string, ListQuerySpec>;
export const PosTimeOffListQueries = {
  pending: { filters: {}, search: false },
  list: { filters: { status: { type: 'enum', values: ['pending', 'approved', 'rejected', 'cancelled'] } }, search: false, dateRange: { maxDays: 400 } },
} satisfies Record<string, ListQuerySpec>;
