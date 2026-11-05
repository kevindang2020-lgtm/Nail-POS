// deposit-reconciliation.webhook.ts — pure parse/validate for an inbound bank-deposit webhook payload. Tenant is
// NEVER taken from here (it comes from the verified endpoint token). Amount is integer cents.
export interface ParsedBankDeposit { amountCents: number; externalBankTxnId: string; depositDate: string | null; reference: string | null; description: string | null }

export function parseBankPayload(body: any): { ok: boolean; error?: string; value?: ParsedBankDeposit } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_payload' };
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
  } };
}
