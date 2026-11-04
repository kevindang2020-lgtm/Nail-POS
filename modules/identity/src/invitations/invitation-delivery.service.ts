// invitation-delivery.service.ts — ONE delivery seam, two callers.
//
// == WHY THIS FILE EXISTS ==================================================================================
//
// The logic below was a PRIVATE METHOD on SuperAdminPlatformService. It is good logic: it POSTs the accept link
// to whatever mailer/SMS relay the operator has configured (`INVITE_NOTIFIER_URL`), and it records what actually
// happened — `delivered`, `failed`, or `not_connected` — and hands the one-time token back for manual delivery
// rather than ever fabricating a send.
//
// When the technician-invite path needed to send an invitation too, there were two options: copy it, or extract
// it. Copying it would have produced a second delivery mechanism that drifts from the first — a second thing to
// time out, a second set of status strings, a second place to forget that `not_connected` is not `sent`.
//
// So it is extracted, SuperAdminPlatformService delegates to it, and its behaviour is byte-for-byte what it was.
import { type EmailSender, TwilioSmsSender, type SmsSender, emailSenderFromEnv as sharedEmailSender } from '@aipowersalon/notifications';
import { sql } from 'kysely';
import { acceptUrl } from './invitation-token-core';
import { buildInvitationDeliveryPayload, deliveryStatusFor } from './invitation-notifier-core';

/** The one write this needs. Kept as a port so the platform repo (which already has it) satisfies it as-is. */
export interface InvitationDeliverySink {
  setInvitationDelivery(id: string, deliveryStatus: string, error?: string | null): Promise<void>;
}

export interface DeliveryResult {
  delivered: boolean;
  deliveryStatus: 'delivered' | 'failed' | 'not_connected';
  channel: string;
  reason: string;
  /** The one-time token, returned ONLY when it could not be delivered — so a human can hand it over. */
  manualToken: string | null;
}

const TIMEOUT_MS = 5000;

/**
 * The transports this platform ALREADY HAS — and has had all along.
 *
 * SendGrid and Twilio are wired for password resets and customer OTPs and configured from the same env vars.
 * The invitation path used neither: its only route out was a generic `INVITE_NOTIFIER_URL` webhook that most
 * operators will never stand up. So an invite reported `not_connected` on a platform perfectly capable of
 * sending it.
 *
 * Returns NULL when unconfigured — never a Mock. `MockSmsSender` would happily report a send that never left the
 * building, which is the one thing this whole seam exists to refuse.
 */
export function emailFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  return sharedEmailSender(env);   // one factory (packages/notifications) — default sender nailsalons@aipowersalon.com
}
export function smsFromEnv(env: NodeJS.ProcessEnv = process.env): SmsSender | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = env;
  return TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM
    ? new TwilioSmsSender({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_FROM })
    : null;
}

/** C3 audit (Nov 4 2026): the invite text named "technician" for every role — a receptionist was told to set up a
 *  technician account. A technician (or an invite without a role) keeps the technician text; any other role is named. */
const isTech = (role?: string | null) => !role || /^tech/i.test(role.trim());
const roleName = (role: string) => role.trim().toLowerCase().replace(/[_-]+/g, ' ');
export function inviteSmsBody(link: string, role?: string | null): string {
  return isTech(role)
    ? `AIPowerSalon: you have been invited to join a salon. Set up your technician account here: ${link}`
    : `AIPowerSalon: you have been invited to join a salon team as ${/^[aeiou]/i.test(roleName(role!)) ? 'an' : 'a'} ${roleName(role!)}. Set up your account here: ${link}`;
}
export function inviteEmail(link: string, role?: string | null): { subject: string; body: string } {
  if (!isTech(role)) {
    const r = roleName(role!);
    return {
      subject: 'You have been invited to AIPowerSalon',
      body: `A salon has invited you to join its team on AIPowerSalon as ${/^[aeiou]/i.test(r) ? 'an' : 'a'} ${r}.\n\nSet up your account:\n${link}\n\n` +
        'If you were not expecting this, you can ignore this message.',
    };
  }
  return {
    subject: 'You have been invited to AIPowerSalon',
    body: `A salon has invited you to join AIPowerSalon as a technician.\n\nSet up your account:\n${link}\n\n` +
      'Your profile, portfolio, followers and rating belong to you and stay with you at every salon you work at.\n' +
      'If you were not expecting this, you can ignore this message.',
  };
}

export class InvitationDelivery {
  private readonly email: EmailSender | null;
  private readonly sms: SmsSender | null;

  constructor(
    private readonly sink: InvitationDeliverySink,
    private readonly http: typeof fetch = fetch,
    transports?: { email?: EmailSender | null; sms?: SmsSender | null },
  ) {
    // Explicit transports win (tests inject fakes); otherwise the platform's own configured senders; otherwise
    // null, and the notifier webhook or an honest `not_connected` takes over.
    this.email = transports?.email !== undefined ? transports.email : emailFromEnv();
    this.sms = transports?.sms !== undefined ? transports.sms : smsFromEnv();
  }

  /**
   * Deliver an invitation, and be honest about whether it went.
   *
   * With no notifier configured this returns `not_connected` and the raw token. It does NOT return "sent". The
   * difference between those two is the difference between a technician who got a text and a technician who is
   * sitting there waiting for one that was never sent, while the salon's screen says she was invited.
   */
  async deliver(input: {
    invitationId: string;
    channel: 'email' | 'sms' | 'manual';
    /** The address or number the invite is going to. */
    to: string;
    token: string | null;
    baseUrl: string;
    role?: string | null;
    tenantId?: string | null;
    expiresAt?: string | null;
  }): Promise<DeliveryResult> {
    if (!input.token) {
      await this.sink.setInvitationDelivery(input.invitationId, 'not_connected', 'No invitation token to deliver');
      return { delivered: false, deliveryStatus: 'not_connected', channel: input.channel, reason: 'No token to deliver.', manualToken: null };
    }

    const link = acceptUrl(input.baseUrl, input.token);

    // ── 1. The transports this platform already has. ──────────────────────────────────────────────────────
    const direct = input.channel === 'sms' ? this.sms : input.channel === 'email' ? this.email : null;
    if (direct) {
      try {
        if (input.channel === 'sms') await (direct as SmsSender).send(input.to, inviteSmsBody(link, input.role));
        else { const m = inviteEmail(link, input.role); await (direct as EmailSender).send(input.to, m.subject, m.body); }
        await this.sink.setInvitationDelivery(input.invitationId, 'delivered', null);
        return { delivered: true, deliveryStatus: 'delivered', channel: input.channel, reason: `Sent by ${input.channel}.`, manualToken: null };
      } catch (e: any) {
        // A transport failure is recorded and then FALLS THROUGH to the notifier — one dead sender must not be
        // the end of the road for a hire. What it never does is fall through to reporting success.
        await this.sink.setInvitationDelivery(input.invitationId, 'failed', String(e?.message || 'send failed'));
      }
    }

    // ── 2. The generic notifier webhook. ─────────────────────────────────────────────────────────────────
    const url = process.env.INVITE_NOTIFIER_URL;
    if (!url) {
      await this.sink.setInvitationDelivery(input.invitationId, 'not_connected', 'No email/SMS notifier configured');
      return {
        delivered: false, deliveryStatus: 'not_connected', channel: input.channel,
        reason: 'No email/SMS notifier configured — deliver the link manually.',
        manualToken: input.token,
      };
    }

    const payload = buildInvitationDeliveryPayload({
      email: input.to, channel: input.channel, acceptUrl: link, tokenPrefix: input.token.slice(0, 8),
      role: input.role ?? null, tenantId: input.tenantId ?? null, expiresAt: input.expiresAt ?? null,
    });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await this.http(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: ac.signal,
      });
      const ok = res.ok;
      const status = deliveryStatusFor(ok);
      await this.sink.setInvitationDelivery(input.invitationId, status, ok ? null : `Notifier responded ${res.status}`);
      return {
        delivered: ok, deliveryStatus: status, channel: input.channel,
        reason: ok ? 'Delivered to the configured notifier.' : `Notifier responded ${res.status} — deliver the link manually.`,
        manualToken: ok ? null : input.token,
      };
    } catch (e: any) {
      // A notifier that is down must not take a hire down with it. The invitation row survives, the failure is
      // recorded, and the token comes back so somebody can hand it over by hand.
      await this.sink.setInvitationDelivery(input.invitationId, 'failed', String(e?.message || 'delivery error'));
      return {
        delivered: false, deliveryStatus: 'failed', channel: input.channel,
        reason: 'Notifier unreachable — deliver the link manually.',
        manualToken: input.token,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The delivery-status write, over Kysely.
 *
 * SuperAdminPlatformRepository already has this method (it is part of its persistence port and other invitation
 * operations use it). This is the same statement for callers that do not carry that whole repository — the
 * technician-invite path being the first. Persistence is per-module; the DELIVERY LOGIC above is the thing that
 * had to be singular, and now is.
 */
export class KyselyInvitationDeliverySink implements InvitationDeliverySink {
  constructor(private readonly db: any) {}
  async setInvitationDelivery(id: string, deliveryStatus: string, error?: string | null): Promise<void> {
    if (!this.db) return;
    await sql`update user_invitations
                 set delivery_status = ${deliveryStatus}, delivery_error = ${error ?? null},
                     last_sent_at = now(), updated_at = now()
               where id = ${id}`.execute(this.db).catch(() => {});
  }
}
