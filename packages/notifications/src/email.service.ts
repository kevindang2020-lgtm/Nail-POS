import { instrumentedFetch } from '@aipowersalon/observability';
// email.service.ts — Email port + SendGrid impl (direct REST, no npm dep) + Mock for pilot/tests.
export interface EmailSender { send(to: string, subject: string, body: string): Promise<{ id: string }>; }
export class SendGridEmailSender implements EmailSender {
  constructor(private cfg: { apiKey: string; from: string }, private http: typeof fetch = instrumentedFetch('email', fetch) as typeof fetch) {}
  async send(to: string, subject: string, body: string): Promise<{ id: string }> {
    const res = await this.http("https://api.sendgrid.com/v3/mail/send", { method: "POST",
      headers: { Authorization: "Bearer " + this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: this.cfg.from }, subject, content: [{ type: "text/plain", value: body }] }) });
    if (!res.ok) throw new Error("email_failed:" + res.status);
    return { id: res.headers.get("x-message-id") || "SG" };
  }
}
export class MockEmailSender implements EmailSender {
  public sent: { to: string; subject: string; body: string }[] = [];
  async send(to: string, subject: string, body: string) { this.sent.push({ to, subject, body }); return { id: "EM-MOCK-" + this.sent.length }; }
}

/** The platform's sending address (Kevin, Oct 4 2026). SENDGRID_FROM overrides it per environment. */
export const DEFAULT_EMAIL_FROM = 'nailsalons@aipowersalon.com';
export function emailFromAddress(env: NodeJS.ProcessEnv = process.env): string { return String(env.SENDGRID_FROM ?? '').trim() || DEFAULT_EMAIL_FROM; }
/** The ONE place a real email sender is built from the environment: SendGrid when SENDGRID_API_KEY is set, else null
 *  (callers fall back to their own mock / skip). It replaced eight copies that each required SENDGRID_FROM as well. */
export function emailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): SendGridEmailSender | null {
  const key = String(env.SENDGRID_API_KEY ?? '').trim();
  return key ? new SendGridEmailSender({ apiKey: key, from: emailFromAddress(env) }) : null;
}
