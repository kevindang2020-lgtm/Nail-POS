// The wire types are the customer realm contract (Constitution 13 §15).
export type { BillLine, SkipLineSettings } from '@aipowersalon/api-contracts/customer';
import type { BillLine, SkipLineSettings } from '@aipowersalon/api-contracts/customer';
// skip-line-checkout.dto.ts — Skip-the-Line Checkout types. "invoice" = the ticket's derived bill (no invoices table);
// invoiceId == ticketId. All amounts integer cents, computed server-side.
export type IntentMethod = 'card' | 'apple_pay' | 'google_pay' | 'cash_to_technician' | 'gift_card' | 'split_payment' | 'bnpl';
export type IntentStatus = 'created' | 'sent_to_customer' | 'processing' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'cash_pending_tech_confirmation' | 'cash_confirmed_by_tech' | 'cash_issue_needs_front_desk';
export type CashConfStatus = 'pending' | 'confirmed' | 'customer_did_not_pay' | 'cancelled' | 'manager_review';

export interface Bill {
  ticketId: string; invoiceId: string; ticketNumber: string; customerId: string | null; customerName: string;
  technicianId: string | null; technicianName: string; services: BillLine[];
  subtotalCents: number; discountCents: number; taxCents: number; tipCents: number; totalDueCents: number;
  ticketStatus: string; paid: boolean;
}
export const DEFAULT_SKIP_LINE_SETTINGS: SkipLineSettings = {
  featureEnabled: true, autoSendPromptOnServiceDone: true, requireFrontDeskApproval: false,
  allowCashToTechnician: true, requireTechConfirmationForCash: true, managerApprovalOverCents: 0,
};

// Realtime event names (emitted via the shared bus).
export const SLC_EVENTS = {
  promptSent: 'skip_line_payment_prompt_sent', billOpened: 'customer_bill_opened',
  paymentStarted: 'customer_payment_started', paymentProcessing: 'customer_payment_processing',
  paymentSucceeded: 'customer_payment_succeeded', paymentFailed: 'customer_payment_failed',
  cashSelected: 'cash_to_technician_selected', cashPending: 'cash_pending_tech_confirmation',
  cashConfirmed: 'cash_confirmed_by_tech', cashIssue: 'cash_issue_needs_front_desk',
  ticketPaid: 'ticket_paid', ticketClosed: 'ticket_closed', receiptCreated: 'receipt_created', loyaltyPointsAdded: 'loyalty_points_added',
} as const;

export class SkipLineError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) { super(message); this.name = 'SkipLineError'; }
}
