import { describe, it, expect } from 'vitest';
import { ApplicationConfirmationSender, APPLICATION_CONFIRMATION_TEMPLATES, renderTemplate } from './application-confirmation';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo } from './super-admin-platform.repository';

// Comms phase of the intake spec: templated applicant confirmations. Pinned here: templates never promise approval
// or free hardware; SMS is consent-gated; providers-missing and provider-failure paths are honest and never throw
// into the intake flow; the idempotent replay never re-sends.
const app = (over: any = {}) => ({
  owner_first_name: 'Linda', owner_name: 'Linda Pham', salon_name: 'Lotus Nail Bar',
  email: 'linda@lotus.com', phone: '609-555-0188', consent_given: true, reference_number: 'APS-AB12-CD34', ...over,
});

describe('confirmation templates', () => {
  it('render with the reference and NEVER promise approval or hardware', () => {
    const vars = { firstName: 'Linda', salonName: 'Lotus Nail Bar', reference: 'APS-AB12-CD34' };
    const subject = renderTemplate(APPLICATION_CONFIRMATION_TEMPLATES.email.subject, vars);
    const body = renderTemplate(APPLICATION_CONFIRMATION_TEMPLATES.email.body, vars);
    const smsBody = renderTemplate(APPLICATION_CONFIRMATION_TEMPLATES.sms.body, vars);
    expect(subject).toContain('APS-AB12-CD34');
    for (const text of [body, smsBody]) {
      expect(text).toContain('APS-AB12-CD34');
      expect(text.toLowerCase()).toContain('subject to approval');
      expect(text.toLowerCase()).not.toMatch(/you are approved|guaranteed|free imac/);
    }
    expect(body).toContain('does not guarantee acceptance');
  });
});

describe('ApplicationConfirmationSender', () => {
  it('sends email + SMS (consent recorded) with rendered content; E.164-normalizes the phone', async () => {
    const emails: any[] = []; const sms: any[] = [];
    const s = new ApplicationConfirmationSender({
      email: { send: async (to, subject, body) => { emails.push({ to, subject, body }); return { id: 'em1' }; } },
      sms: { send: async (to, body) => { sms.push({ to, body }); return { sid: 'sm1' }; } },
    });
    await s.sendConfirmation(app());
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('linda@lotus.com');
    expect(emails[0].subject).toContain('APS-AB12-CD34');
    expect(emails[0].body).toContain('Lotus Nail Bar');
    expect(sms).toHaveLength(1);
    expect(sms[0].to).toBe('+16095550188');
    expect(sms[0].body).toContain('APS-AB12-CD34');
  });

  it('never sends SMS without recorded consent', async () => {
    const sms: any[] = [];
    const s = new ApplicationConfirmationSender({ email: null, sms: { send: async (to, body) => { sms.push({ to, body }); return { sid: 'x' }; } } });
    await s.sendConfirmation(app({ consent_given: false }));
    expect(sms).toHaveLength(0);
  });

  it('is honest and non-throwing when providers are missing or failing', async () => {
    const bare = new ApplicationConfirmationSender({});
    await expect(bare.sendConfirmation(app())).resolves.toBeUndefined(); // skipped, no throw
    const failing = new ApplicationConfirmationSender({
      email: { send: async () => { throw new Error('sendgrid down'); } },
      sms: { send: async (to, body) => ({ sid: 'ok' }) },
    });
    await expect(failing.sendConfirmation(app())).resolves.toBeUndefined(); // email failure doesn't stop SMS or throw
  });

  it('intake triggers exactly one confirmation per FRESH submission — idempotent replay does not re-send', async () => {
    const sent: any[] = [];
    const repo = new InMemorySuperAdminPlatformRepo();
    const svc = new SuperAdminPlatformService(repo as any, undefined, undefined, { sendConfirmation: async (a: any) => { sent.push(a.reference_number); } });
    const input = { owner_first_name: 'Linda', owner_last_name: 'Pham', salon_name: 'Lotus Nail Bar', phone: '609-555-0188', email: 'linda@lotus.com', sms_email_consent: true, idempotency_key: 'k1' };
    const first = await svc.publicCreateApplication(input, '8.8.8.1');
    await svc.publicCreateApplication(input, '8.8.8.1');
    await new Promise((r) => setTimeout(r, 0)); // flush the fire-and-forget
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(first.reference);
  });
});
