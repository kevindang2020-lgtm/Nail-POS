// kiosk.ts — the Go Check-In kiosk and the checkout customer display, as they appear ON THE WIRE (Constitution 13 §13,
// §15). Realm: customer — the customer-display app (a kiosk facing the guest) may import only this realm (§14, §361).
// Money fields are integer cents (the tenant realm's Money is the same number; the customer realm does not import it).
import type { CustomerDisplayReceipt } from './display-device';

// ── Go Check-In kiosk ─────────────────────────────────────────────────────────────────────────────────────────────
/** The kiosk's settings as sent to the device — only ever sent when the kiosk is enabled. */
export interface KioskSettings {
  enabled: true;
  appointmentCheckinEnabled: boolean; walkinCheckinEnabled: boolean; newCustomerEnabled: boolean;
  serviceSelectionEnabled: boolean; technicianPreferenceEnabled: boolean;
  tenantPhoneLookupEnabled: boolean; centralLookupEnabled: boolean; customerLinkingEnabled: boolean;
  showWaitEstimate: boolean; autoSendToQueue: boolean; requireFrontDeskApproval: boolean;
  confirmationTimeoutSeconds: number;   // idle auto-return after "You're Checked In!" (seconds)
}
export interface KioskConfig {
  salonName: string; branchName?: string; welcomeMessage?: string;
  branches?: { id: string; name: string; isDefault: boolean }[];   // selectable branches when the device serves >1
  settings: KioskSettings;
}
export interface TenantCustomerMatch { source: 'tenant'; customerId: string; firstName: string; lastInitial: string; }
export interface CentralCustomerMatch { source: 'central'; firstName: string; lastInitial: string; maskedEmail: string | null; }
/** One service of today's visit as the guest sees it (23-inch spec §16–§17): technicians by first name only. */
export interface AppointmentItem { serviceName: string; technicianName?: string; startTimeLabel: string; }
/**
 * Today's visit for the guest who typed their phone (§16–§17). A visit is the appointments of that customer at this
 * branch today that belong together — booked at the same time or back to back (each appointment has one technician, so
 * "Gel Manicure with Olivia + Spa Pedicure with Lisa" is two appointments). "I'm Here" sends `appointmentId`; the server
 * works the visit out again and checks every appointment of it in.
 */
export interface AppointmentToday {
  appointmentId: string;
  /** The visit's start on the branch's clock, e.g. '11:00 AM'. */
  startTimeLabel: string;
  /** The first service (and its technician's first name) — what a one-line screen shows. */
  serviceName: string; technicianName?: string;
  /** Every service of the visit, in order. */
  items?: AppointmentItem[];
}
/** A service the guest may choose (§22–§23): the BRANCH's own catalog and price. Add-ons (§20) are flagged. */
export interface KioskServiceOption { id: string; name: string; priceCents: number; durationMinutes: number; category: string; isAddOn: boolean; }
/**
 * A technician the guest may ask for (§25): working today at this branch and qualified for the chosen services.
 * `name` is the first name (with a last initial only when two share it); `fromLabel` when their day starts later.
 */
export interface KioskTechnicianOption { technicianId: string; name: string; avatarUrl?: string | null; fromLabel?: string; }
export interface CustomerChoice { firstName: string; lastInitial: string; }
export interface LookupResult {
  match: TenantCustomerMatch | CentralCustomerMatch | null;
  foundInTenant: boolean;
  appointment: AppointmentToday | null;
  canWalkIn: boolean;
  canCreate: boolean;
  ambiguous?: boolean;            // 2+ tenant customers share this phone — do NOT auto-select
  askFrontDesk?: boolean;         // the kiosk routes the guest to the front desk
  choices?: CustomerChoice[];     // safe disambiguation labels (first name + last initial)
}
export interface CheckInConfirmation {
  status: 'checked_in' | 'already_checked_in';
  firstName: string;
  estimatedWaitMinutes?: number;
  /** §26–§27: the queue engine's estimate as the band the guest is shown ("25–35 min") — the display computes nothing.
   *  Absent when the salon hides the estimate. */
  estimatedWait?: { fromMinutes: number; toMinutes: number };
  /** §24: how long the chosen services take, from the branch's catalog (walk-in). */
  estimatedServiceMinutes?: number;
  /** §17: how many appointments this tap checked in (a visit may hold several). */
  appointmentsCheckedIn?: number;
  checkInId?: string;
  /** BUILD_PLAN Phase 6 round 2: the guest's queue item; the technician they asked for (busy or not); other technicians
   *  who could take them (only when the requested one is busy) — POST go-check-in/session/:id/accept-alternate
   *  { queueItemId, technicianId } → { ok, technicianName } (409 when taken). */
  queueItemId?: string;
  requestedTechnician?: { technicianId: string; name: string; busy: boolean; availableInMinutes: number | null } | null;
  alternates?: { technicianId: string; name: string; availableInMinutes: number | null }[];
}
/** POST /customer-display/device/check-in/session — a paired display starts a guest's check-in with ITS credential. */
export interface DisplayCheckInSession { sessionId: string; sessionToken: string; config: KioskConfig; }

// ── Checkout customer display ────────────────────────────────────────────────────────────────────────────────────
// payment_verifying (23-inch spec §41): a card charge is in flight but its outcome has not come back in time (terminal or
// network lost) — the display says "Verifying payment — please do not pay again" and never asks for a second payment.
export type DisplayState = 'idle' | 'ticket_review' | 'tip_selected' | 'payment_processing' | 'payment_verifying' | 'payment_success' | 'payment_failed' | 'disconnected' | 'expired';
export interface CheckoutTotals {
  subtotalCents: number; tipCents: number; taxCents: number; surchargeCents: number; giftCardChargeCents: number; totalDueCents: number;
  paymentMethod?: 'card' | 'cash' | 'gift_card' | 'split' | 'deposit' | 'global_reward';
}
export interface TipOption { label: string; tipType: 'none' | 'percent' | 'custom'; percent?: number; amountCents: number; selected: boolean; }

/**
 * 23-inch dual-screen spec §30–§39: the customer-safe checkout projection. Built ONLY by the checkout module from the
 * same ticket, lines, discount snapshot, totals and payments the POS uses — the display never computes money. An
 * explicit allowlist: no ids, commission, pay %, margin, processor data, notes, phone or email ever enter it (§39).
 */
export interface CustomerDisplayLine {
  kind: 'service' | 'add_on' | 'product';
  name: string;
  /** First name only (§16's "with Olivia"). Absent when the line has no technician (products). */
  technicianName?: string;
  quantity: number;
  /** What the customer is charged for the line. */
  amountCents: number;
  /** The catalog price for the quantity — present ONLY when the line is charged less than it (§32 original vs discounted). */
  originalCents?: number;
}
export interface CustomerDisplayAdjustment {
  kind: 'membership' | 'loyalty' | 'promotion' | 'deal' | 'bundle' | 'discount';
  label: string;
  /** A positive amount taken off the bill. */
  amountCents: number;
}
export interface CustomerDisplayPayment {
  method: 'card' | 'cash' | 'gift_card' | 'other';
  label: string;
  amountCents: number;
}
export type CustomerDisplayPaymentStatus = 'unpaid' | 'processing' | 'partially_paid' | 'paid' | 'declined';
export interface CustomerDisplayCheckout {
  ticketNumber: string;
  /** When the visit's ticket was opened (ISO); the display formats it in its own time zone. */
  date: string;
  lines: CustomerDisplayLine[];
  adjustments: CustomerDisplayAdjustment[];
  /** Sum of the lines, before any adjustment. */
  itemsSubtotalCents: number;
  /** Sum of the adjustments — exactly what the ticket takes off. */
  discountCents: number;
  taxCents: number;
  /** A configured customer-facing fee (the card surcharge); 0 when none applies. */
  customerFeeCents: number;
  customerFeeLabel?: string;
  tipCents: number;
  /** A gift card bought on this visit (untaxed, at face value). */
  giftCardSaleCents: number;
  /** Before payment: what is due for the chosen method. After payment: what was paid. */
  totalCents: number;
  paidCents: number;
  balanceDueCents: number;
  /** Payments received (approved), customer-safe: method and amount only. */
  payments: CustomerDisplayPayment[];
  paymentStatus: CustomerDisplayPaymentStatus;
  paymentMethod: 'card' | 'cash' | 'gift_card' | 'split';
  /** Loyalty points earned on this visit — only once it is paid. */
  loyaltyPointsEarned?: number;
}

/**
 * 23-inch spec §13: the SALON's identity at the top of its customer display — never the platform's (AI PowerSalon stays
 * a quiet "Powered by" line). Built by the server from the salon's own settings: Settings → Customer Display (tagline,
 * branch name, idle line, branding on/off) and the salon logo from Settings → Receipts & Branding.
 */
export interface CustomerDisplayBranding {
  salonName: string;
  /** The salon's uploaded logo (a public media URL), or null — the display then shows the name alone. */
  logoUrl: string | null;
  tagline: string | null;
  /** Only when the salon chose to show the branch on its displays. */
  branchName: string | null;
  /** The salon's own line for a quiet moment ("Ready for our next guest"). */
  idleMessage: string | null;
}

export interface CustomerDisplayState {
  state: DisplayState; salonName: string;
  /** Dual-Screen mandate §118–§119: the languages the salon offers on its display ('en' | 'vi'), its default first.
   *  Absent: English only. */
  languages?: string[];
  /** §13 — the header of a paired 23-inch display. Absent on a one-off session display. */
  branding?: CustomerDisplayBranding;
  /** The checkout session this state belongs to (absent while idle). The display keys its realtime channel and its
   *  3-second completion on it, and never shows a state for a session it has already released. */
  sessionId?: string;
  /** Monotonic per session (the server's latest change time, ms). A response older than the one on screen is dropped
   *  (spec §101), so an out-of-order fetch can never roll the ticket back. */
  version?: number;
  customer?: { firstName: string; loyaltyLabel?: string };
  ticket?: { ticketNumber: string; services: { serviceName: string; priceCents: number }[] };
  /** The full customer-safe checkout (§30–§39) — every number on the display comes from here. Absent while idle. */
  checkout?: CustomerDisplayCheckout;
  tipOptions: TipOption[]; selectedTipCents: number; totals: CheckoutTotals; payButtonEnabled: boolean;
  /** 23-inch spec §8, §14–§28: the salon's check-in is on for this paired display's branch — the display starts each
   *  guest's check-in with its OWN credential (POST /customer-display/device/check-in/session). */
  checkIn?: boolean;
  /** Displays built before Unit 7 borrowed a Go Check-In kiosk's slug for check-in; still sent for them, ignored now. */
  goCheckInSlug?: string;
  checkoutCompleteTimeoutSeconds?: number;   // how long 'Payment Complete' shows before returning to Go Check-In
  /** §97–§98: after payment the customer chooses a receipt; the 3-second screen waits for it. (No signature is ever asked
   *  on the display — Kevin, Oct 6 2026: the cardholder signs once, on the Clover card terminal.) */
  receipt?: CustomerDisplayReceipt;
  /** §85: the owner switched this display to MAINTENANCE — it shows a neutral "being serviced" screen, no customer. */
  maintenance?: boolean;
  /** Phase 3 (customer phone management): staff asked this customer to type their phone-change code HERE rather than
   *  read it aloud at the counter. Masked number only. */
  phoneVerification?: { maskedPhone: string };
}
/** POST /customer-display/.../tip — what the guest picked. */
export interface TipSubmission { tipType?: 'none' | 'percent' | 'custom'; percent?: number; amountCents?: number }
