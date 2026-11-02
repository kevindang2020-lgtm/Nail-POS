// activation-destination.vitest.spec — Constitution 12 §115 (finding M10): activation codes are not an SMS-pumping endpoint.
import { describe, it, expect } from 'vitest';
import { CustomerActivationService, InMemoryTicketStore } from './customer-activation.service';
import { InMemoryActivationRepo } from './customer-activation.repository';

function svc() {
  const sent: string[] = []; const abuse: Array<{ risk: string }> = [];
  const s = new CustomerActivationService(new InMemoryActivationRepo(), { sendSms: async (m: { to: string }) => { sent.push(m.to); return { sent: true, status: 'sent' as const }; } }, new InMemoryTicketStore(), undefined, (e) => abuse.push(e));
  return { s, sent, abuse };
}

describe('§115 the destination decides, not only the caller', () => {
  it.each(['+882123456789', '+883123456789', '+8812345678', '+870123456789'])('a premium-rate / satellite number (%s) is refused and NOT texted', async (phone) => {
    const { s, sent, abuse } = svc();
    await expect(s.requestCode({ phone, ip: '203.0.113.5' })).rejects.toMatchObject({ code: 'invalid_phone' });
    expect(sent).toEqual([]);
    expect(abuse[0]).toMatchObject({ risk: 'premium_rate' });
  });
  it('a home-country (+1) number is texted normally and raises nothing', async () => {
    const { s, sent, abuse } = svc();
    await s.requestCode({ phone: '+18565550123', ip: '203.0.113.5' });
    expect(sent).toEqual(['+18565550123']); expect(abuse).toEqual([]);
  });
  it('a foreign (high-cost) number is SENT — a US salon can have international customers — but recorded', async () => {
    const { s, sent, abuse } = svc();
    await s.requestCode({ phone: '+447700900123', ip: '203.0.113.5' });
    expect(sent).toEqual(['+447700900123']); expect(abuse[0]).toMatchObject({ risk: 'high_cost' });
  });
  it('the refusal message does not explain the classifier (an attacker learns nothing to tune against)', async () => {
    const { s } = svc();
    await expect(s.requestCode({ phone: '+882123456789' })).rejects.toMatchObject({ extra: { message: 'This phone number cannot receive verification codes.' } });
  });
});
