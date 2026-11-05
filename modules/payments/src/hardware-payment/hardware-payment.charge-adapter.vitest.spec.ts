import { describe, it, expect } from 'vitest';
import { HardwareChargeAdapter, SandboxPaymentProcessor } from './hardware-payment.charge-adapter';

describe('Hardware charge adapter', () => {
  it('approves via the sandbox processor and returns a retref', async () => {
    const a = new HardwareChargeAdapter(new SandboxPaymentProcessor());
    const r = await a.charge({ tenantId: 't', token: 'tok_visa', amountCents: 15_250, invoiceId: 'inv1' });
    expect(r.ok).toBe(true); expect(r.respstat).toBe('A'); expect(r.retref).toMatch(/^SBX-/);
  });
  it('declines a decline-token', async () => {
    const a = new HardwareChargeAdapter(new SandboxPaymentProcessor());
    const r = await a.charge({ tenantId: 't', token: 'tok_decline', amountCents: 15_250, invoiceId: 'inv1' });
    expect(r.ok).toBe(false); expect(r.respstat).toBe('C');
  });
  it('fails safely when no processor is configured', async () => {
    const a = new HardwareChargeAdapter(undefined);
    const r = await a.charge({ tenantId: 't', token: 'tok', amountCents: 100, invoiceId: 'i' });
    expect(r.ok).toBe(false); expect(r.respText).toMatch(/no payment processor/i);
  });
});
