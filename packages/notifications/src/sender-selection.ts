// sender-selection.ts — P-11 (wave 4 pilot): the ONE place an SMS / e-mail sender is chosen from the environment.
//   provider configured            → the real provider (Twilio / SendGrid), in every environment
//   production, no provider         → the NOT-CONFIGURED sender: every send is refused with `not_configured`, so nothing
//                                     is recorded as sent and nothing is metered. A mock is NEVER selected in production.
//   development / test, no provider → the in-memory mock; callers label what it "sends" as simulated and never meter it
//   MESSAGING_MOCK_SENDERS=1         → force the mock outside production (even with a provider); in production it is a
//                                     startup refusal (messagingProductionProblems) and the factories ignore it.
import { MockSmsSender, TwilioSmsSender, type SmsSender } from './sms.service';
import { MockEmailSender, emailSenderFromEnv, type EmailSender } from './email.service';

type Env = Record<string, string | undefined>;

export const isProductionRuntime = (env: Env = process.env): boolean => String(env.NODE_ENV ?? '').trim() === 'production';
export const mockSendersForced = (env: Env = process.env): boolean => ['1', 'true', 'yes', 'on'].includes(String(env.MESSAGING_MOCK_SENDERS ?? '').trim().toLowerCase());

/** A send on a channel with no provider in production. Its message is the reason code the ledger records. */
export class MessagingNotConfiguredError extends Error {
  readonly reason = 'not_configured' as const;
  constructor(readonly channel: 'sms' | 'email') { super('not_configured'); this.name = 'MessagingNotConfiguredError'; }
}
export class NotConfiguredSmsSender implements SmsSender {
  readonly notConfigured = true as const;
  async send(): Promise<{ sid: string }> { throw new MessagingNotConfiguredError('sms'); }
}
export class NotConfiguredEmailSender implements EmailSender {
  readonly notConfigured = true as const;
  async send(): Promise<{ id: string }> { throw new MessagingNotConfiguredError('email'); }
}

export function smsSenderFromEnv(env: Env = process.env): SmsSender {
  const prod = isProductionRuntime(env);
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = env;
  if ((prod || !mockSendersForced(env)) && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM) {
    return new TwilioSmsSender({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_FROM });
  }
  return prod ? new NotConfiguredSmsSender() : new MockSmsSender();
}

export function messagingEmailSenderFromEnv(env: Env = process.env): EmailSender {
  const prod = isProductionRuntime(env);
  const real = prod || !mockSendersForced(env) ? emailSenderFromEnv(env as NodeJS.ProcessEnv) : null;
  if (real) return real;
  return prod ? new NotConfiguredEmailSender() : new MockEmailSender();
}

/** The in-memory stand-in (development / test): what it "sends" never leaves the process. */
export const isSimulatedSender = (s: unknown): boolean => s instanceof MockSmsSender || s instanceof MockEmailSender;
export const isNotConfiguredSender = (s: unknown): boolean => s instanceof NotConfiguredSmsSender || s instanceof NotConfiguredEmailSender;
/** True only for a sender that really hands the message to a provider. */
export const senderDelivers = (s: unknown): boolean => !!s && !isSimulatedSender(s) && !isNotConfiguredSender(s);

/** Startup refusal reasons (production only): a forced mock sender. */
export function messagingProductionProblems(env: Env = process.env): string[] {
  if (!isProductionRuntime(env) || !mockSendersForced(env)) return [];
  return ['MESSAGING_MOCK_SENDERS forces the mock SMS / e-mail senders (MockSmsSender, MockEmailSender) — production never sends through a mock sender (texts and e-mails would be recorded as sent while nothing leaves); unset it and configure Twilio / SendGrid, or leave the channel not configured'];
}
