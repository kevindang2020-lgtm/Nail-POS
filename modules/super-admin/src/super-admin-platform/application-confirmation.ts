// application-confirmation.ts — applicant-facing confirmations for the Free POS Package intake (spec: comms phase).
// Templates live here as named, versioned constants (never hardcoded inline in the send path), rendered with
// {{var}} interpolation. Email goes to every valid submission (transactional); SMS goes ONLY because the form's
// required consent checkbox was recorded at submission time (consent_given + consent_text + consent_at are on the
// row). Wording deliberately never promises approval or free hardware — eligibility is stated as subject to review.
// Delivery: SendGrid/Twilio via the SAME env convention the rest of the platform uses (SENDGRID_*, TWILIO_*).
// HONESTY RULE: when a provider is not configured we do NOT pretend to send — the attempt is logged to the
// canonical notification_delivery_logs (tenant_id NULL = platform-level) with status 'blocked' (reason not_configured /
// invalid_target in error_message — the CHECK's vocabulary, as migration 663) so the Super Admin
// Communications overview shows the truth. Every path is best-effort: a confirmation can never fail a submission.
import { type EmailSender, TwilioSmsSender, type SmsSender, emailSenderFromEnv as sharedEmailSender } from '@aipowersalon/notifications';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export const APPLICATION_CONFIRMATION_TEMPLATES = {
  email: {
    name: 'application_confirmation_email',
    version: '2026-07-26',
    subject: 'We received your AIPowerSalon application — {{reference}}',
    body: [
      'Hi {{firstName}},',
      '',
      'Thanks for applying for the AIPowerSalon POS Package for {{salonName}}.',
      '',
      'Your application reference is {{reference}}. Keep it for your records.',
      '',
      'What happens next: our team reviews every application and will contact you, usually within 1–2 business days,',
      'by your preferred method. Eligibility and hardware availability are subject to approval — submitting an',
      'application does not guarantee acceptance or equipment.',
      '',
      'Questions? Just reply to this email or write to nailsalon@aipowersalon.com and include your reference.',
      '',
      '— The AIPowerSalon team',
    ].join('\n'),
  },
  sms: {
    name: 'application_confirmation_sms',
    version: '2026-07-26',
    body: 'AIPowerSalon: we received your application {{reference}} for {{salonName}}. Our team will contact you within 1–2 business days. Eligibility & hardware are subject to approval.',
  },
} as const;

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? '');
}

const maskEmail = (e: string) => { const [u, d] = String(e).split('@'); return `${(u || '').slice(0, 1)}***@${d || ''}`; };
const maskPhone = (p: string) => { const d = String(p).replace(/\D/g, ''); return `•••${d.slice(-4)}`; };
const toE164 = (p: string): string | null => {
  const d = String(p).replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return null;
};

export function emailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  return sharedEmailSender(env);   // one factory (packages/notifications) — default sender nailsalons@aipowersalon.com
}
export function smsSenderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = env;
  return TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM
    ? new TwilioSmsSender({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_FROM }) : null;
}

/** Best-effort applicant confirmations. Injected into SuperAdminPlatformService as a narrow structural port. */
export class ApplicationConfirmationSender {
  constructor(private readonly opts: { email?: EmailSender | null; sms?: SmsSender | null; db?: Kysely<DB> | null }) {}

  private async log(channel: 'email' | 'sms', target: string, status: 'sent' | 'failed' | 'blocked', providerId: string | null, error?: string) {
    const db = this.opts.db;
    if (!db) return;
    await db.insertInto('notification_delivery_logs' as any).values({
      id: sql`gen_random_uuid()` as any, tenant_id: null as any, user_id: null as any,
      channel, target_masked: target, template: APPLICATION_CONFIRMATION_TEMPLATES[channel].name,
      provider_id: providerId, status, error_message: error ?? null,
    } as any).execute().catch(() => { /* logging must never break the flow */ });
  }

  /** Fire-and-forget from the intake path. `app` is the freshly created tenant_applications row. */
  async sendConfirmation(app: any): Promise<void> {
    const vars = {
      firstName: String(app?.owner_first_name || app?.owner_name || 'there').split(' ')[0],
      salonName: String(app?.salon_name || 'your salon'),
      reference: String(app?.reference_number || ''),
    };
    // Email — transactional confirmation of the submission itself.
    if (app?.email) {
      const t = APPLICATION_CONFIRMATION_TEMPLATES.email;
      if (!this.opts.email) await this.log('email', maskEmail(app.email), 'blocked', null, 'not_configured: email provider not configured');
      else {
        try {
          const r = await this.opts.email.send(String(app.email), renderTemplate(t.subject, vars), renderTemplate(t.body, vars));
          await this.log('email', maskEmail(app.email), 'sent', r?.id ?? null);
        } catch (e: any) { await this.log('email', maskEmail(app.email), 'failed', null, String(e?.message || e)); }
      }
    }
    // SMS — only under the recorded submission consent (the form's required checkbox), to a normalizable number.
    if (app?.phone && app?.consent_given === true) {
      const e164 = toE164(app.phone);
      const t = APPLICATION_CONFIRMATION_TEMPLATES.sms;
      if (!e164) await this.log('sms', maskPhone(app.phone), 'blocked', null, 'invalid_target: phone not E.164-normalizable');
      else if (!this.opts.sms) await this.log('sms', maskPhone(app.phone), 'blocked', null, 'not_configured: sms provider not configured');
      else {
        try {
          const r = await this.opts.sms.send(e164, renderTemplate(t.body, vars));
          await this.log('sms', maskPhone(app.phone), 'sent', r?.sid ?? null);
        } catch (e: any) { await this.log('sms', maskPhone(app.phone), 'failed', null, String(e?.message || e)); }
      }
    }
  }
}
