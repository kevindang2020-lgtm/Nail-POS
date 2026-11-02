import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { parseBankPayload } from './deposit-reconciliation.webhook';
import { InMemoryWebhookRepository } from './deposit-reconciliation.webhook.repository';
import { BankWebhookService } from './deposit-reconciliation.webhook.service';

const SECRET = 'whsec_test';
const sign = (payload: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex')}`;
const endpoint = { token: 'tok_1', tenantId: 't1', bankAccountId: 'acc1', signingSecret: SECRET, status: 'active' };

describe('webhook — payload parsing (pure)', () => {
  it('requires amount + external txn id (for idempotency)', () => {
    expect(parseBankPayload({ amountCents: 1000, externalBankTxnId: 'X1' }).ok).toBe(true);
    expect(parseBankPayload({ externalBankTxnId: 'X1' }).error).toBe('missing_amount');
    expect(parseBankPayload({ amountCents: 1000 }).error).toBe('missing_external_txn_id');
  });
});

describe('webhook — ingest (signature, replay, idempotency, tenant-from-credential)', () => {
  const svc = () => new BankWebhookService(new InMemoryWebhookRepository([endpoint]));
  const body = JSON.stringify({ amountCents: 29100, externalBankTxnId: 'BANK-TXN-1', reference: 'ACH-1' });

  it('unknown token -> 404', async () => { expect((await svc().ingest('nope', body, sign(body))).status).toBe(404); });
  it('disabled endpoint -> 403', async () => {
    const s = new BankWebhookService(new InMemoryWebhookRepository([{ ...endpoint, status: 'disabled' }]));
    expect((await s.ingest('tok_1', body, sign(body))).status).toBe(403);
  });
  it('bad signature -> 401', async () => { const badSig = `t=${Math.floor(Date.now()/1000)},v1=deadbeef`; const r = await svc().ingest('tok_1', body, badSig); expect(r.status).toBe(401); expect(r.reason).toMatch(/signature_/); });
  it('stale timestamp -> 401 replay_rejected', async () => {
    const stale = sign(body, Math.floor(Date.now() / 1000) - 1000);
    const r = await svc().ingest('tok_1', body, stale);
    expect(r.status).toBe(401); expect(r.reason).toBe('replay_rejected');
  });
  it('valid signature -> 200 accepted, then duplicate -> 200 idempotent already_processed', async () => {
    const s = svc();
    const first = await s.ingest('tok_1', body, sign(body));
    expect(first.status).toBe(200); expect(first.reason).toBe('accepted'); expect(first.idempotent).toBe(false);
    const dup = await s.ingest('tok_1', body, sign(body));
    expect(dup.status).toBe(200); expect(dup.reason).toBe('already_processed'); expect(dup.idempotent).toBe(true);
  });
  it('malformed json -> 400', async () => { expect((await svc().ingest('tok_1', 'not-json', sign('not-json'))).status).toBe(400); });
});
