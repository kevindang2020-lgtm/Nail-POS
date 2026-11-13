// staff-alert-reads.pgtest.vitest.spec.ts — extras round 9: per-person alert read state (AI BUSINESS ALERTS 05, Global
// Loyalty Rewards 08) and the cross-device badge-sync monitor (Customer Notifications 04), over the real schema + 873.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { join } from 'node:path';
import { migratedPglite, kyselyFor, applyMigrationToPglite } from '@aipowersalon/testing';
import { TenantNavigationService, type NavCtx } from './tenant-navigation.service';
import { badgeSyncState } from './staff-alert-reads';

const T1 = '87300000-0000-4000-8000-000000000001', T2 = '87300000-0000-4000-8000-000000000002';
const B1 = '87300000-0000-4000-8000-0000000000b1', B1b = '87300000-0000-4000-8000-0000000000b2', B2 = '87300000-0000-4000-8000-0000000000b3';
const OWNER = '87300000-0000-4000-8000-0000000000a1', MGR = '87300000-0000-4000-8000-0000000000a2', DESK = '87300000-0000-4000-8000-0000000000a3', OTHER = '87300000-0000-4000-8000-0000000000a4';
const LOY = '87300000-0000-4000-8000-0000000000c1', BIZ = '87300000-0000-4000-8000-0000000000c2', OTHER_BRANCH = '87300000-0000-4000-8000-0000000000c3', FOREIGN = '87300000-0000-4000-8000-0000000000c4', OLD = '87300000-0000-4000-8000-0000000000c5', DONE = '87300000-0000-4000-8000-0000000000c6';
const S_OWNER_POS = '87300000-0000-4000-8000-0000000000d1', S_OWNER_TAB = '87300000-0000-4000-8000-0000000000d2', S_OWNER_IDLE = '87300000-0000-4000-8000-0000000000d3', S_OWNER_NEW = '87300000-0000-4000-8000-0000000000d4', S_OWNER_ENDED = '87300000-0000-4000-8000-0000000000d5';
const ALERT_PERMS = ['dashboard.view', 'owner.alerts.view'];
let pg: any; let svc: TenantNavigationService;
const ctx = (userId: string, perms = ALERT_PERMS, tenantId = T1, branchId = B1, sessionId: string | null = null): NavCtx => ({ tenantId, branchId, role: 'OWNER', permissions: perms, userId, sessionId });
const q = (text: string, params: unknown[] = []) => pg.query(text, params);

beforeAll(async () => {
  pg = await migratedPglite();
  // migration 873 is applied again here when present (idempotent) — a branch run before the shared schema cache holds it
  const f873 = join(MIGRATIONS_DIR, '873_staff_alert_reads.sql');
  if (existsSync(f873)) await applyMigrationToPglite(pg, readFileSync(f873, 'utf8'));
  svc = new TenantNavigationService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A LLC','A','sar-a','SARA'),($2,'B LLC','B','sar-b','SARB')`, [T1, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'),($3,$2,'Second','active','UTC'),($4,$5,'Main','active','UTC')`, [B1, T1, B1b, B2, T2]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$5,'Owner','o@sar.test','active','OWNER'),($2,$5,'Manager','m@sar.test','active','MANAGER'),
    ($3,$5,'Desk','d@sar.test','active','FRONT_DESK'),($4,$6,'Other','x@sar.test','active','OWNER')`, [OWNER, MGR, DESK, OTHER, T1, T2]);
  await q(`insert into owner_alerts (id, tenant_id, branch_id, category, severity, status, title, created_at) values
    ($1,$7,null,'loyalty','warning','new','Token balance is low', now() - interval '1 hour'),
    ($2,$7,$8,'ai_business_alert','critical','new','Sales dropped', now() - interval '2 hours'),
    ($3,$7,$9,'loyalty','warning','new','Other branch alert', now() - interval '3 hours'),
    ($4,$10,null,'loyalty','warning','new','Other salon alert', now()),
    ($5,$7,null,'loyalty','info','new','Old alert', now() - interval '40 days'),
    ($6,$7,null,'loyalty','info','resolved','Resolved alert', now() - interval '1 hour')`, [LOY, BIZ, OTHER_BRANCH, FOREIGN, OLD, DONE, T1, B1, B1b, T2]);
}, 240_000);

describe('per-person alert read state (AI BUSINESS ALERTS 05 / Global Loyalty Rewards 08)', () => {
  it('counts live, in-scope alerts of the last 30 days as unread for each person (badge + list)', async () => {
    expect((await svc.badges(ctx(OWNER))).alertsUnread).toBe(2);   // LOY (salon-wide) + BIZ (this branch); not the other branch / salon / old / resolved
    const list = await svc.staffAlerts(ctx(OWNER), {});
    expect(list.unread).toBe(2);
    expect(list.items.map((i) => i.alertId).sort()).toEqual([LOY, BIZ].sort());
    expect(list.items.every((i) => i.readAt === null && i.lifecycleStatus === 'new')).toBe(true);
  });

  it('a person without owner.alerts.view has none and cannot mark read', async () => {
    expect((await svc.badges(ctx(DESK, ['dashboard.view']))).alertsUnread).toBe(0);
    expect((await svc.staffAlerts(ctx(DESK, ['dashboard.view']), {})).items).toEqual([]);
    await expect(svc.markAlertsRead(ctx(DESK, ['dashboard.view']), [LOY])).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('reading clears ONLY my unread badge: the alert stays new (lifecycle untouched) and the manager still sees it unread', async () => {
    const r = await svc.markAlertsRead(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS), [LOY]);
    expect(r).toEqual({ marked: 1, unread: 1, lifecycleChanged: false });
    expect((await q(`select status from owner_alerts where id = $1`, [LOY])).rows[0].status).toBe('new');   // the failure is still open
    expect((await svc.badges(ctx(OWNER))).alertsUnread).toBe(1);
    expect((await svc.badges(ctx(MGR))).alertsUnread).toBe(2);
    const mine = (await svc.staffAlerts(ctx(OWNER), { category: 'loyalty' })).items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ alertId: LOY, lifecycleStatus: 'new' });
    expect(mine[0].readAt).not.toBeNull();
    expect((await q(`select read_session_id from staff_alert_reads where alert_id = $1 and user_id = $2`, [LOY, OWNER])).rows[0].read_session_id).toBe(S_OWNER_POS);
  });

  it('the read is server-side: another device of the same person reads the cleared count; reading twice is not counted twice', async () => {
    expect((await svc.badges(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_TAB))).alertsUnread).toBe(1);
    expect((await svc.markAlertsRead(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_TAB), [LOY])).marked).toBe(0);
  });

  it('acknowledging an alert (lifecycle) does not mark it read for anyone', async () => {
    await q(`update owner_alerts set status = 'acknowledged' where id = $1`, [BIZ]);
    expect((await svc.badges(ctx(MGR))).alertsUnread).toBe(2);
    expect((await svc.staffAlerts(ctx(MGR), {})).items.find((i) => i.alertId === BIZ)).toMatchObject({ lifecycleStatus: 'acknowledged', readAt: null });
  });

  it('another salon\'s or another branch\'s alert id is ignored (never marked, never an error that confirms it)', async () => {
    const r = await svc.markAlertsRead(ctx(OWNER), [FOREIGN, OTHER_BRANCH]);
    expect(r.marked).toBe(0);
    expect(Number((await q(`select count(*)::int as n from staff_alert_reads where alert_id = any($1::uuid[])`, [[FOREIGN, OTHER_BRANCH]])).rows[0].n)).toBe(0);
    await expect(svc.markAlertsRead(ctx(OWNER), ['not-a-uuid'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.markAlertsRead(ctx(OWNER), [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('the database refuses a read row that crosses salons (B-12 trigger)', async () => {
    await expect(q(`insert into staff_alert_reads (tenant_id, user_id, alert_id) values ($1, $2, $3)`, [T1, OWNER, FOREIGN])).rejects.toThrow();
    await expect(q(`insert into staff_alert_reads (tenant_id, user_id, alert_id) values ($1, $2, $3)`, [T1, OTHER, LOY])).rejects.toThrow();
  });
});

describe('cross-device badge-sync monitor (Customer Notifications 04)', () => {
  const now = Date.now();
  it('names each live session in sync / behind / stale / broken / never; ended sessions and other people are left out', async () => {
    await q(`insert into sessions (id, user_id, tenant_id, status, expires_at, last_seen_at, device_name, platform) values
      ($1,$6,$7,'active', now() + interval '1 day', now(), 'Front desk POS', 'web'),
      ($2,$6,$7,'active', now() + interval '1 day', now(), 'Back office tablet', 'web'),
      ($3,$6,$7,'active', now() + interval '1 day', now() - interval '2 hours', 'Old laptop', 'web'),
      ($4,$6,$7,'active', now() + interval '1 day', now(), 'New phone', 'ios'),
      ($5,$6,$7,'revoked', now() + interval '1 day', now(), 'Signed out', 'web')`, [S_OWNER_POS, S_OWNER_TAB, S_OWNER_IDLE, S_OWNER_NEW, S_OWNER_ENDED, OWNER, T1]);
    // the front-desk POS applied the current count (1) just now
    expect((await svc.recordBadgeSync(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS), { unread: 1 })).sessionRef).toBe(S_OWNER_POS.slice(-6));
    // the tablet synced recently but still shows 2 (before my read) → behind
    await q(`insert into staff_badge_syncs (tenant_id, user_id, session_id, last_sync_at, last_unread) values ($1,$2,$3, now() - interval '1 minute', 2)`, [T1, OWNER, S_OWNER_TAB]);
    // the tablet then kept talking to the server for 30 minutes without a badge sync → broken
    await q(`update staff_badge_syncs set last_sync_at = now() - interval '30 minutes' where session_id = $1`, [S_OWNER_TAB]);
    // the idle laptop last synced 3 hours ago and was last seen 2 hours ago → stale
    await q(`insert into staff_badge_syncs (tenant_id, user_id, session_id, last_sync_at, last_unread) values ($1,$2,$3, now() - interval '3 hours', 2)`, [T1, OWNER, S_OWNER_IDLE]);
    const m = await svc.badgeSyncMonitor(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS));
    expect(m.currentUnread).toBe(1);
    const byRef = Object.fromEntries(m.sessions.map((s) => [s.sessionRef, s]));
    expect(Object.keys(byRef).sort()).toEqual([S_OWNER_POS, S_OWNER_TAB, S_OWNER_IDLE, S_OWNER_NEW].map((s) => s.slice(-6)).sort());
    expect(byRef[S_OWNER_POS.slice(-6)]).toMatchObject({ state: 'in_sync', current: true, lastUnread: 1, syncCount: 1, deviceName: 'Front desk POS' });
    expect(byRef[S_OWNER_TAB.slice(-6)]).toMatchObject({ state: 'broken', current: false });
    expect(byRef[S_OWNER_IDLE.slice(-6)]).toMatchObject({ state: 'stale' });
    expect(byRef[S_OWNER_NEW.slice(-6)]).toMatchObject({ state: 'never', lastSyncAt: null, syncCount: 0 });
    expect(m.summary).toEqual({ in_sync: 1, behind: 0, stale: 1, broken: 1, never: 1 });
    expect(JSON.stringify(m)).not.toContain(S_OWNER_POS);   // never the full session id
  });

  it('a second sync from the same session updates its row (count + time), and a new read makes it behind until it syncs again', async () => {
    await svc.recordBadgeSync(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS), { unread: 1 });
    await svc.markAlertsRead(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_NEW), [BIZ]);
    let m = await svc.badgeSyncMonitor(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS));
    expect(m.currentUnread).toBe(0);
    expect(m.sessions.find((s) => s.current)).toMatchObject({ state: 'behind', syncCount: 2, lastUnread: 1 });
    await svc.recordBadgeSync(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS), { unread: 0 });
    m = await svc.badgeSyncMonitor(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS));
    expect(m.sessions.find((s) => s.current)).toMatchObject({ state: 'in_sync', syncCount: 3, lastUnread: 0 });
  });

  it('refuses a sync without a session or with a bad count; another salon\'s person sees only their own sessions', async () => {
    await expect(svc.recordBadgeSync(ctx(OWNER), { unread: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.recordBadgeSync(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS), { unread: -1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.recordBadgeSync(ctx(OWNER, ALERT_PERMS, T1, B1, S_OWNER_POS), { unread: 1.5 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await svc.badgeSyncMonitor(ctx(OTHER, ALERT_PERMS, T2, B2))).sessions).toEqual([]);
  });

  it('badgeSyncState rules (pure)', () => {
    const min = 60_000;
    expect(badgeSyncState({ lastSyncAt: null, lastUnread: null, lastSeenAt: now }, 0, now)).toBe('never');
    expect(badgeSyncState({ lastSyncAt: now - min, lastUnread: 3, lastSeenAt: now }, 3, now)).toBe('in_sync');
    expect(badgeSyncState({ lastSyncAt: now - min, lastUnread: 2, lastSeenAt: now }, 3, now)).toBe('behind');
    expect(badgeSyncState({ lastSyncAt: now - 20 * min, lastUnread: 3, lastSeenAt: now - 15 * min }, 3, now)).toBe('stale');
    expect(badgeSyncState({ lastSyncAt: now - 20 * min, lastUnread: 3, lastSeenAt: now }, 3, now)).toBe('broken');
  });
});
