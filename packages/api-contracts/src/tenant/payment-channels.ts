// payment-channels.ts — wire types for GET /pos/payment-channels and POST /pos/payment-channels/check (Three Ways to Pay
// SUNMI guide, Nov 9 2026). Read-only; integer cents; merchant ids masked; no card data or token ever.
export type PcChannelKey = 'clover_compact' | 'tap_to_pay_iphone' | 'customer_app';
export type PcChannelState = 'ready' | 'setup_required' | 'provider_pending' | 'blocked' | 'unavailable';
export interface PcChannel {
  key: PcChannelKey;
  state: PcChannelState;
  /** a registry-style code the screen words (and remediation) are keyed on; null when nothing needs saying */
  reason: string | null;
  /** 'uat' = a Fiserv TEST lane (no live money); never a certification claim */
  mode: 'uat' | 'production' | null;
  /** may this channel's primary action run now (server readiness AND the open ticket's state) */
  actionAllowed: boolean;
  actionHeldBy: null | 'ticket_paid' | 'payment_in_progress' | 'verify_first' | 'nothing_due' | 'no_customer';
  lastVerifiedAt: string | null;
  facts: Record<string, unknown>;
}
export interface PcTicketStatus {
  id: string; number: string | null;
  status: 'unpaid' | 'partially_paid' | 'in_progress' | 'unknown' | 'paid';
  inProgressVia: PcChannelKey | 'front_desk' | null;
  appPromptOpen: boolean;
  dueCents: number | null; paidCents: number; balanceCents: number | null;
  paidVia: PcChannelKey | 'other' | null; paidAt: string | null;
  hasCustomer: boolean;
}
export interface PcResponse {
  checkedAt: string;
  branch: { id: string; name: string };
  liveMode: boolean;
  merchant: { configured: boolean; masked: string | null; environment: 'sandbox' | 'production' | null; scope: 'tenant' | 'branch' | null; status: string; pausedByPlatform: boolean; blockedReason: string | null };
  ticket: PcTicketStatus | null;
  channels: [PcChannel, PcChannel, PcChannel];
}
export type PcCheckState = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE' | 'PROVIDER_APPROVAL_PENDING';
export interface PcCheckResponse {
  overall: PcCheckState;
  checkedAt: string;
  checks: { key: string; area: 'shared' | 'clover' | 'iphone' | 'saved_card' | 'compliance' | 'screen_fit'; state: PcCheckState; reason: string | null; count?: number }[];
}
