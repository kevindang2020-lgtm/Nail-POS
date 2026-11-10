/**
 * reminder-language.vitest.spec.ts — English + Vietnamese POS mandate WP-I (§54, §119): every reminder template has an
 * .en and a .vi variant and the CUSTOMER's language (customers.preferred_language) picks it — a Vietnamese-speaking
 * receptionist / a Vietnamese salon POS never turns an English customer's SMS Vietnamese, and the reverse.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryRemindersRepository } from './reminders.repository';
import { RemindersService, startLabel, type NotificationSender, type ReminderPushLike } from './reminders.service';
import { buildReminderMessage, reminderSubject, reminderPush, rungWords } from './reminder-core';

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);
const T = 'luxe001';
class Capture implements NotificationSender {
  public sent: Array<{ to: string; body: string; subject?: string; channel: string }> = [];
  async send(_ctx: unknown, req: { channel: 'sms' | 'email'; to: string; body: string; subject?: string }) { this.sent.push(req); return { sent: true, status: 'sent' }; }
}
class Push implements ReminderPushLike { public calls: any[] = []; async dispatchToUser(_t: string | null, userId: string, msg: any) { this.calls.push({ userId, msg }); return {}; } }
function seed(channel: 'sms' | 'email' = 'sms') {
  const r = new InMemoryRemindersRepository();
  r.configs.set(T, { tenantId: T, enabled: true, leadMinutes: 1440, windowMinutes: 60, channel } as any);
  r.meta.set(T, { salonName: 'Kim Nails', timezone: 'UTC' } as any);
  const row = (id: string, lang: string | null, phone: string) => ({ appointmentId: id, apptDate: '2026-06-02', startTime: '12:30', status: 'booked', customerName: `Guest ${id}`, customerPhone: phone, customerEmail: `${id}@example.test`, serviceName: 'Gel Mani', customerUserId: `user-${id}`, customerLanguage: lang });
  r.appts.push(row('en1', 'en', '+15551110001') as any, row('vi1', 'vi', '+15551110002') as any, row('none', null, '+15551110003') as any);
  for (const id of ['en1', 'vi1', 'none']) r.apptTenant.set(id, T);
  return r;
}

describe('appointment reminders in the customer\'s language', () => {
  it("every customer gets the English reminder — a customer marked Vietnamese too (Kevin's ruling (Oct 28 2026): every customer message is English — the salons' customers are English-speaking Americans)", async () => {
    const out = new Capture(); const push = new Push();
    await new RemindersService(seed(), out, push).runDueReminders(NOW);
    const by = (p: string) => out.sent.find((s) => s.to === p)!.body;
    expect(by('+15551110001')).toBe('Hi Guest en1, this is a reminder of your appointment for Gel Mani at Kim Nails tomorrow on Tue, Jun 2, 12:30 PM. Reply to reschedule. Reply STOP to opt out.');
    expect(by('+15551110002')).toBe('Hi Guest vi1, this is a reminder of your appointment for Gel Mani at Kim Nails tomorrow on Tue, Jun 2, 12:30 PM. Reply to reschedule. Reply STOP to opt out.');
    expect(by('+15551110003')).toMatch(/^Hi Guest none, this is a reminder/);
    expect(push.calls.find((c) => c.userId === 'user-vi1').msg).toMatchObject({ title: 'Appointment reminder' });
    expect(push.calls.find((c) => c.userId === 'user-en1').msg).toMatchObject({ title: 'Appointment reminder' });
  });
  it('email reminders carry the English subject for every customer', async () => {
    const out = new Capture();
    await new RemindersService(seed('email'), out).runDueReminders(NOW);
    expect(out.sent.find((s) => s.to === 'vi1@example.test')).toMatchObject({ subject: 'Appointment reminder — Kim Nails' });
    expect(out.sent.find((s) => s.to === 'en1@example.test')).toMatchObject({ subject: 'Appointment reminder — Kim Nails' });
    expect(out.sent.find((s) => s.to === 'vi1@example.test')!.body).not.toContain('STOP');
  });
  it('English for every language argument (Nov 9 2026: no Vietnamese variant exists): rung words, date label, fallbacks', () => {
    expect([rungWords(1440, 'vi'), rungWords(180, 'vi'), rungWords(60, 'vi'), rungWords(30, 'vi'), rungWords(4320, 'vi')]).toEqual(['tomorrow', 'in about 3 hours', 'in about an hour', 'in 30 minutes', 'in 3 days']);
    expect(rungWords(1440)).toBe('tomorrow');
    expect(startLabel(Date.UTC(2026, 5, 2, 18, 30), 'America/New_York', 'vi')).toBe('Tue, Jun 2, 2:30 PM');
    expect(buildReminderMessage({ appointmentId: 'x', startsAtMs: 0, status: 'booked', language: 'vi' }, undefined, 'email')).toBe('this is a reminder of your appointment at your salon. Reply to reschedule.');
    expect(reminderSubject(undefined, 'vi')).toBe('Appointment reminder');
    expect(reminderPush(undefined, undefined, 'en')).toEqual({ title: 'Appointment reminder', body: 'Your appointment is coming up.' });
  });
});
