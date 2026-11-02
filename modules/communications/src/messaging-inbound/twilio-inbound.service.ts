// twilio-inbound.service.ts — resolves an inbound Twilio SMS to its tenant (via the messaging-number registry) and
// records STOP/START as an opt-out/opt-in through the EXISTING NotificationsService, so the app's opt-out state stays
// in sync with what customers text (TCPA/A2P compliance). The webhook is unauthenticated by design (Twilio calls it)
// but every request is signature-verified.
//
// Security fix E2 (Oct 23 2026) — WHICH token verifies the signature. Before, the token was picked by the request's
// AccountSid (any salon's self-entered credentials) while the affected tenant came from the `To` number (or, for status
// callbacks, from the MessageSid across ALL tenants) — never checked to be the same salon. A salon owner who saved
// arbitrary credentials could sign a request with its own token, name another salon's number as `To`, and opt that
// salon's customers in or out (or forge another salon's delivery statuses). Now, like the booking-verification webhook:
//   1. the tenant is resolved FIRST from data WE stored — the registered `To` number (inbound) or the stored message row
//      (status callback); nothing in the request names it;
//   2. the signature is verified with a token THAT tenant may sign with: its own configured account's token when the
//      AccountSid is one of that tenant's accounts, else the platform token (TWILIO_AUTH_TOKEN) — a platform-account
//      number is signed by the platform, and nobody outside can produce that signature;
//   3. an AccountSid that is another salon's configured account (and not the platform account) is refused outright.
import { Injectable, Inject, Optional } from '@nestjs/common';
import { systemContext } from '@aipowersalon/tenant-context';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase, canMoveToSql } from '@aipowersalon/database';
import { SMS_TEST_EVENT } from '../communications-lifecycles';
import { NotificationsService } from '../notifications/notifications.service';
import { verifyTwilioSignature, classifyInboundKeyword } from '@aipowersalon/notifications';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';   // provider credentials open through the port (Constitution 13 §94)
import { recordMessagingEvent, logException } from '@aipowersalon/observability';   // wave 3 PAYI §105
import { REALTIME, EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { recordInboundSms } from '../inbox/inbox.repository';

export interface InboundSmsInput { from: string; to: string; body: string; signature?: string | null; url: string; params: Record<string, string> }
export type InboundResult =
  | { status: 'ignored'; reason: 'no_signature_config' | 'bad_signature' | 'account_mismatch' | 'unknown_number' | 'no_keyword' }
  | { status: 'opted_out'; tenantId: string }
  | { status: 'opted_in'; tenantId: string }
  | { status: 'help'; tenantId: string }
  /** Communications guide (Oct 30 2026): an ordinary customer text, stored in the salon's SMS Inbox (was dropped as no_keyword) */
  | { status: 'recorded'; tenantId: string; threadId: string | null; duplicate: boolean };
export type StatusResult =
  | { status: 'ignored'; reason: 'no_signature_config' | 'bad_signature' | 'account_mismatch' | 'unknown_message' }
  | { status: 'recorded'; updated: number };
type TokenChoice = { token: string } | { refused: 'no_signature_config' | 'account_mismatch' };
/** the readiness stamp is evidence, not the webhook's job: its failure is logged (one line, no payload), never thrown */
const logWebhookGap = (e: unknown): void => { process.stderr.write(JSON.stringify({ level: 'warn', msg: 'twilio webhook: readiness stamp failed', code: (e as { code?: unknown } | null)?.code ?? null }) + '\n'); };

@Injectable()
export class TwilioInboundService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly notifications: NotificationsService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets,
    @Optional() @Inject(REALTIME) private readonly realtime?: RealtimeEmitter | null) {}

  /** Communications guide §10.1: every signature-verified customer text lands in the salon's inbox — idempotent on the
   *  MessageSid (Twilio retries are one message), linked to a customer only on an exact, unique phone match. A failure
   *  here is logged and never stops the opt-out handling that follows. */
  private async storeInbound(tenantId: string, input: InboundSmsInput): Promise<{ threadId: string; duplicate: boolean } | null> {
    if (!this.db || typeof this.db.transaction !== 'function') return null;
    try {
      const sid = input.params?.MessageSid || input.params?.SmsSid || null;
      const out = await recordInboundSms(this.db, { tenantId, from: input.from, to: input.to, body: input.body, messageSid: sid, numMedia: Number(input.params?.NumMedia || 0) || 0 });
      if (!out.duplicate) await this.emitConversation(tenantId, out.branchId, out.threadId, 'inbound');
      return { threadId: out.threadId, duplicate: out.duplicate };
    } catch (e) { logException(e, { where: 'twilio-inbound.storeInbound' }); return null; }
  }

  private authToken(): string { return process.env.TWILIO_AUTH_TOKEN || ''; }
  private platformAccountSid(): string { return process.env.TWILIO_ACCOUNT_SID || ''; }

  /**
   * The token to verify a webhook for `tenantId` with (E2). `tenantId` came from OUR registry, never the request.
   *   • AccountSid is one of this tenant's configured accounts (own account or platform-managed subaccount) → its token;
   *   • AccountSid is the platform account, absent, or unknown → the platform token;
   *   • AccountSid is ANOTHER tenant's configured account → refused (it can never be this tenant's traffic).
   * The platform account SID is never matched against tenant rows: a salon typing the platform SID into its own
   * credentials must not be able to redirect verification of platform-signed callbacks to its token.
   */
  private async verificationTokenFor(tenantId: string | null, accountSid: string | undefined): Promise<TokenChoice> {
    const platform = this.authToken();
    const sid = String(accountSid ?? '').trim();
    const platformSid = this.platformAccountSid();
    if (sid && this.db && sid !== platformSid) {
      // Every configured row for this AccountSid, this tenant's first. One query: whose account is it?
      const res: any = await sql`SELECT tenant_id::text AS tenant_id, auth_token_enc FROM tenant_messaging_credentials
        WHERE account_sid = ${sid} AND provider = 'twilio' AND status = 'configured'
        ORDER BY (tenant_id::text = ${tenantId ?? ''}) DESC, branch_id NULLS FIRST LIMIT 1`.execute(this.db);
      const row = res.rows?.[0];
      if (row && tenantId && String(row.tenant_id) === String(tenantId) && row.auth_token_enc) {
        // An undecryptable token is an operator problem (PROVIDER_VAULT_KEK) — it throws, so Twilio retries and the
        // error is seen, instead of silently trusting a different key.
        return { token: this.secrets.decrypt(row.auth_token_enc) };
      }
      if (row) return { refused: 'account_mismatch' };
    }
    return platform ? { token: platform } : { refused: 'no_signature_config' };
  }

  private async tenantForNumber(toNumber: string): Promise<string | null> {
    if (!this.db || !toNumber) return null;
    const res: any = await sql`SELECT tenant_id::text AS tenant_id FROM tenant_messaging_numbers WHERE phone_number = ${toNumber} LIMIT 1`.execute(this.db);
    return res.rows?.[0]?.tenant_id ?? null;
  }

  /** The tenant that SENT this message, from the stored row. Two tenants claiming one SID → refused (null). A SID that
   *  is no notification may be a salon's Test SMS (sms_test_events, Phone & Messaging guide §9) — same rule. */
  private async tenantForMessage(messageSid: string): Promise<{ tenantId: string; kind: 'notification' | 'test' } | null> {
    if (!this.db || !messageSid) return null;
    const res: any = await sql`SELECT DISTINCT tenant_id::text AS tenant_id FROM notifications WHERE provider_id = ${messageSid} LIMIT 2`.execute(this.db);
    if (res.rows?.length === 1) return { tenantId: String(res.rows[0].tenant_id), kind: 'notification' };
    if (res.rows?.length) return null;
    const t: any = await sql`SELECT DISTINCT t.tenant_id::text AS tenant_id FROM sms_test_events t WHERE t.provider_message_sid = ${messageSid} LIMIT 2`.execute(this.db);
    return t.rows?.length === 1 ? { tenantId: String(t.rows[0].tenant_id), kind: 'test' } : null;
  }

  /** Inbound readiness is proven by a real, signature-verified event for THIS salon — never by an outbound test. */
  private async noteVerifiedWebhook(tenantId: string, kind: 'inbound' | 'status'): Promise<void> {
    if (!this.db) return;
    await sql`INSERT INTO tenant_messaging_webhook_activity (tenant_id, webhook_kind) VALUES (${tenantId}, ${kind})
      ON CONFLICT (tenant_id, webhook_kind) DO UPDATE SET last_verified_at = now(), events_verified = tenant_messaging_webhook_activity.events_verified + 1
      WHERE tenant_messaging_webhook_activity.tenant_id = ${tenantId}`.execute(this.db).catch(logWebhookGap);
  }

  /** A Test SMS moves forward only (SMS_TEST_EVENT): a final state (delivered / failed / undelivered / rejected) is never
   *  overwritten, and a 'sent' test never falls back to 'accepted'. */
  private async recordTestStatus(tenantId: string, sid: string, status: string, errorCode: string | null): Promise<number> {
    const s = String(status || '').toLowerCase();
    const next = s === 'delivered' ? 'delivered' : s === 'failed' ? 'failed' : s === 'undelivered' ? 'undelivered' : s === 'sent' ? 'sent' : s === 'queued' || s === 'accepted' || s === 'sending' ? 'accepted' : null;
    if (!next || !this.db) return 0;
    const code = errorCode && /^[0-9]{3,6}$/.test(errorCode) ? `TWILIO_${errorCode}` : null;
    const r: any = await sql`UPDATE sms_test_events e SET status = ${next}, error_code = COALESCE(${code}, e.error_code), status_updated_at = now(),
        delivered_at = CASE WHEN ${next} = 'delivered' THEN now() ELSE e.delivered_at END
      WHERE e.tenant_id = ${tenantId} AND e.provider_message_sid = ${sid} AND ${canMoveToSql(SMS_TEST_EVENT, next, 'e')} RETURNING e.id`.execute(this.db);
    return r.rows?.length ?? 0;
  }

  /** ids-only conversation_updated: to the conversation's branch room, or — salon-wide number — to every branch of the salon */
  private async emitConversation(tenantId: string, branchId: string | null, threadId: string, kind: 'inbound' | 'status_update'): Promise<void> {
    if (!this.realtime || !this.db) return;
    try {
      const ids = branchId ? [branchId] : ((await sql`SELECT b.id::text AS id FROM branches b WHERE b.tenant_id = ${tenantId} AND b.deleted_at IS NULL LIMIT 500`.execute(this.db)) as { rows: { id: string }[] }).rows.map((r) => r.id);
      // §343 exempt: a momentary screen signal (a text arrived / delivery changed; refetch, ids only) — the stored row is the fact
      for (const b of ids) this.realtime.toTenant({ tenantId, branchId: b }, EVENTS.conversationUpdated, { threadId, kind, version: null });
    } catch (e) { logException(e, { where: 'twilio-inbound.emit', kind }); }
  }

  /** a staff reply's provider status moved → the inbox showing that conversation refetches (ids only) */
  private async notifyInboxDelivery(tenantId: string, messageSid: string): Promise<void> {
    if (!this.db || !this.realtime) return;
    try {
      const r: any = await sql`SELECT m.thread_id::text AS thread_id, t.branch_id::text AS branch_id FROM notifications n
        JOIN communication_messages m ON m.tenant_id = ${tenantId} AND m.notification_id = n.id
        JOIN communication_threads t ON t.tenant_id = ${tenantId} AND t.id = m.thread_id
        WHERE n.tenant_id = ${tenantId} AND n.provider_id = ${messageSid} LIMIT 1`.execute(this.db);
      const row = r.rows?.[0];
      if (row) await this.emitConversation(tenantId, row.branch_id ?? null, row.thread_id, 'status_update');
    } catch (e) { logException(e, { where: 'twilio-inbound.notifyInboxDelivery' }); }
  }

  async handleInbound(input: InboundSmsInput): Promise<InboundResult> {
    // 1) Which tenant owns the receiving number — from our registry, before anything in the request is trusted.
    const tenantId = await this.tenantForNumber(input.to);
    // 2) Verify the request really came from Twilio, with a token THAT tenant may sign with. An unknown number is still
    //    verified (platform token) so a forged request is reported as one, and then ignored.
    const choice = await this.verificationTokenFor(tenantId, input.params?.AccountSid);
    if ('refused' in choice) return { status: 'ignored', reason: choice.refused };
    if (!verifyTwilioSignature(choice.token, input.url, input.params, input.signature)) return { status: 'ignored', reason: 'bad_signature' };
    if (!tenantId) return { status: 'ignored', reason: 'unknown_number' };
    await this.noteVerifiedWebhook(tenantId, 'inbound');

    // 3) The text itself goes into the salon's inbox (keyword texts too — they are part of the customer's history).
    const stored = await this.storeInbound(tenantId, input);
    // 4) Act on opt-out / opt-in keywords via the existing notifications opt-out state (system-initiated write).
    const kw = classifyInboundKeyword(input.body);
    const sysCtx = systemContext({ tenantId, actor: 'twilio-inbound' });
    if (kw === 'stop') { await this.notifications.recordOptOut(sysCtx, 'sms', input.from, 'inbound_stop'); recordMessagingEvent('opt_out'); return { status: 'opted_out', tenantId }; }
    if (kw === 'start') { await this.notifications.recordOptIn(sysCtx, 'sms', input.from); return { status: 'opted_in', tenantId }; }
    if (kw === 'help') return { status: 'help', tenantId };
    if (stored) return { status: 'recorded', tenantId, threadId: stored.threadId, duplicate: stored.duplicate };
    return { status: 'ignored', reason: 'no_keyword' };
  }

  /**
   * Twilio message-status callback. The tenant comes from the STORED message row (by MessageSid), the signature is
   * verified with a token that tenant may sign with, and only that tenant's message row is moved.
   */
  async handleStatus(input: { sid: string; status: string; signature?: string | null; url: string; params: Record<string, string> }): Promise<StatusResult> {
    const owner = await this.tenantForMessage(input.sid);
    const tenantId = owner?.tenantId ?? null;
    const choice = await this.verificationTokenFor(tenantId, input.params?.AccountSid);
    if ('refused' in choice) return { status: 'ignored', reason: choice.refused };
    if (!verifyTwilioSignature(choice.token, input.url, input.params, input.signature)) return { status: 'ignored', reason: 'bad_signature' };
    if (!tenantId) return { status: 'ignored', reason: 'unknown_message' };
    await this.noteVerifiedWebhook(tenantId, 'status');
    if (owner?.kind === 'test') return { status: 'recorded', updated: await this.recordTestStatus(tenantId, input.sid, input.status, input.params?.ErrorCode || null) };
    // wave 3 PAYI §87: ErrorCode (e.g. 30007) and NumSegments ride along — stored for support, never shown to a customer
    const { updated } = await this.notifications.recordDeliveryStatus(input.sid, input.status, { errorCode: input.params?.ErrorCode || null, segments: input.params?.NumSegments ? Number(input.params.NumSegments) : null }, { tenantId });
    if (updated > 0) await this.notifyInboxDelivery(tenantId, input.sid);
    return { status: 'recorded', updated };
  }
}
