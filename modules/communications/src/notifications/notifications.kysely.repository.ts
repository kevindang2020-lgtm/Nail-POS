// notifications.kysely.repository.ts — Postgres adapter. Raw SQL to avoid editing generated kysely.types.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { NotificationsRepositoryPort, SendFacts, DeliveryProviderFacts, SmsSegmentUsage } from './notifications.repository';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import type { NotificationLogRow } from './notifications.dto';
import { canMoveToSql } from '@aipowersalon/database';
import { NOTIFICATION } from '../communications-lifecycles';

export class KyselyNotificationsRepository implements NotificationsRepositoryPort {
  // Phase 2 (Oct 2026): with an outbox writer, every SMS ledger row commits WITH its domain event —
  // communication.sms_sent for a handoff to the provider, communication.sms_delivery_failed for a refused send — so
  // consumers (usage, analytics, alerts) see every text the platform sends. Never the body or the number (§79).
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter | null) {}

  async log(row: Omit<NotificationLogRow, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, facts?: SendFacts): Promise<NotificationLogRow> {
    const eventType = row.channel === 'sms' ? (row.status === 'sent' || row.status === 'simulated' ? DOMAIN_EVENTS.SMS_SENT : row.status === 'failed' ? DOMAIN_EVENTS.SMS_DELIVERY_FAILED : null) : null;
    if (!this.outbox || !eventType) return this.insert(this.db, row);
    return this.db.transaction().execute(async (trx) => {
      const r = await this.insert(trx as any, row);
      await this.outbox!.write(trx as any, createDomainEvent({
        eventType, tenantId: row.tenantId, aggregateType: 'notification', aggregateId: String(r.id), actorType: 'system',
        payload: { notificationId: String(r.id), channel: 'sms', purpose: facts?.purpose ?? 'notification', customerId: row.customerId ?? null,
          providerId: row.providerId ?? null, simulated: !!facts?.simulated, ...(row.status === 'failed' ? { stage: 'send', reason: String(row.failureReason ?? '').slice(0, 120) } : {}) },
      }));
      return r;
    });
  }

  private async insert(db: Kysely<DB>, row: Omit<NotificationLogRow, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): Promise<NotificationLogRow> {
    const res = await sql<NotificationLogRow & { created_at: string }>`
      INSERT INTO notifications (tenant_id, channel, to_address, subject, body, customer_id, status, provider_id, failure_reason, segment_count)
      VALUES (${row.tenantId}, ${row.channel}, ${row.toAddress}, ${row.subject ?? null}, ${row.body}, ${row.customerId ?? null}, ${row.status}, ${row.providerId ?? null}, ${row.failureReason ?? null}, ${row.segmentCount ?? null})
      RETURNING id, tenant_id AS "tenantId", channel, to_address AS "toAddress", subject, body, customer_id AS "customerId", status, provider_id AS "providerId", failure_reason AS "failureReason", created_at AS "createdAt", segment_count AS "segmentCount"
    `.execute(db);
    return res.rows[0] as unknown as NotificationLogRow;
  }

  async listForTenant(tenantId: string, limit: number): Promise<NotificationLogRow[]> {
    const res = await sql<NotificationLogRow>`
      SELECT id, tenant_id AS "tenantId", channel, to_address AS "toAddress", subject, body, customer_id AS "customerId",
             status, provider_id AS "providerId", failure_reason AS "failureReason", created_at AS "createdAt"
      FROM notifications WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT ${Math.max(1, limit)}
    `.execute(this.db);
    return res.rows as unknown as NotificationLogRow[];
  }

  /** wave 3 PAYI §77 / §80: segments this salon sent in [from, to) — the billable quantity; rows the provider never
   *  sized (older sends) are counted as unknown, never guessed as 1. P-11: simulated (development mock) and blocked rows
   *  (opted out, over the limit, not configured) never reached a provider and are not usage. */
  async segmentUsage(tenantId: string, fromIso: string, toIso: string): Promise<SmsSegmentUsage> {
    const r: any = await sql`
      SELECT count(*)::int AS messages, coalesce(sum(segment_count), 0)::int AS segments,
             count(*) FILTER (WHERE status = 'delivered')::int AS delivered, count(*) FILTER (WHERE status = 'failed')::int AS failed,
             count(*) FILTER (WHERE segment_count IS NULL)::int AS unknown_segments
      FROM notifications WHERE tenant_id = ${tenantId} AND channel = 'sms' AND status NOT IN ('simulated', 'blocked') AND created_at >= ${fromIso}::timestamptz AND created_at < ${toIso}::timestamptz
    `.execute(this.db);
    const x = r.rows?.[0] ?? {};
    return { messages: Number(x.messages ?? 0), segments: Number(x.segments ?? 0), delivered: Number(x.delivered ?? 0), failed: Number(x.failed ?? 0), unknownSegments: Number(x.unknown_segments ?? 0) };
  }

  async updateDeliveryByProvider(providerId: string, status: 'sent' | 'failed' | 'delivered', failureReason: string | null, deliveredAt: string | null, provider?: DeliveryProviderFacts): Promise<{ updated: number }> {
    // provider_id is the globally-unique Twilio MessageSid, so this update is safe without tenant scoping.
    // A carrier failure reported later (Twilio status callback) is communication.sms_delivery_failed, once per row that
    // moves INTO failed — a repeated callback for an already-failed message emits nothing.
    // wave 3 PAYI §87: the provider's own status word, error code and segment count are kept beside the normalized status
    // (support reads them; a customer never sees "30007").
    const pStatus = provider?.providerStatus ?? null, pErr = provider?.errorCode ?? null, pSeg = provider?.segments ?? null;
    return this.db.transaction().execute(async (trx) => {
      const res: any = await sql<any>`
        UPDATE notifications n SET status = ${status}, failure_reason = ${failureReason},
          delivered_at = ${deliveredAt}::timestamptz,
          provider_status = coalesce(${pStatus}, n.provider_status), provider_error_code = coalesce(${pErr}, n.provider_error_code),
          segment_count = coalesce(${pSeg}::int, n.segment_count)
        FROM (SELECT id, status AS before FROM notifications WHERE provider_id = ${providerId} FOR UPDATE) o
        WHERE n.id = o.id AND ${canMoveToSql(NOTIFICATION, status, 'n')}   -- Phase 12 (#27): a late callback never moves delivered / failed back
        RETURNING n.id, n.tenant_id, n.customer_id, o.before
      `.execute(trx);
      if (this.outbox && status === 'failed') {
        for (const r of res.rows as any[]) {
          if (r.before === 'failed') continue;
          await this.outbox.write(trx as any, createDomainEvent({
            eventType: DOMAIN_EVENTS.SMS_DELIVERY_FAILED, tenantId: String(r.tenant_id), aggregateType: 'notification', aggregateId: String(r.id), actorType: 'webhook',
            payload: { notificationId: String(r.id), channel: 'sms', customerId: r.customer_id ?? null, providerId, stage: 'carrier', reason: String(failureReason ?? '').slice(0, 120) },
          }));
        }
      }
      return { updated: (res.rows as any[]).length };
    });
  }
}
