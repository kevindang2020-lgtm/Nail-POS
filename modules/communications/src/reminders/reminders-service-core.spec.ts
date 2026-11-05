/**
 * reminders-service-core.spec.ts — end-to-end orchestration on in-memory data + a stub notification sender:
 * window selection, idempotency, opt-out vs over-limit retry semantics, and config validation.
 */
import { InMemoryRemindersRepository } from './reminders.repository';
import { RemindersService, ValidationError, type NotificationSender } from './reminders.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, ctor: any) { try { await fn(); check(name, false); } catch (e: any) { check(name, e instanceof ctor); } }

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 5, 1, 12, 0, 0); // fixed "now"
const T = 'luxe001';

class StubSender implements NotificationSender {
  public calls: any[] = [];
  constructor(private result: { sent: boolean; status: string; reason?: string } = { sent: true, status: 'sent' }) {}
  async send(ctx: any, req: any) { this.calls.push({ ctx, req }); return this.result; }
}

function seedRepo(): InMemoryRemindersRepository {
  const r = new InMemoryRemindersRepository();
  r.configs.set(T, { tenantId: T, enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
  r.meta.set(T, { salonName: 'Luxe Nails', timezone: 'UTC' });
  // due window in UTC is [NOW+24h, NOW+25h)  → 2026-06-02 12:00..13:00
  const add = (id: string, date: string, time: string, status: string, phone: string | null) => { r.appts.push({ appointmentId: id, apptDate: date, startTime: time, status, customerName: 'Guest ' + id, customerPhone: phone, serviceName: 'Gel Mani' }); r.apptTenant.set(id, T); };
  add('a1', '2026-06-02', '12:30', 'booked', '+15551110001'); // due (NOW+24.5h)
  add('a2', '2026-06-02', '14:00', 'booked', '+15551110002'); // same date, but NOW+26h → outside window
  add('a3', '2026-06-02', '12:45', 'cancelled', '+15551110003'); // not booked
  add('a4', '2026-06-02', '12:50', 'booked', null); // no phone
  return r;
}

async function main(): Promise<void> {
  console.log('\n== window selection + send ==');
  {
    const repo = seedRepo();
    const sender = new StubSender();
    const svc = new RemindersService(repo, sender);
    const s = await svc.runDueReminders(NOW);
    check('one tenant processed', s.tenantsProcessed === 1);
    check('exactly the in-window booked+phone appt selected', s.candidates === 1 && s.sent === 1);
    check('sent the right recipient', sender.calls.length === 1 && sender.calls[0].req.to === '+15551110001' && sender.calls[0].req.channel === 'sms');
    check('message includes opt-out + salon', /STOP/i.test(sender.calls[0].req.body) && sender.calls[0].req.body.includes('Luxe Nails'));
    check('records a sent delivery attempt', repo.attempts.length === 1 && repo.attempts[0].status === 'sent' && repo.attempts[0].appointmentId === 'a1' && repo.attempts[0].channel === 'sms');

    // idempotency: a second run sends nothing
    const s2 = await svc.runDueReminders(NOW);
    check('second run is idempotent', s2.candidates === 0 && s2.sent === 0 && sender.calls.length === 1);
  }

  console.log('\n== disabled tenant is skipped ==');
  {
    const repo = seedRepo();
    repo.configs.set(T, { tenantId: T, enabled: false, leadMinutes: 1440, windowMinutes: 60, channel: 'sms' });
    const sender = new StubSender();
    const s = await new RemindersService(repo, sender).runDueReminders(NOW);
    check('no tenants processed when disabled', s.tenantsProcessed === 0 && sender.calls.length === 0);
  }

  console.log('\n== failed send records a failed delivery attempt ==');
  {
    const repo = seedRepo();
    const sender = new StubSender({ sent: false, status: 'failed' });
    const s = await new RemindersService(repo, sender).runDueReminders(NOW);
    check('counted as failed (not marked sent → retryable)', s.failed === 1 && s.sent === 0);
    check('records a failed delivery attempt', repo.attempts.length === 1 && repo.attempts[0].status === 'failed' && repo.attempts[0].appointmentId === 'a1');
    check('failed attempt is not marked sent', (await repo.listSent(T, ['a1'])).length === 0);
  }

  console.log('\n== provider error records a failed attempt ==');
  {
    const repo = seedRepo();
    const sender: NotificationSender = { async send() { throw new Error('provider down'); } };
    const s = await new RemindersService(repo, sender).runDueReminders(NOW);
    check('provider throw counted as failed', s.failed === 1 && s.sent === 0);
    check('records a failed attempt with provider_error', repo.attempts.length === 1 && repo.attempts[0].status === 'failed' && repo.attempts[0].error === 'provider_error');
  }

  console.log('\n== opted-out: blocked + marked (no retry) ==');
  {
    const repo = seedRepo();
    const sender = new StubSender({ sent: false, status: 'blocked', reason: 'opted_out' });
    const svc = new RemindersService(repo, sender);
    const s = await svc.runDueReminders(NOW);
    check('opted-out counted as blocked', s.blocked === 1 && s.sent === 0);
    const s2 = await svc.runDueReminders(NOW);
    check('opted-out not retried (marked)', s2.candidates === 0 && sender.calls.length === 1);
  }

  console.log('\n== over_limit: blocked but retried next run ==');
  {
    const repo = seedRepo();
    const sender = new StubSender({ sent: false, status: 'blocked', reason: 'over_limit' });
    const svc = new RemindersService(repo, sender);
    const s = await svc.runDueReminders(NOW);
    check('over_limit counted as blocked', s.blocked === 1);
    const s2 = await svc.runDueReminders(NOW);
    check('over_limit retried next run (not marked)', s2.candidates === 1 && sender.calls.length === 2);
  }

  console.log('\n== provider failure: retried, not marked ==');
  {
    const repo = seedRepo();
    const sender = new StubSender({ sent: false, status: 'failed', reason: 'sms_failed' });
    const s = await new RemindersService(repo, sender).runDueReminders(NOW);
    check('failure counted', s.failed === 1 && s.sent === 0);
  }

  console.log('\n== email channel uses customer email ==');
  {
    const repo = seedRepo();
    repo.configs.set(T, { tenantId: T, enabled: true, leadMinutes: 1440, windowMinutes: 60, channel: 'email' });
    // give a1 an email; a4 (no phone) also gets an email so it becomes reachable by email
    const a1 = repo.appts.find((a) => a.appointmentId === 'a1')!; a1.customerEmail = 'a1@example.com';
    const a4 = repo.appts.find((a) => a.appointmentId === 'a4')!; a4.apptDate = '2026-06-02'; a4.startTime = '12:35'; a4.customerEmail = 'a4@example.com';
    const sender = new StubSender();
    const s = await new RemindersService(repo, sender).runDueReminders(NOW);
    check('email-channel sends to email addresses', sender.calls.every((c) => c.req.channel === 'email' && c.req.to.includes('@')));
    check('a1 + a4 reachable by email', s.sent === 2 && sender.calls.map((c) => c.req.to).sort().join(',') === 'a1@example.com,a4@example.com');
  }

  console.log('\n== config management ==');
  {
    const repo = new InMemoryRemindersRepository();
    const svc = new RemindersService(repo, new StubSender());
    const def = await svc.getConfig(T);
    check('default config disabled', def.enabled === false && def.leadMinutes === 1440 && def.windowMinutes === 60);
    const up = await svc.updateConfig(T, { enabled: true, leadMinutes: 120 });
    check('update persists', up.enabled === true && up.leadMinutes === 120);
    check('reflected in getConfig', (await svc.getConfig(T)).leadMinutes === 120);
    await throwsAsync('rejects bad leadMinutes', () => svc.updateConfig(T, { leadMinutes: 99999 }), ValidationError);
    await throwsAsync('rejects bad windowMinutes', () => svc.updateConfig(T, { windowMinutes: 1 }), ValidationError);
    check('enabling adds tenant to job list', (await repo.listEnabledTenants()).some((c) => c.tenantId === T));
    const ch = await svc.updateConfig(T, { channel: 'email' });
    check('channel update persists', ch.channel === 'email');
    await throwsAsync('rejects bad channel', () => svc.updateConfig(T, { channel: 'fax' as any }), ValidationError);
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
