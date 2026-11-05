// payment-status.ts — the single source of truth for which payment rows count as revenue and which are refunds.
// Both Sales Reports and the POS Overview import these so the two can never drift apart (they previously diverged:
// the checkout flow writes captured payments as 'approved', but Overview was filtering on 'completed' — which the
// payment flow never writes — so Overview revenue silently read ~$0 while Reports showed the real total).
//
// Captured/collected money lands as one of these (see checkout.service.ts): cash + card capture → 'approved',
// some flows → 'paid', split captures → 'partial'. 'captured' is accepted defensively for processor-driven rows.
export const REVENUE_BEARING_STATUSES = ['approved', 'partial', 'paid', 'captured'] as const;

// Refunds/voids/reversals — money that left or never settled. Excluded from revenue; reported separately.
export const REFUND_STATUSES = ['refunded', 'refund', 'voided', 'void', 'reversed'] as const;

export const isRefundStatus = (s: string): boolean => (REFUND_STATUSES as readonly string[]).includes((s || '').toLowerCase());

// What Reports loads (revenue-bearing + refunds, then split by isRefundStatus to net refunds out as a separate line).
export const REPORTABLE_PAYMENT_STATUSES = [...REVENUE_BEARING_STATUSES, ...REFUND_STATUSES] as const;
