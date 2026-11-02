// notifications.kysely.repository.ts — Postgres adapter. Raw SQL to avoid editing generated kysely.types.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { NotificationsRepositoryPort, SendFacts, DeliveryProviderFacts, SmsSegmentUsage } from './notifications.repository';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import type { NotificationLogRow } from './notifications.dto';
import { canMoveToSql } from '@aipowersalon/database';
import { NOTIFICATION } from '../communications-lifecycles';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ck_notifications_source_type (741) */
const SOURCE_TYPES: readonly string[] = ['appointment', 'ticket', 'campaign', 'thread', 'follow_up', 'retry', 'template_test', 'manual', 'phone_change'];
/** the ledger's purpose vocabulary (ck_notifications_purpose, migration 730) */
const NOTIFICATION_PURPOSES: readonly string[] = ['receipt', 'reminder', 'followup', 'marketing', 'account', 'notification', 'conversation'];

export class KyselyNotificationsRepository implements NotificationsRepositoryPort {
  // Phase 2 (Oct 2026): with an outbox writer, every SMS ledger row commits WITH its domain event —
  // communication.sms_sent for a handoff to the provider, communication.sms_delivery_failed for a refused send — so
  // consumers (usage, analytics, alerts) see every text the platform sends. Never the body or the number (§79).
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter | null) {}

  async log(row: Omit<NotificationLogRow, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, facts?: SendFacts): Promise<NotificationLogRow> {
    const eventType = row.channel === 'sms' ? (row.status === 'sent' || row.status === 'simulated' ? DOMAIN_EVENTS.SMS_SENT : row.status === 'failed' ? DOMAIN_EVENTS.SMS_DELIVERY_FAILED : null) : null;
    if (!this.outbox || !eventType) return this.insert(this.db, row, facts);
    return this.db.transaction().execute(async (trx) => {
      const r = await this.insert(trx, row, facts);
      await this.outbox!.write(trx, createDomainEvent({
        eventType, tenantId: row.tenantId, aggregateType: 'notification', aggregateId: String(r.id), actorType: 'system',
        payload: { notificationId: String(r.id), channel: 'sms', purpose: facts?.purpose ?? 'notification', customerId: row.customerId ?? null,
          providerId: row.providerId ?? null, simulated: !!facts?.simulated, ...(row.status === 'failed' ? { stage: 'send', reason: String(row.failureReason ?? '').slice(0, 120) } : {}) },
      }));
      return r;
    });
  }

  /** purpose (migration 730): which kind of text this row was — read by the SMS Inbox customer timeline; unknown → NULL. */
  private async insert(db: Kysely<DB>, row: Omit<NotificationLogRow, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, facts?: SendFacts): Promise<NotificationLogRow> {
    const purposeRaw = facts?.purpose;
    const purpose = purposeRaw && NOTIFICATION_PURPOSES.includes(purposeRaw) ? purposeRaw : null;
    // 741 (Customer Notifications guide §13): branch, source link and the attempt this row re-sends — only well-formed values
    const branchId = facts?.branchId && UUID_RE.test(facts.branchId) ? facts.branchId : null;
    const srcType = facts?.source?.type && SOURCE_TYPES.includes(facts.source.type) ? facts.source.type : null;
    const srcId = srcType && facts?.source?.id ? String(facts.source.id).slice(0, 120) : null;
    const retryOf = facts?.retryOf && UUID_RE.test(facts.retryOf) ? facts.retryOf : null;
    const res = await sql<NotificationLogRow & { created_at: string }>`
      INSERT INTO notifications (tenant_id, channel, to_address, subject, body, customer_id, status, provider_id, failure_reason, segment_count, sender_route, sender_from, purpose,
        provider_error_code, branch_id, source_type, source_id, retry_of_notification_id)
      VALUES (${row.tenantId}, ${row.channel}, ${row.toAddress}, ${row.subject ?? null}, ${row.body}, ${row.customerId ?? null}, ${row.status}, ${row.providerId ?? null}, ${row.failureReason ?? null}, ${row.segmentCount ?? null}, ${row.senderRoute ?? null}, ${row.senderFrom ?? null}, ${purpose},
        ${row.providerErrorCode ?? null}, ${branchId}::uuid, ${srcType}, ${srcId}, ${retryOf}::uuid)
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

  /** a verified callback that does not move the ledger (queued / sending / accepted …) — kept as freshness evidence only */
  async recordDeliveryEvent(providerId: string, providerStatus: string, errorCode: string | null, tenantId: string | null): Promise<void> {
    if (!tenantId) return;
    await sql`INSERT INTO notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, error_code, applied, signature_verified)
      SELECT n.tenant_id, n.id, ${providerId}, ${providerStatus.slice(0, 40)}, ${errorCode}, false, true FROM notifications n
       WHERE n.provider_id = ${providerId} AND n.tenant_id = ${tenantId}::uuid
      ON CONFLICT (tenant_id, provider_message_sid, provider_status) DO NOTHING`.execute(this.db);
  }

  async updateDeliveryByProvider(providerId: string, status: 'sent' | 'failed' | 'delivered', failureReason: string | null, deliveredAt: string | null, provider?: DeliveryProviderFacts, tenantId?: string | null): Promise<{ updated: number }> {
    // provider_id is the Twilio MessageSid. Security fix E2: the status webhook resolves the tenant from the stored row
    // and passes it here, so a callback can only ever move that tenant's message (defence in depth beside the signature).
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
        FROM (SELECT id, status AS before FROM notifications WHERE provider_id = ${providerId}
          AND ${tenantId ? sql`tenant_id = ${tenantId}::uuid` : sql`true`} FOR UPDATE) o
        WHERE n.id = o.id AND ${canMoveToSql(NOTIFICATION, status, 'n')}   -- Phase 12 (#27): a late callback never moves delivered / failed back
        RETURNING n.id, n.tenant_id, n.customer_id, o.before
      `.execute(trx);
      // 741 (Customer Notifications guide §09): every verified callback is kept, append-only, deduped per (sid, provider status);
      // `applied` says whether it moved the ledger row (a duplicate or out-of-order callback is kept but never regresses it)
      const moved = new Set(res.rows.map((r: any) => String(r.id)));
      await sql`INSERT INTO notification_delivery_events (tenant_id, notification_id, provider_message_sid, provider_status, error_code, applied, signature_verified)
        SELECT n.tenant_id, n.id, ${providerId}, ${pStatus ?? status}, ${pErr}, n.id = ANY(${[...moved]}::uuid[]), true
          FROM notifications n WHERE n.provider_id = ${providerId} AND ${tenantId ? sql`n.tenant_id = ${tenantId}::uuid` : sql`true`}
        ON CONFLICT (tenant_id, provider_message_sid, provider_status) DO NOTHING`.execute(trx);
      if (this.outbox && status === 'failed') {
        for (const r of res.rows) {
          if (r.before === 'failed') continue;
          await this.outbox.write(trx, createDomainEvent({
            eventType: DOMAIN_EVENTS.SMS_DELIVERY_FAILED, tenantId: String(r.tenant_id), aggregateType: 'notification', aggregateId: String(r.id), actorType: 'webhook',
            payload: { notificationId: String(r.id), channel: 'sms', customerId: r.customer_id ?? null, providerId, stage: 'carrier', reason: String(failureReason ?? '').slice(0, 120) },
          }));
        }
      }
      return { updated: res.rows.length };
    });
  }
}
