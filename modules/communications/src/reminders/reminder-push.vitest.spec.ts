/**
 * reminder-push.vitest.spec.ts — the app-push channel added to the reminder sweep (Jul 26, 2026).
 * Pins the safety semantics: pushes fire ONLY on terminal outcomes (sent / opted_out) so provider-error and
 * over-limit retries can never double-push; the sent-set makes it at-most-once per appointment across runs;
 * walk-ins without a linked account are skipped silently; a missing/broken push port never affects the sweep.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryRemindersRepository } from './reminders.repository';
import { RemindersService, type NotificationSender, type ReminderPushLike } from './reminders.service';

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const T = 'luxe001';

class StubSender implements NotificationSender {
  public calls = 0;
  constructor(public result: { sent: boolean; status: string; reason?: string } = { sent: true, status: 'sent' }, public throwOnce = false) {}
  async send(): Promise<{ sent: boolean; status: string; reason?: string }> {
    this.calls++;
    if (this.throwOnce) { this.throwOnce = false; throw new Error('provider down'); }
    return this.result;
  }
}

class FakePush implements ReminderPushLike {
  public calls: Array<{ tenantId: string | null; userId: string; msg: any }> = [];
  public explode = false;
  async dispatchToUser(tenantId: string | null, userId: string, msg: any): Promise<unknown> {
    if (this.explode) throw new Error('push transport down');
    this.calls.push({ tenantId, userId, msg });
    return { attempted: 1 };
  }
}

function seed(withUser = true): InMemoryRemindersRepository {
  const r = new InMemoryRemindersRepository();
  r.configs.set(T, { tenantId: T, enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' } as any);
  r.meta.set(T, { salonName: 'Luxe Nails', timezone: 'UTC' } as any);
  r.appts.push({ appointmentId: 'a1', apptDate: '2026-06-02', startTime: '12:30', status: 'booked', customerName: 'Guest a1', customerPhone: '+15551110001', serviceName: 'Gel Mani', customerUserId: withUser ? 'user-a1' : undefined } as any);
  r.apptTenant.set('a1', T);
  return r;
}

describe('reminder push channel', () => {
  it('successful send → exactly one push to the linked account, with appointment data and no phone number in the body', async () => {
    const repo = seed();
    const push = new FakePush();
    const svc = new RemindersService(repo, new StubSender(), push);
    const sum = await svc.runDueReminders(NOW);
    expect(sum.sent).toBe(1);
    expect(push.calls.length).toBe(1);
    expect(push.calls[0].tenantId).toBe(T);
    expect(push.calls[0].userId).toBe('user-a1');
    expect(push.calls[0].msg.title).toBe('Appointment reminder');
    expect(push.calls[0].msg.data).toEqual({ kind: 'appointment_reminder', appointmentId: 'a1' });
    expect(String(push.calls[0].msg.body)).not.toContain('5551110001');
    // idempotent across runs: the sent-set stops a second push
    await svc.runDueReminders(NOW);
    expect(push.calls.length).toBe(1);
  });

  it('SMS opt-out is terminal → the app push (separate OS-level consent) still reaches them exactly once', async () => {
    const repo = seed();
    const push = new FakePush();
    const svc = new RemindersService(repo, new StubSender({ sent: false, status: 'blocked', reason: 'opted_out' }), push);
    const sum = await svc.runDueReminders(NOW);
    expect(sum.blocked).toBe(1);
    expect(push.calls.length).toBe(1);
    await svc.runDueReminders(NOW);
    expect(push.calls.length).toBe(1);
  });

  it('retryable outcomes (provider error, over-limit) do NOT push; the eventual terminal pass pushes once', async () => {
    const repo = seed();
    const push = new FakePush();
    const sender = new StubSender({ sent: true, status: 'sent' }, /* throwOnce */ true);
    const svc = new RemindersService(repo, sender, push);
    await svc.runDueReminders(NOW);            // provider throws → failed, retry next run, no push
    expect(push.calls.length).toBe(0);
    await svc.runDueReminders(NOW);            // succeeds → one push
    expect(push.calls.length).toBe(1);

    const repo2 = seed();
    const push2 = new FakePush();
    const sender2 = new StubSender({ sent: false, status: 'blocked', reason: 'over_limit' });
    const svc2 = new RemindersService(repo2, sender2, push2);
    await svc2.runDueReminders(NOW);           // over_limit is retryable (not marked sent) → no push
    expect(push2.calls.length).toBe(0);
    sender2.result = { sent: true, status: 'sent' };
    await svc2.runDueReminders(NOW);
    expect(push2.calls.length).toBe(1);
  });

  it('walk-in with no linked account → no push, sweep unaffected', async () => {
    const repo = seed(/* withUser */ false);
    const push = new FakePush();
    const svc = new RemindersService(repo, new StubSender(), push);
    const sum = await svc.runDueReminders(NOW);
    expect(sum.sent).toBe(1);
    expect(push.calls.length).toBe(0);
  });

  it('no push port wired (legacy construction) and a throwing push transport both leave the sweep intact', async () => {
    const legacy = new RemindersService(seed(), new StubSender());
    const sumLegacy = await legacy.runDueReminders(NOW);
    expect(sumLegacy.sent).toBe(1);

    const repo = seed();
    const push = new FakePush();
    push.explode = true;
    const svc = new RemindersService(repo, new StubSender(), push);
    const sum = await svc.runDueReminders(NOW);
    expect(sum.sent).toBe(1);                  // push transport failure never breaks the reminder
    expect(push.calls.length).toBe(0);
  });
});
