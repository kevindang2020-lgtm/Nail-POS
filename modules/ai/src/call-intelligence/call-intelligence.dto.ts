import { businessDate } from '@aipowersalon/date-time';
import type { CallIntelSummary } from '@aipowersalon/api-contracts/tenant';
export type { CallIntelSummary };   // owned by packages/api-contracts (Constitution 13 §13)
/**
 * call-intelligence.dto.ts — call-intelligence contract + pure summary math (spec §12–16).
 * A call event is idempotent on providerCallId. The summary is computed the same way over the in-memory and
 * Postgres repos so tests and production agree.
 */
export type CallStatus = 'missed' | 'answered_ai' | 'answered_human' | 'voicemail';
export type CallOutcome = 'booked' | 'recovered' | 'transferred' | 'message' | 'no_action';

export interface CallEventInput {
  tenantId: string; branchId?: string | null; providerCallId: string;
  customerId?: string | null; callerPhone?: string | null;
  direction?: 'inbound' | 'outbound'; status: CallStatus; aiHandled?: boolean;
  intent?: string | null; durationSeconds?: number; outcome?: CallOutcome;
  recoveredAppointmentId?: string | null; startedAt?: string;
}

export interface CallEventRow extends CallEventInput {
  id: string; direction: 'inbound' | 'outbound'; aiHandled: boolean; durationSeconds: number; outcome: CallOutcome; startedAt: string;
}


// the same date in `tz` — the branch's (Oct 6 2026 — it was the UTC date); 'UTC' when no zone is given
const isToday = (iso: string, now: Date, tz: string): boolean => businessDate(tz, new Date(iso)) === businessDate(tz, now);

/** Pure projection over a set of rows -> today's summary. Used by the in-memory repo and unit tests. */
export function summarize(rows: CallEventRow[], now: Date = new Date(), tz = 'UTC'): CallIntelSummary {
  const today = rows.filter((r) => isToday(r.startedAt, now, tz));
  const aiHandledToday = today.filter((r) => r.status === 'answered_ai').length;
  const missed = today.filter((r) => r.status === 'missed');
  const recoveredRows = today.filter((r) => r.outcome === 'recovered');
  const booked = today.filter((r) => r.outcome === 'booked' || r.outcome === 'recovered').length;
  const answeredInbound = today.filter((r) => r.direction === 'inbound' && (r.status === 'answered_ai' || r.status === 'answered_human')).length;
  const durations = today.map((r) => r.durationSeconds).filter((d) => d > 0);
  return {
    totalToday: today.length,
    aiHandledToday,
    missedToday: missed.length,
    recoveredToday: recoveredRows.length,
    qualifiedToday: today.filter((r) => !!r.intent).length,
    callToBookingRatePct: answeredInbound > 0 ? Math.round((booked / answeredInbound) * 1000) / 10 : null,
    avgDurationSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    missedQueue: missed.slice(0, 10).map((r) => ({ callerPhone: r.callerPhone ?? null, customerId: r.customerId ?? null, at: r.startedAt })),
    recovered: recoveredRows.slice(0, 10).map((r) => ({ customerId: r.customerId ?? null, appointmentId: r.recoveredAppointmentId ?? null, at: r.startedAt })),
  };
}
