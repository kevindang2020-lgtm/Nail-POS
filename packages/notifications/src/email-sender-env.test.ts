// email-sender-env.test.ts — one factory builds the email sender from the environment (Oct 4 2026).
import { describe, it, expect } from 'vitest';
import { emailSenderFromEnv, emailFromAddress, DEFAULT_EMAIL_FROM, SendGridEmailSender } from './email.service';
describe('emailSenderFromEnv', () => {
  it('the platform sends from nailsalons@aipowersalon.com unless SENDGRID_FROM says otherwise', () => {
    expect(DEFAULT_EMAIL_FROM).toBe('nailsalons@aipowersalon.com');
    expect(emailFromAddress({})).toBe('nailsalons@aipowersalon.com');
    expect(emailFromAddress({ SENDGRID_FROM: '  ' })).toBe('nailsalons@aipowersalon.com');
    expect(emailFromAddress({ SENDGRID_FROM: 'alerts@aipowersalon.com' })).toBe('alerts@aipowersalon.com');
  });
  it('the API key alone makes email live; without it there is no sender (callers mock or skip)', async () => {
    expect(emailSenderFromEnv({})).toBeNull();
    const s = emailSenderFromEnv({ SENDGRID_API_KEY: 'SG.test' })!;
    expect(s).toBeInstanceOf(SendGridEmailSender);
    let sent: any; const probe = new SendGridEmailSender({ apiKey: 'SG.test', from: emailFromAddress({}) }, (async (_u: string, init: any) => { sent = JSON.parse(init.body); return new Response('', { status: 202 }); }) as any);
    await probe.send('owner@salon.test', 'Hi', 'Body');
    expect(sent.from.email).toBe('nailsalons@aipowersalon.com');
  });
});
