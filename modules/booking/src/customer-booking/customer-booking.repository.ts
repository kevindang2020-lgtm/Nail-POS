// customer-booking.repository.ts — data port for the customer self-booking surface. The Kysely adapter reads the
// tenant's active services + technicians, the existing appointments for a date (conflict input), resolves the customer
// from the session, and inserts the new appointment. In-memory adapter is empty/no-op (safe before a DB handle exists).
import type { BookableService, BookableTechnician } from './customer-booking.dto';

export interface CustomerBookingContext { tenantId: string; branchId: string; userId: string }
export interface ExistingApptRow { appointmentId: string; technicianId: string; startTime: string; endTime: string; status: string }
export interface RescheduleAtomicInput { tenantId: string; customerId: string; appointmentId: string; technicianId: string; date: string; startTime: string; endTime: string; bufferMinutes?: number;
  /** §73: the customer's booking session — its own hold never blocks its own move (another session's always does). */
  bookingSessionId?: string | null }
export interface InsertBookingInput {
  tenantId: string; branchId: string; technicianId: string; customerId: string; customerName: string;
  customerPhone?: string | null;
  serviceId: string; serviceName: string; durationMinutes: number; priceCents: number; date: string; startTime: string; endTime: string;
  selectedAddOns?: { addOnId: string; name: string; durationDeltaMinutes: number; priceCents: number }[];
  allServicesData?: { serviceId: string; serviceName: string; durationMinutes: number; priceCents: number; addOns?: any[] }[];
  notes?: string | null; inspirationPhotoId?: string | null; bufferMinutes?: number;
  /** §73: the customer's booking session — its own hold never blocks its own booking (another session's always does). */
  bookingSessionId?: string | null;
}

export interface CustomerBookingDataPort {
  /** Constitution 7 §19 — a salon that is not ACTIVE (suspended, closed, not yet live) takes no customer bookings. */
  salonAcceptsBookings?(ctx: CustomerBookingContext): Promise<boolean>;
  /** Is this branch one of the session tenant's own, active, non-deleted branches? (guards the client-named salonId) */
  branchBelongsToTenant?(ctx: CustomerBookingContext, branchId: string): Promise<boolean>;
  resolveCustomerId(ctx: CustomerBookingContext): Promise<{ id: string; fullName: string; phone?: string | null; language?: string | null } | null>;
  /** D11: the appointment's start as an instant, in its branch's time zone (the deposit's refund window counts from it) */
  startsAtOf?(ctx: CustomerBookingContext, appointmentId: string): Promise<Date | null>;
  /** D11: is this appointment the customer's own (the deposit routes answer 404 otherwise) */
  appointmentBelongsToCustomer?(ctx: CustomerBookingContext, appointmentId: string, customerId: string): Promise<boolean>;
  listServices(ctx: CustomerBookingContext): Promise<BookableService[]>;
  listTechnicians(ctx: CustomerBookingContext): Promise<BookableTechnician[]>;
  getService(ctx: CustomerBookingContext, serviceId: string): Promise<BookableService | null>;
  getServiceAddOns(ctx: CustomerBookingContext, serviceId: string): Promise<{ addOnId: string; durationDeltaMinutes: number; priceCents: number; name: string }[]>;
  getTechnician(ctx: CustomerBookingContext, technicianId: string): Promise<BookableTechnician | null>;
  existingForDate(ctx: CustomerBookingContext, date: string): Promise<ExistingApptRow[]>;
  getAppointmentForReschedule(ctx: CustomerBookingContext, customerId: string, appointmentId: string): Promise<{ technicianId: string; durationMinutes: number; status: string } | null>;
  rescheduleAtomic(input: RescheduleAtomicInput): Promise<{ ok: boolean; conflictingAppointmentId?: string; heldBy?: string }>;
  insertBooking(input: InsertBookingInput): Promise<string>; // returns new appointment id
  // Atomic insert: locks (tenant,tech,date), re-checks the technician conflict against committed rows, then inserts.
  // Returns ok:false (with the blocking appointment) instead of inserting when the slot was taken by a concurrent booking.
  insertBookingAtomic(input: InsertBookingInput): Promise<{ ok: true; id: string } | { ok: false; conflictingAppointmentId?: string; heldBy?: string }>;
  /** §71/§72 (Wave 3, Oct 13 2026): the technician's bookable windows that day in minutes of day — store hours ∩ weekly
   *  schedule − breaks/lunch − blocked time, the SAME rule the staff engine applies (pbTechDayWindows). `null` = the port
   *  cannot say (no schedule data source), in which case the service does not refuse. */
  technicianWindows?(ctx: CustomerBookingContext, technicianId: string, date: string): Promise<{ start: number; end: number }[] | null>;
  /** the salon's own clock: today's date and the minute of day in the branch's time zone (a past slot is refused against it) */
  salonNow?(ctx: CustomerBookingContext): Promise<{ date: string; minutes: number }>;
}

export class InMemoryCustomerBookingRepository implements CustomerBookingDataPort {
  async resolveCustomerId(): Promise<{ id: string; fullName: string } | null> { return null; }
  async listServices(): Promise<BookableService[]> { return []; }
  async listTechnicians(): Promise<BookableTechnician[]> { return []; }
  async getService(): Promise<BookableService | null> { return null; }
  async getServiceAddOns(): Promise<{ addOnId: string; durationDeltaMinutes: number; priceCents: number; name: string }[]> { return []; }
  async getTechnician(): Promise<BookableTechnician | null> { return null; }
  async existingForDate(): Promise<ExistingApptRow[]> { return []; }
  async getAppointmentForReschedule(): Promise<{ technicianId: string; durationMinutes: number; status: string } | null> { return null; }
  async rescheduleAtomic(): Promise<{ ok: boolean; conflictingAppointmentId?: string }> { return { ok: false }; }
  async insertBooking(): Promise<string> { return ''; }
  async insertBookingAtomic(): Promise<{ ok: true; id: string } | { ok: false; conflictingAppointmentId?: string }> { return { ok: true, id: '' }; }
}
