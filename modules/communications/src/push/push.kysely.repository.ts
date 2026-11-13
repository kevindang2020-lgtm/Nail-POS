// push.kysely.repository.ts — Postgres adapter over device_push_tokens + notification_delivery_logs.
import { sql, type Kysely } from 'kysely';
import { tenantTimeZone, type DB } from '@aipowersalon/database';
import type { PushRepositoryPort, PushContext, PushTokenRow, DeliveryLogInput } from './push.repository';
import type { PushPlatform } from './push.types';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';

export class KyselyPushRepository implements PushRepositoryPort {
  // Phase 2 (Oct 2026): with an outbox writer, a push handed to the provider for a salon commits its delivery-log row
  // WITH communication.push_sent (declared since the event contract, never produced). Never the token or the text.
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter | null) {}
  async upsertToken(ctx: PushContext, platform: PushPlatform, token: string, app?: string): Promise<void> {
    // token is unique → re-registering re-points it at the current user and clears any prior revocation.
    await this.db.insertInto('device_push_tokens')
      .values({ tenant_id: ctx.tenantId, user_id: ctx.userId, platform, token, app: app ?? null, revoked_at: null })
      .onConflict((oc) => oc.column('token').doUpdateSet({ tenant_id: ctx.tenantId, user_id: ctx.userId, platform, app: app ?? null, revoked_at: null, last_seen_at: new Date(), updated_at: new Date() }))
      .execute();
  }
  async revokeToken(token: string): Promise<void> {
    await this.db.updateTable('device_push_tokens').set({ revoked_at: new Date() as any, updated_at: new Date() as any } as any).where('token', '=', token).execute();
  }
  // tenant review (Nov 2026): one user's own device tokens (user_id is platform-unique); revoke paths are keyed to ctx.userId
  async activeTokensForUser(userId: string): Promise<PushTokenRow[]> {
    const rows = await this.db.selectFrom('device_push_tokens').select(['id', 'platform', 'token', 'app']).where('user_id', '=', userId).where('revoked_at', 'is', null).execute().catch(() => [] as any[]);
    return rows.map((r) => ({ id: r.id, platform: r.platform as PushPlatform, token: r.token, app: r.app ?? null }));
  }
  async quietHoursFor(tenantId: string, userId: string): Promise<{ start: string; end: string; timeZone: string } | null> {
    const r = (await sql<{ quiet_start: string | null; quiet_end: string | null }>`select p.quiet_start, p.quiet_end from user_notification_prefs p
      where p.tenant_id = ${tenantId} and p.user_id = ${userId} limit 1`.execute(this.db)).rows[0];
    if (!r?.quiet_start || !r?.quiet_end) return null;
    return { start: r.quiet_start, end: r.quiet_end, timeZone: await tenantTimeZone(this.db, tenantId) };
  }
  async logDelivery(input: DeliveryLogInput): Promise<void> {
    const write = async (db: Kysely<DB>) => (await db.insertInto('notification_delivery_logs').values({
      tenant_id: input.tenantId, user_id: input.userId, channel: 'push', target_masked: '***' + input.token.slice(-6),
      template: input.template, provider_id: input.result.providerId ?? null, status: input.result.ok ? 'sent' : 'failed', error_message: input.result.error ?? null,
    }).returning('id').executeTakeFirst())?.id as string | undefined;
    try {
      if (!this.outbox || !input.result.ok || !input.tenantId) { await write(this.db); return; }
      await this.db.transaction().execute(async (trx) => {
        const id = await write(trx);
        await this.outbox!.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.PUSH_SENT, tenantId: input.tenantId!, aggregateType: 'notification', aggregateId: String(id ?? input.userId), actorType: 'system',
          payload: { deliveryLogId: id ?? null, userId: input.userId, template: input.template, providerId: input.result.providerId ?? null },
        }));
      });
    } catch { /* logging is best-effort */ }
  }
}
