import { appendFileSync } from 'node:fs';
import { instrumentedFetch } from '@aipowersalon/observability';
// email.service.ts — Email port + SendGrid impl (direct REST, no npm dep) + Mock for pilot/tests.
//
// Email guide (Oct 31 2026, P0): the send path hands the provider the BRANDED HTML layout, but this adapter declared it
// `text/plain` — a customer would have read raw tags. HTML bodies now go as text/html WITH a plain-text alternative; the
// salon's display name and reply-to ride beside the platform's verified from-address (never a spoofed address), and
// extra headers carry List-Unsubscribe for marketing mail. `verify()` is the provider's own credential check (health).
export interface EmailSendOptions {
  /** display name shown as "From" (the salon) — the address itself stays the verified sender */
  fromName?: string;
  replyTo?: string;
  /** plain-text alternative; derived from the HTML when missing */
  text?: string;
  headers?: Record<string, string>;
}
export interface EmailVerifyResult { status: 'healthy' | 'auth_failed' | 'down'; detail: string; httpStatus?: number }
export interface EmailSender {
  send(to: string, subject: string, body: string, opts?: EmailSendOptions): Promise<{ id: string }>;
  /** the provider's own credential / reachability check — never a send */
  verify?(): Promise<EmailVerifyResult>;
}
const looksHtml = (s: string) => /^\s*(<!doctype html|<html[\s>])/i.test(s);
/** a readable plain-text version of an HTML body (the alternative part) — tags dropped, entities decoded */
export function htmlToText(html: string): string {
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|tr|h\d|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** a display name that can never smuggle an address or a header (no CR/LF, no <>, no quotes) */
export function safeDisplayName(name: string | null | undefined): string | undefined {
  const v = String(name ?? '').replace(/[\r\n<>"@]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return v || undefined;
}
export class SendGridEmailSender implements EmailSender {
  constructor(private cfg: { apiKey: string; from: string }, private http: typeof fetch = instrumentedFetch('email', fetch) as typeof fetch) {}
  /** the exact SendGrid v3 request body (exported shape for tests — no network) */
  static payload(from: string, to: string, subject: string, body: string, opts: EmailSendOptions = {}): Record<string, unknown> {
    const html = looksHtml(body);
    const text = opts.text ?? (html ? htmlToText(body) : body);
    const name = safeDisplayName(opts.fromName);
    const headers = opts.headers && Object.keys(opts.headers).length ? Object.fromEntries(Object.entries(opts.headers).map(([k, v]) => [k, String(v).replace(/[\r\n]/g, ' ')])) : undefined;
    return {
      personalizations: [{ to: [{ email: to }], ...(headers ? { headers } : {}) }],
      from: name ? { email: from, name } : { email: from },
      ...(opts.replyTo ? { reply_to: { email: opts.replyTo } } : {}),
      subject: String(subject).replace(/[\r\n]/g, ' '),
      content: html ? [{ type: 'text/plain', value: text }, { type: 'text/html', value: body }] : [{ type: 'text/plain', value: text }],
    };
  }
  async send(to: string, subject: string, body: string, opts: EmailSendOptions = {}): Promise<{ id: string }> {
    const res = await this.http("https://api.sendgrid.com/v3/mail/send", { method: "POST",
      headers: { Authorization: "Bearer " + this.cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(SendGridEmailSender.payload(this.cfg.from, to, subject, body, opts)) });
    if (!res.ok) throw new Error("email_failed:" + res.status);
    return { id: res.headers.get("x-message-id") || "SG" };
  }
  /** GET /v3/scopes — the key's own permissions; 401/403 = the key is wrong, 5xx / network = the provider is down */
  async verify(): Promise<EmailVerifyResult> {
    try {
      const res = await this.http("https://api.sendgrid.com/v3/scopes", { method: "GET", headers: { Authorization: "Bearer " + this.cfg.apiKey } });
      if (res.ok) {
        const j: any = await res.json().catch(() => ({}));
        const scopes: string[] = Array.isArray(j?.scopes) ? j.scopes : [];
        return scopes.length && !scopes.includes('mail.send') ? { status: 'auth_failed', detail: 'The API key cannot send mail (missing mail.send).', httpStatus: res.status } : { status: 'healthy', detail: 'The provider accepted the API key.', httpStatus: res.status };
      }
      if (res.status === 401 || res.status === 403) return { status: 'auth_failed', detail: 'The provider rejected the API key.', httpStatus: res.status };
      return { status: 'down', detail: `The provider answered ${res.status}.`, httpStatus: res.status };
    } catch { return { status: 'down', detail: 'The provider could not be reached.' }; }
  }
}
export class MockEmailSender implements EmailSender {
  public sent: { to: string; subject: string; body: string; opts?: EmailSendOptions }[] = [];
  /** tests / the harness drive the credential check (never a network call) */
  public verifyResult: EmailVerifyResult = { status: 'healthy', detail: 'Test sender (no provider).' };
  async send(to: string, subject: string, body: string, opts?: EmailSendOptions) { this.sent.push({ to, subject, body, opts }); mockOutbox({ channel: 'email', to, subject, body }); return { id: "EM-MOCK-" + this.sent.length }; }
  async verify(): Promise<EmailVerifyResult> { return this.verifyResult; }
}

/** Proof-only outbox (Security Deep Scan C2, Oct 23 2026): a credential now reaches ONLY the account holder, so a live proof
 *  (the pilot day) reads the mock "inbox" the way the owner reads her e-mail. Inert unless MOCK_OUTBOX_FILE is set, and
 *  NEVER in production (mock senders are refused there anyway — sender-selection.ts). One JSON line per message. */
export function mockOutbox(msg: { channel: 'email' | 'sms'; to: string; subject?: string; body: string }, env: NodeJS.ProcessEnv = process.env): void {
  const file = String(env.MOCK_OUTBOX_FILE ?? '').trim();
  if (!file || env.NODE_ENV === 'production') return;
  try { appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...msg }) + '\n'); }
  catch (e) { console.warn(`mock outbox: could not append (${(e as Error)?.message ?? e})`); }   // a proof aid only — the send itself already succeeded
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
