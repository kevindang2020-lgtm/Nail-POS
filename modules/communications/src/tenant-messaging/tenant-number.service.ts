// tenant-number.service.ts — search + buy a phone number for a salon and register it so send / inbound routing /
// receipts all key off it. Buys under the salon's OWN Twilio account when configured (per-tenant credentials), else the
// shared ISV account. Registering = upsert into tenant_messaging_numbers (inbound routing + the send from-number
// resolver) and, when the salon has its own account, updating its credentials.from_number. Honest: no account creds →
// not_configured; never fabricates a number.
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase, canMoveToSql } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { TwilioNumbersClient, type NumbersCreds, type AvailableNumber } from './twilio-numbers-client';
import { TENANT_MESSAGING_NUMBER } from '../communications-lifecycles';   // wave 3 PAYI: the number status machine

export interface TenantNumberView { tenantId: string; configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null }

@Injectable()
export class TenantNumberService {
  // Credentials through the ProviderSecrets port (Constitution 13 §94) — never the key ring directly.
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}

  /** Resolve the account to buy under: the salon's own configured account, else the shared ISV account (env). */
  private async resolveAccount(tenantId: string): Promise<{ creds: NumbersCreds | null; own: boolean }> {
    if (this.db) {
      const res: any = await sql`SELECT account_sid, auth_token_enc FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND status = 'configured' AND branch_id IS NULL LIMIT 1`.execute(this.db as any);
      const r = res.rows?.[0];
      if (r?.account_sid && r?.auth_token_enc) {
        try { return { creds: { accountSid: r.account_sid, authToken: this.secrets.decrypt(r.auth_token_enc) }, own: true }; } catch { /* fall through to shared */ }
      }
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    return { creds: accountSid && authToken ? { accountSid, authToken } : null, own: false };
  }

  private inboundWebhookUrl(): string | undefined {
    const base = (process.env.PUBLIC_API_BASE_URL || process.env.APS_API_BASE || '').replace(/\/+$/, '');
    return base ? `${base}/webhooks/twilio/sms/inbound` : undefined;
  }

  async get(tenantId: string): Promise<TenantNumberView> {
    const { creds, own } = await this.resolveAccount(tenantId);
    let registeredNumber: string | null = null;
    if (this.db) {
      const res: any = await sql`SELECT phone_number FROM tenant_messaging_numbers WHERE tenant_id = ${tenantId} AND channel = 'sms' ORDER BY created_at ASC LIMIT 1`.execute(this.db as any);
      registeredNumber = res.rows?.[0]?.phone_number ?? null;
    }
    return { tenantId, configured: !!creds, usingOwnAccount: own, registeredNumber };
  }

  async search(tenantId: string, opts: { country?: string; areaCode?: string }): Promise<{ available: AvailableNumber[]; configured: boolean }> {
    const { creds } = await this.resolveAccount(tenantId);
    if (!creds) return { available: [], configured: false };
    const client = new TwilioNumbersClient(creds);
    const available = await client.searchLocal({ country: opts.country, areaCode: opts.areaCode });
    return { available, configured: true };
  }

  /** Buy a specific number, wire its inbound webhook, register it, and (for own-account salons) set it as the from. */
  async buyAndRegister(actorUserId: string, tenantId: string, phoneNumber: string): Promise<{ ok: boolean; number?: string; error?: string; reason?: 'not_configured' }> {
    const { creds, own } = await this.resolveAccount(tenantId);
    if (!creds) return { ok: false, reason: 'not_configured' };
    if (!/^\+[1-9]\d{6,15}$/.test(phoneNumber || '')) return { ok: false, error: 'A valid E.164 number is required.' };
    let bought: { sid: string; phoneNumber: string };
    try {
      bought = await new TwilioNumbersClient(creds).purchase(phoneNumber, { smsUrl: this.inboundWebhookUrl() });
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'purchase failed').replace(/^numbers_failed:/, 'Twilio: ') };
    }
    const reg = await this.register(tenantId, bought.phoneNumber, own, bought.sid, actorUserId);
    if (!reg.ok) return { ok: false, error: reg.error };
    await this.audit.record({ tenantId, userId: actorUserId } as any, { module: 'messaging', action: 'number.purchased', resourceType: 'tenant_messaging_numbers', resourceId: tenantId, summary: `Purchased + registered ${bought.phoneNumber}`, metadata: { sid: bought.sid, ownAccount: own } }).catch(() => undefined);
    return { ok: true, number: bought.phoneNumber };
  }

  /** Register an already-owned number (no purchase) — e.g. a number the salon already has on their account. */
  async registerExisting(actorUserId: string, tenantId: string, phoneNumber: string): Promise<{ ok: boolean; number?: string; error?: string }> {
    if (!/^\+[1-9]\d{6,15}$/.test(phoneNumber || '')) return { ok: false, error: 'A valid E.164 number is required.' };
    const { own } = await this.resolveAccount(tenantId);
    const reg = await this.register(tenantId, phoneNumber, own, null, actorUserId);
    if (!reg.ok) return { ok: false, error: reg.error };
    await this.audit.record({ tenantId, userId: actorUserId } as any, { module: 'messaging', action: 'number.registered', resourceType: 'tenant_messaging_numbers', resourceId: tenantId, summary: `Registered ${phoneNumber}` }).catch(() => undefined);
    return { ok: true, number: phoneNumber };
  }

  /**
   * wave 3 PAYI §5 / §59: a number belongs to exactly ONE salon. Before, `ON CONFLICT (phone_number) DO UPDATE SET
   * tenant_id` let any salon's owner type another salon's number and take over its inbound routing and sender —
   * cross-tenant leakage. Now a number already registered to another salon is refused; re-registering your own number
   * only refreshes its provider SID / active status.
   */
  private async register(tenantId: string, phoneNumber: string, ownAccount: boolean, providerSid: string | null, actorUserId: string | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.db) return { ok: true };
    const actor = actorUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorUserId) ? actorUserId : null;   // 641 actor stamp (a uuid user id, else unknown)
    const owner: any = await sql`SELECT tenant_id::text AS tenant_id FROM tenant_messaging_numbers WHERE phone_number = ${phoneNumber} LIMIT 1`.execute(this.db as any).then((r: any) => r.rows?.[0]);
    if (owner && String(owner.tenant_id) !== String(tenantId)) return { ok: false, error: 'That number is already registered to another salon.' };
    await sql`
      INSERT INTO tenant_messaging_numbers (tenant_id, phone_number, channel, provider, provider_phone_number_sid, purpose, status, updated_by)
      VALUES (${tenantId}, ${phoneNumber}, 'sms', 'twilio', ${providerSid}, 'general_sms', 'active', ${actor})
      ON CONFLICT (phone_number) DO UPDATE SET provider_phone_number_sid = COALESCE(EXCLUDED.provider_phone_number_sid, tenant_messaging_numbers.provider_phone_number_sid),
        status = 'active', released_at = NULL, updated_at = now(), updated_by = EXCLUDED.updated_by
      WHERE tenant_messaging_numbers.tenant_id = ${tenantId} AND ${canMoveToSql(TENANT_MESSAGING_NUMBER, 'active', 'tenant_messaging_numbers')}
    `.execute(this.db as any);
    if (ownAccount) {
      // The salon sends through its own account → point that account's from at the new number.
      await sql`UPDATE tenant_messaging_credentials SET from_number = ${phoneNumber}, config_version = config_version + 1, updated_at = now() WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND branch_id IS NULL`.execute(this.db as any).catch(() => undefined);
    }
    return { ok: true };
  }
}
