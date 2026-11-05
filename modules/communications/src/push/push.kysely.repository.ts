// push.kysely.repository.ts — Postgres adapter over device_push_tokens + notification_delivery_logs.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PushRepositoryPort, PushContext, PushTokenRow, DeliveryLogInput } from './push.repository';
import type { PushPlatform } from './push.types';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';

export class KyselyPushRepository implements PushRepositoryPort {
  // Phase 2 (Oct 2026): with an outbox writer, a push handed to the provider for a salon commits its delivery-log row
  // WITH communication.push_sent (declared since the event contract, never produced). Never the token or the text.
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter | null) {}
  async upsertToken(ctx: PushContext, platform: PushPlatform, token: string, app?: string): Promise<void> {
    const targetApp = app ?? null;
    await this.db.transaction().execute(async (trx) => {
      // 1. Revoke any older active tokens for the same user, platform, and app that are not this token
      let revQ = trx.updateTable('device_push_tokens')
        .set({ revoked_at: new Date() as any, updated_at: new Date() as any } as any)
        .where('user_id', '=', ctx.userId)
        .where('platform', '=', platform)
        .where('token', '!=', token)
        .where('revoked_at', 'is', null);
      if (targetApp) {
        revQ = revQ.where('app', '=', targetApp);
      }
      await revQ.execute().catch(() => undefined);

      // 2. Token is unique → upsert pointing it at current user and clearing prior revocation
      await trx.insertInto('device_push_tokens')
        .values({ tenant_id: ctx.tenantId, user_id: ctx.userId, platform, token, app: targetApp, revoked_at: null } as any)
        .onConflict((oc) => oc.column('token').doUpdateSet({ tenant_id: ctx.tenantId, user_id: ctx.userId, platform, app: targetApp, revoked_at: null, last_seen_at: new Date() as any, updated_at: new Date() as any } as any))
        .execute();
    });
  }
  async revokeToken(token: string): Promise<void> {
    await this.db.updateTable('device_push_tokens').set({ revoked_at: new Date() as any, updated_at: new Date() as any } as any).where('token', '=', token).execute();
  }
  // tenant review (Nov 2026): one user's own device tokens (user_id is platform-unique); revoke paths are keyed to ctx.userId
  async activeTokensForUser(userId: string): Promise<PushTokenRow[]> {
    const rows = await this.db.selectFrom('device_push_tokens')
      .select(['id', 'platform', 'token', 'app', 'updated_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('updated_at', 'desc')
      .execute()
      .catch(() => [] as any[]);
    const seen = new Set<string>();
    const out: PushTokenRow[] = [];
    for (const r of rows as any[]) {
      const key = `${r.platform}:${r.app || 'default'}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ id: r.id, platform: r.platform as PushPlatform, token: r.token, app: r.app ?? null });
      }
    }
    return out;
  }
  async logDelivery(input: DeliveryLogInput): Promise<void> {
    const write = async (db: Kysely<DB>) => (await db.insertInto('notification_delivery_logs').values({
      tenant_id: input.tenantId, user_id: input.userId, channel: 'push', target_masked: '***' + input.token.slice(-6),
      template: input.template, provider_id: input.result.providerId ?? null, status: input.result.ok ? 'sent' : 'failed', error_message: input.result.error ?? null,
    } as any).returning('id' as any).executeTakeFirst() as any)?.id as string | undefined;
    try {
      if (!this.outbox || !input.result.ok || !input.tenantId) { await write(this.db); return; }
      await this.db.transaction().execute(async (trx) => {
        const id = await write(trx as any);
        await this.outbox!.write(trx as any, createDomainEvent({
          eventType: DOMAIN_EVENTS.PUSH_SENT, tenantId: input.tenantId!, aggregateType: 'notification', aggregateId: String(id ?? input.userId), actorType: 'system',
          payload: { deliveryLogId: id ?? null, userId: input.userId, template: input.template, providerId: input.result.providerId ?? null },
        }));
      });
    } catch { /* logging is best-effort */ }
  }
}
