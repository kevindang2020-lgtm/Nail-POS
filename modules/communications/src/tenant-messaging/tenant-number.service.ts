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
import { logException } from '@aipowersalon/observability';
import { TwilioNumbersClient, type NumbersCreds, type AvailableNumber } from './twilio-numbers-client';
import { TENANT_MESSAGING_NUMBER, TENANT_NUMBER_PURCHASE_QUOTE } from '../communications-lifecycles';   // wave 3 PAYI: the number status machine
import { createHash, randomBytes } from 'node:crypto';
import { withCode } from '@aipowersalon/api-contracts';
import { availableNumber, quoteLocalNumberPrice } from './twilio-account-probe';

export const NUMBER_OWNED_BY_ANOTHER_SALON = 'That number is already registered to another salon.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE one way a phone number is written into `tenant_messaging_numbers` for a salon (security fix E1, Oct 23 2026).
 *
 * wave 3 PAYI §5 / §59: a number belongs to exactly ONE salon. The registry decides which salon an inbound text (STOP /
 * START / a reply) belongs to, so moving a number means moving another salon's customers' opt-outs. Before, two write
 * paths ran `ON CONFLICT (phone_number) DO UPDATE SET tenant_id = <caller>` (this service until wave 3, and the
 * credentials form until E1) — any owner could type another salon's number and take over its inbound routing.
 * Now: a number already registered to another salon is refused; re-registering your own number only refreshes its
 * provider SID / active status. The upsert's own WHERE re-checks ownership, so a race between the read and the write
 * cannot move it either, and migration 684's trigger refuses any UPDATE that changes `tenant_id` from any path.
 */
export async function registerTenantNumber(db: AppDatabase, input: { tenantId: string; phoneNumber: string; providerSid?: string | null; actorUserId?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tenantId, phoneNumber } = input;
  const providerSid = input.providerSid ?? null;
  const actor = input.actorUserId && UUID_RE.test(input.actorUserId) ? input.actorUserId : null;   // 641 actor stamp (a uuid user id, else unknown)
  const ownerOf = async (): Promise<string | null> => {
    const r: any = await sql`SELECT tenant_id::text AS tenant_id FROM tenant_messaging_numbers WHERE phone_number = ${phoneNumber} LIMIT 1`.execute(db as any);
    return r.rows?.[0]?.tenant_id ?? null;
  };
  const before = await ownerOf();
  if (before && before !== String(tenantId)) return { ok: false, error: NUMBER_OWNED_BY_ANOTHER_SALON };
  await sql`
    INSERT INTO tenant_messaging_numbers (tenant_id, phone_number, channel, provider, provider_phone_number_sid, purpose, status, updated_by)
    VALUES (${tenantId}, ${phoneNumber}, 'sms', 'twilio', ${providerSid}, 'general_sms', 'active', ${actor})
    ON CONFLICT (phone_number) DO UPDATE SET provider_phone_number_sid = COALESCE(EXCLUDED.provider_phone_number_sid, tenant_messaging_numbers.provider_phone_number_sid),
      status = 'active', released_at = NULL, updated_at = now(), updated_by = EXCLUDED.updated_by
    WHERE tenant_messaging_numbers.tenant_id = EXCLUDED.tenant_id AND ${canMoveToSql(TENANT_MESSAGING_NUMBER, 'active', 'tenant_messaging_numbers')}
  `.execute(db as any);
  // The conflict branch writes nothing when another salon won a race for the number: re-read who owns it now.
  const after = await ownerOf();
  if (after !== String(tenantId)) return { ok: false, error: NUMBER_OWNED_BY_ANOTHER_SALON };
  return { ok: true };
}

export interface TenantNumberView { tenantId: string; configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null }
export interface NumberQuoteView {
  ok: true; confirmationToken: string; phoneNumber: string; capabilities: { sms: boolean; voice: boolean; mms: boolean } | null;
  price: { amount: string; unit: string } | null; priceNote: 'provider_quoted_monthly' | 'price_not_returned_by_provider'; expiresAt: string;
  billedTo: 'salon_account' | 'platform_account'; replacesNumber: string | null;
}
export class NumberPurchaseError extends Error {}
/** a purchase confirmation lives this long (it is single use) */
export const QUOTE_TTL_MS = 5 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const logWarn = (what: string) => (e: unknown): void => {
  const code = (e as { code?: unknown } | null)?.code;
  process.stderr.write(JSON.stringify({ level: 'warn', msg: what, code: typeof code === 'string' ? code : null }) + '\n');
};

@Injectable()
export class TenantNumberService {
  // Credentials through the ProviderSecrets port (Constitution 13 §94) — never the key ring directly.
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}
  /** the provider HTTP client for search / quote / purchase (tests swap it for a fake; null = the instrumented default) */
  http: typeof fetch | null = null;
  private client(creds: NumbersCreds): TwilioNumbersClient { return this.http ? new TwilioNumbersClient(creds, this.http) : new TwilioNumbersClient(creds); }
  private probeHttp(): typeof fetch { return this.http ?? ((...a) => fetch(...a)); }

  /**
   * Step 1 of a deliberate purchase (Phone & Messaging guide §6): re-check that THIS number is still available on the
   * account that will be billed, fetch the provider's quoted monthly price (null when Twilio does not return one — the
   * UI then says so; a price is never estimated), and issue a short-lived, single-use confirmation bound to this salon +
   * number. Nothing is bought here. The token is returned once and stored only as a SHA-256 hash.
   */
  async quote(actorUserId: string, tenantId: string, phoneNumber: string, country = 'US'): Promise<NumberQuoteView | { ok: false; reason: 'not_configured' }> {
    if (!/^\+[1-9][0-9]{6,15}$/.test(phoneNumber || '')) throw withCode(new NumberPurchaseError('A valid E.164 number is required.'), 'PHONE_E164_INVALID');
    const { creds, own } = await this.resolveAccount(tenantId);
    if (!creds) return { ok: false, reason: 'not_configured' };
    if (!this.db) throw withCode(new NumberPurchaseError('Number purchase needs the database.'), 'SERVICE_UNAVAILABLE');
    const auth = { accountSid: creds.accountSid, user: creds.accountSid, pass: creds.authToken };
    const avail = await availableNumber(this.probeHttp(), auth, country, phoneNumber);
    if (!avail.reachable) throw withCode(new NumberPurchaseError('Twilio could not be reached.'), 'MESSAGING_PROVIDER_UNREACHABLE');
    if (!avail.available) throw withCode(new NumberPurchaseError('That number is no longer available.'), 'NUMBER_NO_LONGER_AVAILABLE');
    const price = await quoteLocalNumberPrice(this.probeHttp(), auth, country);
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + QUOTE_TTL_MS);
    const actor = UUID_RE.test(actorUserId) ? actorUserId : null;
    await sql`INSERT INTO tenant_number_purchase_quotes (tenant_id, token_hash, phone_number, price_amount, price_unit, capabilities, own_account, expires_at, created_by_user_id, result_status)
      VALUES (${tenantId}, ${sha256(token)}, ${phoneNumber}, ${price?.amount ?? null}, ${price?.unit ?? null}, ${avail.capabilities ? JSON.stringify(avail.capabilities) : null}::jsonb, ${own}, ${expires.toISOString()}::timestamptz, ${actor}, 'quoted')`.execute(this.db);
    const current: any = await sql`SELECT n.phone_number FROM tenant_messaging_numbers n WHERE n.tenant_id = ${tenantId} AND n.channel = 'sms' AND n.status = 'active' ORDER BY n.created_at ASC LIMIT 1`.execute(this.db);
    await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'number.purchase_quoted', resourceType: 'tenant_number_purchase_quotes', resourceId: tenantId, summary: `Purchase confirmation issued for ${phoneNumber}`, metadata: { phoneNumber, price: price ? `${price.amount} ${price.unit}` : null, ownAccount: own } })
      .catch(logWarn('number quote: audit write failed'));
    return { ok: true, confirmationToken: token, phoneNumber, capabilities: avail.capabilities, price, priceNote: price ? 'provider_quoted_monthly' : 'price_not_returned_by_provider',
      expiresAt: expires.toISOString(), billedTo: own ? 'salon_account' : 'platform_account', replacesNumber: current.rows?.[0]?.phone_number && current.rows[0].phone_number !== phoneNumber ? String(current.rows[0].phone_number) : null };
  }

  /**
   * Step 2: buy ONLY with a valid confirmation for this salon + number. The confirmation is claimed atomically (one
   * request wins); a replay of a used confirmation returns the recorded result instead of buying again (idempotent).
   */
  async confirmPurchase(actorUserId: string, tenantId: string, phoneNumber: string, confirmationToken: string): Promise<{ ok: boolean; number?: string; error?: string; reason?: 'not_configured'; replayed?: boolean }> {
    if (!confirmationToken) throw withCode(new NumberPurchaseError('Review the number and its price, then confirm the purchase.'), 'NUMBER_PURCHASE_CONFIRMATION_REQUIRED');
    if (!this.db) throw withCode(new NumberPurchaseError('Number purchase needs the database.'), 'SERVICE_UNAVAILABLE');
    const h = sha256(confirmationToken);
    const claimed: any = await sql`UPDATE tenant_number_purchase_quotes q SET consumed_at = now() WHERE q.tenant_id = ${tenantId} AND q.token_hash = ${h} AND q.phone_number = ${phoneNumber}
      AND q.consumed_at IS NULL AND q.expires_at > now() RETURNING q.id`.execute(this.db);
    const id = claimed.rows?.[0]?.id;
    if (!id) {
      const q: any = await sql`SELECT q.phone_number, q.consumed_at, q.expires_at, q.result_status, q.result_number, q.result_error_code FROM tenant_number_purchase_quotes q WHERE q.tenant_id = ${tenantId} AND q.token_hash = ${h} LIMIT 1`.execute(this.db);
      const r = q.rows?.[0];
      if (!r || r.phone_number !== phoneNumber) throw withCode(new NumberPurchaseError('This purchase confirmation is not valid for this number.'), 'NUMBER_QUOTE_INVALID');
      if (r.consumed_at && r.result_status === 'purchased') return { ok: true, number: String(r.result_number), replayed: true };
      if (r.consumed_at && r.result_status === 'failed') return { ok: false, error: String(r.result_error_code ?? 'purchase failed'), replayed: true };
      if (r.consumed_at) throw withCode(new NumberPurchaseError('This purchase is already in progress.'), 'NUMBER_PURCHASE_IN_PROGRESS');
      throw withCode(new NumberPurchaseError('This purchase confirmation expired.'), 'NUMBER_QUOTE_EXPIRED');
    }
    const out = await this.buyAndRegister(actorUserId, tenantId, phoneNumber);
    const outcome = out.ok ? 'purchased' : 'failed';
    const recorded: any = await sql`UPDATE tenant_number_purchase_quotes q SET result_status = ${outcome}, result_number = ${out.number ?? null}, result_error_code = ${out.ok ? null : (out.reason ?? 'PURCHASE_FAILED')}
      WHERE q.tenant_id = ${tenantId} AND q.id = ${id} AND ${canMoveToSql(TENANT_NUMBER_PURCHASE_QUOTE, outcome, 'q')} RETURNING q.id`.execute(this.db);
    // the quote was claimed by THIS request (consumed_at), so its outcome is still 'quoted'; anything else is a defect worth
    // seeing — the purchase result itself is returned unchanged (nothing is bought or refunded here)
    if (!recorded.rows?.length) logException(new Error('number purchase outcome not recorded: quote no longer quoted'), { where: 'tenant-number.confirmPurchase', tenantId, quoteId: String(id), outcome });
    return out;
  }

  /** Resolve the account to buy under: the salon's own configured account, else the shared ISV account (env). */
  private async resolveAccount(tenantId: string): Promise<{ creds: NumbersCreds | null; own: boolean }> {
    if (this.db) {
      const res: any = await sql`SELECT account_sid, auth_token_enc FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND status = 'configured' AND branch_id IS NULL LIMIT 1`.execute(this.db);
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
      const res: any = await sql`SELECT phone_number FROM tenant_messaging_numbers WHERE tenant_id = ${tenantId} AND channel = 'sms' ORDER BY created_at ASC LIMIT 1`.execute(this.db);
      registeredNumber = res.rows?.[0]?.phone_number ?? null;
    }
    return { tenantId, configured: !!creds, usingOwnAccount: own, registeredNumber };
  }

  async search(tenantId: string, opts: { country?: string; areaCode?: string }): Promise<{ available: AvailableNumber[]; configured: boolean }> {
    const { creds } = await this.resolveAccount(tenantId);
    if (!creds) return { available: [], configured: false };
    const client = this.client(creds);
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
      bought = await this.client(creds).purchase(phoneNumber, { smsUrl: this.inboundWebhookUrl() });
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'purchase failed').replace(/^numbers_failed:/, 'Twilio: ') };
    }
    const reg = await this.register(tenantId, bought.phoneNumber, own, bought.sid, actorUserId);
    if (!reg.ok) return { ok: false, error: reg.error };
    await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'number.purchased', resourceType: 'tenant_messaging_numbers', resourceId: tenantId, summary: `Purchased + registered ${bought.phoneNumber}`, metadata: { sid: bought.sid, ownAccount: own } }).catch(() => undefined);
    return { ok: true, number: bought.phoneNumber };
  }

  /** Register an already-owned number (no purchase) — e.g. a number the salon already has on their account. */
  async registerExisting(actorUserId: string, tenantId: string, phoneNumber: string): Promise<{ ok: boolean; number?: string; error?: string }> {
    if (!/^\+[1-9]\d{6,15}$/.test(phoneNumber || '')) return { ok: false, error: 'A valid E.164 number is required.' };
    const { own } = await this.resolveAccount(tenantId);
    const reg = await this.register(tenantId, phoneNumber, own, null, actorUserId);
    if (!reg.ok) return { ok: false, error: reg.error };
    await this.audit.record({ tenantId, userId: actorUserId }, { module: 'messaging', action: 'number.registered', resourceType: 'tenant_messaging_numbers', resourceId: tenantId, summary: `Registered ${phoneNumber}` }).catch(() => undefined);
    return { ok: true, number: phoneNumber };
  }

  /**
   * wave 3 PAYI §5 / §59: a number belongs to exactly ONE salon — see `registerTenantNumber` (the single write path
   * every caller goes through: number purchase, register-existing, and the salon's own credentials form).
   */
  private async register(tenantId: string, phoneNumber: string, ownAccount: boolean, providerSid: string | null, actorUserId: string | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.db) return { ok: true };
    const reg = await registerTenantNumber(this.db, { tenantId, phoneNumber, providerSid, actorUserId });
    if (!reg.ok) return reg;
    if (ownAccount) {
      // The salon sends through its own account → point that account's from at the new number.
      await sql`UPDATE tenant_messaging_credentials SET from_number = ${phoneNumber}, config_version = config_version + 1, updated_at = now() WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND branch_id IS NULL`.execute(this.db).catch(() => undefined);
    }
    return { ok: true };
  }
}
