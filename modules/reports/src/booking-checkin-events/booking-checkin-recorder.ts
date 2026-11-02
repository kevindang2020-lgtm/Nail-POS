// booking-checkin-recorder.ts — the WRITER seam for the Booking & Check-In Monitor's event stores. The pipeline
// (kiosk/check-in/booking/AI flows) calls these to record a failure, AI handoff, unmatched customer, or duplicate
// candidate AS IT HAPPENS. Deliberately separate from the monitor (which only READS) so the dependency points
// pipeline → recorder → tables → monitor, never the reverse. Every method is fail-soft: a recorder problem must never
// break the customer-facing flow that called it. Only safe diagnostic detail is stored — never secrets/tokens/PII beyond
// what the store columns intend.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export const BOOKING_CHECKIN_RECORDER = 'BOOKING_CHECKIN_RECORDER';

export type FailureCategory = 'check_in' | 'booking' | 'api' | 'integration';
export type RetryStatus = 'failed' | 'retrying' | 'retry_available' | 'resolved' | 'not_retryable';

export interface FailedEventInput {
  tenantId: string; branchId?: string | null; category?: FailureCategory;
  bookingId?: string | null; checkinId?: string | null; appointmentId?: string | null; deviceId?: string | null;
  source?: string | null; checkInMethod?: string | null; failureType?: string; errorCode?: string | null;
  errorMessage?: string | null; correlationId?: string | null; retryStatus?: RetryStatus;
}
export interface HandoffInput { tenantId: string; branchId?: string | null; aiSessionId?: string | null; customerRef?: string | null; transferredTo?: string; reason?: string | null; status?: string; waitSeconds?: number | null; failureReason?: string | null }
export interface UnmatchedInput { tenantId: string; branchId?: string | null; displayName?: string | null; normalizedPhone?: string | null; normalizedEmail?: string | null; source?: string | null; possibleMatches?: number; reviewState?: string; lastContactAt?: Date | null }
export interface DuplicateInput { tenantId: string; branchId?: string | null; customerRef?: string | null; appointmentId?: string | null; deviceId?: string | null; checkInMethod?: string | null; matchReasons?: string[]; confidence?: number; reviewState?: string }

// Pure normalizer (unit-tested): applies the store's defaults + clamps so an emit always produces a valid row.
export function normalizeFailedEvent(i: FailedEventInput) {
  const cat: FailureCategory = i.category ?? 'check_in';
  return {
    tenantId: i.tenantId,
    branchId: i.branchId ?? null,
    category: cat,
    bookingId: i.bookingId ?? null,
    checkinId: i.checkinId ?? null,
    appointmentId: i.appointmentId ?? null,
    deviceId: i.deviceId ?? null,
    source: i.source ?? null,
    checkInMethod: i.checkInMethod ?? null,
    failureType: (i.failureType && i.failureType.trim()) || 'unknown_error',
    errorCode: i.errorCode ?? null,
    errorMessage: i.errorMessage ? String(i.errorMessage).slice(0, 500) : null, // safe message only, bounded
    correlationId: i.correlationId ?? null,
    retryStatus: i.retryStatus ?? 'failed',
  };
}

export interface BookingCheckinRecorderPort {
  recordFailedEvent(i: FailedEventInput): Promise<void>;
  recordHandoff(i: HandoffInput): Promise<void>;
  recordUnmatched(i: UnmatchedInput): Promise<void>;
  recordDuplicateCandidate(i: DuplicateInput): Promise<void>;
}

export class BookingCheckinRecorder implements BookingCheckinRecorderPort {
  constructor(private readonly db: AppDatabase) {}

  async recordFailedEvent(i: FailedEventInput): Promise<void> {
    const e = normalizeFailedEvent(i);
    try {
      await sql`insert into booking_checkin_failed_events
        (tenant_id, branch_id, category, booking_id, checkin_id, appointment_id, device_id, source, check_in_method, failure_type, error_code, error_message, correlation_id, retry_status)
        values (${e.tenantId}, ${e.branchId}, ${e.category}, ${e.bookingId}, ${e.checkinId}, ${e.appointmentId}, ${e.deviceId}, ${e.source}, ${e.checkInMethod}, ${e.failureType}, ${e.errorCode}, ${e.errorMessage}, ${e.correlationId}, ${e.retryStatus})`.execute(this.db as any);
    } catch { /* fail-soft: never break the calling flow */ }
  }

  async recordHandoff(i: HandoffInput): Promise<void> {
    try {
      await sql`insert into ai_receptionist_handoffs
        (tenant_id, branch_id, ai_session_id, customer_ref, transferred_to, reason, status, requested_at, wait_seconds, failure_reason)
        values (${i.tenantId}, ${i.branchId ?? null}, ${i.aiSessionId ?? null}, ${i.customerRef ?? null}, ${i.transferredTo ?? 'front_desk'}, ${i.reason ?? null}, ${i.status ?? 'requested'}, now(), ${i.waitSeconds ?? null}, ${i.failureReason ?? null})`.execute(this.db as any);
    } catch { /* fail-soft */ }
  }

  async recordUnmatched(i: UnmatchedInput): Promise<void> {
    try {
      await sql`insert into unmatched_customer_records
        (tenant_id, branch_id, display_name, normalized_phone, normalized_email, source, possible_matches, review_state, last_contact_at)
        values (${i.tenantId}, ${i.branchId ?? null}, ${i.displayName ?? null}, ${i.normalizedPhone ?? null}, ${i.normalizedEmail ?? null}, ${i.source ?? null}, ${i.possibleMatches ?? 0}, ${i.reviewState ?? 'pending'}, ${i.lastContactAt ?? null})`.execute(this.db as any);
    } catch { /* fail-soft */ }
  }

  async recordDuplicateCandidate(i: DuplicateInput): Promise<void> {
    try {
      await sql`insert into duplicate_checkin_candidates
        (tenant_id, branch_id, customer_ref, appointment_id, device_id, check_in_method, match_reasons, confidence, review_state)
        values (${i.tenantId}, ${i.branchId ?? null}, ${i.customerRef ?? null}, ${i.appointmentId ?? null}, ${i.deviceId ?? null}, ${i.checkInMethod ?? null}, ${JSON.stringify(i.matchReasons ?? [])}::jsonb, ${i.confidence ?? 0}, ${i.reviewState ?? 'pending'})`.execute(this.db as any);
    } catch { /* fail-soft */ }
  }
}
