// Fiserv master build §8C P0 regression tests (Nov 4 2026): no fabricated Tap to Pay approval can reach the ledger.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FiservCommerceHubTtpAdapter } from './fiserv-commercehub-ttp.adapter';
import { TapToPayNotImplementedError } from './tap-to-pay-session';
import type { FiservTtpConfig } from './ttp-config';

const cfg: FiservTtpConfig = { apiKey: 'k', apiSecret: 's', merchantId: 'm', terminalProfileId: 't', environment: 'sandbox', currency: 'USD' };
const input = (processorRef: string, amountCents = 3233) => ({ tenantId: 't1', idempotencyKey: 'K1', processorRef, amountCents } as any);

describe('Tap to Pay — no fake approval (P0)', () => {
  it('a client-supplied sbx_tap_ reference is refused when no provider client exists', async () => {
    const a = new FiservCommerceHubTtpAdapter(cfg, null);
    await expect(a.finalizeTransaction(input('sbx_tap_1730000000000'))).rejects.toBeInstanceOf(TapToPayNotImplementedError);
  });

  it('an arbitrary processorRef is refused when no provider client exists', async () => {
    const a = new FiservCommerceHubTtpAdapter(cfg, null);
    await expect(a.finalizeTransaction(input('anything'))).rejects.toBeInstanceOf(TapToPayNotImplementedError);
  });

  it('a sbx_tap_ reference is charged through the provider like any other ref — the provider decides', async () => {
    const client: any = { authorizeAndCapture: vi.fn().mockResolvedValue({ approved: false, declined: true, respstat: 'C', respText: 'Invalid session' }) };
    const a = new FiservCommerceHubTtpAdapter(cfg, client);
    const r = await a.finalizeTransaction(input('sbx_tap_1'));
    expect(client.authorizeAndCapture).toHaveBeenCalledOnce();
    expect(r.verified).toBe(false);
  });

  it('provider approval with a different amount is NOT verified', async () => {
    const client: any = { authorizeAndCapture: vi.fn().mockResolvedValue({ approved: true, declined: false, respstat: 'A', respText: 'Approved', retref: 'R1', amountCents: 100 }) };
    const a = new FiservCommerceHubTtpAdapter(cfg, client);
    const r = await a.finalizeTransaction(input('SESS', 3233));
    expect(r.verified).toBe(false);
    expect(r.respText).toMatch(/held for review/);
  });

  it('provider approval without a confirmed amount is NOT verified', async () => {
    const client: any = { authorizeAndCapture: vi.fn().mockResolvedValue({ approved: true, declined: false, respstat: 'A', respText: 'Approved', retref: 'R1' }) };
    const r = await new FiservCommerceHubTtpAdapter(cfg, client).finalizeTransaction(input('SESS', 3233));
    expect(r.verified).toBe(false);
  });

  it('provider approval with the exact amount is verified', async () => {
    const client: any = { authorizeAndCapture: vi.fn().mockResolvedValue({ approved: true, declined: false, respstat: 'A', respText: 'Approved', retref: 'R9', amountCents: 3233 }) };
    const r = await new FiservCommerceHubTtpAdapter(cfg, client).finalizeTransaction(input('SESS', 3233));
    expect(r).toMatchObject({ verified: true, processorRef: 'R9', capturedAmountCents: 3233 });
  });

  it('no production source file fabricates a sbx_tap_ reference or approves on it', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    for (const f of ['apps/manager-pay-web/src/native/tapToPay.ts', 'modules/checkout/src/mobile-checkout/fiserv-commercehub-ttp.adapter.ts']) {
      const src = readFileSync(join(root, f), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/sbx_tap_/);
    }
  });
});
