// customer-quick-activity.ts — extras Customer 03 (Nov 13 2026): the receipts + activity a staff member sees in the Customer 360
// Quick View, from one read-only staff endpoint (GET /pos/customers/:customerId/quick-activity). It reuses the canonical reads
// (the salon's receipts joined through the customer's tickets; the durable audit_events trail for this customer) and carries no
// printing or resend control — those stay on the Full View / receipt screens.
export interface CustomerQuickReceipt {
  receiptId: string;
  receiptNumber: string | null;
  ticketId: string | null;
  date: string;
  totalCents: number;
  /** 'email' when the receipt was emailed, else 'issued' (printed / handed over — the system does not record which) */
  channel: 'email' | 'issued';
}

export type CustomerQuickActivityKind = 'receipt' | 'profile';

export interface CustomerQuickActivityItem {
  at: string;
  kind: CustomerQuickActivityKind;
  /** receipt: 'receipt_issued'; profile: the audit action code (e.g. pos_customer_notes_updated) — labelled on the client */
  code: string;
  actorName: string | null;
  amountCents: number | null;
  refId: string | null;
}

export interface CustomerQuickActivity {
  customerId: string;
  receipts: CustomerQuickReceipt[];
  receiptsTotal: number;
  activity: CustomerQuickActivityItem[];
  /** the newest N of each source are shown; the Full View has the complete history */
  limit: { receipts: number; activity: number };
}
