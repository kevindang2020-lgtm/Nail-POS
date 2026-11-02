// communications-providers.kysely.repository.ts — persistence for communication providers (§27). CRITICAL: read paths
// (list/get) select SAFE columns only and NEVER credential_enc. Only the internal validation flow decrypts the secret,
// via credentialEnc(id), which is used server-side and never returned to a client. Writes are non-swallowing.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { COMMUNICATION_PROVIDER } from '../communications-lifecycles';

const SAFE_COLS = sql`id::text as id, name, channel, region, account_reference, api_endpoint, webhook_endpoint,
  webhook_signing_status, priority, failover_priority, rate_limit, monthly_limit, status, credential_last4,
  last_successful_at::text as last_successful_at, last_health_check_at::text as last_health_check_at, created_at::text as created_at`;

export interface ProviderSafe { id: string; name: string; channel: string; region: string | null; account_reference: string | null; api_endpoint: string | null; webhook_endpoint: string | null; webhook_signing_status: string; priority: number; failover_priority: number | null; rate_limit: number | null; monthly_limit: number | null; status: string; credential_last4: string | null; last_successful_at: string | null; last_health_check_at: string | null; created_at: string }

export class CommunicationsProvidersRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(): Promise<ProviderSafe[]> {
    try { return (await sql`select ${SAFE_COLS} from communication_providers order by priority asc, name asc`.execute(this.db as any)).rows as ProviderSafe[]; } catch { return []; }
  }

  async get(id: string): Promise<ProviderSafe | null> {
    const r = (await sql`select ${SAFE_COLS} from communication_providers where id = ${id} limit 1`.execute(this.db as any)).rows[0] as ProviderSafe | undefined;
    return r ?? null;
  }

  /** Internal only — decryptable secret for the validation flow. Never exposed by a controller. */
  async credentialEnc(id: string): Promise<string | null> {
    const r = (await sql`select credential_enc from communication_providers where id = ${id} limit 1`.execute(this.db as any)).rows[0] as { credential_enc: string | null } | undefined;
    return r?.credential_enc ?? null;
  }

  async insert(i: { name: string; channel: string; region: string | null; accountRef: string | null; apiEndpoint: string | null; webhookEndpoint: string | null; priority: number; credentialEnc: string | null; credentialLast4: string | null; createdBy: string | null }): Promise<{ id: string }> {
    const r = (await sql`insert into communication_providers (name, channel, region, account_reference, api_endpoint, webhook_endpoint, priority, status, credential_enc, credential_last4, created_by)
      values (${i.name}, ${i.channel}, ${i.region}, ${i.accountRef}, ${i.apiEndpoint}, ${i.webhookEndpoint}, ${i.priority}, 'test', ${i.credentialEnc}, ${i.credentialLast4}, ${i.createdBy})
      returning id::text as id`.execute(this.db as any)).rows[0] as { id: string };
    return r;
  }

  async updateConfig(id: string, i: { name: string; region: string | null; apiEndpoint: string | null; webhookEndpoint: string | null; priority: number; status: string }): Promise<void> {
    await sql`update communication_providers set name = ${i.name}, region = ${i.region}, api_endpoint = ${i.apiEndpoint}, webhook_endpoint = ${i.webhookEndpoint}, priority = ${i.priority}, status = ${i.status}, updated_at = now() where id = ${id} and ${canMoveToSql(COMMUNICATION_PROVIDER, i.status)}`.execute(this.db as any);
  }

  async rotateCredential(id: string, enc: string, last4: string | null): Promise<void> {
    await sql`update communication_providers set credential_enc = ${enc}, credential_last4 = ${last4}, updated_at = now() where id = ${id}`.execute(this.db as any);
  }

  async setHealth(id: string, status: string): Promise<void> {
    await sql`update communication_providers set status = ${status}, last_health_check_at = now(), updated_at = now() where id = ${id} and ${canMoveToSql(COMMUNICATION_PROVIDER, status)}`.execute(this.db as any);
  }

  /** Real delivery signal for a provider over the recent window (drives health, not "credentials present"). */
  async recentDelivery(providerId: string): Promise<{ delivered: number; failed: number }> {
    const r = (await sql`select
        count(*) filter (where status = 'delivered')::int as delivered,
        count(*) filter (where status in ('failed','error','undelivered'))::int as failed
      from notification_delivery_logs where provider_id = ${providerId} and created_at >= now() - interval '7 days'`.execute(this.db as any)).rows[0] as { delivered: number; failed: number };
    return r ?? { delivered: 0, failed: 0 };
  }

  async writeAudit(actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    // Providers are platform-level (no tenant); the communication_providers row + this metadata are the record. We can
    // only attach audit_events rows when a tenant context exists, so provider changes rely on the durable row + logs.
    void actor; void action; void summary; void metadata;
  }
}
