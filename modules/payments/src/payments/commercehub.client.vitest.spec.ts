// Contract tests for the CommerceHub adapter, asserted against the request/response shapes in Fiserv's public docs.
// These lock the mapping (HMAC headers, decimal amounts, response parsing, honest failure) so a sandbox run only has
// to confirm the documented field names — the orchestration is already proven.
import { describe, it, expect } from 'vitest';
import { CommerceHubClient, type CommerceHubConfig } from './commercehub.client';
import { ProcessorError } from './payment-processor.port';
import type { FetchLike, FetchResponseLike } from './cardpointe.client';

const cfg: CommerceHubConfig = { baseUrl: 'https://cert.example.fiserv.com/', apiKey: 'API_KEY', apiSecret: 'SECRET', merchantId: 'MID1', terminalId: 'TID1', currency: 'USD' };

// A documented APPROVED charge response (shape from developer.fiserv.com).
const approvedCharge = {
  gatewayResponse: { transactionType: 'CHARGE', transactionState: 'AUTHORIZED', transactionProcessingDetails: { transactionId: '84356531338', clientRequestId: '4345791' } },
  source: { sourceType: 'PaymentSession', card: { last4: '0019', scheme: 'VISA' } },
  paymentReceipt: { approvedAmount: { total: 12.04, currency: 'USD' }, processorResponseDetails: { approvalStatus: 'APPROVED', approvalCode: 'OK5882', responseCode: '000', responseMessage: 'APPROVAL' } },
};

function mockFetch(resp: { status?: number; body: any }, capture?: (url: string, init: any) => void): FetchLike {
  return async (url, init): Promise<FetchResponseLike> => {
    capture?.(url, init);
    const status = resp.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => resp.body, text: async () => JSON.stringify(resp.body) };
  };
}

describe('CommerceHubClient — documented contract', () => {
  it('signs requests with the documented HMAC headers', async () => {
    let seen: any = null;
    const c = new CommerceHubClient(cfg, mockFetch({ body: approvedCharge }, (_u, init) => { seen = init; }));
    await c.authorizeAndCapture({ account: 'sess_abc', amountCents: 1204 });
    expect(seen.headers['Api-Key']).toBe('API_KEY');
    expect(seen.headers['Auth-Token-Type']).toBe('HMAC');
    expect(seen.headers['Authorization']).toMatch(/^[A-Za-z0-9+/=]+$/); // base64 signature
    expect(seen.headers['Client-Request-Id']).toBeTruthy();
    expect(seen.headers['Timestamp']).toMatch(/^\d+$/);
  });

  it('charges via /payments/v1/charges with a decimal amount + PaymentSession + captureFlag', async () => {
    let url = ''; let body: any = null;
    const c = new CommerceHubClient(cfg, mockFetch({ body: approvedCharge }, (u, init) => { url = u; body = JSON.parse(init.body); }));
    await c.authorizeAndCapture({ account: 'sess_abc', amountCents: 1204, idempotencyKey: 'idem-1' });
    expect(url).toBe('https://cert.example.fiserv.com/payments/v1/charges');
    expect(body.amount).toEqual({ total: 12.04, currency: 'USD' });       // integer cents → decimal
    expect(body.source).toEqual({ sourceType: 'PaymentSession', session: 'sess_abc' });
    expect(body.transactionDetails).toMatchObject({ captureFlag: true, merchantTransactionId: 'idem-1' });
    expect(body.merchantDetails).toEqual({ merchantId: 'MID1', terminalId: 'TID1' });
  });

  it('parses an APPROVED response into approved + retref + amount', async () => {
    const c = new CommerceHubClient(cfg, mockFetch({ body: approvedCharge }));
    const r = await c.authorizeAndCapture({ account: 'sess_abc', amountCents: 1204 });
    expect(r).toMatchObject({ approved: true, declined: false, retref: '84356531338', authCode: 'OK5882', respstat: '000', amountCents: 1204 });
  });

  it('treats a DECLINED response as declined, not an error', async () => {
    const declined = { gatewayResponse: { transactionState: 'DECLINED', transactionProcessingDetails: { transactionId: 'T2' } }, paymentReceipt: { processorResponseDetails: { approvalStatus: 'DECLINED', responseCode: '104', responseMessage: 'DECLINED' } } };
    const c = new CommerceHubClient(cfg, mockFetch({ body: declined }));
    const r = await c.authorizeAndCapture({ account: 'sess_abc', amountCents: 500 });
    expect(r.approved).toBe(false);
    expect(r.declined).toBe(true);
  });

  it('surfaces a non-2xx as ProcessorError (never a fabricated success)', async () => {
    const c = new CommerceHubClient(cfg, mockFetch({ status: 401, body: { error: [{ message: 'Invalid Api-Key' }] } }));
    await expect(c.authorizeAndCapture({ account: 'sess_abc', amountCents: 500 })).rejects.toBeInstanceOf(ProcessorError);
  });

  it('createSession posts to the Security Credentials API and returns the sessionId/accessToken/publicKey', async () => {
    let url = '';
    const c = new CommerceHubClient(cfg, mockFetch({ status: 201, body: { gatewayResponse: { transactionState: 'CREATED', transactionProcessingDetails: { transactionId: 'C1' } }, sessionId: 'SESS1', accessToken: 'AT1', publicKey: 'PK1', accessTokenTimeToLive: 1500 } }, (u) => { url = u; }));
    const s = await c.createSession();
    expect(url).toBe('https://cert.example.fiserv.com/payments-vas/v1/security/credentials');
    expect(s).toMatchObject({ sessionId: 'SESS1', accessToken: 'AT1', publicKey: 'PK1', expiresInSeconds: 1500 });
  });

  it('refunds via /payments/v1/refunds and voids via /payments/v1/cancels with the reference transaction', async () => {
    let refundUrl = ''; let refundBody: any = null;
    const rc = new CommerceHubClient(cfg, mockFetch({ body: { gatewayResponse: { transactionState: 'CAPTURED', transactionProcessingDetails: { transactionId: 'R1' } }, paymentReceipt: { processorResponseDetails: { approvalStatus: 'APPROVED' } } } }, (u, init) => { refundUrl = u; refundBody = JSON.parse(init.body); }));
    const refund = await rc.refund({ retref: '84356531338', amountCents: 604 });
    expect(refundUrl).toBe('https://cert.example.fiserv.com/payments/v1/refunds');
    expect(refundBody.referenceTransactionDetails).toEqual({ referenceTransactionId: '84356531338' });
    expect(refundBody.amount).toEqual({ total: 6.04, currency: 'USD' });
    expect(refund.ok).toBe(true);

    let voidUrl = '';
    const vc = new CommerceHubClient(cfg, mockFetch({ body: { gatewayResponse: { transactionState: 'VOIDED', transactionProcessingDetails: { transactionId: 'V1' } }, paymentReceipt: { processorResponseDetails: { approvalStatus: 'APPROVED' } } } }, (u) => { voidUrl = u; }));
    const voided = await vc.voidTransaction({ retref: '84356531338' });
    expect(voidUrl).toBe('https://cert.example.fiserv.com/payments/v1/cancels');
    expect(voided.ok).toBe(true);
  });
});
