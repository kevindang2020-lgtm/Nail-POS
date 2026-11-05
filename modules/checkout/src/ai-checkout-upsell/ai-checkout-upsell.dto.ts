// ai-checkout-upsell.dto.ts — the trusted, SERVER-DERIVED context for every ai_checkout_upsell operation. Built from the
// authenticated CheckoutContext (tenant membership + branch assignment + permission service + checkout session), NEVER
// from request body, query, headers, or model output (§5). tenantId/branchId are authoritative here.
export interface AiCheckoutUpsellContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
  deviceId?: string | null;      // checkout-device scope for settings inheritance (§70)
}

// Ticket (cart) shape the recommenders need — a bounded projection of the authoritative checkout ticket. No payment data.
export interface CheckoutTicketView {
  checkoutId: string;
  branchId: string;
  customerId: string | null;
  status: string;                // e.g. 'open' | 'reopened' | 'payment_in_progress' | 'paid'
  serviceLines: { serviceId: string; serviceName: string }[];
  cartAddOnIds: string[];
  subtotalCents: number;
  /** Functional Decision 27: the technician(s) working this ticket — their next appointment limits add-on time. */
  technicianIds?: string[];
}

// A charge-producing recommendation is frozen once payment has begun (§10).
export function isPaymentStage(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'payment_in_progress' || s === 'processing' || s === 'paid' || s === 'completed';
}
