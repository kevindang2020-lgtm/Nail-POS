// turn-queue.list-queries.ts — Constitution 5 §47–§52: the declared filters / ranges of the turn-queue list endpoints
// (@ListQueries on TurnQueueController). Unknown filter[x] → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const TurnQueueControllerListQueries = {
  history: {
    filters: { technicianId: { type: 'id' }, customerId: { type: 'id' }, reasonCode: { type: 'text' }, eventType: { type: 'text' }, assignmentSource: { type: 'text' }, manualOnly: { type: 'text' } },
    dateRange: { maxDays: 92 }, maxLimit: 5000, defaultLimit: 2000,
  },
  fairness: { dateRange: { maxDays: 92 } },
  teamReport: { params: ['period', 'date'] },
  rules: { params: ['includeHistory'] },
  summary: { params: ['period', 'date'] },
} satisfies Record<string, ListQuerySpec>;

/** GET /tech/turn-queue/summary — the technician's own period summary (§171). */
export const TechTurnQueueControllerListQueries = {
  mySummary: { params: ['period', 'date'] },
} satisfies Record<string, ListQuerySpec>;
