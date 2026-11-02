// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: customer. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

// customer-booking.dto.ts — customer-facing self-booking types. The customer picks a bookable service + technician +
// date + time; the server validates against the tenant's catalog and the technician's existing appointments (reusing
// the tech-appointments pure conflict helpers) before creating a pos_tech_appointment (source 'customer_app').
export interface BookableService { id: string; name: string; durationMinutes: number; priceCents: number; category?: string | null }

export interface BookableTechnician { id: string; fullName: string; branchId?: string }   // branchId: developer, Sep 2026

export interface BookingOptions { services: BookableService[]; technicians: BookableTechnician[] }

/** D11 (Oct 21 2026): what the salon asks up front for this booking — paid from the app with a card token */
export interface BookingDepositView {
  depositId: string; appointmentId: string; status: 'pending' | 'captured' | 'failed' | 'applied' | 'refunded' | 'forfeited'; amountCents: number; cardLast4: string | null;
  refundableUntil: string | null; forfeitOnNoShow: boolean; appliedCents: number | null; refundedCents: number | null; endedReason: string | null; failureReason: string | null;
}
export interface BookingResult {
  appointmentId: string;
  /** D11: set when the salon requires a deposit — the booking stands, the deposit is paid next (POST appointments/:id/deposit) */
  deposit?: BookingDepositView | null;
  date: string;
  startTime: string;
  endTime: string;
  serviceName: string;
  technicianName: string;
  status: string;
}

export interface AvailabilitySlot { startTime: string; available: boolean; technicianIds: string[] }

export interface AvailabilityResult { date: string; serviceId: string; durationMinutes: number; window: AvailabilityWindow; slots: AvailabilitySlot[] }

export interface AvailabilityWindow { open: string; close: string; stepMinutes: number; bufferMinutes: number }
