// sender-not-configured.vitest.spec.ts — P-11 (wave 4 pilot): with no provider, the ONE send path never records a text or
// an e-mail as "sent" and never meters it.
//   production  → the not-configured sender: ledger row blocked / not_configured, result not sent, no credit charged
//   dev / test  → the mock: ledger row 'simulated', result marked simulated, no credit charged
import { describe, it, expect } from 'vitest';
import { MockSmsSender, MockEmailSender, NotConfiguredSmsSender, NotConfiguredEmailSender } from '@aipowersalon/notifications';
import { NotificationsService } from './notifications.service';
import { InMemoryNotificationsRepository } from './notifications.repository';

class StubMeter {
  adjusts: { metric: string; delta: number }[] = [];
  async hasCapacity() { return true; }
  async adjust(_t: string, metric: string, delta: number) { this.adjusts.push({ metric, delta }); }
}
const ctx = { tenantId: 'ten_1', userId: 'u_owner', role: 'OWNER', salonName: 'Luxe' };

describe('no provider configured (production)', () => {
  it('a salon text is refused as not_configured: not sent, ledger blocked, not metered', async () => {
    const repo = new InMemoryNotificationsRepository(); const meter = new StubMeter();
    const svc = new NotificationsService(repo, new NotConfiguredSmsSender(), new NotConfiguredEmailSender(), meter);
    const r = await svc.sendSms({ tenantId: 'ten_1', to: '+18565550101', body: 'Your receipt', purpose: 'receipt', meter: true });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('not_configured');
    expect(meter.adjusts).toEqual([]);
    const rows = await repo.listForTenant('ten_1', 10);
    expect(rows.map((x) => [x.status, x.failureReason])).toEqual([['blocked', 'not_configured']]);
  });
  it('a staff send (sms and email) is refused as not_configured and never charged', async () => {
    const repo = new InMemoryNotificationsRepository(); const meter = new StubMeter();
    const svc = new NotificationsService(repo, new NotConfiguredSmsSender(), new NotConfiguredEmailSender(), meter);
    const s = await svc.send(ctx, { channel: 'sms', to: '+18565550101', body: 'Hi' });
    const e = await svc.send(ctx, { channel: 'email', to: 'guest@example.com', body: 'Hi' });
    expect([s.sent, s.reason, e.sent, e.reason]).toEqual([false, 'not_configured', false, 'not_configured']);
    expect(meter.adjusts).toEqual([]);
    const rows = await repo.listForTenant('ten_1', 10);
    expect(rows.every((x) => x.status === 'blocked' && x.failureReason === 'not_configured')).toBe(true);
    expect(rows.length).toBe(2);
  });
});

describe('the mock (development / test)', () => {
  it('a mock text is recorded as simulated, reported simulated, and not metered', async () => {
    const repo = new InMemoryNotificationsRepository(); const meter = new StubMeter();
    const svc = new NotificationsService(repo, new MockSmsSender(), new MockEmailSender(), meter);
    const r = await svc.sendSms({ tenantId: 'ten_1', to: '+18565550101', body: 'Promo', purpose: 'marketing', meter: true });
    expect(r.sent).toBe(true);
    expect(r.simulated).toBe(true);
    const s = await svc.send(ctx, { channel: 'sms', to: '+18565550102', body: 'Hi' });
    const e = await svc.send(ctx, { channel: 'email', to: 'guest@example.com', body: 'Hi' });
    expect([s.status, e.status]).toEqual(['simulated', 'simulated']);
    expect(meter.adjusts).toEqual([]);
    const rows = await repo.listForTenant('ten_1', 10);
    expect(rows.length).toBe(3);
    expect(rows.every((x) => x.status === 'simulated')).toBe(true);
  });
});
