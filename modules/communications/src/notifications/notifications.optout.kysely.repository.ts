// notifications.optout.kysely.repository.ts — Postgres adapter for the opt-out store. Raw SQL.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { OptOutPort, OptOutRow } from './notifications.optout.repository';
import type { NotificationChannel } from './notifications-core';

export class KyselyOptOutRepository implements OptOutPort {
  constructor(private readonly db: Kysely<DB>) {}

  async isOptedOut(tenantId: string, channel: NotificationChannel, address: string): Promise<boolean> {
    const res = await sql<{ one: number }>`
      SELECT 1 AS one FROM notification_opt_outs WHERE tenant_id = ${tenantId} AND channel = ${channel} AND address = ${address} LIMIT 1
    `.execute(this.db);
    return res.rows.length > 0;
  }
  async optOut(tenantId: string, channel: NotificationChannel, address: string, reason?: string): Promise<void> {
    await sql`
      INSERT INTO notification_opt_outs (tenant_id, channel, address, reason)
      VALUES (${tenantId}, ${channel}, ${address}, ${reason ?? null})
      ON CONFLICT (tenant_id, channel, address) DO NOTHING
    `.execute(this.db);
  }
  async optIn(tenantId: string, channel: NotificationChannel, address: string): Promise<void> {
    await sql`DELETE FROM notification_opt_outs WHERE tenant_id = ${tenantId} AND channel = ${channel} AND address = ${address}`.execute(this.db);
  }
  async list(tenantId: string, limit: number): Promise<OptOutRow[]> {
    const res = await sql<OptOutRow>`
      SELECT tenant_id AS "tenantId", channel, address, reason, opted_out_at AS "optedOutAt"
      FROM notification_opt_outs WHERE tenant_id = ${tenantId} ORDER BY opted_out_at DESC LIMIT ${Math.max(1, limit)}
    `.execute(this.db);
    return res.rows as unknown as OptOutRow[];
  }
}
