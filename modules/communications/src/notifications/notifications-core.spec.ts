/**
 * notifications-core.spec.ts — validation + channel→credit mapping (pure), plus the service send path with
 * mock senders and a capacity-aware meter (send meters a credit, over-capacity blocks without sending,
 * provider failure does not charge).
 */
import { MockSmsSender, MockEmailSender } from '@aipowersalon/notifications';
import { validateSendRequest, creditMetricForChannel, resolveSubject, parseInboundKeyword } from './notifications-core';
import { InMemoryNotificationsRepository } from './notifications.repository';
import { InMemoryOptOutRepository } from './notifications.optout.repository';
import { NotificationsService, ValidationError, ForbiddenError } from './notifications.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, ctor: any) { try { await fn(); check(name, false); } catch (e: any) { check(name, e instanceof ctor); } }

const ctx = (over: any = {}) => ({ tenantId: 'luxe001', userId: 'u_owner', role: 'OWNER', salonName: 'Luxe Nails', ...over });

// capacity meter stub: configurable capacity + records adjusts
class StubMeter {
  public adjusts: { metric: string; delta: number }[] = [];
  constructor(private capacity: boolean) {}
  async hasCapacity() { return this.capacity; }
  async adjust(_t: string, metric: string, delta: number) { this.adjusts.push({ metric, delta }); }
}

async function main(): Promise<void> {
  console.log('\n== validation (pure) ==');
  check('valid sms', validateSendRequest({ channel: 'sms', to: '+15551234567', body: 'Hi' }).ok);
  check('valid email', validateSendRequest({ channel: 'email', to: 'a@b.com', body: 'Hi' }).ok);
  check('bad channel rejected', !validateSendRequest({ channel: 'fax' as any, to: 'x', body: 'y' }).ok);
  check('bad sms number rejected', !validateSendRequest({ channel: 'sms', to: '5551234', body: 'y' }).ok);
  check('bad email rejected', !validateSendRequest({ channel: 'email', to: 'not-an-email', body: 'y' }).ok);
  check('empty body rejected', !validateSendRequest({ channel: 'sms', to: '+15551234567', body: '  ' }).ok);
  check('credit metric mapping', creditMetricForChannel('sms') === 'sms_credits' && creditMetricForChannel('email') === 'email_credits');
  check('subject default', resolveSubject({ channel: 'email', to: 'a@b.com', body: 'x' }, 'Luxe Nails') === 'A message from Luxe Nails');

  console.log('\n== service send path ==');
  // provider stand-ins (the Mock senders are SIMULATED — never metered, P-11 — so a real handoff is faked here)
  class FakeSms { sent: { to: string; body: string }[] = []; async send(to: string, body: string) { this.sent.push({ to, body }); return { sid: 'SM-F-' + this.sent.length }; } }
  class FakeEmail { sent: { to: string }[] = []; async send(to: string) { this.sent.push({ to }); return { id: 'EM-F-' + this.sent.length }; } }
  const sms = new FakeSms();
  const email = new FakeEmail();
  const meter = new StubMeter(true);
  const svc = new NotificationsService(new InMemoryNotificationsRepository(), sms, email, meter);

  const r1 = await svc.send(ctx(), { channel: 'sms', to: '+15551234567', body: 'Your appointment is confirmed.' });
  check('sms sent', r1.sent === true && r1.status === 'sent' && !!r1.providerId);
  check('sms actually handed to provider', sms.sent.length === 1 && sms.sent[0].to === '+15551234567');
  check('sms charged one credit', meter.adjusts.length === 1 && meter.adjusts[0].metric === 'sms_credits' && meter.adjusts[0].delta === 1);

  const r2 = await svc.send(ctx(), { channel: 'email', to: 'guest@example.com', subject: 'See you soon', body: 'Reminder' });
  check('email sent + charged', r2.sent === true && email.sent.length === 1 && meter.adjusts.some((a) => a.metric === 'email_credits'));

  console.log('\n== capacity gate (no credits) ==');
  const blocked = new NotificationsService(new InMemoryNotificationsRepository(), new MockSmsSender(), new MockEmailSender(), new StubMeter(false));
  const r3 = await blocked.send(ctx(), { channel: 'sms', to: '+15551234567', body: 'Hi' });
  check('blocked when no credits', r3.sent === false && r3.status === 'blocked' && r3.reason === 'over_limit');

  console.log('\n== provider failure does not charge ==');
  class FailingSms { sent: any[] = []; async send() { throw new Error('sms_failed:21610'); } }
  const failMeter = new StubMeter(true);
  const failSvc = new NotificationsService(new InMemoryNotificationsRepository(), new FailingSms() as any, new MockEmailSender(), failMeter);
  const r4 = await failSvc.send(ctx(), { channel: 'sms', to: '+15551234567', body: 'Hi' });
  check('failed send reported', r4.sent === false && r4.status === 'failed');
  check('failed send not charged', failMeter.adjusts.length === 0);

  console.log('\n== auth + validation guards ==');
  await throwsAsync('customer role forbidden', () => svc.send(ctx({ role: 'CUSTOMER' }), { channel: 'sms', to: '+15551234567', body: 'Hi' }), ForbiddenError);
  await throwsAsync('invalid input throws', () => svc.send(ctx(), { channel: 'sms', to: 'bad', body: 'Hi' }), ValidationError);

  console.log('\n== recent log ==');
  const recent = await svc.recent(ctx(), 10);
  check('recent returns logged sends', recent.items.length >= 2 && recent.items.every((i) => i.tenantId === 'luxe001'));

  console.log('\n== opt-out enforcement ==');
  const optOut = new InMemoryOptOutRepository();
  const optMeter = new StubMeter(true);
  const optSms = new FakeSms();
  const svcO = new NotificationsService(new InMemoryNotificationsRepository(), optSms, new FakeEmail(), optMeter, optOut);
  await svcO.recordOptOut(ctx(), 'sms', '+15550001111', 'customer requested');
  const blockedSend = await svcO.send(ctx(), { channel: 'sms', to: '+15550001111', body: 'Promo!' });
  check('opted-out recipient blocked', blockedSend.sent === false && blockedSend.reason === 'opted_out');
  check('opted-out send not handed to provider', optSms.sent.length === 0);
  check('opted-out send not charged', optMeter.adjusts.length === 0);
  // a different number still sends
  const okSend = await svcO.send(ctx(), { channel: 'sms', to: '+15559998888', body: 'Confirmed' });
  check('non-opted-out still sends', okSend.sent === true);
  // opt back in restores delivery
  await svcO.recordOptIn(ctx(), 'sms', '+15550001111');
  const afterOptIn = await svcO.send(ctx(), { channel: 'sms', to: '+15550001111', body: 'Welcome back' });
  check('opt-in restores delivery', afterOptIn.sent === true);
  const list = await svcO.optOuts(ctx());
  check('opt-out list empty after opt-in', list.items.length === 0);
  // email opt-out is case-insensitive
  await svcO.recordOptOut(ctx(), 'email', 'Guest@Example.com');
  const emailBlocked = await svcO.send(ctx(), { channel: 'email', to: 'guest@example.com', body: 'Hi' });
  check('email opt-out case-insensitive', emailBlocked.reason === 'opted_out');

  console.log('\n== inbound keyword parsing (pure) ==');
  check('STOP detected', parseInboundKeyword('STOP') === 'stop' && parseInboundKeyword('unsubscribe') === 'stop');
  check('START detected', parseInboundKeyword('start') === 'start' && parseInboundKeyword('UNSTOP') === 'start');
  check('HELP detected', parseInboundKeyword('help') === 'help');
  check('other text -> null', parseInboundKeyword('what time are you open') === null);

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
