// booking.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface BookingFilters { from?: string; to?: string; date?: string; search?: string; technicianId?: string; status?: string; source?: string; serviceCategory?: string; conflictOnly?: boolean; depositStatus?: string; branchId?: string; page?: number; pageSize?: number;
  /** 'none' (200-technician mandate §2): leave `filters.technicians` (every name in the roster) out of GET /state — the
   *  Booking board pages technicians from GET /technicians and never needs the whole list. */
  roster?: 'none';
}

// ── 200-technician mandate (Oct 23 2026): the Booking board's technician columns are paged ON THE SERVER ──
// 12 technicians a page is the board's density; 200 technicians → 17 pages (16 × 12 + 8). 200 is a certification target,
// not a maximum: nothing here assumes a roster size. Identity is always technicianId — a page number is navigation only.
/** The board's default technician density (columns per page). */
export const BOOKING_TECH_PAGE_SIZE = 12;
/** Upper bound on one page of technician columns (Full Screen may ask for more than 12, never an unbounded set). */
export const BOOKING_TECH_PAGE_SIZE_MAX = 48;

/** Pure page math shared by the server and the board, so both always agree. `total` 0 → one empty page. */
export function bookingTechPageMath(total: number, pageSize: number, page: number): { page: number; totalPages: number; startIndex: number; endIndex: number; first: number; last: number } {
  const size = Math.max(1, Math.trunc(Number(pageSize)) || BOOKING_TECH_PAGE_SIZE);
  const n = Math.max(0, Math.trunc(Number(total)) || 0);
  const totalPages = Math.max(1, Math.ceil(n / size));
  const p = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), totalPages);
  const startIndex = (p - 1) * size;                       // 0-based, inclusive
  const endIndex = Math.min(n, startIndex + size);          // 0-based, exclusive
  return { page: p, totalPages, startIndex, endIndex, first: n === 0 ? 0 : startIndex + 1, last: endIndex };
}
/** The page (1-based) that holds the technician at 0-based roster `index`. */
export function bookingTechPageOf(index: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(Number(pageSize)) || BOOKING_TECH_PAGE_SIZE);
  return Math.floor(Math.max(0, index) / size) + 1;
}

/** GET /pos/booking/technicians query. Tenant and branch always come from the session, never from here. */
export interface BookingTechnicianQuery {
  date?: string;
  page?: number;
  pageSize?: number;
  /** name / phone / e-mail / roster number ("#200" or "200") */
  search?: string;
  /** exact-service eligibility (the ONE eligibility authority) — only technicians approved for EVERY id */
  serviceIds?: string[];
  /** only technicians working on `date` (schedule, not on approved full-day time off, active) */
  working?: boolean;
  /** 'active' (default) | 'inactive' | 'all' */
  status?: 'active' | 'inactive' | 'all';
  /** service category name (the board's skill chip) */
  skill?: string;
  /** a technicianId: answer the page that holds it (jump-to-technician) */
  locate?: string;
}
/** Booking's lightweight technician projection — never payroll, pay plans, tax, notes, PIN or contact data. */
export interface BookingTechnicianSummary {
  technicianId: string;
  name: string;
  /** 1-based position in the salon's roster order (name, then id) — "#200"; stable across filters */
  rosterNumber: number;
  avatarUrl: string | null;
  /** is_active */
  available: boolean;
  /** working on the requested date (schedule + approved time off) */
  workingToday: boolean;
  skills: string[];
  rating: number | null;
  reviewCount: number;
  /** present when serviceIds were given: always true in the page (ineligible technicians are filtered out) */
  eligible?: boolean;
}
export interface BookingTechnicianPage {
  date: string;
  technicians: BookingTechnicianSummary[];
  /** technicians matching the filters (pages are computed from this) */
  total: number;
  /** every technician of the branch (not archived), before filters */
  totalAll: number;
  /** of those, working on `date` */
  workingCount: number;
  /** today only: working now (inside a window) and not in a chair-holding appointment right now */
  availableNowCount?: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** `locate` answer: where that technician is in the FILTERED list, or null when the filters exclude them */
  located?: { technicianId: string; page: number; index: number } | null;
}
/** GET /pos/booking/openings — Find an Opening / Best Matches computed on the server: hard eligibility first, then rank. */
export interface BookingOpening {
  technicianId: string;
  name: string;
  rosterNumber: number;
  /** HH:MM, the earliest bookable start for the service(s) */
  time: string;
  /** how many bookable starts the technician has left that day */
  openSlots: number;
  rank: number;
  /** extras TEAM MANAGEMENT 05: the technician's own branch (null = salon-wide) and its name — the booking engine only offers
   *  technicians of the session's branch scope, so this states where the opening is bookable. Absent on an older server. */
  branch?: { branchId: string | null; name: string | null } | null;
}
export interface BookingOpeningsResponse {
  date: string;
  serviceIds: string[];
  durationMinutes: number;
  /** eligible technicians considered (after the hard eligibility filter) */
  eligibleCount: number;
  /** with at least one opening */
  withOpenings: number;
  openings: BookingOpening[];
  /** more ranked openings exist past `limit` (View More → offset) */
  hasMore: boolean;
  offset: number;
  limit: number;
}

// ── booking200 addendum §08 (round 12): the Booking page's six KPI cards, each from its real source ──
/** 'ok' = a real value; 'not_today' = the card only means something for the branch's today (Arriving soon, Waitlist,
 *  Available now) and another date is on the board; 'unavailable' = its source could not be read — the card shows a
 *  stale/error state, NEVER a zero. */
export type BookingKpiState = 'ok' | 'not_today' | 'unavailable';
export interface BookingKpiValue { state: BookingKpiState; value: number | null }
/** GET /pos/booking/kpi-cards?date=YYYY-MM-DD&arrivingWindowMinutes=N — tenant and branch from the session. */
export interface BookingKpiCards {
  /** the board's date (branch-local YYYY-MM-DD) and the branch's today */
  date: string; today: string; isToday: boolean; timeZone: string;
  /** when the server computed these (ISO) */
  asOf: string;
  /** the Arriving-soon window actually used (default 60, bounded 5–240) */
  arrivingWindowMinutes: number;
  /** canonical appointments of the date (one per appointment, never per service line), cancelled / no-show excluded */
  appointments: BookingKpiValue & { awaitingConfirmation: number | null; confirmed: number | null; inSalon: number | null; completed: number | null };
  /** booked / confirmed appointments starting within the window from now — today only */
  arrivingSoon: BookingKpiValue;
  /** walk-in appointments of the date (not cancelled / no-show) + Customer Queue walk-in visits checked in that day that
   *  are not an appointment's queue entry */
  walkIns: BookingKpiValue & { fromAppointments: number | null; fromQueue: number | null };
  /** guests WAITING in the live Customer Queue right now — today only */
  waitlist: BookingKpiValue;
  /** active technicians inside a working window now and not in a chair-holding appointment — today only; workingCount =
   *  technicians scheduled to work on the date (any date) */
  availableNow: BookingKpiValue & { workingCount: number | null };
  /** projected booked service subtotal in integer cents: the price on each appointment's service lines (incl. add-ons and
   *  approved price overrides) of non-cancelled, non-no-show appointments; excludes tax, tips, surcharges, discounts and
   *  deposits. "Booked", never "collected". */
  bookedRevenue: BookingKpiValue & { basis: 'booked_service_subtotal' };
}

/** AI Calendar · AI booking provenance & exception review (Extras · AI Calendar 10): AI-origin failures, incomplete
 *  verification and source attribution that does not hold up, each with its stored source ids — read only, redacted */
export interface AiCalendarProvenanceReview {
  asOf: string; timeZone: string; windowDays: number; readOnly: true;
  counts: { toolFailed: number; verificationIncomplete: number; sourceUnlinked: number; sourceMismatch: number; total: number };
  items: {
    kind: 'tool_failed' | 'verification_incomplete' | 'source_unlinked' | 'source_mismatch';
    at: string | null;
    refs: { table: 'voice_tool_executions' | 'booking_holds' | 'booking_verification_sessions' | 'pos_tech_appointments'; id: string }[];
    appointmentId: string | null;
    detail: { tool: string | null; result: string | null; call: string | null; holdStatus: string | null; releaseReason: string | null; verification: string | null; source: string | null; appointmentStatus: string | null };
  }[];
}

/** AI Calendar · Pending Verification Queue (Extras · AI Calendar 04): live slot holds, soonest to expire first */
export interface AiCalendarPendingQueue {
  asOf: string; timeZone: string; pendingCode: number; expiringSoon: number;
  items: { id: string; technicianId: string | null; technicianName: string | null; date: string; start: string; end: string; expiresAt: string; minutesLeft: number; channel: string | null; pendingCode: boolean; expiringSoon: boolean }[];
}

/** round 10 (AI Booking Assistant): the technicians the booking engine qualifies for a request — names only, bounded */
export interface AiBookingQualifiedTechnicians { technicians: Pick<BookingTechnicianSummary, 'technicianId' | 'name'>[]; total: number; bounded: boolean; correlationId: string }
