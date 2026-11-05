// ai-scheduling-application.ts — the pure rules around turning a recommendation into a schedule change. The change itself
// always goes THROUGH the booking service (never a direct appointment write) — AiSchedulingService.apply orchestrates it
// with the stored proposed_state, the stored appointment snapshot, a versioned idempotency key and conditional status
// updates. What lives here:
//   • the booking surface the optimizer calls (the real BookingService satisfies it and re-validates everything);
//   • snapshotDrift — has the appointment moved since the recommendation was computed? (→ STALE_SCHEDULE, never overwrite);
//   • applyKey — the idempotency key, versioned by the apply attempt so a retry is a NEW key;
//   • evaluateAutomation — the controlled-automation gate (B's runner calls it for every recommendation of a run).
import type { SchedAppointmentSnapshot } from '@aipowersalon/api-contracts/tenant';
import { isAutoActionAllowed, type ResolvedSettings } from './ai-scheduling-settings';

export interface ApplyCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; }

/** The booking-service surface the optimizer uses. booking.service re-checks hours / windows / skills / conflicts and the
 *  appointment version (expectedVersion → 409 VERSION_CONFLICT) and may throw; its rejection always stands. */
export interface BookingPort {
  reschedule(ctx: ApplyCtx, id: string, body: { startTime: string; date?: string; technicianId?: string; expectedVersion?: number; notifyCustomer?: boolean; reason?: string }): Promise<{ appointmentId?: string; version?: number }>;
}

export interface CurrentAppointment { date: string; startTime: string; technicianId: string | null; version: number; status: string }
/** The fields that matter for staleness: date, start, technician and the optimistic version. Any drift → stale. */
export function snapshotDrift(snapshot: SchedAppointmentSnapshot, now: CurrentAppointment | null): string[] {
  if (!now) return ['missing'];
  const d: string[] = [];
  if (now.date !== snapshot.date) d.push('date');
  if (now.startTime !== snapshot.startTime) d.push('startTime');
  if ((now.technicianId ?? null) !== (snapshot.technicianId ?? null)) d.push('technicianId');
  if (Number(now.version) !== Number(snapshot.version)) d.push('version');
  return d;
}

/** `${tenantId}:${recId}:apply:${attempt}` — the same attempt is the same key (a duplicate call returns the recorded
 *  result); retry increments apply_attempt so a retry is a fresh key. */
export const applyKey = (tenantId: string, recId: string, attempt: number): string => `${tenantId}:${recId}:apply:${attempt}`;
export const rollbackKey = (tenantId: string, recId: string, attempt: number): string => `${tenantId}:${recId}:rollback:${attempt}`;

/** Booking errors → a stable code for the application row (ConflictError carries .code, e.g. VERSION_CONFLICT). */
export function bookingErrorCode(e: unknown): string {
  const any = e as { code?: unknown; name?: unknown } | null;
  if (any && typeof any.code === 'string' && any.code) return any.code;
  if (any && any.name === 'ForbiddenError') return 'BOOKING_FORBIDDEN';
  if (any && any.name === 'ValidationError') return 'BOOKING_VALIDATION';
  if (any && any.name === 'ConflictError') return 'BOOKING_CONFLICT';
  return 'BOOKING_REJECTED';
}

// ── controlled automation gate ────────────────────────────────────────────────
export interface AutomationDecision { autoApply: boolean; reason: string }
/** Decide whether an action may run automatically, or must go to manual review. Requires: settings allow it (Stage 7),
 *  the action is REVERSIBLE, and it's not one that touches a confirmed appointment or a customer. */
export function evaluateAutomation(resolved: ResolvedSettings, input: { action: string; confidence: number; reversible: boolean; touchesConfirmedAppointment: boolean; touchesCustomer: boolean }): AutomationDecision {
  if (input.touchesConfirmedAppointment) return { autoApply: false, reason: 'confirmed_appointment_requires_review' };
  if (input.touchesCustomer) return { autoApply: false, reason: 'customer_facing_requires_review' };
  if (!input.reversible) return { autoApply: false, reason: 'irreversible_requires_review' };
  if (!isAutoActionAllowed(resolved, input.action, input.confidence)) return { autoApply: false, reason: 'not_permitted_by_settings' };
  return { autoApply: true, reason: 'safe_reversible_confident_action' };
}
