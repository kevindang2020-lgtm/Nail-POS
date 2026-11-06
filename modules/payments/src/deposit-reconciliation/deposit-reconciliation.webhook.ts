import { checkWebhookPayload, unknownFieldMode, type WebhookSchemaError } from '../payments/webhook-payload-schemas';   // Security Deep Scan §110
// deposit-reconciliation.webhook.ts — pure parse/validate for an inbound bank-deposit webhook payload. Tenant is
// NEVER taken from here (it comes from the verified endpoint token). Amount is integer cents.
export interface ParsedBankDeposit { amountCents: number; externalBankTxnId: string; depositDate: string | null; reference: string | null; description: string | null }

export function parseBankPayload(body: any): { ok: boolean; error?: string; value?: ParsedBankDeposit; errors?: WebhookSchemaError[]; unknownFields?: string[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_payload' };
  // Security Deep Scan §110: the bank feed's exact shape (types, bounds, agreeing aliases) before anything is read —
  // a description that was an object, or 12.7 cents, used to be stored as given.
  const shape = checkWebhookPayload('bank', body, { unknownFields: unknownFieldMode() });
  if (!shape.ok) return { ok: false, error: 'invalid_payload', errors: shape.errors };
  const amountCents = Number(body.amountCents ?? body.amount_cents);
  const externalBankTxnId = String(body.externalBankTxnId ?? body.external_bank_txn_id ?? body.transactionId ?? '').trim();
  if (!Number.isFinite(amountCents)) return { ok: false, error: 'missing_amount' };
  if (!externalBankTxnId) return { ok: false, error: 'missing_external_txn_id' };  // required for idempotency
  return { ok: true, value: {
    amountCents: Math.round(amountCents),
    externalBankTxnId,
    depositDate: body.depositDate ?? body.deposit_date ?? null,
    reference: body.reference ?? null,
    description: body.description ?? null,
  }, unknownFields: shape.unknownFields };
}
