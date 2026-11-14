/**
 * Core data shapes for the Booking Schedule Board (spec §7).
 *
 * These are *module contracts*, not new persistent entities. After merge the
 * ProductionBookingDataAdapter maps the existing AIPowerSalon
 * appointment / technician / service / schedule models into these shapes.
 * Identifiers are opaque strings so existing ids pass through unchanged.
 */

export type ID = string;
/** ISO-8601 date-time with offset, e.g. `2026-05-06T09:00:00-04:00`. */
export type ISODateTime = string;
/** ISO calendar date, e.g. `2026-05-06`. */
export type ISODate = string;
/** `HH:mm` 24h local time. */
export type HHmm = string;

export const GRID_MINUTES = 15;

export type TechnicianWorkingState =
  | 'working'
  | 'off'
  | 'time_off'
  | 'on_break'
  | 'lunch'
  | 'in_service'
  | 'blocked';

export interface Technician {
  id: ID;
  tenantId: ID;
  branchId: ID;
  displayName: string;
  avatarUrl?: string | null;
  active: boolean;
  workingState: TechnicianWorkingState;
  /** Exact technician → service qualification (spec §18). `null` = not sent by the host: the board makes no local
   *  eligibility pre-check and the authoritative backend decides every placement (production: the server's one
   *  eligibility authority — the POS never re-derives it). */
  serviceIds: ID[] | null;
  /** Display ordering within the branch (stable paging). */
  sortOrder: number;
}

export interface Service {
  id: ID;
  tenantId: ID;
  name: string;
  categoryId?: ID | null;
  durationMinutes: number;
  priceCents: number;
  active: boolean;
  /** Empty/undefined = available at all branches. */
  branchIds?: ID[];
}

export interface ServiceAddOn {
  id: ID;
  name: string;
  /** Time-changing add-ons extend the required duration (spec §13). */
  durationMinutes: number;
  priceCents: number;
}

export interface AppointmentServiceItem {
  serviceId: ID;
  name: string;
  durationMinutes: number;
  priceCents: number;
  addOns?: ServiceAddOn[];
}

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'in_service'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

export type AppointmentSource = 'pos' | 'walk_in' | 'online' | 'phone' | 'ai_phone' | 'partner';

/** Statuses that occupy technician time on the board. */
export const OCCUPYING_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'scheduled',
  'confirmed',
  'arrived',
  'in_service',
  'completed',
]);

export interface Appointment {
  id: ID;
  tenantId: ID;
  branchId: ID;
  customerId?: ID | null;
  customerName: string;
  customerPhone?: string | null;
  technicianId: ID;
  items: AppointmentServiceItem[];
  startAt: ISODateTime;
  endAt: ISODateTime;
  status: AppointmentStatus;
  source: AppointmentSource;
  /** Customer explicitly asked for this technician. */
  requestedTechnician: boolean;
  /** Protected commitment (spec §23): nothing may run into it. */
  protected: boolean;
  /** Optional lead buffer before a protected appointment. */
  protectionBufferMinutes?: number;
  notes?: string | null;
  /** Optimistic-concurrency version from the authoritative backend. */
  version: number;
  /** Link into the existing queue / Fair Turn workflow for walk-ins. */
  queueTicketId?: ID | null;
}

export type SegmentType = 'working' | 'lunch' | 'break' | 'blocked' | 'time_off';

export interface ScheduleSegment {
  id: ID;
  tenantId: ID;
  branchId: ID;
  technicianId: ID;
  startAt: ISODateTime;
  endAt: ISODateTime;
  type: SegmentType;
  reason?: string | null;
  notes?: string | null;
  createdByUserId?: ID | null;
  createdAt?: ISODateTime;
}

export interface AvailabilityGap {
  technicianId: ID;
  startAt: ISODateTime;
  endAt: ISODateTime;
  durationMinutes: number;
  bookable: boolean;
}

export interface BranchHours {
  openAt: HHmm;
  closeAt: HHmm;
}

export interface ScheduleRange {
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  timezone: string;
  branchHours: BranchHours;
  technicians: Technician[];
  appointments: Appointment[];
  segments: ScheduleSegment[];
  /** Authoritative availability per technician (computed server-side after merge). */
  availability: Record<ID, AvailabilityGap[]>;
  serverVersion: number;
  updatedAt: ISODateTime;
  /** Present when the host pages technicians ON THE SERVER (200+ technicians, addendum §13): `technicians` is then
   *  exactly one page and these are the server's authoritative counts. Absent → the board pages the full list itself. */
  paging?: ServerTechnicianPaging;
}

export interface ServerTechnicianPaging {
  /** technicians matching the server-side filters (pages are computed from this) */
  total: number;
  /** every technician of the branch, before filters */
  totalAll: number;
  /** of those, working on the date */
  workingCount: number;
  /** 1-based page actually served (the server clamps an out-of-range request) */
  page: number;
  pageSize: number;
  totalPages: number;
  /** 1-based roster position of each technician on this page ("#200"), keyed by technician id */
  rosterNumbers?: Record<ID, number>;
}

export interface BookingPolicy {
  /** Minimum minutes from "now" that a new booking may start (0 = none). */
  minLeadMinutes?: number;
  /** Bookings must start on the grid (always true on this board). */
  gridMinutes?: number;
  /** Optional cap on a single booking's total duration. */
  maxDurationMinutes?: number;
}

export interface TechnicianDay {
  technician: Technician;
  date: ISODate;
  timezone: string;
  appointments: Appointment[];
  segments: ScheduleSegment[];
  availability: AvailabilityGap[];
  summary: {
    workingMinutes: number;
    bookedMinutes: number;
    openMinutes: number;
    appointmentCount: number;
  };
}

/** Outbound host integration payload (spec §5 / §14). */
export interface BookingContext {
  tenantId: ID;
  branchId: ID;
  date: ISODate;
  technicianId: ID;
  startAt: ISODateTime;
  availableDurationMinutes: number;
  serviceId?: ID;
  appointmentId?: ID;
}

export interface OpeningResult {
  technicianId: ID;
  technicianName: string;
  startAt: ISODateTime;
  endAt: ISODateTime;
  durationMinutes: number;
  /** Size of the whole gap the opening sits in. */
  gapDurationMinutes: number;
}

export interface TechnicianMatch {
  technicianId: ID;
  technicianName: string;
  score: number;
  earliestStartAt: ISODateTime | null;
  reasons: string[];
}

export type Unsubscribe = () => void;

/**
 * Read-only marks a host may draw over the board — e.g. the AI Scheduling Optimizer's lock, open conflict and open
 * suggestion on an appointment, and its unused gaps on a technician's column (the same marks the Classic board draws).
 * Marks never change a booking: a badge only asks the host to open something (the optimizer), nothing else.
 */
export interface AppointmentMarks {
  locked?: { title: string };
  conflict?: 'info' | 'warning' | 'critical';
  badge?: { label: string; title: string; ariaLabel: string; onOpen: () => void };
}
export interface OverlayGap { id: string; technicianId: ID; startMinute: number; endMinute: number; title: string }
export interface BoardOverlay { appointments: Readonly<Record<ID, AppointmentMarks>>; gaps: readonly OverlayGap[] }
