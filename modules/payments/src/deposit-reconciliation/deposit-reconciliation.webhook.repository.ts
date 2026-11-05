// deposit-reconciliation.webhook.repository.ts — resolves a webhook endpoint (token -> tenant + bank account +
// secret) and creates a deposit IDEMPOTENTLY (ON CONFLICT DO NOTHING against the external-txn unique index).
import { createHash } from 'node:crypto';
import type { ProviderSecrets } from '@aipowersalon/security';   // the webhook sealer arrives through SECRET_SEALERS.forPurpose('webhook')
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ParsedBankDeposit } from './deposit-reconciliation.webhook';

export interface WebhookEndpoint { tenantId: string; bankAccountId: string; signingSecret: string; status: string }
export interface WebhookRepositoryPort {
  resolveEndpoint(token: string): Promise<WebhookEndpoint | null>;
  createDepositIdempotent(tenantId: string, bankAccountId: string, d: ParsedBankDeposit): Promise<{ id: string | null; idempotent: boolean }>;
}

export class InMemoryWebhookRepository implements WebhookRepositoryPort {
  private endpoints: (WebhookEndpoint & { token: string })[];
  private seen = new Set<string>();
  constructor(endpoints: (WebhookEndpoint & { token: string })[] = []) { this.endpoints = endpoints.slice(); }
  async resolveEndpoint(token: string): Promise<WebhookEndpoint | null> { const e = this.endpoints.find((x) => x.token === token); return e ? { tenantId: e.tenantId, bankAccountId: e.bankAccountId, signingSecret: e.signingSecret, status: e.status } : null; }
  async createDepositIdempotent(tenantId: string, bankAccountId: string, d: ParsedBankDeposit): Promise<{ id: string | null; idempotent: boolean }> {
    const key = `${tenantId}:${bankAccountId}:${d.externalBankTxnId}`;
    if (this.seen.has(key)) return { id: null, idempotent: true };
    this.seen.add(key); return { id: 'dep_' + this.seen.size, idempotent: false };
  }
}

export class KyselyWebhookRepository implements WebhookRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly sealer: ProviderSecrets) {}
  async resolveEndpoint(token: string): Promise<WebhookEndpoint | null> {
    // Constitution 12 M6: look the endpoint up by the token's SHA-256, never by the token; the signing secret lives only
    // in signing_secret_enc. BUILD_PLAN Phase 10 (migration 542, the cleanup 451 promised): the plaintext `token` and
    // `signing_secret` columns are dropped, and this code never reads either — a row still holding a plaintext secret
    // on an older database is sealed by apps/api/scripts/seal-bank-webhook-secrets.mjs, not on a request path.
    const hash = createHash('sha256').update(token).digest('hex');
    const res: any = await sql`SELECT id, tenant_id, bank_account_id, signing_secret_enc, status FROM bank_webhook_endpoints WHERE token_hash = ${hash} LIMIT 1`.execute(this.db as any);
    const r = res.rows?.[0]; if (!r) return null;
    if (!r.signing_secret_enc) return null;                      // an endpoint with no sealed secret cannot authenticate anything
    const secret = this.sealer.decrypt(String(r.signing_secret_enc));
    return { tenantId: String(r.tenant_id), bankAccountId: String(r.bank_account_id), signingSecret: secret, status: String(r.status) };
  }
  async createDepositIdempotent(tenantId: string, bankAccountId: string, d: ParsedBankDeposit): Promise<{ id: string | null; idempotent: boolean }> {
    const res: any = await sql`
      INSERT INTO bank_deposits (tenant_id, bank_account_id, amount_cents, deposit_date, reference, external_bank_txn_id, description, source, status)
      VALUES (${tenantId}, ${bankAccountId}, ${d.amountCents}, ${d.depositDate}, ${d.reference}, ${d.externalBankTxnId}, ${d.description}, ${'bank_feed'}, ${'posted'})
      ON CONFLICT (tenant_id, bank_account_id, external_bank_txn_id) WHERE external_bank_txn_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `.execute(this.db as any);
    const row = res.rows?.[0];
    return row ? { id: String(row.id), idempotent: false } : { id: null, idempotent: true };
  }
}
