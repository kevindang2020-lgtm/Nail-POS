// reminder-ladder.vitest.spec — Oct 14 build plan §54 ("reminder ladder 24 h / 2 h / 30 min"), rebuilt Oct 21 2026. One
// reminder per appointment per RUNG, each rung its own words ("tomorrow", "in about 2 hours", "in 30 minutes"); a run that
// fires every few minutes sends the 30-minute rung within its own window, never 90 minutes early; the old single
// lead_minutes setting is the ladder's first rung for salons that never touched the new setting; a rung already sent is
// never sent again, while the next rung still fires.
import { describe, it, expect } from 'vitest';
import { InMemoryRemindersRepository } from './reminders.repository';
import { RemindersService, type NotificationSender } from './reminders.service';

const HOUR = 3600_000, MIN = 60_000;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const T = 'ladder01';
class Sender implements NotificationSender { calls: { to: string; body: string }[] = []; async send(_c: any, r: any) { this.calls.push({ to: r.to, body: r.body }); return { sent: true, status: 'sent' }; } }
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function repo(ladder?: number[]) {
  const r = new InMemoryRemindersRepository();
  r.configs.set(T, { tenantId: T, enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms', ...(ladder ? { ladderMinutes: ladder } : {}) } as any);
  r.meta.set(T, { salonName: 'Luxe Nails', timezone: 'UTC' });
  const add = (id: string, startsAt: number) => { r.appts.push({ appointmentId: id, apptDate: ymd(startsAt), startTime: hhmm(startsAt), status: 'booked', customerName: 'Guest ' + id, customerPhone: '+1555000' + id.slice(-4).padStart(4, '0'), serviceName: 'Gel' }); r.apptTenant.set(id, T); };
  return { r, add };
}

describe('the reminder ladder', () => {
  it('24 h / 2 h / 30 min: three rungs, each once, each with its own words', async () => {
    const { r, add } = repo([1440, 120, 30]);
    add('a1', NOW + 24 * HOUR + 10 * MIN);   // 24 h rung now
    add('a2', NOW + 2 * HOUR + 3 * MIN);     // 2 h rung now
    add('a3', NOW + 32 * MIN);               // 30 min rung now
    add('a4', NOW + 5 * HOUR);               // nothing yet
    const s = new Sender();
    const sum = await new RemindersService(r, s).runDueReminders(NOW);
    expect(sum.sent).toBe(3);
    const by = Object.fromEntries(s.calls.map((c) => [c.to.slice(-4), c.body]));
    expect(by['00a1']).toMatch(/tomorrow/i);
    expect(by['00a2']).toMatch(/in about 2 hours/i);
    expect(by['00a3']).toMatch(/in 30 minutes/i);
    expect(by['00a4']).toBeUndefined();
    // the same minute again: nothing is sent twice
    expect((await new RemindersService(r, s).runDueReminders(NOW)).sent).toBe(0);
    // two hours later the 24 h guest gets nothing new (her 2 h rung is 22 h away); a3 is past; a2's 30-min rung is 1.5 h gone
    const later = NOW + 2 * HOUR;
    expect((await new RemindersService(r, s).runDueReminders(later)).sent).toBe(0);
    // and when a1 reaches her 2 h rung, that rung fires — once — even though her 24 h rung was already sent
    const s2 = new Sender();
    expect((await new RemindersService(r, s2).runDueReminders(NOW + 22 * HOUR + 10 * MIN)).sent).toBe(1);
    expect(s2.calls[0].body).toMatch(/in about 2 hours/i);
  });
  it('a short rung never fires early: with a 60-minute window the 30-minute rung looks only 30–40 minutes ahead (the window is capped at the rung)', async () => {
    const { r, add } = repo([30]);
    add('b1', NOW + 75 * MIN);   // 75 minutes away: NOT yet (the old single-lead code would have sent this now)
    add('b2', NOW + 35 * MIN);   // in the rung's own window
    const s = new Sender();
    expect((await new RemindersService(r, s).runDueReminders(NOW)).sent).toBe(1);
    expect(s.calls[0].to.endsWith('00b2')).toBe(true);
  });
  it('a salon that never set a ladder keeps its single lead_minutes as the one rung (unchanged behaviour)', async () => {
    const { r, add } = repo();                 // leadMinutes 1440, no ladder
    add('c1', NOW + 24 * HOUR + 10 * MIN);
    add('c2', NOW + 2 * HOUR + 3 * MIN);
    const s = new Sender();
    expect((await new RemindersService(r, s).runDueReminders(NOW)).sent).toBe(1);
    expect(s.calls[0].to.endsWith('00c1')).toBe(true);
    expect(s.calls[0].body).toMatch(/tomorrow/i);
  });
  it('the owner sets the ladder: sorted, de-duplicated, 1–5 rungs, each 5 min – 14 days; garbage is refused', async () => {
    const { r } = repo();
    const svc = new RemindersService(r, new Sender());
    expect((await svc.updateConfig(T, { ladderMinutes: [30, 1440, 120, 120] } as any)) as any).toMatchObject({ ladderMinutes: [1440, 120, 30] });
    await expect(svc.updateConfig(T, { ladderMinutes: [] } as any)).rejects.toThrow(/ladder/);
    await expect(svc.updateConfig(T, { ladderMinutes: [1, 2] } as any)).rejects.toThrow(/ladder/);
    await expect(svc.updateConfig(T, { ladderMinutes: [10, 20, 30, 40, 50, 60] } as any)).rejects.toThrow(/ladder/);
  });
});
