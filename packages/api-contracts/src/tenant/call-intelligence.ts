// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface CallIntelSummary {
  totalToday: number; aiHandledToday: number; missedToday: number; recoveredToday: number; qualifiedToday: number;
  callToBookingRatePct: number | null;          // bookings(booked+recovered) / answered-inbound today
  avgDurationSeconds: number | null;
  missedQueue: { callerPhone: string | null; customerId: string | null; at: string }[];
  recovered: { customerId: string | null; appointmentId: string | null; at: string }[];
}
