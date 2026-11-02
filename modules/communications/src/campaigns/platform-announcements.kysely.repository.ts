// Kysely (Postgres) platform announcements repo. create inserts the announcement + targets (idempotent target
// unique index); setStatus records lifecycle timestamps; listForOversight shapes platform rows for the marketing
// engine. Writes audit platform_announcement_created / _status.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AnnouncementInput, AnnouncementStatus } from './platform-announcement-core';
import type { AnnouncementRepo, AnnouncementRow, OversightPlatformRow } from './platform-announcements.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { PLATFORM_ANNOUNCEMENT } from '../communications-lifecycles';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const mapRow = (r: any, tenantIds: string[] = []): AnnouncementRow => ({
  id: r.id, title: r.title, body: r.body, channel: r.channel, audienceScope: r.audience_scope, status: r.status,
  scheduledAt: iso(r.scheduled_at), audienceSize: Number(r.audience_size || 0), sentCount: Number(r.sent_count || 0),
  openCount: Number(r.open_count || 0), clickCount: Number(r.click_count || 0), bookingCount: Number(r.booking_count || 0),
  revenueCents: Number(r.revenue_cents || 0), tenantIds, createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at) as string,
  sentAt: iso(r.sent_at), cancelledAt: iso(r.cancelled_at), cancelReason: r.cancel_reason,
});

export class KyselyAnnouncementRepo implements AnnouncementRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async list(scope: { status?: string; cap?: number }): Promise<AnnouncementRow[]> {
    const st = scope.status ? sql`AND status = ${scope.status}` : sql``;
    try { const r = await sql<any>`SELECT * FROM platform_announcements WHERE 1=1 ${st} ORDER BY created_at DESC LIMIT ${Math.min(500, scope.cap ?? 200)}`.execute(this.db); return r.rows.map((x) => mapRow(x)); } catch { return []; }
  }
  async get(id: string): Promise<AnnouncementRow | null> {
    try {
      const r = await sql<any>`SELECT * FROM platform_announcements WHERE id = ${id} LIMIT 1`.execute(this.db);
      if (!r.rows[0]) return null;
      const t = await sql<any>`SELECT tenant_id FROM platform_announcement_targets WHERE announcement_id = ${id}`.execute(this.db);
      return mapRow(r.rows[0], t.rows.map((x) => x.tenant_id));
    } catch { return null; }
  }
  async create(input: AnnouncementInput & { status: AnnouncementStatus; audienceSize: number; createdByUserId: string | null }): Promise<AnnouncementRow> {
    const ins = await sql<any>`
      INSERT INTO platform_announcements (title, body, channel, audience_scope, status, scheduled_at, audience_size, created_by_user_id)
      VALUES (${input.title}, ${input.body ?? null}, ${input.channel ?? 'email'}, ${input.audienceScope ?? 'selected_tenants'}, ${input.status}, ${input.scheduledAt ?? null}, ${input.audienceSize}, ${input.createdByUserId})
      RETURNING *`.execute(this.db);
    const id = ins.rows[0].id;
    const tenantIds = (input.tenantIds ?? []).filter(Boolean);
    for (const t of tenantIds) {
      try { await sql`INSERT INTO platform_announcement_targets (announcement_id, tenant_id) VALUES (${id}, ${t}) ON CONFLICT (announcement_id, tenant_id) DO NOTHING`.execute(this.db); } catch { /* skip */ }
    }
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('platform_announcement_created', 'platform_announcement', ${id}, ${input.createdByUserId}, now())`.execute(this.db); } catch { /* best-effort */ }
    return mapRow(ins.rows[0], tenantIds);
  }
  async setStatus(id: string, status: AnnouncementStatus, extra?: { cancelReason?: string; sentAt?: string }): Promise<AnnouncementRow | null> {
    const cancelBits = status === 'cancelled' ? sql`, cancelled_at = now(), cancel_reason = ${extra?.cancelReason ?? null}` : sql``;
    const sentBits = status === 'sent' ? sql`, sent_at = now()` : sql``;
    const r = await sql<any>`UPDATE platform_announcements SET status = ${status} ${cancelBits} ${sentBits} WHERE id = ${id} AND ${canMoveToSql(PLATFORM_ANNOUNCEMENT, status)} RETURNING *`.execute(this.db);
    if (!r.rows[0]) return null;
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('platform_announcement_status', 'platform_announcement', ${id}, NULL, now())`.execute(this.db); } catch { /* best-effort */ }
    return mapRow(r.rows[0]);
  }
  async listForOversight(): Promise<OversightPlatformRow[]> {
    try {
      const r = await sql<any>`SELECT id, title, channel, audience_size, status, scheduled_at, sent_count, open_count, click_count, booking_count, revenue_cents FROM platform_announcements ORDER BY created_at DESC LIMIT 500`.execute(this.db);
      return r.rows.map((x) => ({
        id: x.id, ownerType: 'platform' as const, tenantId: null, tenantName: null, branchId: null, branchName: null,
        name: x.title, channel: x.channel, audienceSize: Number(x.audience_size || 0), status: x.status, scheduledAt: iso(x.scheduled_at),
        sentCount: Number(x.sent_count || 0), openCount: Number(x.open_count || 0), clickCount: Number(x.click_count || 0),
        bookingCount: Number(x.booking_count || 0), revenueCents: Number(x.revenue_cents || 0),
      }));
    } catch { return []; }
  }
}
