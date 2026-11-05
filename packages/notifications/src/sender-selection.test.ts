// sender-selection.test.ts — P-11 (wave 4 pilot): a mock sender is never selected in production. An unconfigured
// channel is "not configured" there (the send is refused, never recorded as sent); outside production the mock stays,
// marked as simulated; forcing the mock in production is a startup refusal.
import { describe, it, expect } from 'vitest';
import {
  smsSenderFromEnv, messagingEmailSenderFromEnv, NotConfiguredSmsSender, NotConfiguredEmailSender, MessagingNotConfiguredError,
  isSimulatedSender, isNotConfiguredSender, senderDelivers, messagingProductionProblems,
} from './sender-selection';
import { MockSmsSender, TwilioSmsSender } from './sms.service';
import { MockEmailSender, SendGridEmailSender } from './email.service';

const twilio = { TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000', TWILIO_AUTH_TOKEN: 'x', TWILIO_FROM: '+15550000000' };

describe('sender selection (P-11)', () => {
  it('production without a provider: the not-configured sender, never a mock', async () => {
    const sms = smsSenderFromEnv({ NODE_ENV: 'production' });
    const email = messagingEmailSenderFromEnv({ NODE_ENV: 'production' });
    expect(sms).toBeInstanceOf(NotConfiguredSmsSender);
    expect(email).toBeInstanceOf(NotConfiguredEmailSender);
    expect(isSimulatedSender(sms)).toBe(false);
    expect(isNotConfiguredSender(sms) && isNotConfiguredSender(email)).toBe(true);
    expect(senderDelivers(sms)).toBe(false);
    await expect(sms.send('+15551234567', 'hi')).rejects.toBeInstanceOf(MessagingNotConfiguredError);
    await expect(email.send('a@b.test', 's', 'b')).rejects.toThrow('not_configured');
  });
  it('production never takes the mock even when it is forced (and the forcing is a startup refusal)', () => {
    const env = { NODE_ENV: 'production', MESSAGING_MOCK_SENDERS: '1' };
    expect(smsSenderFromEnv(env)).toBeInstanceOf(NotConfiguredSmsSender);
    expect(messagingEmailSenderFromEnv(env)).toBeInstanceOf(NotConfiguredEmailSender);
    const problems = messagingProductionProblems(env);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/MockSmsSender/);
    expect(problems[0]).toMatch(/MockEmailSender/);
    expect(messagingProductionProblems({ NODE_ENV: 'development', MESSAGING_MOCK_SENDERS: '1' })).toEqual([]);
    expect(messagingProductionProblems({ NODE_ENV: 'production' })).toEqual([]);
  });
  it('a configured provider is used in every environment', () => {
    expect(smsSenderFromEnv({ NODE_ENV: 'production', ...twilio })).toBeInstanceOf(TwilioSmsSender);
    expect(messagingEmailSenderFromEnv({ NODE_ENV: 'production', SENDGRID_API_KEY: 'SG.x' })).toBeInstanceOf(SendGridEmailSender);
    expect(senderDelivers(smsSenderFromEnv({ NODE_ENV: 'production', ...twilio }))).toBe(true);
  });
  it('outside production the mock stays and is marked simulated (forcing it wins over a configured provider)', () => {
    const sms = smsSenderFromEnv({ NODE_ENV: 'development' });
    expect(sms).toBeInstanceOf(MockSmsSender);
    expect(isSimulatedSender(sms)).toBe(true);
    expect(senderDelivers(sms)).toBe(false);
    expect(messagingEmailSenderFromEnv({})).toBeInstanceOf(MockEmailSender);
    expect(smsSenderFromEnv({ NODE_ENV: 'test', MESSAGING_MOCK_SENDERS: 'true', ...twilio })).toBeInstanceOf(MockSmsSender);
  });
});
