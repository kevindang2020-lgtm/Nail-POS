// api-webhooks.kysely.repository.ts — production adapter over tenant_api_keys + tenant_webhooks. Tenant-scoped on
// every query; stores only hashes; arrays map to Postgres text[] via the query builder. Reads are resilient (.catch).
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_WEBHOOK } from '@aipowersalon/super-admin';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ApiWebhooksContext } from './api-webhooks.dto';
import type { ApiWebhooksRepositoryPort, StoredKey, StoredWebhook, NewKey, NewWebhook } from './api-webhooks.repository';

const toMs = (v: unknown): number | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? null : n;
};
const reqMs = (v: unknown): number => toMs(v) ?? Date.now();
const toDate = (ms: number | null): Date | null => (ms == null ? null : new Date(ms));

export class KyselyApiWebhooksRepository implements ApiWebhooksRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private mapKey = (r: any): StoredKey => ({
    id: r.id, name: r.name, prefix: r.prefix, secretHash: r.secret_hash, environment: r.environment,
    scopes: r.scopes ?? [], createdByUserId: r.created_by_user_id ?? null,
    lastUsedMs: toMs(r.last_used_at), expiresMs: toMs(r.expires_at), revokedMs: toMs(r.revoked_at), createdMs: reqMs(r.created_at),
  });
  private mapHook = (r: any): StoredWebhook => ({
    id: r.id, name: r.name, url: r.url, events: r.events ?? [], signingSecretEnc: r.signing_secret_enc, status: r.status,
    createdByUserId: r.created_by_user_id ?? null, lastDeliveryMs: toMs(r.last_delivery_at), lastSuccessMs: toMs(r.last_success_at),
    lastFailureMs: toMs(r.last_failure_at), failureCount: r.failure_count ?? 0, createdMs: reqMs(r.created_at),
  });

  async listKeys(ctx: ApiWebhooksContext): Promise<StoredKey[]> {
    const rows = await this.db.selectFrom('tenant_api_keys').selectAll().where('tenant_id', '=', ctx.tenantId).where('revoked_at', 'is', null).orderBy('created_at', 'desc').execute().catch(() => []);
    return rows.map(this.mapKey);
  }
  async insertKey(ctx: ApiWebhooksContext, k: NewKey): Promise<StoredKey> {
    const r = await this.db.insertInto('tenant_api_keys').values({
      tenant_id: ctx.tenantId, name: k.name, prefix: k.prefix, secret_hash: k.secretHash, environment: k.environment,
      scopes: k.scopes as any, created_by_user_id: k.createdByUserId, expires_at: toDate(k.expiresMs) as any,
    } as any).returningAll().executeTakeFirstOrThrow();
    return this.mapKey(r);
  }
  async getKey(ctx: ApiWebhooksContext, id: string): Promise<StoredKey | null> {
    const r = await this.db.selectFrom('tenant_api_keys').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return r ? this.mapKey(r) : null;
  }
  async rotateKey(ctx: ApiWebhooksContext, id: string, secretHash: string, prefix: string): Promise<StoredKey | null> {
    // Constitution 3 §76–78: the PREVIOUS secret keeps working for 24 h so a live integration can switch without an outage
    const r = await this.db.updateTable('tenant_api_keys').set((eb: any) => ({ previous_secret_hash: eb.ref('secret_hash'), previous_valid_until: sql`now() + interval '24 hours'`, secret_hash: secretHash, prefix, updated_at: new Date() as any }) as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('revoked_at', 'is', null).returningAll().executeTakeFirst().catch(() => undefined);
    return r ? this.mapKey(r) : null;
  }
  async revokeKey(ctx: ApiWebhooksContext, id: string): Promise<boolean> {
    const r = await this.db.updateTable('tenant_api_keys').set({ revoked_at: new Date() as any, updated_at: new Date() as any } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where('revoked_at', 'is', null).executeTakeFirst().catch(() => undefined);
    return !!r && Number(r.numUpdatedRows ?? 0) > 0;
  }

  async listWebhooks(ctx: ApiWebhooksContext): Promise<StoredWebhook[]> {
    const rows = await this.db.selectFrom('tenant_webhooks').selectAll().where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').execute().catch(() => []);
    return rows.map(this.mapHook);
  }
  async insertWebhook(ctx: ApiWebhooksContext, w: NewWebhook): Promise<StoredWebhook> {
    const r = await this.db.insertInto('tenant_webhooks').values({
      tenant_id: ctx.tenantId, name: w.name, url: w.url, events: w.events as any, signing_secret_enc: w.signingSecretEnc, created_by_user_id: w.createdByUserId,
    } as any).returningAll().executeTakeFirstOrThrow();
    return this.mapHook(r);
  }
  async getWebhook(ctx: ApiWebhooksContext, id: string): Promise<StoredWebhook | null> {
    const r = await this.db.selectFrom('tenant_webhooks').selectAll().where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return r ? this.mapHook(r) : null;
  }
  async setWebhookStatus(ctx: ApiWebhooksContext, id: string, status: string): Promise<boolean> {
    const r = await this.db.updateTable('tenant_webhooks').set({ status, updated_at: new Date() as any } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).where(canMoveToSql(TENANT_WEBHOOK, status) as any).executeTakeFirst().catch(() => undefined);
    return !!r && Number(r.numUpdatedRows ?? 0) > 0;
  }
  async rotateWebhookSecret(ctx: ApiWebhooksContext, id: string, signingSecretEnc: string): Promise<boolean> {
    const r = await this.db.updateTable('tenant_webhooks').set({ signing_secret_enc: signingSecretEnc, updated_at: new Date() as any } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return !!r && Number(r.numUpdatedRows ?? 0) > 0;
  }
  async recordDelivery(ctx: ApiWebhooksContext, id: string, ok: boolean): Promise<void> {
    const now = new Date();
    const set: any = { last_delivery_at: now, updated_at: now };
    if (ok) set.last_success_at = now; else set.last_failure_at = now;
    await this.db.updateTable('tenant_webhooks')
      .set((eb) => ok ? set : ({ ...set, failure_count: eb('failure_count', '+', 1) } as any))
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
  }
}
