// push-targeting.vitest.spec.ts — BUILD_PLAN Phase 13 D (Constitution 6 §58–63): typed categories, per-app targeting and
// payload minimization at the push service's one choke point (dispatchToUser).
import { describe, it, expect } from 'vitest';
import { PushService } from './push.service';
import { InMemoryPushRepository } from './push.repository';
import type { PushProvider, PushTarget, PushMessage } from './push.types';

class Recorder implements PushProvider {
  readonly name = 'rec';
  sent: { target: PushTarget; msg: PushMessage }[] = [];
  async send(target: PushTarget, msg: PushMessage) { this.sent.push({ target, msg }); return { ok: true }; }
}
async function setup() {
  const repo = new InMemoryPushRepository(); const rec = new Recorder(); const svc = new PushService(repo, rec);
  await svc.register({ tenantId: 't1', userId: 'u1' }, 'ios', 'tok-customer-000001', 'customer');
  await svc.register({ tenantId: 't1', userId: 'u1' }, 'ios', 'tok-tech-0000000001', 'tech');
  await svc.register({ tenantId: 't1', userId: 'u1' }, 'android', 'tok-legacy-00000001');   // no app id (legacy row)
  return { svc, rec, repo };
}

describe('dispatchToUser — per-app targeting by category', () => {
  it('a QUEUE_ASSIGNMENT reaches the tech app (and a legacy token), never the same person’s customer app', async () => {
    const { svc, rec } = await setup();
    const r = await svc.dispatchToUser('t1', 'u1', { title: 'New assignment', body: 'A guest is waiting for you', category: 'QUEUE_ASSIGNMENT', data: { queueItemId: 'q1' } });
    expect(rec.sent.map((s) => s.target.token).sort()).toEqual(['tok-legacy-00000001', 'tok-tech-0000000001']);
    expect(r.tokens).toBe(2);
  });
  it('an APPOINTMENT_REMINDER reaches only the customer app', async () => {
    const { svc, rec } = await setup();
    await svc.dispatchToUser('t1', 'u1', { title: 'Appointment reminder', category: 'APPOINTMENT_REMINDER', data: { appointmentId: 'a1' } });
    expect(rec.sent.map((s) => s.target.token).sort()).toEqual(['tok-customer-000001', 'tok-legacy-00000001']);
  });
});

describe('dispatchToUser — the payload carries a typed route and no personal data', () => {
  it('adds category + route + whitelisted ids', async () => {
    const { svc, rec } = await setup();
    await svc.dispatchToUser('t1', 'u1', { title: 'x', category: 'QUEUE_ASSIGNMENT', data: { kind: 'queue_assignment', queueItemId: 'q1' } });
    expect(rec.sent[0].msg.data).toMatchObject({ category: 'QUEUE_ASSIGNMENT', route: 'queue', queueItemId: 'q1', kind: 'queue_assignment' });
  });
  it('drops forbidden data keys (a name, phone, amount) whatever the producer put there', async () => {
    const { svc, rec } = await setup();
    await svc.dispatchToUser('t1', 'u1', { title: 'x', category: 'QUEUE_ASSIGNMENT', data: { queueItemId: 'q1', customerName: 'Jane Doe', phone: '+15555550100', amountCents: '1200' } });
    const d = rec.sent[0].msg.data!;
    expect(d.customerName).toBeUndefined(); expect(d.phone).toBeUndefined(); expect(d.amountCents).toBeUndefined();
    expect(JSON.stringify(rec.sent[0].msg)).not.toMatch(/Jane|5555550100/);
  });
  it('an unknown category is refused (nothing sent) — a typo must not fan out to every app', async () => {
    const { svc, rec } = await setup();
    const r = await svc.dispatchToUser('t1', 'u1', { title: 'x', category: 'NOT_A_CATEGORY' as any });
    expect(rec.sent).toHaveLength(0); expect(r.tokens).toBe(0);
  });
});

describe('register — the app id is a known one', () => {
  it('refuses an unknown app id (the topic and the targeting depend on it)', async () => {
    const svc = new PushService(new InMemoryPushRepository(), new Recorder());
    await expect(svc.register({ tenantId: 't1', userId: 'u1' }, 'ios', 'tok-xxxxxxxxxx', 'unknown_app')).rejects.toThrow(/app/);
    await expect(svc.register({ tenantId: 't1', userId: 'u1' }, 'ios', 'tok-xxxxxxxxxx', 'manager')).resolves.toEqual({ ok: true });
  });
});

// extras Customer Notifications 08 (round 10): personal quiet hours — a non-required push is held; a security notice goes
describe('dispatchToUser — the person\'s own quiet hours', () => {
  const withQuiet = (q: { start: string; end: string; timeZone: string } | null | 'boom') => {
    const repo = new InMemoryPushRepository() as InMemoryPushRepository & { quietHoursFor?: (t: string, u: string) => Promise<unknown> };
    repo.quietHoursFor = async () => { if (q === 'boom') throw new Error('db down'); return q; };
    const rec = new Recorder(); const svc = new PushService(repo, rec);
    return { repo, rec, svc };
  };
  it('22:00 → 07:00 New York: at 23:30 a booking push is held (nothing sent, the count says why); a SECURITY push still goes', async () => {
    const { svc, rec } = withQuiet({ start: '22:00', end: '07:00', timeZone: 'America/New_York' });
    await svc.register({ tenantId: 't1', userId: 'u1' }, 'ios', 'tok-owner-00000001', 'owner');
    svc.now = () => new Date('2026-11-13T04:30:00Z');   // 23:30 New York
    const held = await svc.dispatchToUser('t1', 'u1', { title: 'Booking changed', category: 'BOOKING_CHANGE', data: { appointmentId: 'a1' } });
    expect(held).toMatchObject({ sent: 0, heldForQuietHours: 1 }); expect(rec.sent).toHaveLength(0);
    const sec = await svc.dispatchToUser('t1', 'u1', { title: 'New sign-in', category: 'SECURITY' });
    expect(sec.sent).toBe(1); expect(sec.heldForQuietHours).toBeUndefined();
    svc.now = () => new Date('2026-11-13T12:30:00Z');   // 07:30 New York — outside
    expect((await svc.dispatchToUser('t1', 'u1', { title: 'Booking changed', category: 'BOOKING_CHANGE', data: { appointmentId: 'a1' } })).sent).toBe(1);
  });
  it('no quiet hours, or an unreadable preference, never silences a push', async () => {
    for (const q of [null, 'boom'] as const) {
      const { svc, rec } = withQuiet(q);
      await svc.register({ tenantId: 't1', userId: 'u1' }, 'ios', 'tok-owner-00000002', 'owner');
      svc.now = () => new Date('2026-11-13T04:30:00Z');
      expect((await svc.dispatchToUser('t1', 'u1', { title: 'Booking changed', category: 'BOOKING_CHANGE', data: { appointmentId: 'a1' } })).sent).toBe(1);
      expect(rec.sent).toHaveLength(1);
    }
  });
});
