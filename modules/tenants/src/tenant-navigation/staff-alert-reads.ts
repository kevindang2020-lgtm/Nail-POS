// staff-alert-reads.ts — per-person read state for salon alerts (owner_alerts) and the cross-device badge-sync monitor
// (extras round 9: AI BUSINESS ALERTS 05, Global Loyalty Rewards 08, Customer Notifications 04; migration 873).
//
//   READ ≠ LIFECYCLE   owner_alerts.status (new → acknowledged → resolved / dismissed) is the salon-wide incident lifecycle.
//                      "Unread" is per person: an alert is unread for me until I read it (staff_alert_reads). Marking read
//                      inserts my row only — it never updates owner_alerts, so the failure behind the alert stays open
//                      until someone acknowledges / resolves it through the lifecycle (owner.service transitionAlert).
//   SCOPE              the session's salon; salon-wide alerts (branch_id NULL) and the session branch's alerts; live
//                      lifecycle states only (new / acknowledged / in_progress) of the last 30 days. Only a person who
//                      may see owner alerts (owner.alerts.view) has any.
//   ACROSS DEVICES     the read row is server-side, so every device of the same person reads the same count on its next
//                      badge read. Each POS session reports when it last APPLIED a fresh count (staff_badge_syncs); the
//                      monitor compares those reports with the person's live sessions and the count now.
import { sql, type Kysely } from 'kysely';
import type { BadgeSyncMonitor, BadgeSyncSession, BadgeSyncState, StaffAlertItem, StaffAlertList, StaffAlertMarkReadResponse } from '@aipowersalon/api-contracts/tenant';

export interface AlertReadCtx { tenantId: string; branchId: string; userId: string; permissions: string[] }
export const ALERT_READ_WINDOW_DAYS = 30;
export const BADGE_SYNC_STALE_MINUTES = 10;
const LIVE = ['new', 'acknowledged', 'in_progress'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export class StaffAlertReadError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); } }

/** May this person see salon alerts at all (the owner-alerts read key)? */
export const canSeeAlerts = (ctx: AlertReadCtx): boolean => ctx.permissions.includes('owner.alerts.view') && UUID.test(ctx.userId || '') && UUID.test(ctx.tenantId || '');

function scope(ctx: AlertReadCtx, now: Date) {
  const since = new Date(now.getTime() - ALERT_READ_WINDOW_DAYS * 86_400_000);
  const branch = UUID.test(ctx.branchId || '') ? ctx.branchId : null;
  return sql`a.tenant_id = ${ctx.tenantId}::uuid and (a.branch_id is null or a.branch_id = ${branch}::uuid)
    and a.status = any(${LIVE}::text[]) and a.created_at > ${since}`;
}

/** This person's unread count (0 without owner.alerts.view). */
export async function unreadAlertCount(db: Kysely<any>, ctx: AlertReadCtx, now = new Date()): Promise<number> {
  if (!canSeeAlerts(ctx)) return 0;
  const r = (await sql<{ n: number }>`select count(*)::int as n from owner_alerts a
    where ${scope(ctx, now)} and not exists (select 1 from staff_alert_reads sr where sr.tenant_id = a.tenant_id and sr.user_id = ${ctx.userId}::uuid and sr.alert_id = a.id)`.execute(db)).rows[0];
  return Number(r?.n ?? 0);
}

/** Live alerts in scope, newest first, each with THIS person's read time and the alert's own lifecycle state. */
export async function listStaffAlerts(db: Kysely<any>, ctx: AlertReadCtx, q: { category?: string | null; limit?: number } = {}, now = new Date()): Promise<StaffAlertList> {
  const base = { generatedAt: now.toISOString(), windowDays: ALERT_READ_WINDOW_DAYS };
  if (!canSeeAlerts(ctx)) return { ...base, unread: 0, items: [] };
  const limit = Math.min(50, Math.max(1, Math.round(Number(q.limit) || 20)));
  const cat = q.category && /^[a-z_]{1,40}$/.test(q.category) ? q.category : null;
  const rows = (await sql<{ id: string; category: string; severity: StaffAlertItem['severity']; title: string; status: StaffAlertItem['lifecycleStatus']; created_at: string; read_at: string | null }>`
    select a.id, a.category, a.severity, a.title, a.status, a.created_at, sr.read_at
      from owner_alerts a
      left join staff_alert_reads sr on sr.tenant_id = a.tenant_id and sr.user_id = ${ctx.userId}::uuid and sr.alert_id = a.id
     where ${scope(ctx, now)} ${cat ? sql`and a.category = ${cat}` : sql``}
     order by (sr.read_at is null) desc, a.created_at desc, a.id desc limit ${limit}`.execute(db)).rows;
  return {
    ...base, unread: await unreadAlertCount(db, ctx, now),
    items: rows.map((r) => ({ alertId: String(r.id), category: String(r.category), severity: r.severity, title: String(r.title), lifecycleStatus: r.status, createdAt: iso(r.created_at)!, readAt: iso(r.read_at) })),
  };
}

/** Mark alerts read for THIS person only. Alerts outside the person's salon / branch are ignored (never an error that
 *  confirms another salon's id exists). owner_alerts is not touched. */
export async function markStaffAlertsRead(db: Kysely<any>, ctx: AlertReadCtx, alertIds: unknown, sessionId: string | null, now = new Date()): Promise<StaffAlertMarkReadResponse> {
  if (!canSeeAlerts(ctx)) throw new StaffAlertReadError('You cannot see salon alerts.', 'PERMISSION_DENIED', 403);
  if (!Array.isArray(alertIds) || alertIds.length === 0 || alertIds.length > 200) throw new StaffAlertReadError('Choose between 1 and 200 alerts.', 'VALIDATION_FAILED');
  const ids = [...new Set(alertIds.map(String))];
  if (!ids.every((id) => UUID.test(id))) throw new StaffAlertReadError('An alert id is not valid.', 'VALIDATION_FAILED');
  const branch = UUID.test(ctx.branchId || '') ? ctx.branchId : null;
  const sid = sessionId ? String(sessionId).slice(0, 100) : null;
  const ins = await sql<{ alert_id: string }>`insert into staff_alert_reads (tenant_id, user_id, alert_id, read_at, read_session_id)
    select a.tenant_id, ${ctx.userId}::uuid, a.id, ${now}, ${sid} from owner_alerts a
     where a.tenant_id = ${ctx.tenantId}::uuid and a.id = any(${ids}::uuid[]) and (a.branch_id is null or a.branch_id = ${branch}::uuid)
    on conflict (tenant_id, user_id, alert_id) do nothing returning alert_id`.execute(db);
  return { marked: ins.rows.length, unread: await unreadAlertCount(db, ctx, now), lifecycleChanged: false };
}

/** A POS session applied a fresh unread count: remember when and what it showed (one row per session). */
export async function recordBadgeSync(db: Kysely<any>, ctx: AlertReadCtx, sessionId: string | null, body: { unread?: unknown; surface?: unknown }, now = new Date()) {
  if (!sessionId) throw new StaffAlertReadError('This session has no id to record.', 'VALIDATION_FAILED');
  if (!UUID.test(ctx.userId || '')) throw new StaffAlertReadError('Only a signed-in person can record a badge sync.', 'PERMISSION_DENIED', 403);
  const unread = Number(body?.unread);
  if (!Number.isInteger(unread) || unread < 0 || unread > 100_000) throw new StaffAlertReadError('unread must be a whole number of 0 or more.', 'VALIDATION_FAILED');
  const surface = body?.surface == null ? 'pos' : String(body.surface);
  if (!['pos', 'owner_app', 'tech_app'].includes(surface)) throw new StaffAlertReadError('Unknown surface.', 'VALIDATION_FAILED');
  const sid = String(sessionId).slice(0, 100);
  await sql`insert into staff_badge_syncs (tenant_id, user_id, session_id, surface, first_sync_at, last_sync_at, last_unread, sync_count)
    values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${sid}, ${surface}, ${now}, ${now}, ${unread}, 1)
    on conflict (tenant_id, user_id, session_id) do update set last_sync_at = excluded.last_sync_at, last_unread = excluded.last_unread,
      surface = excluded.surface, sync_count = staff_badge_syncs.sync_count + 1`.execute(db);
  return { recordedAt: now.toISOString(), sessionRef: sid.slice(-6) };
}

/** Pure: one session's sync state. stale = no sync for N minutes and the device idle; broken = no sync for N minutes while
 *  the device was seen by the server within those minutes (it is not refreshing its badge); behind = synced recently, but the count changed. */
export function badgeSyncState(s: { lastSyncAt: number | null; lastUnread: number | null; lastSeenAt: number | null }, currentUnread: number, now: number, staleMs = BADGE_SYNC_STALE_MINUTES * 60_000): BadgeSyncState {
  if (s.lastSyncAt == null) return 'never';
  if (now - s.lastSyncAt > staleMs) return s.lastSeenAt != null && now - s.lastSeenAt <= staleMs ? 'broken' : 'stale';
  return s.lastUnread === currentUnread ? 'in_sync' : 'behind';
}

/** This person's live sessions with their last badge sync, compared with the count the server computes now. Read-only. */
export async function badgeSyncMonitor(db: Kysely<any>, ctx: AlertReadCtx, currentSessionId: string | null, now = new Date()): Promise<BadgeSyncMonitor> {
  const currentUnread = await unreadAlertCount(db, ctx, now);
  const summary: Record<BadgeSyncState, number> = { in_sync: 0, behind: 0, stale: 0, broken: 0, never: 0 };
  const out: BadgeSyncSession[] = [];
  if (UUID.test(ctx.userId || '')) {
    const rows = (await sql<{ id: string; device_name: string | null; platform: string | null; seen: string | null; last_sync_at: string | null; last_unread: number | null; sync_count: number | null }>`
      select s.id::text as id, s.device_name, s.platform, greatest(s.last_seen_at, s.last_activity_at) as seen, b.last_sync_at, b.last_unread, b.sync_count
        from sessions s
        left join staff_badge_syncs b on b.tenant_id = ${ctx.tenantId}::uuid and b.user_id = s.user_id and b.session_id = s.id::text
       where s.user_id = ${ctx.userId}::uuid and s.tenant_id = ${ctx.tenantId}::uuid and s.status = 'active' and s.revoked_at is null and s.expires_at > ${now}
       order by greatest(s.last_seen_at, s.last_activity_at) desc nulls last, s.created_at desc limit 20`.execute(db)).rows;
    for (const r of rows) {
      const lastSyncAt = r.last_sync_at ? Date.parse(String(r.last_sync_at)) : null;
      const seen = r.seen ? Date.parse(String(r.seen)) : null;
      const state = badgeSyncState({ lastSyncAt, lastUnread: r.last_unread == null ? null : Number(r.last_unread), lastSeenAt: seen }, currentUnread, now.getTime());
      summary[state]++;
      out.push({ sessionRef: String(r.id).slice(-6), current: !!currentSessionId && String(r.id) === String(currentSessionId), deviceName: r.device_name ?? null, platform: r.platform ?? null,
        lastSeenAt: iso(r.seen), lastSyncAt: iso(r.last_sync_at), lastUnread: r.last_unread == null ? null : Number(r.last_unread), syncCount: Number(r.sync_count ?? 0), state });
    }
  }
  return { generatedAt: now.toISOString(), currentUnread, staleAfterMinutes: BADGE_SYNC_STALE_MINUTES, sessions: out, summary };
}
