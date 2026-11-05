// payment-gateway.resolver.ts — TENANT-ISOLATED payment gateway resolution.
//
// The checkout service must process every card payment with the CURRENT TENANT's own gateway credentials — never a
// shared/global merchant. This resolver loads exactly one tenant's tenant_payment_config row (scoped by the
// server-derived tenantId) and builds a PaymentProcessor bound to that tenant's merchant id + credentials, or returns
// `configured:false` when the tenant has not been provisioned. Credentials are encrypted at rest (AES-256-GCM, same
// cipher as mfa_factors.secret_enc) and only ever decrypted inside this backend resolver — never returned to a client.
//
// Strict by default: no env/global fallback unless PAYMENTS_ALLOW_ENV_FALLBACK=1 (a transition aid only).

import { assertTransition } from '@aipowersalon/database';
import { PAYMENT_GATEWAY, MERCHANT_ONBOARDING } from '../payments-lifecycles';
import { instrumentedFetch } from '@aipowersalon/observability';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PaymentProcessor } from './payment-processor.port';
import { CardPointeClient, type FetchLike } from './cardpointe.client';
import { CloverPaymentAdapter } from './clover.client';
import { processorFromEnv } from './processor.factory';
import type { PaymentSecrets } from '@aipowersalon/security';
import { maskSecretTail as maskSecret } from '@aipowersalon/security';
import { missingGatewayCredentials, webhookHealth } from './payment-gateways-core';
import { tokenizerForGatewayBase } from './card-data';
import { randomBytes, createHash } from 'node:crypto';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { GatewayStatus, MaskedPaymentGateway } from '@aipowersalon/api-contracts/tenant';
import type { GatewayStatus, MaskedPaymentGateway } from '@aipowersalon/api-contracts/tenant';


export interface ResolvedGateway {
  processor?: PaymentProcessor;          // tenant-bound processor; undefined when not usable
  processorType: string;                 // 'fiserv' | 'cardpointe' | 'none'
  environment: 'sandbox' | 'production';
  merchantIdMasked: string;              // safe to surface; full MID never leaves the backend
  status: GatewayStatus;
  configured: boolean;                   // true only when a usable processor was built
  /** Constitution 7 §34 — set when the platform has paused this payment integration (kill switch). */
  pausedByPlatform?: boolean;
  /** Payments mandate §7/§13 (wave 3): which merchant account the router chose — 'branch' = the branch's own row in
   *  payment_merchant_accounts (merchantAccountId = its id), 'tenant' = the tenant default (tenant_payment_config, id null). */
  scope?: 'tenant' | 'branch';
  branchId?: string | null;
  merchantAccountId?: string | null;
  /** §168: the configuration version the processor was built from (part of the router cache key, §169). */
  configVersion?: number;
}

/** The columns a merchant configuration row carries — the tenant default (tenant_payment_config) and a branch merchant
 *  (payment_merchant_accounts) share them, so ONE builder turns either into a processor. */
interface MerchantConfigRow {
  processor: string | null; merchant_id: string | null; status: string | null; environment: string | null; base_url: string | null;
  api_username_enc: string | null; api_password_enc: string | null; config_version?: number | null;
}

// What the frontend/Super Admin is allowed to see — never raw secrets (spec §8).

/** Masked view of a branch's own merchant account (migration 638) — never a credential. */
export interface BranchMerchantAccountView {
  id: string; tenantId: string; branchId: string; branchName: string | null; processorType: string; environment: 'sandbox' | 'production';
  displayName: string | null; merchantIdMasked: string; currency: string; status: GatewayStatus; credentialsConfigured: boolean;
  terminalConfigured: boolean; terminalBaseUrl: string | null; webhookSecretConfigured: boolean; configVersion: number;
  lastValidatedAt: string | null; lastValidationError: string | null; updatedAt: string | null;
}

export interface UpsertGatewayInput {
  processorType?: 'fiserv' | 'cardpointe' | 'clover' | 'none';
  environment?: 'sandbox' | 'production';
  baseUrl?: string;
  merchantId?: string;
  apiUsername?: string;     // encrypted before storage
  apiPassword?: string;     // encrypted before storage
  webhookSecret?: string;   // encrypted before storage
  /** CardPointe Integrated Terminal (Bolt, P2PE): the API base (e.g. https://bolt-uat.cardpointe.com/api) and the
   *  per-merchant Authorization key. The key is encrypted before storage; terminals themselves are paired with their HSN
   *  in POS settings. */
  boltBaseUrl?: string;
  boltApiKey?: string;      // encrypted before storage
  status?: GatewayStatus;
  onboardingStatus?: 'not_started' | 'submitted' | 'under_review' | 'approved' | 'declined';
}

const NOT_CONFIGURED: ResolvedGateway = {
  processor: undefined, processorType: 'none', environment: 'sandbox',
  merchantIdMasked: '', status: 'not_configured', configured: false, scope: 'tenant', merchantAccountId: null,
};

export class PaymentGatewayResolver {
  constructor(private readonly db: Kysely<DB> | null, private readonly secrets: PaymentSecrets) {}

  private transport(): FetchLike {
    return (url, init) => (globalThis.fetch as unknown as FetchLike)(url, init);
  }

  /**
   * THE payment provider router (mandate §13): tenant + branch → merchant configuration → provider → adapter.
   *   • branchId given and that branch has its OWN merchant (payment_merchant_accounts, scoped by THIS tenant id) → that
   *     row decides, whatever its status: a paused / disabled / pending branch merchant blocks card charging at that branch
   *     — it never silently falls back to the tenant default (a different MID would settle the money somewhere else).
   *   • otherwise the tenant default (tenant_payment_config) — exactly the pre-wave-3 behaviour.
   * The tenant and branch come from the trusted session (callers pass ctx.tenantId / ctx.branchId), never from a body.
   * Never touches another tenant's row: every read is keyed by tenant_id first.
   */
  async resolve(tenantId: string, branchId?: string | null): Promise<ResolvedGateway> {
    if (!this.db) {
      // dev/in-memory: optional single env gateway, only if explicitly allowed.
      if (process.env.PAYMENTS_ALLOW_ENV_FALLBACK === '1') {
        const p = processorFromEnv();
        if (p) return { processor: p, processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '', status: 'active', configured: true, scope: 'tenant', branchId: branchId ?? null, merchantAccountId: null };
      }
      return { ...NOT_CONFIGURED, branchId: branchId ?? null };
    }
    if (branchId) {
      const br: any = await this.db.selectFrom('payment_merchant_accounts').selectAll()
        .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst().catch(() => undefined);
      if (br) return this.build(tenantId, br as MerchantConfigRow, { scope: 'branch', branchId, merchantAccountId: String(br.id) });
    }
    const row = await this.db.selectFrom('tenant_payment_config').selectAll()
      .where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (!row) return { ...(await this.envFallback()), branchId: branchId ?? null };
    return this.build(tenantId, row as unknown as MerchantConfigRow, { scope: 'tenant', branchId: branchId ?? null, merchantAccountId: null });
  }

  /** §169: built processors cached per (tenant, branch scope, provider, version, credential fingerprint) — the key changes
   *  whenever any credential column changes, so a write can never leave a stale processor in use; bounded. No
   *  process-global "current merchant" (§170): the key always names the tenant. */
  private built = new Map<string, PaymentProcessor>();
  private cacheKey(tenantId: string, scope: string, row: MerchantConfigRow): string {
    const fp = createHash('sha256').update([row.processor, row.merchant_id, row.base_url, row.api_username_enc, row.api_password_enc].map((x) => String(x ?? '')).join('\u0000')).digest('hex').slice(0, 24);
    return `${tenantId}|${scope}|${String(row.processor || '')}|${Number(row.config_version ?? 1)}|${fp}`;
  }

  private async build(tenantId: string, row: MerchantConfigRow, route: { scope: 'tenant' | 'branch'; branchId: string | null; merchantAccountId: string | null }): Promise<ResolvedGateway> {
    const status = (row.status as GatewayStatus) || 'not_configured';
    const masked = maskSecret(row.merchant_id || '');
    const env = (row.environment as 'sandbox' | 'production') || 'sandbox';
    const configVersion = Number(row.config_version ?? 1);
    const base = { processorType: String(row.processor || 'none'), environment: env, merchantIdMasked: masked, ...route, configVersion };
    if (status !== 'active') return { ...base, processor: undefined, status, configured: false };
    const ptype = (row.processor || '').toLowerCase();
    const key = this.cacheKey(tenantId, route.scope === 'branch' ? `branch:${route.branchId}` : 'tenant', row);
    let processor = this.built.get(key);
    if (!processor) {
      const merchid = row.merchant_id || '';
      const username = row.api_username_enc ? this.secrets.decrypt(row.api_username_enc) : '';
      const password = row.api_password_enc ? this.secrets.decrypt(row.api_password_enc) : '';
      const baseUrl = row.base_url || '';
      if (ptype === 'clover') {
        // Clover Ecommerce: Bearer private access token (stored in api_password_enc); base URL defaults to scl.clover.com.
        if (!password) return { ...base, processor: undefined, status: 'error', configured: false };
        processor = new CloverPaymentAdapter({ baseUrl: baseUrl || 'https://scl.clover.com', apiAccessToken: password, currency: 'usd' }, instrumentedFetch('clover', this.transport()));
      } else {
        // Fiserv / CardConnect (CardPointe): HTTP Basic with a per-tenant merchant id + credentials.
        // active flag but credentials incomplete → treat as not usable (honest), do NOT fall back to another gateway.
        if (!baseUrl || !merchid || !username || !password) return { ...base, processor: undefined, status: 'error', configured: false };
        processor = new CardPointeClient({ baseUrl, merchid, username, password, currency: 'USD' }, instrumentedFetch('cardpointe', this.transport()));
      }
      if (this.built.size >= 500) this.built.delete(this.built.keys().next().value as string);
      this.built.set(key, processor);
    }
    // Constitution 7 §34: a paused payment INTEGRATION (platform kill switch) makes the processor unusable for every salon
    // on it — the tenant's own configuration is untouched and comes back the moment the switch is released.
    if (await this.integrationPaused(ptype === 'clover' ? 'clover' : 'cardpointe')) {
      return { ...base, processor: undefined, status: 'paused', configured: false, pausedByPlatform: true };
    }
    return { ...base, processor, status: 'active', configured: true };
  }

  /** platform_settings 'payments.<integration>_disabled', read at most every 15 s; a failed read keeps the last value. */
  private paused = new Map<string, { at: number; off: boolean }>();
  private async integrationPaused(integration: 'cardpointe' | 'clover', now = Date.now()): Promise<boolean> {
    if (!this.db) return false;
    const hit = this.paused.get(integration);
    if (hit && now - hit.at < 15_000) return hit.off;
    try {
      const r: any = await sql`select value from platform_settings where setting_key = ${`payments.${integration}_disabled`} limit 1`.execute(this.db as any);
      const v = r.rows[0]?.value;
      this.paused.set(integration, { at: now, off: v === true || v === 'true' });
    } catch { if (!hit) this.paused.set(integration, { at: now, off: false }); }
    return this.paused.get(integration)!.off;
  }

  /** Resolve a tenant by its live merchant id (for inbound webhooks). The MID is looked up in BOTH the tenant defaults and
   *  the branch merchants (§10); exactly one match across both is required — unknown or ambiguous → null (never picks an
   *  arbitrary "first" row, never borrows another tenant's gateway). Decrypts THAT row's webhook secret for verification. */
  async resolveTenantByMerchantId(merchantId: string): Promise<{ tenantId: string; branchId: string | null; merchantAccountId: string | null; processorType: string; environment: 'sandbox' | 'production'; merchantIdMasked: string; status: GatewayStatus; webhookSecret: string | null } | null> {
    if (!this.db || !merchantId) return null;
    const rows = await this.db.selectFrom('tenant_payment_config').selectAll().where('merchant_id', '=', merchantId).execute().catch(() => [] as any[]);
    const branchRows = await this.db.selectFrom('payment_merchant_accounts').selectAll().where('merchant_id', '=', merchantId).execute().catch(() => [] as any[]);
    if (rows.length + branchRows.length !== 1) return null; // unknown or ambiguous merchant id → reject
    const row: any = rows[0] ?? branchRows[0];
    const isBranch = !rows[0];
    return {
      tenantId: row.tenant_id,
      branchId: isBranch ? String(row.branch_id) : null,
      merchantAccountId: isBranch ? String(row.id) : null,
      processorType: row.processor,
      environment: (row.environment as 'sandbox' | 'production') || 'sandbox',
      merchantIdMasked: maskSecret(row.merchant_id || ''),
      status: (row.status as GatewayStatus) || 'not_configured',
      webhookSecret: row.webhook_secret_enc ? this.secrets.decrypt(row.webhook_secret_enc) : null,
    };
  }

  private async envFallback(): Promise<ResolvedGateway> {
    if (process.env.PAYMENTS_ALLOW_ENV_FALLBACK === '1') {
      const p = processorFromEnv();
      if (p) return { processor: p, processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '', status: 'active', configured: true, scope: 'tenant', merchantAccountId: null };
    }
    return NOT_CONFIGURED;
  }

  /**
   * Payments mandate §13 / §17 (wave 3): the TERMINAL route. The Clover Compact is driven through CardPointe Integrated
   * Terminal (Bolt) with the merchant account the terminal charges through: the terminal's own merchant_account_id when
   * set, else the branch's merchant account, else the tenant default. The Bolt key is decrypted here and only here;
   * the caller gets a config it can hand to the Bolt adapter, never a row. Status is honoured exactly like `resolve`:
   * a merchant that is not active yields `reason`, never a silently different MID.
   */
  async resolveTerminalConfig(tenantId: string, branchId: string | null, merchantAccountId?: string | null): Promise<
    { config: { baseUrl: string; apiKey: string; merchantId: string }; scope: 'tenant' | 'branch'; merchantAccountId: string | null; configVersion: number; reason?: undefined }
    | { config: null; scope: 'tenant' | 'branch'; merchantAccountId: string | null; configVersion: number; reason: 'MERCHANT_NOT_CONFIGURED' | 'MERCHANT_SUSPENDED' | 'TERMINAL_NOT_CONFIGURED' | 'SECRET_UNREADABLE' }> {
    if (!this.db) return { config: null, scope: 'tenant', merchantAccountId: null, configVersion: 1, reason: 'MERCHANT_NOT_CONFIGURED' };
    const cols = ['id', 'tenant_id', 'status', 'merchant_id', 'bolt_base_url', 'bolt_api_key_enc', 'config_version'] as const;
    let row: any; let scope: 'tenant' | 'branch' = 'tenant'; let accountId: string | null = null;
    if (merchantAccountId) {
      row = await this.db.selectFrom('payment_merchant_accounts').select(cols as any).where('tenant_id', '=', tenantId).where('id', '=', merchantAccountId).executeTakeFirst().catch(() => undefined);
      if (row) { scope = 'branch'; accountId = String(row.id); }
    }
    if (!row && branchId) {
      row = await this.db.selectFrom('payment_merchant_accounts').select(cols as any).where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst().catch(() => undefined);
      if (row) { scope = 'branch'; accountId = String(row.id); }
    }
    if (!row) row = await this.db.selectFrom('tenant_payment_config').select(['status', 'merchant_id', 'bolt_base_url', 'bolt_api_key_enc', 'config_version'] as any).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    const configVersion = Number(row?.config_version ?? 1);
    if (!row) return { config: null, scope, merchantAccountId: accountId, configVersion, reason: 'MERCHANT_NOT_CONFIGURED' };
    if (row.status !== 'active') return { config: null, scope, merchantAccountId: accountId, configVersion, reason: row.status === 'paused' || row.status === 'disabled' ? 'MERCHANT_SUSPENDED' : 'MERCHANT_NOT_CONFIGURED' };
    if (!row.bolt_base_url || !row.bolt_api_key_enc || !row.merchant_id) return { config: null, scope, merchantAccountId: accountId, configVersion, reason: 'TERMINAL_NOT_CONFIGURED' };
    let apiKey: string;
    try { apiKey = this.secrets.decrypt(String(row.bolt_api_key_enc)); } catch { return { config: null, scope, merchantAccountId: accountId, configVersion, reason: 'SECRET_UNREADABLE' }; }
    return { config: { baseUrl: String(row.bolt_base_url), apiKey, merchantId: String(row.merchant_id) }, scope, merchantAccountId: accountId, configVersion };
  }

  /** Masked view for Super Admin / POS — never includes raw secrets. */
  async getMasked(tenantId: string): Promise<MaskedPaymentGateway> {
    const g = await this.resolve(tenantId);
    const onb: any = this.db
      ? await this.db.selectFrom('tenant_payment_config').select(['onboarding_status', 'bolt_base_url', 'bolt_api_key_enc'] as any).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined)
      : undefined;
    return { processorType: g.processorType, environment: g.environment, merchantIdMasked: g.merchantIdMasked, status: g.status, setupRequired: !g.configured, onboardingStatus: (onb?.onboarding_status as string) || 'not_started' , terminalConfigured: !!(onb?.bolt_base_url && onb?.bolt_api_key_enc), terminalBaseUrl: onb?.bolt_base_url ? String(onb.bolt_base_url) : null };
  }

  /** Non-charging connectivity check. Honest: confirms a tenant-bound processor can be built from stored credentials,
   *  but does NOT perform a live gateway round-trip (that needs a CardPointe sandbox). Never returns a fake "reachable". */
  async testConnection(tenantId: string): Promise<{ ok: boolean; configured: boolean; status: GatewayStatus; environment: 'sandbox' | 'production'; merchantIdMasked: string; tested: boolean; note: string; gateway?: { merchantEnabled?: boolean; cardProcessor?: string; avsSupported?: boolean; cvvSupported?: boolean } }> {
    const g = await this.resolve(tenantId);
    if (!g.configured) {
      return { ok: false, configured: false, status: g.status, environment: g.environment, merchantIdMasked: g.merchantIdMasked, tested: false,
        note: g.status === 'pending' ? 'Gateway provisioned but not yet activated.' : 'Gateway not configured for this tenant.' };
    }
    // A real, charge-free round trip when the processor offers one (CardPointe: inquireMerchant). Honest when it does not.
    if (g.processor?.testConnection) {
      const r = await g.processor.testConnection();
      return { ok: r.ok, configured: true, status: g.status, environment: g.environment, merchantIdMasked: g.merchantIdMasked, tested: true, note: r.message,
        gateway: { merchantEnabled: r.merchantEnabled, cardProcessor: r.cardProcessor, avsSupported: r.avsSupported, cvvSupported: r.cvvSupported } };
    }
    return {
      ok: true, configured: true, status: g.status, environment: g.environment, merchantIdMasked: g.merchantIdMasked, tested: false,
      note: 'Credentials present and a tenant-bound processor was built. This processor offers no charge-free round trip.',
    };
  }

  /** The salon's CardSecure hosted iFrame tokenizer (Fiserv "Hosted iFrame Tokenizer"): the card is typed into a page on
   *  the gateway's own host and only a TOKEN comes back to the browser — the card number never reaches the app or this
   *  backend (PCI SAQ A). Derived from the tenant's gateway host; no credential is involved. */
  async tokenizerUrl(tenantId: string): Promise<{ available: boolean; url?: string; origin?: string; reason?: string }> {
    if (!this.db) return { available: false, reason: 'no_database' };
    const row: any = await this.db.selectFrom('tenant_payment_config').select(['processor', 'base_url', 'status'] as any).where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (!row || !row.base_url || !['fiserv', 'cardpointe'].includes(String(row.processor))) return { available: false, reason: 'gateway_not_configured' };
    return tokenizerForGatewayBase(String(row.base_url));
  }

  /** Provision/update a tenant's gateway. Secrets are encrypted before storage; only set fields are written. */
  async upsertConfig(tenantId: string, input: UpsertGatewayInput, updatedByUserId?: string): Promise<MaskedPaymentGateway> {
    if (!this.db) throw new Error('payment gateway persistence requires a database');
    const set: Record<string, unknown> = { updated_at: sql`now()`, updated_by_user_id: updatedByUserId ?? null };
    if (input.processorType !== undefined) set.processor = input.processorType;
    if (input.environment !== undefined) set.environment = input.environment;
    if (input.baseUrl !== undefined) set.base_url = input.baseUrl || null;
    if (input.merchantId !== undefined) set.merchant_id = input.merchantId || null;
    if (input.apiUsername !== undefined) set.api_username_enc = input.apiUsername ? this.secrets.encrypt(input.apiUsername) : null;
    if (input.apiPassword !== undefined) set.api_password_enc = input.apiPassword ? this.secrets.encrypt(input.apiPassword) : null;
    if (input.webhookSecret !== undefined) set.webhook_secret_enc = input.webhookSecret ? this.secrets.encrypt(input.webhookSecret) : null;
    if (input.boltBaseUrl !== undefined) set.bolt_base_url = input.boltBaseUrl ? input.boltBaseUrl.replace(/\/+$/, '') : null;
    if (input.boltApiKey !== undefined) set.bolt_api_key_enc = input.boltApiKey ? this.secrets.encrypt(input.boltApiKey) : null;
    if (input.status !== undefined) set.status = input.status;
    if (input.onboardingStatus !== undefined) set.onboarding_status = input.onboardingStatus;
    if (input.merchantId) set.fiserv_configured = true;
    if (input.status === 'active') set.configured_at = sql`now()`;

    const existing: any = await this.db.selectFrom('tenant_payment_config').select(['tenant_id', 'status', 'onboarding_status'] as any)
      .where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (existing) {
      // Phase 12 (#27): a status / onboarding status in the form moves through its machine (409 on a move it does not list)
      // and the write is conditional on what was read
      if (set.status !== undefined && existing.status) assertTransition(PAYMENT_GATEWAY, existing.status, String(set.status));
      if (set.onboarding_status !== undefined && existing.onboarding_status) assertTransition(MERCHANT_ONBOARDING, existing.onboarding_status, String(set.onboarding_status));
      // §168: every configuration write is a new version (the router's cache key and the audit trail name it)
      let q = this.db.updateTable('tenant_payment_config').set({ ...set, config_version: sql`config_version + 1` } as any).where('tenant_id', '=', tenantId);
      if (set.status !== undefined && existing.status) q = q.where('status', '=', existing.status);
      if (set.onboarding_status !== undefined && existing.onboarding_status) q = q.where('onboarding_status', '=', existing.onboarding_status);
      await q.execute();
    } else {
      await this.db.insertInto('tenant_payment_config').values({ tenant_id: tenantId, ...(set as any) }).execute();
    }
    return this.getMasked(tenantId);
  }

  // ── Branch merchant accounts (mandate §7 / §10, migration 638) ──────────────────────────────────────────────────────
  // A multi-location salon whose branch settles to its own MID. Same rules as the tenant default: credentials sealed on
  // write with the PAYMENT secrets, never selected back (masked view), status through the PAYMENT_GATEWAY machine, every
  // write a new config_version. The tenant id always comes from the caller's trusted scope (Super Admin names it, the
  // tenant's own screens use their session) and every statement is keyed by it.
  private maskBranchRow(r: any): BranchMerchantAccountView {
    return {
      id: String(r.id), tenantId: String(r.tenant_id), branchId: String(r.branch_id), branchName: r.branch_name ? String(r.branch_name) : null,
      processorType: String(r.processor || 'none'), environment: (r.environment as 'sandbox' | 'production') || 'sandbox', displayName: r.display_name ?? null,
      merchantIdMasked: maskSecret(r.merchant_id || ''), currency: String(r.currency || 'USD'), status: (r.status as GatewayStatus) || 'pending',
      credentialsConfigured: !!(r.api_username_enc && r.api_password_enc) || (String(r.processor) === 'clover' && !!r.api_password_enc),
      terminalConfigured: !!(r.bolt_base_url && r.bolt_api_key_enc), terminalBaseUrl: r.bolt_base_url ? String(r.bolt_base_url) : null,
      webhookSecretConfigured: !!r.webhook_secret_enc, configVersion: Number(r.config_version ?? 1),
      lastValidatedAt: r.last_validated_at ? new Date(r.last_validated_at).toISOString() : null, lastValidationError: r.last_validation_error ?? null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    };
  }

  async listBranchMerchants(tenantId: string): Promise<BranchMerchantAccountView[]> {
    if (!this.db) return [];
    const rows: any[] = await sql`SELECT m.*, b.name AS branch_name FROM payment_merchant_accounts m LEFT JOIN branches b ON b.id = m.branch_id
      WHERE m.tenant_id = ${tenantId}::uuid ORDER BY b.name NULLS LAST, m.created_at`.execute(this.db as any).then((r: any) => r.rows).catch(() => []);
    return rows.map((r) => this.maskBranchRow(r));
  }

  async getBranchMerchant(tenantId: string, branchId: string): Promise<BranchMerchantAccountView | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT m.*, b.name AS branch_name FROM payment_merchant_accounts m LEFT JOIN branches b ON b.id = m.branch_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.branch_id = ${branchId}::uuid LIMIT 1`.execute(this.db as any).then((x: any) => x.rows[0]).catch(() => undefined);
    return r ? this.maskBranchRow(r) : null;
  }

  async upsertBranchMerchant(tenantId: string, branchId: string, input: UpsertGatewayInput & { displayName?: string | null; currency?: string }, updatedByUserId?: string): Promise<BranchMerchantAccountView> {
    if (!this.db) throw new Error('payment gateway persistence requires a database');
    const branch: any = await this.db.selectFrom('branches').select(['id']).where('id', '=', branchId as any).where('tenant_id', '=', tenantId as any).executeTakeFirst().catch(() => undefined);
    if (!branch) throw Object.assign(new Error('That location does not belong to this salon.'), { expose: true, status: 404, code: 'BRANCH_NOT_FOUND' });
    const set: Record<string, unknown> = { updated_at: sql`now()`, updated_by: updatedByUserId ?? null };
    if (input.processorType !== undefined) set.processor = input.processorType === 'none' ? 'fiserv' : input.processorType;
    if (input.environment !== undefined) set.environment = input.environment;
    if (input.baseUrl !== undefined) set.base_url = input.baseUrl || null;
    if (input.merchantId !== undefined) set.merchant_id = input.merchantId || null;
    if (input.displayName !== undefined) set.display_name = input.displayName || null;
    if (input.currency !== undefined && /^[A-Z]{3}$/.test(String(input.currency))) set.currency = input.currency;
    if (input.apiUsername !== undefined) set.api_username_enc = input.apiUsername ? this.secrets.encrypt(input.apiUsername) : null;
    if (input.apiPassword !== undefined) set.api_password_enc = input.apiPassword ? this.secrets.encrypt(input.apiPassword) : null;
    if (input.webhookSecret !== undefined) set.webhook_secret_enc = input.webhookSecret ? this.secrets.encrypt(input.webhookSecret) : null;
    if (input.boltBaseUrl !== undefined) set.bolt_base_url = input.boltBaseUrl ? input.boltBaseUrl.replace(/\/+$/, '') : null;
    if (input.boltApiKey !== undefined) set.bolt_api_key_enc = input.boltApiKey ? this.secrets.encrypt(input.boltApiKey) : null;
    if (input.status !== undefined) set.status = input.status;
    // §164: new credentials are untested credentials
    if (input.apiUsername !== undefined || input.apiPassword !== undefined || input.baseUrl !== undefined || input.merchantId !== undefined) { set.last_validated_at = null; set.last_validation_error = null; }
    const existing: any = await this.db.selectFrom('payment_merchant_accounts').select(['id', 'status']).where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst().catch(() => undefined);
    if (existing) {
      if (set.status !== undefined && existing.status && set.status !== existing.status) assertTransition(PAYMENT_GATEWAY, String(existing.status), String(set.status));
      let q = this.db.updateTable('payment_merchant_accounts').set({ ...set, config_version: sql`config_version + 1` } as any).where('tenant_id', '=', tenantId).where('branch_id', '=', branchId);
      if (set.status !== undefined && existing.status) q = q.where('status', '=', existing.status);
      await q.execute();
    } else {
      if (!set.processor) set.processor = 'fiserv';
      await this.db.insertInto('payment_merchant_accounts').values({ tenant_id: tenantId, branch_id: branchId, created_by: updatedByUserId ?? null, ...(set as any) }).execute();
    }
    return (await this.getBranchMerchant(tenantId, branchId))!;
  }

  /** §165: a charge-free round trip for the branch merchant (CardPointe inquireMerchant); the outcome is recorded on the row. */
  async testBranchConnection(tenantId: string, branchId: string): Promise<{ ok: boolean; configured: boolean; status: GatewayStatus; tested: boolean; note: string; scope: 'tenant' | 'branch' }> {
    const g = await this.resolve(tenantId, branchId);
    if (g.scope !== 'branch') return { ok: false, configured: false, status: 'not_configured', tested: false, note: 'This location has no merchant account of its own (it uses the salon default).', scope: 'tenant' };
    if (!g.configured) return { ok: false, configured: false, status: g.status, tested: false, note: g.status === 'pending' ? 'Merchant account provisioned but not yet activated.' : g.status === 'error' ? 'Credentials are incomplete for this merchant account.' : `Merchant account is ${g.status}.`, scope: 'branch' };
    let out: { ok: boolean; tested: boolean; note: string };
    if (g.processor?.testConnection) {
      try { const r = await g.processor.testConnection(); out = { ok: r.ok, tested: true, note: r.message }; }
      catch (e) { out = { ok: false, tested: true, note: `Could not reach the processor: ${(e as Error).message}` }; }
    } else out = { ok: true, tested: false, note: `${g.processorType} offers no charge-free connectivity check; credentials decrypt and a processor was built.` };
    if (this.db) await this.db.updateTable('payment_merchant_accounts').set((out.ok ? { last_validated_at: sql`now()`, last_validation_error: null } : { last_validation_error: out.note.slice(0, 500) }) as any)
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).execute().catch(() => undefined);
    return { ...out, configured: true, status: g.status, scope: 'branch' };
  }

  async setBranchMerchantStatus(tenantId: string, branchId: string, status: GatewayStatus, updatedByUserId?: string): Promise<BranchMerchantAccountView> {
    return this.upsertBranchMerchant(tenantId, branchId, { status }, updatedByUserId);
  }

  /** Verify Credentials (spec §5/§6) — distinct from testConnection: reports exactly which REQUIRED credential fields are
   *  still missing for the chosen processor, without ever decrypting/returning the secret values. */
  async verifyCredentials(tenantId: string): Promise<{ ok: boolean; configured: boolean; processorType: string; environment: 'sandbox' | 'production'; missing: string[]; note: string }> {
    if (!this.db) return { ok: false, configured: false, processorType: 'none', environment: 'sandbox', missing: [], note: 'No persistence configured.' };
    const row = await this.db.selectFrom('tenant_payment_config').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (!row) return { ok: false, configured: false, processorType: 'none', environment: 'sandbox', missing: [], note: 'Gateway not configured for this tenant.' };
    const missing = missingGatewayCredentials(row.processor, {
      merchantId: !!row.merchant_id, apiUsername: !!row.api_username_enc, apiPassword: !!row.api_password_enc, baseUrl: !!row.base_url,
    });
    const environment = (row.environment as 'sandbox' | 'production') || 'sandbox';
    return {
      ok: missing.length === 0, configured: missing.length === 0, processorType: row.processor, environment, missing,
      note: missing.length === 0
        ? 'All required credentials are present (stored encrypted). Live verification against the processor requires its sandbox.'
        : `Missing required credential(s): ${missing.join(', ')}.`,
    };
  }

  /** Sync Merchant Status (spec §5/§6) — returns the current persisted boarding/underwriting status. Honest: a live pull
   *  needs the processor's merchant API (sandbox); inbound merchant_status_changed webhooks update this automatically. */
  async syncMerchantStatus(tenantId: string): Promise<{ onboardingStatus: string; status: GatewayStatus; synced: boolean; note: string }> {
    const masked = await this.getMasked(tenantId);
    return {
      onboardingStatus: masked.onboardingStatus, status: masked.status, synced: false,
      note: 'Current persisted boarding status. A live boarding-status pull requires the processor’s merchant API (sandbox); merchant_status_changed webhooks update this automatically.',
    };
  }

  /** Rotate Webhook Secret (spec §5 dangerous action) — generates a new signing secret, stores it encrypted, and returns
   *  the plaintext ONCE so the admin can set it in the processor dashboard (never retrievable again). */
  async rotateWebhookSecret(tenantId: string, updatedByUserId?: string): Promise<{ rotated: boolean; secretOnce: string; secretMasked: string; note: string }> {
    if (!this.db) throw new Error('payment gateway persistence requires a database');
    const exists = await this.db.selectFrom('tenant_payment_config').select('tenant_id').where('tenant_id', '=', tenantId).executeTakeFirst().catch(() => undefined);
    if (!exists) throw new Error('Gateway not configured for this tenant.');
    const secret = 'whsec_' + randomBytes(24).toString('hex');
    await this.db.updateTable('tenant_payment_config')
      .set({ webhook_secret_enc: this.secrets.encrypt(secret), updated_at: sql`now()`, updated_by_user_id: updatedByUserId ?? null, config_version: sql`config_version + 1` } as any)
      .where('tenant_id', '=', tenantId).execute();
    return { rotated: true, secretOnce: secret, secretMasked: maskSecret(secret), note: 'Copy this secret now — it is shown once. Set it as the webhook signing secret in your processor’s dashboard.' };
  }

  /** Settlement history for a tenant (spec §5/§6) — safe summary rows from payment_settlements; no secrets. */
  async listSettlements(tenantId: string, limit = 25): Promise<{ settlements: Array<{ id: string; settlementId: string | null; grossCents: number; feeCents: number; netCents: number; currency: string; status: string; settledAt: string | null }> }> {
    if (!this.db) return { settlements: [] };
    const rows = await this.db.selectFrom('payment_settlements').selectAll().where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc').limit(Math.min(Math.max(limit, 1), 200)).execute().catch(() => [] as any[]);
    return { settlements: (rows as any[]).map((r) => ({
      id: r.id, settlementId: r.settlement_id ?? null, grossCents: r.gross_cents ?? 0, feeCents: r.fee_cents ?? 0,
      netCents: r.net_cents ?? 0, currency: r.currency || 'USD', status: r.status || 'pending',
      settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
    })) };
  }

  /** Webhook events + health for a tenant (spec §4.H/§6) — recent inbound processor webhooks with signature-verification
   *  status; no secrets. `health` flips to 'failing' if any recent event failed signature verification. */
  async listWebhookEvents(tenantId: string, limit = 25): Promise<{ events: Array<{ id: string; eventType: string | null; processorType: string; signatureValid: boolean; matched: boolean; receivedAt: string | null }>; health: ReturnType<typeof webhookHealth> }> {
    if (!this.db) return { events: [], health: webhookHealth([]) };
    const rows = await this.db.selectFrom('payment_gateway_events').selectAll().where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc').limit(Math.min(Math.max(limit, 1), 200)).execute().catch(() => [] as any[]);
    const events = (rows as any[]).map((r) => ({
      id: r.id, eventType: r.event_type ?? null, processorType: r.processor_type || '',
      signatureValid: !!r.signature_valid, matched: !!r.matched_payment_id,
      receivedAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
    return { events, health: webhookHealth(events.map((e) => ({ signatureValid: e.signatureValid, receivedAt: e.receivedAt }))) };
  }
}
