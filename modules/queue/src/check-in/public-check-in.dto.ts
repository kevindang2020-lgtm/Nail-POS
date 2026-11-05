// public-check-in.dto.ts — AIPowerSalon customer self check-in kiosk (public, by slug).
// SECURITY (§22): resolve tenant/branch from slug only; never accept a raw tenantId from the client;
// only return an appointment when the phone matches; expose limited fields; status by opaque token only.

export interface CustomerMini { customerId: string; firstName: string; }
export interface AppointmentMini {
  appointmentId: string;
  startTimeLabel: string;
  serviceName: string;
  technicianName?: string;
}

// State 1 — lookup
export interface PublicCheckInLookupRequest { tenantSlug: string; branchSlug: string; phone: string; }
export interface PublicCheckInLookupResponse {
  customer?: CustomerMini;
  appointment?: AppointmentMini;
  foundAppointment: boolean;
  canWalkIn: boolean;
}

// State 2 — appointment arrived
export interface PublicAppointmentArrivedRequest { tenantSlug: string; branchSlug: string; phone: string; appointmentId?: string; }

// State 3 — walk-in
export interface PublicWalkInRequest {
  tenantSlug: string;
  branchSlug: string;
  customerName: string;
  phone: string;
  serviceIds?: string[];
}

// shared confirmation payload returned by arrived/walk-in
export interface PublicCheckInConfirmation {
  publicCheckInToken: string;
  firstName: string;
  estimatedWaitMinutesMin: number;
  estimatedWaitMinutesMax: number;
}

// State 4 — status (by token only)
export interface PublicCheckInStatus {
  queuePosition: number;
  estimatedWaitMinutesMin: number;
  estimatedWaitMinutesMax: number;
  status: "waiting" | "assigned" | "serving" | "ready_checkout";
}

// ===== pure helpers (unit-testable) =====

// normalize a typed phone to digits only (for tenant-scoped matching)
export function normalizePhone(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

// kiosk never echoes a full phone/customer list; mask for any UI echo
export function maskPhone(raw: string): string {
  const d = normalizePhone(raw);
  if (d.length < 4) return "•••";
  return "(•••) •••-" + d.slice(-4);
}

// wait window shown to the customer (min/max band around the point estimate)
export function waitWindow(pointEstimateMinutes: number): { min: number; max: number } {
  const min = Math.max(5, Math.round(pointEstimateMinutes / 5) * 5);
  return { min, max: min + 10 };
}
