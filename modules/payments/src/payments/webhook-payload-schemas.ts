// webhook-payload-schemas.ts — Security Deep Scan §110 (Nov 5 2026): "Strictly validate webhook payload shape and reject
// unexpected types / fields where appropriate." PURE — no I/O.
//
// One schema per sender, written from the fields our own parser reads (payment-webhook.service.ts `pick` lists,
// centsFrom, providerTime, settlementTxnIds, chargeEventOutcome; parseBankPayload). Each field has an exact type and
// bound. The schemas run AFTER the signature check (an unsigned body never reaches them) and BEFORE any effect.
//
//   · fiserv family (fiserv · cardpointe · cardconnect · bolt · commercehub): the common fields + CardPointe's own names
//     (merchid, retref, respstat, resptext, orderid).
//   · clover: the common fields only — a CardPointe name in a Clover delivery is refused (`other_processor_field`): the
//     Clover integration never sends one, and our parser would read it.
//   · bank: the deposit feed's fields.
//
// Always refused: a body that is not a JSON object; a known field of the wrong type / out of bounds; two names for the
// same thing carrying DIFFERENT values (`conflicting_fields` — our parser takes the first, so the other would be ignored
// silently). Fields we do not know: kept (they are never read), reported back, and refused only when
// WEBHOOK_UNKNOWN_FIELDS=reject — processors add informational fields without notice, and refusing a signed money event
// over one would lose it. The processors' own published schemas are external (BLOCKED); these encode our parser's contract.

export type WebhookFamily = 'fiserv' | 'clover' | 'bank';
export type FieldRule = 'id' | 'event' | 'cents' | 'dollars' | 'text' | 'status' | 'time' | 'respstat' | 'idList' | 'txnList';
export interface WebhookSchemaError { field: string; rule: string }
export interface WebhookSchemaResult { ok: boolean; errors: WebhookSchemaError[]; unknownFields: string[] }

const MAX_CENTS = 10_000_000_000;   // $100M — no single salon event is larger
const PRINTABLE = /^[^\u0000-\u001f\u007f]+$/;

const COMMON: Record<string, FieldRule> = {
  // who / what / which
  merchantId: 'id', merchant_id: 'id', mid: 'id',
  eventType: 'event', type: 'event', event: 'event', eventName: 'event',
  eventId: 'id', id: 'id', notificationId: 'id', event_id: 'id',
  transactionId: 'id', processorTransactionId: 'id', txnId: 'id', transaction_id: 'id',
  orderId: 'id', order_id: 'id',
  refundId: 'id', refundReference: 'id', processorRefundId: 'id',
  settlementId: 'id', batchId: 'id', batch: 'id', settlement_id: 'id',
  chargebackId: 'id', disputeId: 'id', caseId: 'id', chargeback_id: 'id', dispute_id: 'id', case_id: 'id',
  // money
  amountCents: 'cents', amount_cents: 'cents', refundCents: 'cents', chargebackCents: 'cents', disputeCents: 'cents',
  grossCents: 'cents', feeCents: 'cents', netCents: 'cents',
  amount: 'dollars', gross: 'dollars', fee: 'dollars', net: 'dollars',
  // state + words
  status: 'status', refundStatus: 'status', batchStatus: 'status', transactionState: 'status',
  reason: 'text', refundReason: 'text', reasonDescription: 'text', reason_description: 'text',
  reasonCode: 'id', reason_code: 'id',
  // time
  settledAt: 'time', settled_at: 'time', settlementDate: 'time', settlement_date: 'time', batchDate: 'time', batch_date: 'time', fundedAt: 'time', date: 'time',
  // a settlement batch's transactions
  transactionIds: 'idList', txnIds: 'idList', transaction_ids: 'idList', transactions: 'txnList',
};
const CARDPOINTE_ONLY: Record<string, FieldRule> = {
  merchid: 'id', retref: 'id', orderid: 'id', respstat: 'respstat', respStat: 'respstat', resptext: 'text', respText: 'text',
};
const BANK: Record<string, FieldRule> = {
  amountCents: 'cents', amount_cents: 'cents',
  externalBankTxnId: 'id', external_bank_txn_id: 'id', transactionId: 'id',
  depositDate: 'time', deposit_date: 'time', reference: 'text', description: 'text',
};

export const WEBHOOK_SCHEMAS: Readonly<Record<WebhookFamily, Readonly<Record<string, FieldRule>>>> = {
  fiserv: { ...COMMON, ...CARDPOINTE_ONLY },
  clover: { ...COMMON },
  bank: { ...BANK },
};

/** Names for the same thing — present together they must agree (our parser reads the first one only). */
const SAME_THING: Readonly<Record<WebhookFamily, readonly (readonly string[])[]>> = {
  fiserv: [
    ['merchantId', 'merchid', 'merchant_id', 'mid'], ['eventType', 'type', 'event', 'eventName'], ['eventId', 'id', 'notificationId', 'event_id'],
    ['transactionId', 'retref', 'processorTransactionId', 'txnId', 'transaction_id'], ['orderId', 'orderid', 'order_id'],
    ['refundId', 'refundReference', 'processorRefundId'], ['settlementId', 'batchId', 'batch', 'settlement_id'],
    ['chargebackId', 'disputeId', 'caseId', 'chargeback_id', 'dispute_id', 'case_id'], ['respstat', 'respStat'], ['resptext', 'respText'], ['amountCents', 'amount_cents'],
  ],
  clover: [
    ['merchantId', 'merchant_id', 'mid'], ['eventType', 'type', 'event', 'eventName'], ['eventId', 'id', 'notificationId', 'event_id'],
    ['transactionId', 'processorTransactionId', 'txnId', 'transaction_id'], ['orderId', 'order_id'],
    ['refundId', 'refundReference', 'processorRefundId'], ['settlementId', 'batchId', 'batch', 'settlement_id'],
    ['chargebackId', 'disputeId', 'caseId', 'chargeback_id', 'dispute_id', 'case_id'], ['amountCents', 'amount_cents'],
  ],
  bank: [['amountCents', 'amount_cents'], ['externalBankTxnId', 'external_bank_txn_id', 'transactionId'], ['depositDate', 'deposit_date']],
};

/** The schema family for a processor path / configured processor; null = no schema (an unknown processor). */
export function webhookFamily(processor: string | null | undefined): WebhookFamily | null {
  const v = String(processor ?? '').trim().toLowerCase();
  if (['fiserv', 'cardpointe', 'cardconnect', 'bolt', 'commercehub'].includes(v)) return 'fiserv';
  if (v === 'clover') return 'clover';
  if (v === 'bank') return 'bank';
  return null;
}

const isInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
function idOk(v: unknown): boolean {
  if (isInt(v)) return (v as number) >= 0;
  return typeof v === 'string' && v.length >= 1 && v.length <= 128 && PRINTABLE.test(v);
}
function fieldOk(rule: FieldRule, v: unknown): boolean {
  switch (rule) {
    case 'id': return idOk(v);
    case 'event': return typeof v === 'string' && v.length >= 1 && v.length <= 80 && /^[A-Za-z0-9_.:\- ]+$/.test(v);
    case 'cents': {
      const n = typeof v === 'string' && /^\d{1,11}$/.test(v) ? Number(v) : v;
      return isInt(n) && (n as number) >= 0 && (n as number) <= MAX_CENTS;
    }
    case 'dollars': {
      if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= MAX_CENTS / 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
      return typeof v === 'string' && /^\d{1,9}(\.\d{1,2})?$/.test(v.trim());
    }
    case 'status': return typeof v === 'string' && v.length <= 40 && /^[A-Za-z0-9_.:\- ]*$/.test(v);
    case 'text': return typeof v === 'string' && v.length <= 500;
    case 'time': return (isInt(v) && (v as number) > 0) || (typeof v === 'string' && v.length >= 1 && v.length <= 40 && PRINTABLE.test(v));
    case 'respstat': return typeof v === 'string' && /^[ABCabc]$/.test(v.trim());
    case 'idList': return Array.isArray(v) && v.length <= 5000 && v.every(idOk);
    case 'txnList': return Array.isArray(v) && v.length <= 5000 && v.every((t) => t !== null && typeof t === 'object' && !Array.isArray(t)
      && ['transactionId', 'processorTransactionId', 'retref', 'id'].every((k) => (t as Record<string, unknown>)[k] == null || idOk((t as Record<string, unknown>)[k])));
  }
}
const norm = (v: unknown) => (v == null || v === '' ? null : String(v).trim());

export function checkWebhookPayload(family: WebhookFamily, body: unknown, opts: { unknownFields?: 'report' | 'reject' } = {}): WebhookSchemaResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: [{ field: '$', rule: 'object' }], unknownFields: [] };
  const schema = WEBHOOK_SCHEMAS[family];
  const errors: WebhookSchemaError[] = [];
  const unknownFields: string[] = [];
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const rule = schema[k];
    if (!rule) {
      // a CardPointe name sent for Clover: our parser would read it — never a Clover field
      if (family === 'clover' && CARDPOINTE_ONLY[k]) errors.push({ field: k, rule: 'other_processor_field' });
      else unknownFields.push(k);
      continue;
    }
    if (v == null || v === '') continue;   // absent / empty is "not sent" — the parser skips it the same way
    if (!fieldOk(rule, v)) errors.push({ field: k, rule });
  }
  for (const names of SAME_THING[family]) {
    const vals = names.map((n) => norm((body as Record<string, unknown>)[n])).filter((x): x is string => x != null);
    if (new Set(vals).size > 1) errors.push({ field: names.filter((n) => norm((body as Record<string, unknown>)[n]) != null).join('|'), rule: 'conflicting_fields' });
  }
  if (opts.unknownFields === 'reject') for (const f of unknownFields) errors.push({ field: f, rule: 'unknown_field' });
  return { ok: errors.length === 0, errors: errors.slice(0, 20), unknownFields: unknownFields.slice(0, 50) };
}

/** WEBHOOK_UNKNOWN_FIELDS: `report` (default — kept, never read, listed) or `reject`. */
export function unknownFieldMode(env: NodeJS.ProcessEnv = process.env): 'report' | 'reject' {
  return String(env.WEBHOOK_UNKNOWN_FIELDS ?? '').trim().toLowerCase() === 'reject' ? 'reject' : 'report';
}
