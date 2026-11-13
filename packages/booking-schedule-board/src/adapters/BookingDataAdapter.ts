/**
 * Booking data adapter contract (spec §6).
 *
 * The UI depends ONLY on this interface. `MockBookingDataAdapter` implements it
 * in-memory for isolated development; `ProductionBookingDataAdapter` delegates
 * every call to the existing AIPowerSalon APIs after merge. The backend behind
 * the production adapter is the single source of truth for appointments.
 */
import type { ScheduleEventEnvelope } from '../realtime/events';
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityGap,
  BookingPolicy,
  ID,
  ISODate,
  ISODateTime,
  OpeningResult,
  ScheduleRange,
  ScheduleSegment,
  Service,
  TechnicianDay,
  TechnicianMatch,
  Unsubscribe,
} from '../domain/scheduleTypes';

/** Every request is tenant + branch scoped (spec §33). The server re-validates these. */
export interface ScopeInput {
  tenantId: ID;
  branchId: ID;
}

export interface GetScheduleRangeInput extends ScopeInput {
  /** Inclusive date range; Day view passes the same date twice. */
  fromDate: ISODate;
  toDate: ISODate;
  /** Optional filters applied server-side (spec §19). */
  serviceId?: ID | null;
  statuses?: AppointmentStatus[];
  technicianIds?: ID[];
  /** Server paging (ignored by adapters that return the whole roster): 1-based page, page size, working-only filter. */
  page?: number;
  pageSize?: number;
  workingOnly?: boolean;
}

export interface LocateTechnicianInput extends ScopeInput {
  technicianId: ID;
  date: ISODate;
  pageSize: number;
  workingOnly?: boolean;
}

export interface GetAvailabilityInput extends ScopeInput {
  date: ISODate;
  technicianIds?: ID[];
  /** When supplied, gaps shorter than this are omitted. */
  minimumDurationMinutes?: number;
}

export interface AvailabilityResult {
  date: ISODate;
  timezone: string;
  gaps: Record<ID, AvailabilityGap[]>;
  serverVersion: number;
}

export interface FindOpeningsInput extends ScopeInput {
  date: ISODate;
  serviceIds: ID[];
  /** Total duration incl. add-ons; defaults to sum of service durations. */
  durationMinutes?: number;
  technicianId?: ID | null;
  /** Local `HH:mm` window. */
  windowStart?: string;
  windowEnd?: string;
  preferredTechnicianId?: ID | null;
  customerId?: ID | null;
  limit?: number;
}

export interface GetBestMatchesInput extends ScopeInput {
  date: ISODate;
  serviceIds: ID[];
  durationMinutes?: number;
  requestedTechnicianId?: ID | null;
  preferredTechnicianId?: ID | null;
  /** Local `HH:mm`. */
  preferredStart?: string;
  customerId?: ID | null;
}

export interface CreateAppointmentInput extends ScopeInput {
  /** Client-generated UUID; the backend de-duplicates repeats (spec §22). */
  idempotencyKey: string;
  technicianId: ID | 'any';
  customerId?: ID | null;
  customerName: string;
  customerPhone?: string | null;
  serviceIds: ID[];
  addOnIds?: ID[];
  startAt: ISODateTime;
  requestedTechnician: boolean;
  protected?: boolean;
  notes?: string | null;
  source?: Appointment['source'];
  /** Authorised manual price override in integer cents (audited by the host). */
  priceOverrideCents?: number | null;
  /** The schedule version the client acted on; mismatch → SCHEDULE_CHANGED or CONFLICT. */
  expectedServerVersion?: number;
}

export interface MoveAppointmentInput extends ScopeInput {
  appointmentId: ID;
  /** Version of the appointment the client last saw (optimistic concurrency). */
  expectedVersion: number;
  technicianId: ID;
  startAt: ISODateTime;
  idempotencyKey: string;
}

export interface CancelAppointmentInput extends ScopeInput {
  appointmentId: ID;
  expectedVersion: number;
  reason?: string | null;
}

export interface CreateWalkInInput extends ScopeInput {
  idempotencyKey: string;
  customerName: string;
  customerPhone?: string | null;
  customerId?: ID | null;
  serviceIds: ID[];
  addOnIds?: ID[];
  /** Specific technician, or 'any' → Fair Turn over the eligible set (spec §24). */
  technicianId: ID | 'any';
  requestedTechnician: boolean;
  notes?: string | null;
  priceOverrideCents?: number | null;
}

export interface CreateBlockedTimeInput extends ScopeInput {
  idempotencyKey: string;
  technicianId: ID;
  date: ISODate;
  startAt: ISODateTime;
  endAt: ISODateTime;
  reason: string;
  notes?: string | null;
  /** Recurrence is host-defined; the board passes it through untouched. */
  recurrence?: unknown;
}

export interface GetTechnicianDayInput extends ScopeInput {
  technicianId: ID;
  date: ISODate;
}

export interface GetServicesInput extends ScopeInput {
  includeInactive?: boolean;
}

export interface SubscribeScheduleInput extends ScopeInput {
  date: ISODate;
}

export interface BookingDataAdapter {
  /** true → technicians are paged on the server (getScheduleRange honours page / pageSize / workingOnly and returns
   *  `range.paging`); the board then asks for one page at a time and never holds the whole roster (addendum §13). */
  readonly pagesOnServer?: boolean;
  getScheduleRange(input: GetScheduleRangeInput): Promise<ScheduleRange>;
  getAvailability(input: GetAvailabilityInput): Promise<AvailabilityResult>;
  findOpenings(input: FindOpeningsInput): Promise<OpeningResult[]>;
  getBestMatches(input: GetBestMatchesInput): Promise<TechnicianMatch[]>;
  createAppointment(input: CreateAppointmentInput): Promise<Appointment>;
  moveAppointment(input: MoveAppointmentInput): Promise<Appointment>;
  cancelAppointment(input: CancelAppointmentInput): Promise<void>;
  createWalkIn(input: CreateWalkInInput): Promise<Appointment>;
  createBlockedTime(input: CreateBlockedTimeInput): Promise<ScheduleSegment>;
  getTechnicianDay(input: GetTechnicianDayInput): Promise<TechnicianDay>;
  getServices(input: GetServicesInput): Promise<Service[]>;
  getBookingPolicy?(input: ScopeInput): Promise<BookingPolicy>;
  /** Server-paged adapters: the 0-based page that holds a technician under the same filters, or null when filtered out. */
  locateTechnician?(input: LocateTechnicianInput): Promise<{ pageIndex: number } | null>;
  subscribeSchedule(input: SubscribeScheduleInput, handler: (e: ScheduleEventEnvelope) => void): Unsubscribe;
}

/** Permissions the host resolves server-side AND passes down for UX gating (spec §33). */
export interface BoardPermissions {
  canBook: boolean;
  canMove: boolean;
  canReassign: boolean;
  canCancel: boolean;
  canBlockTime: boolean;
  canViewTechnicianDay: boolean;
  canOverridePrice: boolean;
}

export const READ_ONLY_PERMISSIONS: BoardPermissions = {
  canBook: false,
  canMove: false,
  canReassign: false,
  canCancel: false,
  canBlockTime: false,
  canViewTechnicianDay: true,
  canOverridePrice: false,
};

export const FULL_PERMISSIONS: BoardPermissions = {
  canBook: true,
  canMove: true,
  canReassign: true,
  canCancel: true,
  canBlockTime: true,
  canViewTechnicianDay: true,
  canOverridePrice: true,
};
