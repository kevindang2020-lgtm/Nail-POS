// booking-drafts.ts — B-22 (Oct 22 2026): the POS booking drafts wire shapes (`/pos/booking/drafts`). A draft is the
// New Booking form kept for later on booking_holds (kind 'draft') — never an appointment.
export interface BookingDraftView {
  draftId: string; title: string | null; notes: string | null; date: string | null; startTime: string | null;
  serviceIds: string[]; customerId: string | null;
  /** the New Booking form exactly as the POS sent it (the create-appointment body) */
  payload: Record<string, unknown>;
  createdAt: string; expiresAt: string; createdByUserId: string | null;
}
export interface BookingDraftsListResponse { drafts: BookingDraftView[] }
export interface SaveBookingDraftRequest { payload: Record<string, unknown> }
export interface BookingDraftActionResponse { ok: boolean }
