// display-ads.repository.ts — the Postgres side of customer-display advertising (migration 509). Every statement carries
// tenant_id; every write that must agree with a count (the ad limit, the storage limit) runs under a per-salon advisory
// lock; every edit is an optimistic-concurrency UPDATE (version = expectedVersion) so two managers can't silently
// overwrite each other; and every audited action writes its audit_logs row in the SAME transaction as the change.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { DisplayAdError, isUuid, type AdFields, type AdRecord, type StoredStatus } from './display-ads-core';
import type { Variant } from './display-ads-media-core';
import { assertTransition } from '@aipowersalon/database';
import { DISPLAY_AD_LIFECYCLE } from './display-ads-lifecycle';

type Db = Kysely<DB>;
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const uuidOrNull = (v: string | null | undefined): string | null => (isUuid(v) ? v : null);
/** int2[] arrives as number[] (pg) or '{1,2}' (text) — accept both. */
function intArray(v: unknown): number[] | null {
  if (v == null) return null;
  const list = Array.isArray(v) ? v : String(v).replace(/[{}]/g, '').split(',').filter((x) => x.trim() !== '');
  const out = list.map(Number).filter((n) => Number.isInteger(n));
  return out.length ? out : null;
}

export interface VariantRef { key: string; url: string; width: number; height: number; bytes: number; mime: string }
export interface MediaRow {
  id: string; tenantId: string; mimeType: string; width: number; height: number; bytes: number; totalBytes: number;
  storageKey: string; variants: Record<Variant, VariantRef>; suggestedFocalX: number; suggestedFocalY: number;
  createdAt: string; deletedAt: string | null;
}
export interface WriteActor { tenantId: string; branchId: string | null; userId: string | null; role: string }
export interface AuditEntry { action: string; adId: string | null; metadata: Record<string, unknown> }
export interface DeviceRow { id: string; name: string; branchId: string | null; adsEnabled: boolean; lastSeenAt: string | null }
export interface DisplayRollup { adId: string; hourStart: string; count: number; ms: number; first: string; last: string }

export const AD_SETTINGS_CATEGORY = 'customer-display-ads';

// the ad columns, with the DATE columns read as text (a pg DATE becomes a local-midnight Date otherwise)
const AD_COLS = sql`id, tenant_id, name, media_id, fullscreen_media_id, headline, subheadline, description, cta_text, qr_kind, qr_url,
  fit_mode, focal_x, focal_y, start_date::text as start_date, end_date::text as end_date, days_of_week::text as days_of_week,
  daily_start_time, daily_end_time, display_duration_seconds, priority, all_branches, status, published_at, paused_at, archived_at,
  version, created_by, updated_by, created_at, updated_at`;

function toAd(r: any, branchIds: string[]): AdRecord {
  return {
    id: r.id, tenantId: r.tenant_id, version: num(r.version, 1), status: r.status as StoredStatus,
    name: r.name, mediaId: r.media_id ?? null, fullscreenMediaId: r.fullscreen_media_id ?? null,
    headline: r.headline ?? null, subheadline: r.subheadline ?? null, description: r.description ?? null, ctaText: r.cta_text ?? null,
    qrKind: r.qr_kind ?? null, qrUrl: r.qr_url ?? null, fitMode: r.fit_mode, focalX: num(r.focal_x, 0.5), focalY: num(r.focal_y, 0.5),
    startDate: r.start_date ?? null, endDate: r.end_date ?? null, daysOfWeek: intArray(r.days_of_week),
    dailyStartTime: r.daily_start_time ?? null, dailyEndTime: r.daily_end_time ?? null,
    displayDurationSeconds: r.display_duration_seconds == null ? null : num(r.display_duration_seconds),
    priority: num(r.priority), allBranches: !!r.all_branches, branchIds: [...branchIds].sort(),
    publishedAt: iso(r.published_at), pausedAt: iso(r.paused_at), archivedAt: iso(r.archived_at),
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, createdBy: r.created_by ?? null, updatedBy: r.updated_by ?? null,
  };
}
function toMedia(r: any): MediaRow {
  const v = typeof r.variants === 'string' ? JSON.parse(r.variants) : r.variants;
  return {
    id: r.id, tenantId: r.tenant_id, mimeType: r.mime_type, width: num(r.width), height: num(r.height), bytes: num(r.byte_size),
    totalBytes: num(r.total_bytes), storageKey: r.storage_key, variants: v, suggestedFocalX: num(r.suggested_focal_x, 0.5),
    suggestedFocalY: num(r.suggested_focal_y, 0.5), createdAt: iso(r.created_at)!, deletedAt: iso(r.deleted_at),
  };
}

export class DisplayAdsRepository {
  constructor(private readonly db: Db) {}

  // ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async branches(tenantId: string): Promise<{ id: string; name: string; timezone: string | null }[]> {
    const rows = await this.db.selectFrom('branches').select(['id', 'name', 'timezone']).where('tenant_id', '=', tenantId)
      .where('deleted_at', 'is', null).orderBy('name').execute();
    return rows.map((r: any) => ({ id: r.id, name: r.name, timezone: r.timezone ?? null }));
  }

  async salonName(tenantId: string): Promise<string> {
    const r: any = await this.db.selectFrom('tenants').select(['display_name', 'legal_name']).where('id', '=', tenantId).executeTakeFirst();
    return String(r?.display_name || r?.legal_name || 'Your salon');
  }

  private async targets(tenantId: string, adIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!adIds.length) return out;
    const rows = await this.db.selectFrom('display_ad_branches').select(['ad_id', 'branch_id'])
      .where('tenant_id', '=', tenantId).where('ad_id', 'in', adIds).execute();
    for (const r of rows) out.set(r.ad_id, [...(out.get(r.ad_id) ?? []), r.branch_id]);
    return out;
  }

  async listAds(tenantId: string): Promise<AdRecord[]> {
    const rows = (await sql<any>`select ${AD_COLS} from display_ads where tenant_id = ${tenantId} order by created_at desc, id`.execute(this.db)).rows;
    const t = await this.targets(tenantId, rows.map((r) => r.id));
    return rows.map((r) => toAd(r, t.get(r.id) ?? []));
  }

  async getAd(tenantId: string, id: string): Promise<AdRecord | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`select ${AD_COLS} from display_ads where tenant_id = ${tenantId} and id = ${id}`.execute(this.db)).rows[0];
    if (!r) return null;
    return toAd(r, (await this.targets(tenantId, [id])).get(id) ?? []);
  }

  /** §62: the ads that may play at ONE branch of ONE salon — published, and for all branches or targeted at it. */
  async publishedAdsForBranch(tenantId: string, branchId: string | null): Promise<AdRecord[]> {
    const rows = (await sql<any>`select ${AD_COLS} from display_ads a
      where a.tenant_id = ${tenantId} and a.status = 'published'
        and (a.all_branches or exists (select 1 from display_ad_branches b where b.tenant_id = ${tenantId} and b.ad_id = a.id and b.branch_id = ${branchId}))`.execute(this.db)).rows;
    const t = await this.targets(tenantId, rows.map((r) => r.id));
    return rows.map((r) => toAd(r, t.get(r.id) ?? []));
  }

  async mediaByIds(tenantId: string, ids: (string | null)[]): Promise<Map<string, MediaRow>> {
    const want = [...new Set(ids.filter(isUuid))];
    if (!want.length) return new Map();
    const rows = await this.db.selectFrom('display_ad_media').selectAll().where('tenant_id', '=', tenantId).where('id', 'in', want).execute();
    return new Map(rows.map((r) => [r.id, toMedia(r)]));
  }

  /** §110: the explicitly-set platform limits (the code defaults apply to every key not stored). */
  async platformSettingValues(): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom('platform_settings').select(['setting_key', 'value']).where('setting_key', 'like', 'display_ads.%').execute();
    return Object.fromEntries(rows.map((r) => [r.setting_key, r.value]));
  }

  async settingsRows(tenantId: string): Promise<{ tenant: unknown; branches: Map<string, unknown> }> {
    const rows = await this.db.selectFrom('tenant_settings').select(['branch_id', 'settings_json'])
      .where('tenant_id', '=', tenantId).where('category', '=', AD_SETTINGS_CATEGORY).execute();
    const branches = new Map<string, unknown>(); let tenant: unknown = null;
    for (const r of rows) { if (r.branch_id) branches.set(r.branch_id, r.settings_json); else tenant = r.settings_json; }
    return { tenant, branches };
  }

  async devices(tenantId: string): Promise<DeviceRow[]> {
    const rows = await this.db.selectFrom('customer_display_devices as d')
      .leftJoin('display_ad_device_settings as s', (j) => j.onRef('s.device_id', '=', 'd.id').onRef('s.tenant_id', '=', 'd.tenant_id'))
      .select(['d.id', 'd.device_name', 'd.branch_id', 'd.last_seen_at', 's.ads_enabled'])
      .where('d.tenant_id', '=', tenantId).where('d.revoked_at', 'is', null).orderBy('d.device_name').execute();
    return rows.map((r) => ({ id: r.id, name: r.device_name || 'Customer display', branchId: r.branch_id ?? null, adsEnabled: r.ads_enabled !== false, lastSeenAt: iso(r.last_seen_at) }));
  }

  async deviceAdsEnabled(tenantId: string, deviceId: string): Promise<boolean> {
    const r: any = await this.db.selectFrom('display_ad_device_settings').select('ads_enabled').where('tenant_id', '=', tenantId).where('device_id', '=', deviceId).executeTakeFirst();
    return r ? r.ads_enabled !== false : true;
  }

  /** The registered (paired, not revoked) displays of these branches — the ones to tell that the playlist changed. */
  async deviceIdsForBranches(tenantId: string, branchIds: string[] | 'all'): Promise<string[]> {
    let q = this.db.selectFrom('customer_display_devices').select('id').where('tenant_id', '=', tenantId).where('revoked_at', 'is', null);
    if (branchIds !== 'all') { if (!branchIds.length) return []; q = q.where('branch_id', 'in', branchIds); }
    return (await q.execute()).map((r: any) => r.id);
  }

  async usage(tenantId: string): Promise<{ adCount: number; storageBytes: number }> {
    const a: any = await this.db.selectFrom('display_ads').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '<>', 'archived').executeTakeFirst();
    const m: any = await this.db.selectFrom('display_ad_media').select((eb) => eb.fn.sum<number>('total_bytes').as('b')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst();
    return { adCount: num(a?.n), storageBytes: num(m?.b) };
  }

  /** §109 roll-ups since `since`, optionally limited to some branches. */
  async displayTotals(tenantId: string, since: Date, branchIds: string[] | null, recentSince: Date): Promise<{ byAd: any[]; byBranch: any[]; recentDevices: { deviceId: string; branchId: string; last: string }[] }> {
    let byAd = this.db.selectFrom('display_ad_display_stats').where('tenant_id', '=', tenantId).where('hour_start', '>=', since)
      .select((eb) => ['ad_id', eb.fn.sum<number>('display_count').as('n'), eb.fn.sum<number>('display_ms').as('ms'), eb.fn.max('last_shown_at').as('last')]).groupBy('ad_id');
    let byBranch = this.db.selectFrom('display_ad_display_stats').where('tenant_id', '=', tenantId).where('hour_start', '>=', since)
      .select((eb) => ['branch_id', eb.fn.sum<number>('display_count').as('n'), eb.fn.sum<number>('display_ms').as('ms')]).groupBy('branch_id');
    let recent = this.db.selectFrom('display_ad_display_stats').where('tenant_id', '=', tenantId).where('last_shown_at', '>=', recentSince)
      .select((eb) => ['device_id', 'branch_id', eb.fn.max('last_shown_at').as('last')]).groupBy(['device_id', 'branch_id']);
    if (branchIds) {
      if (!branchIds.length) return { byAd: [], byBranch: [], recentDevices: [] };
      byAd = byAd.where('branch_id', 'in', branchIds); byBranch = byBranch.where('branch_id', 'in', branchIds); recent = recent.where('branch_id', 'in', branchIds);
    }
    const [a, b, r] = await Promise.all([byAd.execute(), byBranch.execute(), recent.execute()]);
    return {
      byAd: a.map((x) => ({ adId: x.ad_id, count: num(x.n), ms: num(x.ms), last: iso(x.last) })),
      byBranch: b.map((x) => ({ branchId: x.branch_id, count: num(x.n), ms: num(x.ms) })),
      recentDevices: r.map((x) => ({ deviceId: x.device_id, branchId: x.branch_id, last: iso(x.last)! })),
    };
  }

  async lastShownByDevice(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.db.selectFrom('display_ad_display_stats').where('tenant_id', '=', tenantId)
      .select((eb) => ['device_id', eb.fn.max('last_shown_at').as('last')]).groupBy('device_id').execute();
    return new Map(rows.map((r) => [r.device_id, iso(r.last)!]));
  }

  async knownAdIds(tenantId: string, ids: string[]): Promise<Set<string>> {
    const want = [...new Set(ids.filter(isUuid))];
    if (!want.length) return new Set();
    const rows = await this.db.selectFrom('display_ads').select('id').where('tenant_id', '=', tenantId).where('id', 'in', want).execute();
    return new Set(rows.map((r) => r.id));
  }

  // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────────
  private async lockTenant(trx: any, tenantId: string, scope: string): Promise<void> {
    // one lock per salon and purpose (the key names no table — it locks nothing but this salon's counting)
    await sql`select pg_advisory_xact_lock(hashtext(${'dads-lock|' + scope + '|' + tenantId}))`.execute(trx);
  }

  private async audit(trx: any, actor: WriteActor, entries: AuditEntry[]): Promise<void> {
    for (const e of entries) {
      await trx.insertInto('audit_logs').values({
        tenant_id: actor.tenantId, branch_id: uuidOrNull(actor.branchId), user_id: uuidOrNull(actor.userId), role: actor.role || null,
        action_type: e.action, entity_type: e.adId ? 'display_ad' : 'display_ads', entity_id: e.adId,
        metadata_json: JSON.stringify(e.metadata),
      }).execute();
    }
  }

  private async writeTargets(trx: any, tenantId: string, adId: string, f: Pick<AdFields, 'allBranches' | 'branchIds'>): Promise<void> {
    await trx.deleteFrom('display_ad_branches').where('tenant_id', '=', tenantId).where('ad_id', '=', adId).execute();
    if (f.allBranches) return;
    for (const b of f.branchIds) await trx.insertInto('display_ad_branches').values({ tenant_id: tenantId, ad_id: adId, branch_id: b }).execute();
  }

  /** §49–§51: a new ad (always a draft). The ad limit is counted under the salon's lock, so two creates can't both pass. */
  async createAd(actor: WriteActor, f: AdFields, maxAds: number, audits: (adId: string) => AuditEntry[]): Promise<AdRecord> {
    const id = await this.db.transaction().execute(async (trx) => {
      await this.lockTenant(trx, actor.tenantId, 'ads');
      const c: any = await trx.selectFrom('display_ads').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', actor.tenantId).where('status', '<>', 'archived').executeTakeFirst();
      if (num(c?.n) >= maxAds) throw new DisplayAdError('PLAN_LIMIT_REACHED', `Your salon can have up to ${maxAds} advertisements. Archive one to add another.`, { limit: maxAds });
      const row: any = await trx.insertInto('display_ads').values({
        tenant_id: actor.tenantId, name: f.name, media_id: f.mediaId, fullscreen_media_id: f.fullscreenMediaId,
        headline: f.headline, subheadline: f.subheadline, description: f.description, cta_text: f.ctaText,
        qr_kind: f.qrKind, qr_url: f.qrUrl, fit_mode: f.fitMode, focal_x: f.focalX, focal_y: f.focalY,
        start_date: f.startDate, end_date: f.endDate, days_of_week: f.daysOfWeek, daily_start_time: f.dailyStartTime, daily_end_time: f.dailyEndTime,
        display_duration_seconds: f.displayDurationSeconds, priority: f.priority, all_branches: f.allBranches, status: 'draft',
        created_by: uuidOrNull(actor.userId), updated_by: uuidOrNull(actor.userId),
      }).returning('id').executeTakeFirstOrThrow();
      await this.writeTargets(trx, actor.tenantId, row.id, f);
      await this.audit(trx, actor, audits(row.id));
      return row.id as string;
    });
    return (await this.getAd(actor.tenantId, id))!;
  }

  /** The version check that turns "two managers edited at once" into a 409 instead of a silent overwrite. */
  private async conflictOrMissing(trx: any, tenantId: string, id: string): Promise<never> {
    const cur: any = await trx.selectFrom('display_ads').select('version').where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
    if (!cur) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'That advertisement no longer exists.');
    throw new DisplayAdError('VERSION_CONFLICT', 'Someone else changed this advertisement. Refresh and try again.', { currentVersion: num(cur.version) });
  }

  async updateAd(actor: WriteActor, id: string, expectedVersion: number, f: AdFields, audits: AuditEntry[]): Promise<AdRecord> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx.updateTable('display_ads').set({
        name: f.name, media_id: f.mediaId, fullscreen_media_id: f.fullscreenMediaId,
        headline: f.headline, subheadline: f.subheadline, description: f.description, cta_text: f.ctaText,
        qr_kind: f.qrKind, qr_url: f.qrUrl, fit_mode: f.fitMode, focal_x: f.focalX, focal_y: f.focalY,
        start_date: f.startDate, end_date: f.endDate, days_of_week: f.daysOfWeek, daily_start_time: f.dailyStartTime, daily_end_time: f.dailyEndTime,
        display_duration_seconds: f.displayDurationSeconds, priority: f.priority, all_branches: f.allBranches,
        version: sql`version + 1`, updated_by: uuidOrNull(actor.userId), updated_at: sql`now()`,
      }).where('tenant_id', '=', actor.tenantId).where('id', '=', id).where('version', '=', expectedVersion).where('status', '<>', 'archived')
        .returning('id').executeTakeFirst();
      if (!row) {
        const cur: any = await trx.selectFrom('display_ads').select(['version', 'status']).where('tenant_id', '=', actor.tenantId).where('id', '=', id).executeTakeFirst();
        if (cur && cur.status === 'archived' && num(cur.version) === expectedVersion) throw new DisplayAdError('CONFLICT', 'Restore this advertisement before editing it.');
        await this.conflictOrMissing(trx, actor.tenantId, id);
      }
      await this.writeTargets(trx, actor.tenantId, id, f);
      await this.audit(trx, actor, audits);
    });
    return (await this.getAd(actor.tenantId, id))!;
  }

  /** §64 transitions. `from` is what the service checked; the UPDATE re-checks it with the version, so a status that
   *  changed in between is a conflict, never a wrong transition. Restoring counts against the ad limit (an archived ad
   *  does not). */
  async setStatus(actor: WriteActor, id: string, expectedVersion: number, from: StoredStatus, to: StoredStatus, audits: AuditEntry[], maxAds: number): Promise<AdRecord> {
    assertTransition(DISPLAY_AD_LIFECYCLE, from, to);   // Phase 12 (#27): the one transition table; the update below stays conditional on `from`
    await this.db.transaction().execute(async (trx) => {
      if (from === 'archived' && to !== 'archived') {
        await this.lockTenant(trx, actor.tenantId, 'ads');
        const c: any = await trx.selectFrom('display_ads').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', actor.tenantId).where('status', '<>', 'archived').executeTakeFirst();
        if (num(c?.n) >= maxAds) throw new DisplayAdError('PLAN_LIMIT_REACHED', `Your salon can have up to ${maxAds} advertisements. Archive one to restore this one.`, { limit: maxAds });
      }
      const stamp = to === 'published' ? { published_at: sql`now()`, paused_at: null } : to === 'paused' ? { paused_at: sql`now()` } : to === 'archived' ? { archived_at: sql`now()` } : { archived_at: null };
      const row = await trx.updateTable('display_ads').set({ status: to, ...stamp, version: sql`version + 1`, updated_by: uuidOrNull(actor.userId), updated_at: sql`now()` } as any)
        .where('tenant_id', '=', actor.tenantId).where('id', '=', id).where('version', '=', expectedVersion).where('status', '=', from)
        .returning('id').executeTakeFirst();
      if (!row) await this.conflictOrMissing(trx, actor.tenantId, id);
      await this.audit(trx, actor, audits);
    });
    return (await this.getAd(actor.tenantId, id))!;
  }

  /** §74 removal: a draft or an archived ad can be deleted for good (its targets and display counts go with it). */
  async deleteAd(actor: WriteActor, id: string, expectedVersion: number, audits: AuditEntry[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx.deleteFrom('display_ads').where('tenant_id', '=', actor.tenantId).where('id', '=', id).where('version', '=', expectedVersion)
        .where('status', 'in', ['draft', 'archived']).returning('id').executeTakeFirst();
      if (!row) {
        const cur: any = await trx.selectFrom('display_ads').select(['version', 'status']).where('tenant_id', '=', actor.tenantId).where('id', '=', id).executeTakeFirst();
        if (cur && num(cur.version) === expectedVersion) throw new DisplayAdError('CONFLICT', 'Archive this advertisement before deleting it.');
        await this.conflictOrMissing(trx, actor.tenantId, id);
      }
      await this.audit(trx, actor, audits);
    });
  }

  /** §68: record an uploaded image (bytes already in object storage). The storage limit is checked under the salon's
   *  lock, so two uploads at once cannot both squeeze under it. */
  async insertMedia(actor: WriteActor, m: { id: string; mimeType: string; width: number; height: number; bytes: number; totalBytes: number; sha256: string; storageKey: string; variants: Record<Variant, VariantRef>; focalX: number; focalY: number; filename: string | null }, storageLimitBytes: number, audit: AuditEntry): Promise<MediaRow> {
    await this.db.transaction().execute(async (trx) => {
      await this.lockTenant(trx, actor.tenantId, 'media');
      const s: any = await trx.selectFrom('display_ad_media').select((eb) => eb.fn.sum<number>('total_bytes').as('b')).where('tenant_id', '=', actor.tenantId).where('deleted_at', 'is', null).executeTakeFirst();
      const used = num(s?.b);
      if (used + m.totalBytes > storageLimitBytes) {
        throw new DisplayAdError('PLAN_LIMIT_REACHED', `Advertising image storage is full (${Math.round(storageLimitBytes / 1024 / 1024)} MB). Delete unused ads to free space.`, { usedBytes: used, limitBytes: storageLimitBytes });
      }
      await trx.insertInto('display_ad_media').values({
        id: m.id, tenant_id: actor.tenantId, mime_type: m.mimeType, width: m.width, height: m.height, byte_size: m.bytes,
        total_bytes: m.totalBytes, sha256: m.sha256, storage_key: m.storageKey, variants: JSON.stringify(m.variants),
        suggested_focal_x: m.focalX, suggested_focal_y: m.focalY, original_filename: m.filename, created_by: uuidOrNull(actor.userId),
      }).execute();
      await this.audit(trx, actor, [audit]);
    });
    return (await this.mediaByIds(actor.tenantId, [m.id])).get(m.id)!;
  }

  /** Images no ad uses any more (replaced, or never attached), older than `before` — candidates for clean-up. */
  async unattachedMedia(tenantId: string, before: Date, limit: number): Promise<MediaRow[]> {
    const rows = (await sql<any>`select m.* from display_ad_media m
      where m.tenant_id = ${tenantId} and m.deleted_at is null and m.created_at < ${before}
        and not exists (select 1 from display_ads a where a.tenant_id = ${tenantId} and (a.media_id = m.id or a.fullscreen_media_id = m.id))
      order by m.created_at limit ${limit}`.execute(this.db)).rows;
    return rows.map(toMedia);
  }

  /** Soft-delete — only while still unused (an ad may have picked the image up since it was listed). */
  async markMediaDeleted(tenantId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = (await sql<any>`update display_ad_media m set deleted_at = now()
      where m.tenant_id = ${tenantId} and m.id = any(${ids}::uuid[]) and m.deleted_at is null
        and not exists (select 1 from display_ads a where a.tenant_id = ${tenantId} and (a.media_id = m.id or a.fullscreen_media_id = m.id))
      returning m.id`.execute(this.db)).rows;
    return rows.map((r) => r.id);
  }

  /** tenant_settings category 'customer-display-ads': the salon-wide row (branch null) or one branch's row. */
  async saveSettings(actor: WriteActor, branchId: string | null, json: Record<string, unknown>, audit: AuditEntry): Promise<void> {
    const body = JSON.stringify(json);
    await this.db.transaction().execute(async (trx) => {
      if (branchId) {
        await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id)
          values (${actor.tenantId}, ${branchId}, ${AD_SETTINGS_CATEGORY}, ${body}::jsonb, ${uuidOrNull(actor.userId)})
          on conflict (tenant_id, branch_id, category) do update set settings_json = excluded.settings_json, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`.execute(trx);
      } else {
        await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json, updated_by_user_id)
          values (${actor.tenantId}, null, ${AD_SETTINGS_CATEGORY}, ${body}::jsonb, ${uuidOrNull(actor.userId)})
          on conflict (tenant_id, category) where branch_id is null do update set settings_json = excluded.settings_json, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`.execute(trx);
      }
      await this.audit(trx, actor, [audit]);
    });
  }

  /** §111 device layer. false when the display is not this salon's (the composite key would refuse it anyway). */
  async setDeviceAdsEnabled(actor: WriteActor, deviceId: string, enabled: boolean, audit: AuditEntry): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const dev = await trx.selectFrom('customer_display_devices').select('id').where('tenant_id', '=', actor.tenantId).where('id', '=', deviceId).where('revoked_at', 'is', null).executeTakeFirst();
      if (!dev) return false;
      await sql`insert into display_ad_device_settings (tenant_id, device_id, ads_enabled, updated_by)
        values (${actor.tenantId}, ${deviceId}, ${enabled}, ${uuidOrNull(actor.userId)})
        on conflict (device_id) do update set ads_enabled = excluded.ads_enabled, updated_by = excluded.updated_by, updated_at = now()
        where display_ad_device_settings.tenant_id = ${actor.tenantId}`.execute(trx);
      await this.audit(trx, actor, [audit]);
      return true;
    });
  }

  /**
   * §108: add a device's report to the hourly roll-ups. The batch id is claimed first, in the same transaction — a
   * resent batch (the device never saw the answer) claims nothing and adds nothing. Old batch ids of this device are
   * pruned here, so the table stays small without a background job.
   */
  async recordDisplays(tenantId: string, branchId: string, deviceId: string, batchId: string, rows: DisplayRollup[]): Promise<{ duplicate: boolean; accepted: number }> {
    return this.db.transaction().execute(async (trx) => {
      const claimed = (await sql<any>`insert into display_ad_report_batches (tenant_id, device_id, batch_id) values (${tenantId}, ${deviceId}, ${batchId})
        on conflict (device_id, batch_id) do nothing returning batch_id`.execute(trx)).rows;
      if (!claimed.length) return { duplicate: true, accepted: 0 };
      await sql`delete from display_ad_report_batches where tenant_id = ${tenantId} and device_id = ${deviceId} and received_at < now() - interval '3 days'`.execute(trx);
      let accepted = 0;
      for (const r of rows) {
        await sql`insert into display_ad_display_stats (tenant_id, branch_id, device_id, ad_id, hour_start, display_count, display_ms, first_shown_at, last_shown_at)
          values (${tenantId}, ${branchId}, ${deviceId}, ${r.adId}, ${r.hourStart}, ${r.count}, ${r.ms}, ${r.first}, ${r.last})
          on conflict (ad_id, device_id, hour_start) do update set
            display_count = display_ad_display_stats.display_count + excluded.display_count,
            display_ms = display_ad_display_stats.display_ms + excluded.display_ms,
            first_shown_at = least(display_ad_display_stats.first_shown_at, excluded.first_shown_at),
            last_shown_at = greatest(display_ad_display_stats.last_shown_at, excluded.last_shown_at)
          where display_ad_display_stats.tenant_id = ${tenantId}`.execute(trx);
        accepted += r.count;
      }
      return { duplicate: false, accepted };
    });
  }
}
