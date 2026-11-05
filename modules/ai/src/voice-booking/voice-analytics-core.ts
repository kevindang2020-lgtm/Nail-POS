import type { VoiceAnalytics } from '@aipowersalon/api-contracts/tenant';
export type { VoiceAnalytics };   // owned by packages/api-contracts (Constitution 13 §13)
// voice-analytics-core.ts — pure aggregation of call-outcome rows into operator metrics. No I/O, fully testable.
// Rates are computed honestly: denominators are the real call count, and a metric with no data reads as null (never 0
// dressed up as a result). This turns the raw outcome store into the numbers an operator actually watches.

export interface OutcomeRowForStats {
  bookingOutcome: string | null;
  handoffOutcome: string | null;
  abandoned: boolean;
  followUpRequired: boolean;
  durationSeconds: number | null;
  toolCalls: { name: string; ok: boolean }[];
  intents: string[];
}


const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);
const isBooked = (o: string | null) => o === 'booked';
const isHandoff = (o: string | null) => !!o && o !== 'none';

export function summarizeOutcomes(rows: OutcomeRowForStats[]): VoiceAnalytics {
  const total = rows.length;
  let booked = 0, handoffs = 0, abandoned = 0, toolFail = 0, followUps = 0, durSum = 0, durN = 0;
  const intentCounts = new Map<string, number>();

  for (const r of rows) {
    if (isBooked(r.bookingOutcome)) booked++;
    if (isHandoff(r.handoffOutcome)) handoffs++;
    if (r.abandoned) abandoned++;
    if (r.followUpRequired) followUps++;
    if ((r.toolCalls ?? []).some((t) => t.ok === false)) toolFail++;
    if (typeof r.durationSeconds === 'number' && r.durationSeconds >= 0) { durSum += r.durationSeconds; durN++; }
    for (const i of r.intents ?? []) intentCounts.set(i, (intentCounts.get(i) ?? 0) + 1);
  }

  const topIntents = [...intentCounts.entries()]
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count || a.intent.localeCompare(b.intent))
    .slice(0, 5);

  return {
    totalCalls: total,
    booked, bookingRatePct: pct(booked, total),
    handoffs, handoffRatePct: pct(handoffs, total),
    abandoned, abandonmentRatePct: pct(abandoned, total),
    callsWithToolFailure: toolFail, toolFailureRatePct: pct(toolFail, total),
    followUpsNeeded: followUps,
    avgDurationSeconds: durN > 0 ? Math.round(durSum / durN) : null,
    topIntents,
  };
}
