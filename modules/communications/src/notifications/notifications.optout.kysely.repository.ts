// notifications.optout.kysely.repository.ts — Postgres adapter for the opt-out store. Raw SQL.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { OptOutPort, OptOutRow, ConsentMeta } from './notifications.optout.repository';

const uuidOrNull = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);
import type { NotificationChannel } from './notifications-core';

export class KyselyOptOutRepository implements OptOutPort {
  constructor(private readonly db: Kysely<DB>) {}

  // 748: a marketing-only unsubscribe (scope 'marketing') blocks marketing mail only — a receipt still reaches the customer
  async isOptedOut(tenantId: string, channel: NotificationChannel, address: string, purpose?: string | null): Promise<boolean> {
    const res = await sql<{ one: number }>`
      SELECT 1 AS one FROM notification_opt_outs WHERE tenant_id = ${tenantId} AND channel = ${channel} AND address = ${address}
         AND (scope = 'all' OR ${purpose === 'marketing'}) LIMIT 1
    `.execute(this.db);
    return res.rows.length > 0;
  }
  // 741: the current-state row and its history event commit together; a repeated STOP keeps the original row (and its date)
  // but still records the new event — it is evidence the customer asked again.
  async optOut(tenantId: string, channel: NotificationChannel, address: string, reason?: string, meta?: ConsentMeta): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO notification_opt_outs (tenant_id, channel, address, reason, scope)
        VALUES (${tenantId}, ${channel}, ${address}, ${reason ?? null}, ${meta?.scope ?? 'all'})
        ON CONFLICT (tenant_id, channel, address) DO UPDATE SET scope = 'all' WHERE excluded.scope = 'all' AND notification_opt_outs.scope <> 'all'
      `.execute(trx);
      await sql`INSERT INTO notification_consent_events (tenant_id, channel, address, action, source, reason, consent_note, actor_user_id)
        VALUES (${tenantId}, ${channel}, ${address}, 'opt_out', ${meta?.source ?? 'staff'}, ${reason ? String(reason).slice(0, 200) : null}, ${meta?.consentNote ? String(meta.consentNote).slice(0, 300) : null}, ${uuidOrNull(meta?.actorUserId)}::uuid)`.execute(trx);
    });
  }
  async optIn(tenantId: string, channel: NotificationChannel, address: string, meta?: ConsentMeta): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const del = await sql`DELETE FROM notification_opt_outs WHERE tenant_id = ${tenantId} AND channel = ${channel} AND address = ${address} RETURNING address`.execute(trx);
      if ((del.rows ?? []).length) await sql`INSERT INTO notification_consent_events (tenant_id, channel, address, action, source, consent_note, actor_user_id)
        VALUES (${tenantId}, ${channel}, ${address}, 'opt_in', ${meta?.source ?? 'staff'}, ${meta?.consentNote ? String(meta.consentNote).slice(0, 300) : null}, ${uuidOrNull(meta?.actorUserId)}::uuid)`.execute(trx);
    });
  }
  async currentOptOutSource(tenantId: string, channel: NotificationChannel, address: string): Promise<string | null> {
    const r = await sql<{ source: string | null; reason: string | null }>`
      SELECT (SELECT e.source FROM notification_consent_events e WHERE e.tenant_id = o.tenant_id AND e.channel = o.channel AND e.address = o.address AND e.action = 'opt_out'
               ORDER BY e.created_at DESC LIMIT 1) AS source, o.reason
        FROM notification_opt_outs o WHERE o.tenant_id = ${tenantId} AND o.channel = ${channel} AND o.address = ${address}`.execute(this.db);
    const row = r.rows[0];
    if (!row) return null;
    // a backfilled row keeps its old reason word ('inbound_stop' was written by the STOP keyword handler)
    if (row.source === 'legacy_backfill' && row.reason === 'inbound_stop') return 'inbound_stop';
    return row.source ?? (row.reason === 'inbound_stop' ? 'inbound_stop' : 'staff');
  }
  async list(tenantId: string, limit: number): Promise<OptOutRow[]> {
    const res = await sql<OptOutRow>`
      SELECT tenant_id AS "tenantId", channel, address, reason, opted_out_at AS "optedOutAt"
      FROM notification_opt_outs WHERE tenant_id = ${tenantId} ORDER BY opted_out_at DESC LIMIT ${Math.max(1, limit)}
    `.execute(this.db);
    return res.rows as unknown as OptOutRow[];
  }
}
