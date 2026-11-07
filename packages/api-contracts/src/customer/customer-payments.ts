// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: customer. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface CustomerPaymentMethod {
  id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean;
  /** Nov 4 2026 (migration 836, was the developer tree's 700): the name and billing ZIP the customer gave with the card */
  cardholderName?: string | null; zipCode?: string | null; cardType?: string | null;
}

export type TopUpIntentStatus = 'CREATED' | 'PROCESSING' | 'APPROVED' | 'DECLINED' | 'UNKNOWN' | 'FAILED' | 'CANCELED';
/** POST /customer/wallet/top-up — Oct 23 2026 (B-79): every answer names the durable intent, so the app can ask again
 *  ("Check status") instead of charging again. status UNKNOWN / PROCESSING = being confirmed with the processor. */
export interface TopUpResult { ok: boolean; declined?: boolean; balanceCents?: number; message?: string; intentId?: string; status?: TopUpIntentStatus }
export interface TopUpIntentView { id: string; amountCents: number; currency: string; status: TopUpIntentStatus; createdAt: string; settledAt: string | null; processorTransactionId: string | null; respText: string | null }
/** GET /customer/wallet/top-ups and GET /pos/customers/:customerId/wallet/top-ups (B-79). */
export interface TopUpIntentList { customerId?: string; items: TopUpIntentView[] }

