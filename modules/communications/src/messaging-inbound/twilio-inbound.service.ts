// twilio-inbound.service.ts — resolves an inbound Twilio SMS to its tenant (via the messaging-number registry) and
// records STOP/START as an opt-out/opt-in through the EXISTING NotificationsService, so the app's opt-out state stays
// in sync with what customers text (TCPA/A2P compliance). Signature verification is enforced with the tenant/account
// Twilio auth token; the webhook is unauthenticated by design (Twilio calls it) but every request is verified.
import { Injectable, Inject } from '@nestjs/common';
import { systemContext } from '@aipowersalon/tenant-context';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { NotificationsService } from '../notifications/notifications.service';
import { verifyTwilioSignature, classifyInboundKeyword } from '@aipowersalon/notifications';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';   // provider credentials open through the port (Constitution 13 §94)
import { recordMessagingEvent } from '@aipowersalon/observability';   // wave 3 PAYI §105

export interface InboundSmsInput { from: string; to: string; body: string; signature?: string | null; url: string; params: Record<string, string> }
export type InboundResult =
  | { status: 'ignored'; reason: 'no_signature_config' | 'bad_signature' | 'unknown_number' | 'no_keyword' }
  | { status: 'opted_out'; tenantId: string }
  | { status: 'opted_in'; tenantId: string }
  | { status: 'help'; tenantId: string };

@Injectable()
export class TwilioInboundService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly notifications: NotificationsService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}

  private authToken(): string { return process.env.TWILIO_AUTH_TOKEN || ''; }

  /**
   * Pick the auth token to verify a webhook signature with. Twilio includes the sending AccountSid on every callback:
   * if it matches a tenant's own configured account, verify with THAT tenant's token (decrypted); otherwise fall back
   * to the shared TWILIO_AUTH_TOKEN. This is what makes per-tenant Twilio accounts work end-to-end — a salon on its own
   * account signs with its own token, and a spoofed AccountSid can't help an attacker because they still can't produce
   * a valid signature without the real token.
   */
  private async resolveVerificationToken(accountSid: string | undefined): Promise<string> {
    if (accountSid && this.db) {
      try {
        const res: any = await sql`SELECT auth_token_enc FROM tenant_messaging_credentials WHERE account_sid = ${accountSid} AND provider = 'twilio' AND status = 'configured' LIMIT 1`.execute(this.db as any);
        const enc = res.rows?.[0]?.auth_token_enc;
        if (enc) { try { return this.secrets.decrypt(enc); } catch { /* undecryptable → fall back to shared token */ } }
      } catch { /* lookup failure → fall back to shared token */ }
    }
    return this.authToken();
  }

  /** Register (or move) a messaging number to a tenant — called when a number is provisioned to a salon. */
  async registerNumber(tenantId: string, phoneNumber: string, branchId?: string | null): Promise<{ ok: boolean }> {
    if (!this.db) return { ok: false };
    await sql`
      INSERT INTO tenant_messaging_numbers (tenant_id, branch_id, phone_number, channel, provider)
      VALUES (${tenantId}, ${branchId ?? null}, ${phoneNumber}, 'sms', 'twilio')
      ON CONFLICT (phone_number) DO UPDATE SET tenant_id = ${tenantId}, branch_id = ${branchId ?? null}
    `.execute(this.db as any);
    return { ok: true };
  }

  private async tenantForNumber(toNumber: string): Promise<string | null> {
    if (!this.db) return null;
    const res: any = await sql`SELECT tenant_id FROM tenant_messaging_numbers WHERE phone_number = ${toNumber} LIMIT 1`.execute(this.db as any);
    return res.rows?.[0]?.tenant_id ?? null;
  }

  async handleInbound(input: InboundSmsInput): Promise<InboundResult> {
    // 1) Verify the request really came from Twilio, using the sender account's token (per-tenant or shared).
    const token = await this.resolveVerificationToken(input.params?.AccountSid);
    if (!token) return { status: 'ignored', reason: 'no_signature_config' };
    if (!verifyTwilioSignature(token, input.url, input.params, input.signature)) return { status: 'ignored', reason: 'bad_signature' };

    // 2) Resolve which tenant owns the receiving number.
    const tenantId = await this.tenantForNumber(input.to);
    if (!tenantId) return { status: 'ignored', reason: 'unknown_number' };

    // 3) Act on opt-out / opt-in keywords via the existing notifications opt-out state (system-initiated write).
    const kw = classifyInboundKeyword(input.body);
    const sysCtx = systemContext({ tenantId, actor: 'twilio-inbound' }) as any;
    if (kw === 'stop') { await this.notifications.recordOptOut(sysCtx, 'sms', input.from, 'inbound_stop'); recordMessagingEvent('opt_out'); return { status: 'opted_out', tenantId }; }
    if (kw === 'start') { await this.notifications.recordOptIn(sysCtx, 'sms', input.from); return { status: 'opted_in', tenantId }; }
    if (kw === 'help') return { status: 'help', tenantId };
    return { status: 'ignored', reason: 'no_keyword' };
  }

  /**
   * Twilio message-status callback. Verifies the signature, then records the carrier delivery status against the
   * message row (keyed by the globally-unique MessageSid). No tenant lookup needed.
   */
  async handleStatus(input: { sid: string; status: string; signature?: string | null; url: string; params: Record<string, string> }): Promise<{ status: 'ignored'; reason: 'no_signature_config' | 'bad_signature' } | { status: 'recorded'; updated: number }> {
    const token = await this.resolveVerificationToken(input.params?.AccountSid);
    if (!token) return { status: 'ignored', reason: 'no_signature_config' };
    if (!verifyTwilioSignature(token, input.url, input.params, input.signature)) return { status: 'ignored', reason: 'bad_signature' };
    // wave 3 PAYI §87: ErrorCode (e.g. 30007) and NumSegments ride along — stored for support, never shown to a customer
    const { updated } = await this.notifications.recordDeliveryStatus(input.sid, input.status, { errorCode: input.params?.ErrorCode || null, segments: input.params?.NumSegments ? Number(input.params.NumSegments) : null });
    return { status: 'recorded', updated };
  }
}
