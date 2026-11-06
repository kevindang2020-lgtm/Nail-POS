// webhook-payload-schemas.vitest.spec — Security Deep Scan §110: each processor's webhook is checked field by field.
import { describe, it, expect } from 'vitest';
import { checkWebhookPayload, webhookFamily, unknownFieldMode, WEBHOOK_SCHEMAS } from './webhook-payload-schemas';
import { parseBankPayload } from '../deposit-reconciliation/deposit-reconciliation.webhook';

const refund = { merchantId: 'MID-A', eventType: 'refund.completed', eventId: 'evt-1', transactionId: 'rr-1', refundId: 'rf-1', amountCents: 2500 };
const cardpointeCharge = { merchid: '496160873888', eventType: 'transaction.approved', eventId: 'wh-1', retref: 'RT-1', orderid: 'ord-1', respstat: 'A', amount: '50.00', resptext: 'Approval' };
const settlement = { merchantId: 'MID-A', eventType: 'settlement.batch_closed', settlementId: 'B-1', gross: '1164.30', fee: '35.00', settledAt: '2026-11-04T12:00:00Z', transactionIds: ['rr-1', 'rr-2'], transactions: [{ retref: 'rr-3' }] };

describe('the families', () => {
  it('maps every processor path to its schema; an unknown processor has none', () => {
    for (const p of ['fiserv', 'cardpointe', 'CardConnect', 'bolt', 'commercehub']) expect(webhookFamily(p)).toBe('fiserv');
    expect(webhookFamily('clover')).toBe('clover');
    expect(webhookFamily('bank')).toBe('bank');
    expect(webhookFamily('stripe')).toBeNull();
  });
  it("CardPointe's own names are in the Fiserv family and not in Clover's", () => {
    for (const f of ['merchid', 'retref', 'respstat', 'resptext', 'orderid']) {
      expect(WEBHOOK_SCHEMAS.fiserv[f]).toBeDefined();
      expect(WEBHOOK_SCHEMAS.clover[f]).toBeUndefined();
    }
  });
});

describe('well-formed deliveries pass', () => {
  it.each([['fiserv', refund], ['clover', refund], ['fiserv', cardpointeCharge], ['fiserv', settlement], ['clover', settlement]] as const)('%s %#', (fam, body) => {
    expect(checkWebhookPayload(fam, body)).toEqual({ ok: true, errors: [], unknownFields: [] });
  });
  it('numbers as digit strings, epoch times, numeric ids, empty optional fields', () => {
    expect(checkWebhookPayload('fiserv', { merchantId: 1234, eventType: 'refund.completed', amountCents: '2500', settledAt: 1762300000, reason: '' }).ok).toBe(true);
  });
});

describe('wrong types and bounds are refused (field names only, never values)', () => {
  it.each([
    [{ ...refund, amountCents: 12.5 }, 'amountCents', 'cents'],
    [{ ...refund, amountCents: -1 }, 'amountCents', 'cents'],
    [{ ...refund, amountCents: 10_000_000_001 }, 'amountCents', 'cents'],
    [{ ...refund, amountCents: { $gt: 0 } }, 'amountCents', 'cents'],
    [{ ...refund, amount: '12.345' }, 'amount', 'dollars'],
    [{ ...refund, amount: '-5.00' }, 'amount', 'dollars'],
    [{ ...refund, eventType: { name: 'refund' } }, 'eventType', 'event'],
    [{ ...refund, eventType: 'refund<script>' }, 'eventType', 'event'],
    [{ ...refund, merchantId: ['MID-A'] }, 'merchantId', 'id'],
    [{ ...refund, transactionId: 'x'.repeat(129) }, 'transactionId', 'id'],
    [{ ...refund, refundId: 'rf\n1' }, 'refundId', 'id'],
    [{ ...refund, reason: 'x'.repeat(501) }, 'reason', 'text'],
    [{ ...refund, status: { approved: true } }, 'status', 'status'],
    [{ ...cardpointeCharge, respstat: 'Z' }, 'respstat', 'respstat'],
    [{ ...settlement, transactionIds: 'rr-1' }, 'transactionIds', 'idList'],
    [{ ...settlement, transactions: [{ retref: { a: 1 } }] }, 'transactions', 'txnList'],
    [{ ...settlement, settledAt: { at: 1 } }, 'settledAt', 'time'],
  ])('%#: %s.%s', (body, field, rule) => {
    const r = checkWebhookPayload('fiserv', body);
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({ field, rule });
    expect(JSON.stringify(r.errors)).not.toContain('MID-A');
  });
  it('a body that is not a JSON object', () => {
    for (const b of [null, [], [refund], 'refund', 42]) expect(checkWebhookPayload('fiserv', b).errors).toEqual([{ field: '$', rule: 'object' }]);
  });
});

describe('unexpected fields', () => {
  it('a CardPointe name in a Clover delivery is refused — our parser would read it', () => {
    const r = checkWebhookPayload('clover', { ...refund, retref: 'rr-other' });
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({ field: 'retref', rule: 'other_processor_field' });
  });
  it('two names for the same thing must agree', () => {
    expect(checkWebhookPayload('fiserv', { ...refund, retref: 'rr-OTHER' }).errors).toContainEqual({ field: 'transactionId|retref', rule: 'conflicting_fields' });
    expect(checkWebhookPayload('fiserv', { ...refund, merchid: 'MID-B' }).errors).toContainEqual({ field: 'merchantId|merchid', rule: 'conflicting_fields' });
    expect(checkWebhookPayload('fiserv', { ...refund, retref: 'rr-1' }).ok).toBe(true);   // the same value twice is fine
  });
  it('fields we do not know: reported by default, refused when WEBHOOK_UNKNOWN_FIELDS=reject', () => {
    const body = { ...refund, note: 'x', data: { nested: true } };
    expect(checkWebhookPayload('fiserv', body)).toEqual({ ok: true, errors: [], unknownFields: ['note', 'data'] });
    const strict = checkWebhookPayload('fiserv', body, { unknownFields: 'reject' });
    expect(strict.ok).toBe(false);
    expect(strict.errors).toEqual([{ field: 'note', rule: 'unknown_field' }, { field: 'data', rule: 'unknown_field' }]);
    expect(unknownFieldMode({})).toBe('report');
    expect(unknownFieldMode({ WEBHOOK_UNKNOWN_FIELDS: 'reject' })).toBe('reject');
    expect(unknownFieldMode({ WEBHOOK_UNKNOWN_FIELDS: 'yes' })).toBe('report');
  });
});

describe('the bank deposit feed', () => {
  it('a good deposit parses; its unknown fields are listed', () => {
    const r = parseBankPayload({ amountCents: 29100, externalBankTxnId: 'BANK-1', reference: 'ACH-1', depositDate: '2026-11-04', memo: 'x' });
    expect(r).toMatchObject({ ok: true, value: { amountCents: 29100, externalBankTxnId: 'BANK-1' }, unknownFields: ['memo'] });
  });
  it.each([
    [{ amountCents: 12.7, externalBankTxnId: 'B' }, 'amountCents'],
    [{ amountCents: 100, externalBankTxnId: 'B', description: { html: '<b>' } }, 'description'],
    [{ amountCents: 100, externalBankTxnId: 'B', transactionId: 'C' }, 'externalBankTxnId|transactionId'],
    [{ amountCents: 100, amount_cents: 200, externalBankTxnId: 'B' }, 'amountCents|amount_cents'],
  ])('%#: refused on %s', (body, field) => {
    const r = parseBankPayload(body);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_payload');
    expect(r.errors?.map((e) => e.field)).toContain(field);
  });
});
