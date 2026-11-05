// customer-activation.service.vitest.spec.ts — proves the activation security rules end to end.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerActivationService, InMemoryTicketStore, ActivationError, type SmsSender } from './customer-activation.service';
import { InMemoryActivationRepo } from './customer-activation.repository';
import type { DirectoryMatch } from '@aipowersalon/customers';

const PHONE = '(856) 555-1234';
const E164 = '+18565551234';

const match = (id: string, tenant: string, name: string): DirectoryMatch =>
  ({ customerId: id, tenantId: tenant, branchId: 'b1', salonName: name });

let repo: InMemoryActivationRepo;
let sent: { to: string; body: string }[];
let sms: SmsSender;
let audit: { record: any; entries: any[] };
let svc: CustomerActivationService;

beforeEach(() => {
  repo = new InMemoryActivationRepo();
  sent = [];
  sms = { async sendSms(req) { sent.push({ to: req.to, body: req.body }); return { sent: true, status: 'sent' }; } };
  audit = { entries: [], record: vi.fn(async (action: string, meta: any) => { audit.entries.push({ action, meta }); }) };
  svc = new CustomerActivationService(repo, sms, new InMemoryTicketStore(), audit as any);
});

/** Pull the code out of the SMS we captured — the ONLY place it should ever appear. */
const codeFromSms = () => (sent[sent.length - 1].body.match(/\b(\d{6})\b/) as RegExpMatchArray)[1];

describe('request code — enumeration safety', () => {
  it('an UNKNOWN phone still gets a code and the SAME generic response', async () => {
    repo.matches = [];                                  // nobody by this number
    const r = await svc.requestCode({ phone: PHONE });
    expect(r.message).toMatch(/if this phone number is eligible/i);
    expect(sent).toHaveLength(1);                       // a code IS sent — otherwise silence would be the tell
  });

  it('a KNOWN phone gets an identical response — the two are indistinguishable', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    const known = await svc.requestCode({ phone: PHONE });

    const repo2 = new InMemoryActivationRepo();
    const svc2 = new CustomerActivationService(repo2, sms, new InMemoryTicketStore());
    const unknown = await svc2.requestCode({ phone: PHONE });

    expect(known.message).toBe(unknown.message);
    expect(known.maskedPhone).toBe(unknown.maskedPhone);
  });

  it('the response and audit NEVER contain the code', async () => {
    const r = await svc.requestCode({ phone: PHONE });
    const code = codeFromSms();
    expect(JSON.stringify(r)).not.toContain(code);
    expect(JSON.stringify(audit.entries)).not.toContain(code);
  });

  it('only the masked phone is echoed back — never the full number', async () => {
    const r = await svc.requestCode({ phone: PHONE });
    expect(r.maskedPhone).toBe('••••1234');
    expect(JSON.stringify(r)).not.toContain('8565551234');
  });

  it('the stored code is HASHED, never plaintext', async () => {
    await svc.requestCode({ phone: PHONE });
    const code = codeFromSms();
    const stored = await repo.latestCode(E164);
    expect(stored!.codeHash).not.toBe(code);
    expect(stored!.codeHash).not.toContain(code);
  });

  it('rejects an invalid phone before doing anything', async () => {
    await expect(svc.requestCode({ phone: '123' })).rejects.toBeInstanceOf(ActivationError);
    expect(sent).toHaveLength(0);
  });

  it('SMS failure is reported honestly — it never claims a code was delivered', async () => {
    const failing: SmsSender = { async sendSms() { throw new Error('twilio down'); } };
    const s = new CustomerActivationService(repo, failing, new InMemoryTicketStore());
    await expect(s.requestCode({ phone: PHONE })).rejects.toMatchObject({
      code: 'sms_unavailable',
      extra: { message: expect.stringMatching(/could not send a verification code/i) },
    });
  });

  it('a resend is refused during the cooldown', async () => {
    await svc.requestCode({ phone: PHONE });
    await expect(svc.requestCode({ phone: PHONE })).rejects.toMatchObject({ code: 'resend_cooldown' });
    expect(sent).toHaveLength(1);                       // no second SMS — no pumping, no spraying a victim
  });
});

describe('verify code', () => {
  it('the correct code activates a single-salon customer', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: codeFromSms() });
    expect(r.outcome).toBe('SUCCESS');
    if (r.outcome === 'SUCCESS') expect(r.tenantId).toBe('t1');
  });

  it('a WRONG code fails and burns an attempt', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: '000000' });
    expect(r.outcome).toBe('FAILED');
    expect((await repo.latestCode(E164))!.attempts).toBe(1);
  });

  it('REPLAY: the same correct code cannot be used twice', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    await svc.requestCode({ phone: PHONE });
    const code = codeFromSms();
    expect((await svc.verifyCode({ phone: PHONE, code })).outcome).toBe('SUCCESS');
    const again = await svc.verifyCode({ phone: PHONE, code });
    expect(again.outcome).toBe('FAILED');               // consumed
  });

  it('a code is invalidated by issuing a new one', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    await svc.requestCode({ phone: PHONE });
    const oldCode = codeFromSms();
    // force past the cooldown
    repo.codes.forEach((c) => { c.createdAt = Date.now() - 120_000; });
    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: oldCode });
    expect(r.outcome).toBe('FAILED');                   // the old code no longer works
  });

  it('no customer data is returned on a FAILED verification', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: '000000' });
    expect(JSON.stringify(r)).not.toContain('c1');
    expect(JSON.stringify(r)).not.toContain('t1');
    expect(JSON.stringify(r)).not.toContain('Polished');
  });
});

describe('multi-salon resolution — never guess, never merge', () => {
  beforeEach(() => {
    repo.matches = [match('c1', 't1', 'Polished'), match('c2', 't2', 'Luxe Nails')];
  });

  it('several salons → the CUSTOMER chooses; no salon is picked for them', async () => {
    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: codeFromSms() });
    expect(r.outcome).toBe('SALON_SELECTION_REQUIRED');
    if (r.outcome === 'SALON_SELECTION_REQUIRED') {
      expect(r.choices.map((c) => c.salonName)).toEqual(['Polished', 'Luxe Nails']);
      // the choice list leaks NOTHING beyond a display name
      expect(JSON.stringify(r.choices)).not.toContain('t1');
      expect(JSON.stringify(r.choices)).not.toContain('c1');
    }
  });

  it('selecting a salon activates only THAT tenant', async () => {
    await svc.requestCode({ phone: PHONE });
    const v = await svc.verifyCode({ phone: PHONE, code: codeFromSms() });
    if (v.outcome !== 'SALON_SELECTION_REQUIRED') throw new Error('expected choice');
    const r = await svc.selectSalon({ ticket: v.ticket, choiceId: '1' });
    expect(r.outcome).toBe('SUCCESS');
    if (r.outcome === 'SUCCESS') expect(r.tenantId).toBe('t2');    // the one they picked
  });

  it('the ticket is SINGLE USE — it cannot be replayed to link a second salon', async () => {
    await svc.requestCode({ phone: PHONE });
    const v = await svc.verifyCode({ phone: PHONE, code: codeFromSms() });
    if (v.outcome !== 'SALON_SELECTION_REQUIRED') throw new Error('expected choice');
    await svc.selectSalon({ ticket: v.ticket, choiceId: '0' });
    const again = await svc.selectSalon({ ticket: v.ticket, choiceId: '1' });
    expect(again.outcome).toBe('FAILED');
  });

  it('a FORGED ticket is refused — the salon step cannot be reached without verifying', async () => {
    const r = await svc.selectSalon({ ticket: 'made-up-ticket', choiceId: '0' });
    expect(r.outcome).toBe('FAILED');
  });
});

describe('no duplicate customer profiles', () => {
  it('an existing app account is REUSED, never duplicated', async () => {
    repo.matches = [match('c1', 't1', 'Polished')];
    repo.accounts.set(`t1:${E164}`, 'existing-user');

    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: codeFromSms() });
    expect(r.outcome).toBe('SUCCESS');
    if (r.outcome === 'SUCCESS') expect(r.userId).toBe('existing-user');
    expect(repo.accounts.size).toBe(1);                 // nothing new created
  });

  it('a verified phone with NO salon profile does NOT create a customer under any tenant', async () => {
    repo.matches = [];
    await svc.requestCode({ phone: PHONE });
    const r = await svc.verifyCode({ phone: PHONE, code: codeFromSms() });
    expect(r.outcome).toBe('NEW_CUSTOMER');             // onboarding, not a fabricated salon profile
    expect(repo.accounts.size).toBe(0);
    expect(repo.verified).toHaveLength(0);
  });
});

describe('source throttle — a caller walking a LIST of numbers', () => {
  it('the per-phone cooldown alone would NOT stop them (each number is fresh)', async () => {
    // no per-source limit hit yet
    repo.counts = { ipLastHour: 0, deviceLastHour: 0 };
    await svc.requestCode({ phone: '856-555-0001', ip: '9.9.9.9', deviceId: 'd1' });
    await svc.requestCode({ phone: '856-555-0002', ip: '9.9.9.9', deviceId: 'd1' });
    expect(sent).toHaveLength(2);          // different numbers → cooldown never triggers
  });

  it('the SOURCE limit stops them once the device has burned its hourly quota', async () => {
    repo.counts = { ipLastHour: 0, deviceLastHour: 5 };   // MAX_CODES_PER_DEVICE_HOUR
    await expect(svc.requestCode({ phone: '856-555-0003', ip: '9.9.9.9', deviceId: 'd1' }))
      .rejects.toMatchObject({ code: 'too_many_requests' });
    expect(sent).toHaveLength(0);          // no SMS sent — no cost, no text blasted at a stranger
  });

  it('the IP limit also stops them', async () => {
    repo.counts = { ipLastHour: 10, deviceLastHour: 0 };  // MAX_CODES_PER_IP_HOUR
    await expect(svc.requestCode({ phone: '856-555-0004', ip: '9.9.9.9', deviceId: 'd2' }))
      .rejects.toMatchObject({ code: 'too_many_requests' });
  });

  it('the refusal says nothing about which limit was hit, or about the number', async () => {
    repo.counts = { ipLastHour: 99, deviceLastHour: 99 };
    const e: any = await svc.requestCode({ phone: '856-555-0005', ip: '1.1.1.1', deviceId: 'd3' }).catch((x) => x);
    expect(e.extra.message).toMatch(/too many attempts/i);
    expect(e.extra.message).not.toMatch(/ip|device|phone|number/i);
  });
});
