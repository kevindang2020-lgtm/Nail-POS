// platform-advertising.ts — Global Advertising + Tenant Control guide (Nov 5 2026, G7, migration 818).
//
// ONE master switch (Super Admin): Allow Tenant Advertising.
//   ON  → TENANT_ONLY   each salon's own published ads (the existing engine, unchanged)
//   OFF → PLATFORM_ONLY every idle customer display plays AI PowerSalon's own campaigns (platform_display_ads)
// Never a mix. The policy is read server-side at EVERY playlist request and tenant mutation (§11); a hidden button is not
// the guard. Platform campaigns reuse the tenant engine's validation (applyAdInput), state transitions, playlist builder
// (resolvePlaylist) and display DTO — one engine, two owners (§02).
//
// Fleet status (§39, §63–§65): a display counts as "policy applied" ONLY when its own heartbeat acknowledged the current
// policy version and mode (customer_display_devices.applied_ad_*), never because a message was sent. Connected = fresh
// heartbeat (DISPLAY_ONLINE_WINDOW_MS); registered eligible = applied + online pending + offline; revoked excluded.
import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import { DISPLAY_ONLINE_WINDOW_MS } from '@aipowersalon/api-contracts';
import type { MediaStorage } from '@aipowersalon/media';
import { acceptUpload, UPLOAD_POLICIES, uploadObjectKey } from '@aipowersalon/media';
import { BLANK_AD_FIELDS, DEFAULT_TENANT_AD_SETTINGS, DisplayAdError, applyAdInput, changedFields, effectiveStatus, isUuid, pickFields, resolvePlaylist, transition,
  type AdFields, type AdRecord, type StoredStatus } from './display-ads-core';
import { checkAdImageUpload, focalOr, VARIANTS, type UploadedPart, type Variant } from './display-ads-media-core';
import { toAd, toMedia, type MediaRow, type VariantRef } from './display-ads.repository';
import { toPlaylistAd } from './display-ads-playlist.service';
import type { PlatformLimitsSource } from './display-ads-sources';
import { canMoveToSql } from '@aipowersalon/database';
import { PLATFORM_DISPLAY_AD_LIFECYCLE } from './display-ads-lifecycle';

export type AdvertisingMode = 'PLATFORM_ONLY' | 'TENANT_ONLY';
export interface AdvertisingPolicy { allowTenantAdvertising: boolean; mode: AdvertisingMode; version: number; effectiveAt: string; reason: string | null }
export interface AdvertisingPolicyPort { current(): Promise<AdvertisingPolicy> }
export const ADVERTISING_POLICY = 'ADVERTISING_POLICY';
type Db = Kysely<any>;
const N = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const modeOf = (allow: boolean): AdvertisingMode => (allow ? 'TENANT_ONLY' : 'PLATFORM_ONLY');

/** The one authority (a 5-second cache keeps the device playlist hot path cheap; a write clears it at once). A failed read
 *  keeps the last known policy; with none it answers TENANT_ONLY (today's behaviour — nothing switches on a failure). */
export class AdvertisingPolicyStore implements AdvertisingPolicyPort {
  private hit: { at: number; v: AdvertisingPolicy } | null = null;
  constructor(private readonly db: Db | null, private readonly ttlMs = 5_000, private readonly clock: () => number = () => Date.now()) {}
  invalidate() { this.hit = null; }
  async current(): Promise<AdvertisingPolicy> {
    const now = this.clock();
    if (this.hit && now - this.hit.at < this.ttlMs) return this.hit.v;
    if (!this.db) return { allowTenantAdvertising: true, mode: 'TENANT_ONLY', version: 0, effectiveAt: new Date(0).toISOString(), reason: null };
    try {
      const r = (await sql<any>`select allow_tenant_advertising, version, effective_at, reason from advertising_global_policy where id = 1`.execute(this.db)).rows[0];
      const v: AdvertisingPolicy = r ? { allowTenantAdvertising: !!r.allow_tenant_advertising, mode: modeOf(!!r.allow_tenant_advertising), version: N(r.version, 1), effectiveAt: iso(r.effective_at)!, reason: r.reason ?? null }
        : { allowTenantAdvertising: true, mode: 'TENANT_ONLY', version: 0, effectiveAt: new Date(0).toISOString(), reason: null };
      this.hit = { at: now, v };
      return v;
    } catch (e) {
      if (!this.hit) throw e;
      console.warn(`[advertising] policy read failed; keeping version ${this.hit.v.version}: ${(e as Error)?.message ?? e}`);
      return this.hit.v;
    }
  }
}

/** §08 / §42: a tenant advertising write while AI PowerSalon manages advertising is refused — saved campaigns stay. */
export async function assertTenantAdvertisingAllowed(policy: AdvertisingPolicyPort | null | undefined): Promise<void> {
  if (!policy) return;
  const p = await policy.current();
  if (p.mode === 'PLATFORM_ONLY') throw new DisplayAdError('ADVERTISING_MANAGED_BY_PLATFORM', 'Advertising is currently managed by AI PowerSalon. Your saved advertisements are kept and return when salon advertising is turned back on.', { mode: p.mode, policyVersion: p.version });
}

const PLATFORM_COLS = sql`id, null::uuid as tenant_id, name, media_id, null::uuid as fullscreen_media_id, headline, subheadline, description, cta_text, qr_kind, qr_url,
  fit_mode, focal_x, focal_y, start_date::text as start_date, end_date::text as end_date, days_of_week::text as days_of_week,
  daily_start_time, daily_end_time, display_duration_seconds, priority, true as all_branches, status, published_at, paused_at, archived_at,
  version, created_by, updated_by, created_at, updated_at`;
const PLATFORM_TZ = 'America/New_York';   // the platform calendar for "expired" in the Super Admin list; displays evaluate in their own branch zone

export interface PlatformActor { userId: string | null; email?: string | null }

export class PlatformAdvertisingService {
  constructor(private readonly db: Db, private readonly storage: MediaStorage | null, private readonly limits: Pick<PlatformLimitsSource, 'get'>,
    private readonly policy: AdvertisingPolicyStore, private readonly notify: (reason: string) => Promise<void> = async () => undefined,
    private readonly clock: () => Date = () => new Date()) {}

  // ── the master switch ───────────────────────────────────────────────────────────────────────────────────────────
  /** §13: what a switch would affect — computed, never invented. */
  async preview() {
    const p = await this.policy.current();
    const since = new Date(this.clock().getTime() - DISPLAY_ONLINE_WINDOW_MS);
    const r = (await sql<any>`select
        (select count(distinct a.tenant_id)::int from display_ads a where a.status = 'published') as tenants_with_live_ads,
        (select count(*)::int from display_ads a where a.status = 'published') as live_tenant_ads,
        (select count(*)::int from platform_display_ads p join platform_ad_media m on m.id = p.media_id and m.deleted_at is null where p.status = 'published') as platform_ads_ready,
        (select count(*)::int from customer_display_devices d where d.revoked_at is null) as registered_displays,
        (select count(*)::int from customer_display_devices d where d.revoked_at is null and d.last_seen_at >= ${since}) as online_displays`.execute(this.db)).rows[0];
    const registered = N(r.registered_displays); const online = N(r.online_displays);
    return { policy: p, tenantsWithLiveAds: N(r.tenants_with_live_ads), liveTenantAds: N(r.live_tenant_ads), platformAdsReady: N(r.platform_ads_ready),
      registeredDisplays: registered, onlineDisplays: online, offlineDisplays: registered - online,
      neutralFallbackWhenEmpty: N(r.platform_ads_ready) === 0 };
  }

  async setPolicy(actor: PlatformActor, b: { allowTenantAdvertising?: unknown; reason?: unknown; expectedVersion?: unknown; acceptNeutralFallback?: unknown }) {
    if (typeof b.allowTenantAdvertising !== 'boolean') throw new DisplayAdError('VALIDATION_FAILED', 'Choose On or Off.', { field: 'allowTenantAdvertising' });
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (reason.length < 5) throw new DisplayAdError('VALIDATION_FAILED', 'Give a reason for the change (at least 5 characters).', { field: 'reason' });
    const pv = await this.preview();
    // §37: PLATFORM_ONLY needs a ready platform ad, or a deliberate choice of the neutral panel
    if (!b.allowTenantAdvertising && pv.platformAdsReady === 0 && b.acceptNeutralFallback !== true)
      throw new DisplayAdError('CONFLICT', 'No published platform advertisement is ready. Publish one first, or confirm that displays may show the neutral welcome panel.', { platformAdsReady: 0 });
    const out = await this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select allow_tenant_advertising, version from advertising_global_policy where id = 1 for update`.execute(trx)).rows[0];
      const curV = N(cur?.version, 1);
      if (typeof b.expectedVersion !== 'number' || b.expectedVersion !== curV) throw new DisplayAdError('VERSION_CONFLICT', 'Someone else changed the advertising policy. Reload and try again.', { currentVersion: curV });
      if (!!cur?.allow_tenant_advertising === b.allowTenantAdvertising) return { version: curV, changed: false };
      const version = curV + 1;
      await sql`update advertising_global_policy set allow_tenant_advertising = ${b.allowTenantAdvertising}, version = ${version}, effective_at = now(), updated_by = ${actor.userId}, reason = ${reason}, updated_at = now() where id = 1`.execute(trx);
      await sql`insert into advertising_policy_events (version, from_mode, to_mode, reason, actor_user_id, preview)
        values (${version}, ${modeOf(!!cur?.allow_tenant_advertising)}, ${modeOf(b.allowTenantAdvertising as boolean)}, ${reason}, ${actor.userId}, ${JSON.stringify({ ...pv, policy: undefined })}::jsonb)`.execute(trx);
      return { version, changed: true };
    });
    this.policy.invalidate();
    if (out.changed) await this.notify('advertising_policy_changed');
    return { ...out, ...(await this.preview()) };
  }

  async history(limit = 25) {
    return (await sql<any>`select e.id, e.version, e.from_mode, e.to_mode, e.reason, e.created_at, coalesce(u.full_name, u.email) as actor from advertising_policy_events e
      left join users u on u.id = e.actor_user_id order by e.created_at desc, e.id desc limit ${limit}`.execute(this.db)).rows
      .map((r: any) => ({ id: String(r.id), version: N(r.version), from: r.from_mode, to: r.to_mode, reason: r.reason, at: iso(r.created_at), actor: r.actor ?? null }));
  }

  /** §39 / §63–§65: device truth from heartbeats + acknowledgments. Counts reconcile: registered = applied + pending + offline. */
  async fleet(q: { status?: string; tenantId?: string; page?: unknown; pageSize?: unknown } = {}) {
    const p = await this.policy.current();
    const since = new Date(this.clock().getTime() - DISPLAY_ONLINE_WINDOW_MS);
    const cls = sql`case when d.last_seen_at is null or d.last_seen_at < ${since} then 'offline'
      when d.applied_ad_policy_version = ${p.version} and d.applied_ad_mode = ${p.mode} then 'applied' else 'pending' end`;
    const c = (await sql<any>`select ${cls} as k, count(*)::int as n from customer_display_devices d where d.revoked_at is null group by 1`.execute(this.db)).rows;
    const by = Object.fromEntries(c.map((r: any) => [r.k, N(r.n)]));
    const revoked = N((await sql<any>`select count(*)::int as n from customer_display_devices where revoked_at is not null`.execute(this.db)).rows[0]?.n);
    const counts = { applied: by.applied ?? 0, pending: by.pending ?? 0, offline: by.offline ?? 0, revoked };
    const page = Math.max(1, Math.trunc(N(q.page, 1))); const size = Math.max(1, Math.min(100, Math.trunc(N(q.pageSize, 25))));
    const st = ['applied', 'pending', 'offline'].includes(String(q.status)) ? String(q.status) : null;
    const tn = isUuid(q.tenantId) ? q.tenantId : null;
    const where = sql`d.revoked_at is null and ${st ? sql`${cls} = ${st}` : sql`true`} and ${tn ? sql`d.tenant_id = ${tn}` : sql`true`}`;
    const total = N((await sql<any>`select count(*)::int as n from customer_display_devices d where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select d.id, d.tenant_id, d.branch_id, d.device_name as name, d.last_seen_at, d.app_version, d.reported_mode, d.applied_ad_policy_version, d.applied_ad_mode, d.applied_ad_at,
        t.display_name as tenant_name, b.name as branch_name, ${cls} as status
      from customer_display_devices d left join tenants t on t.id = d.tenant_id left join branches b on b.id = d.branch_id and b.tenant_id = d.tenant_id
      where ${where} order by d.last_seen_at desc nulls last, d.id limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    return { policy: p, onlineWindowSeconds: DISPLAY_ONLINE_WINDOW_MS / 1000, counts: { ...counts, connected: counts.applied + counts.pending, registered: counts.applied + counts.pending + counts.offline },
      items: rows.map((r: any) => ({ deviceId: String(r.id), tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? null, branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null,
        name: r.name ?? null, status: r.status, lastSeenAt: iso(r.last_seen_at), appVersion: r.app_version ?? null, reportedMode: r.reported_mode ?? null,
        appliedPolicyVersion: r.applied_ad_policy_version == null ? null : N(r.applied_ad_policy_version), appliedMode: r.applied_ad_mode ?? null, appliedAt: iso(r.applied_ad_at) })),
      page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) };
  }

  // ── platform campaigns (§33–§38) ─────────────────────────────────────────────────────────────────────────────────
  private async adRow(trx: Db, id: string, lock = false): Promise<AdRecord> {
    if (!isUuid(id)) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'That advertisement was not found.');
    const r = (await sql<any>`select ${PLATFORM_COLS} from platform_display_ads where id = ${id} ${lock ? sql`for update` : sql``}`.execute(trx)).rows[0];
    if (!r) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'That advertisement was not found.');
    return toAd({ ...r, tenant_id: 'platform' }, []);
  }
  private async media(ids: (string | null)[], trx: Db = this.db): Promise<Map<string, MediaRow>> {
    const want = [...new Set(ids.filter(isUuid))];
    if (!want.length) return new Map();
    const rows = (await sql<any>`select id, mime_type, width, height, byte_size, total_bytes, sha256, storage_key, variants, suggested_focal_x, suggested_focal_y, original_filename, created_by, created_at, deleted_at, deleted_by, null::uuid as tenant_id from platform_ad_media where id = any(${want}::uuid[])`.execute(trx)).rows;
    return new Map(rows.map((r: any) => [String(r.id), toMedia(r)]));
  }
  private view(a: AdRecord, media: Map<string, MediaRow>) {
    const m = a.mediaId ? media.get(a.mediaId) : null;
    return { ...a, tenantId: undefined, allBranches: undefined, branchIds: undefined, fullscreenMediaId: undefined,
      effectiveStatus: effectiveStatus(a, PLATFORM_TZ, this.clock()), image: m && !m.deletedAt ? { thumb: m.variants.thumb?.url ?? null, medium: m.variants.medium?.url ?? null, width: m.width, height: m.height } : null };
  }
  async list(q: { status?: string; page?: unknown; pageSize?: unknown } = {}) {
    const st = ['draft', 'published', 'paused', 'archived'].includes(String(q.status)) ? String(q.status) : null;
    const page = Math.max(1, Math.trunc(N(q.page, 1))); const size = Math.max(1, Math.min(100, Math.trunc(N(q.pageSize, 25))));
    const where = st ? sql`status = ${st}` : sql`status <> 'archived'`;
    const total = N((await sql<any>`select count(*)::int as n from platform_display_ads where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select ${PLATFORM_COLS} from platform_display_ads where ${where} order by priority desc, created_at desc, id limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    const ads = rows.map((r: any) => toAd({ ...r, tenant_id: 'platform' }, []));
    const media = await this.media(ads.map((a: AdRecord) => a.mediaId));
    return { items: ads.map((a: AdRecord) => this.view(a, media)), page, pageSize: size, totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)) };
  }
  private async assertMedia(f: AdFields, trx: Db) {
    if (!f.mediaId) return;
    const m = (await this.media([f.mediaId], trx)).get(f.mediaId);
    if (!m || m.deletedAt) throw new DisplayAdError('VALIDATION_FAILED', 'That image is no longer available. Upload it again.', { field: 'mediaId' });
  }
  private clean(input: unknown): Record<string, unknown> {
    const i = { ...(input && typeof input === 'object' ? input as Record<string, unknown> : {}) };
    delete i.allBranches; delete i.branchIds; delete i.fullscreenMediaId; delete i.tenantId; delete i.ownership;   // §77: a forged scope field is ignored
    return i;
  }
  async create(actor: PlatformActor, input: unknown) {
    const f = applyAdInput(BLANK_AD_FIELDS, this.clean(input), { requireName: true });
    return this.db.transaction().execute(async (trx) => {
      await this.assertMedia(f, trx);
      const r = (await sql<any>`insert into platform_display_ads (name, media_id, headline, subheadline, description, cta_text, qr_kind, qr_url, fit_mode, focal_x, focal_y, start_date, end_date,
          days_of_week, daily_start_time, daily_end_time, display_duration_seconds, priority, status, created_by, updated_by)
        values (${f.name}, ${f.mediaId}, ${f.headline}, ${f.subheadline}, ${f.description}, ${f.ctaText}, ${f.qrKind}, ${f.qrUrl}, ${f.fitMode}, ${f.focalX}, ${f.focalY}, ${f.startDate}::date, ${f.endDate}::date,
          ${f.daysOfWeek}::smallint[], ${f.dailyStartTime}, ${f.dailyEndTime}, ${f.displayDurationSeconds}, ${f.priority}, 'draft', ${actor.userId}, ${actor.userId}) returning id`.execute(trx)).rows[0];
      await sql`insert into platform_ad_events (ad_id, action, actor_user_id, detail) values (${r.id}, 'created', ${actor.userId}, ${JSON.stringify({ name: f.name })}::jsonb)`.execute(trx);
      const a = await this.adRow(trx, String(r.id));
      return this.view(a, await this.media([a.mediaId], trx));
    });
  }
  async update(actor: PlatformActor, id: string, input: unknown) {
    const i = this.clean(input);
    if (typeof i.expectedVersion !== 'number') throw new DisplayAdError('VALIDATION_FAILED', 'expectedVersion is required.', { field: 'expectedVersion' });
    const out = await this.db.transaction().execute(async (trx) => {
      const cur = await this.adRow(trx, id, true);
      if (cur.version !== i.expectedVersion) throw new DisplayAdError('VERSION_CONFLICT', 'Someone else changed this advertisement. Refresh and try again.', { currentVersion: cur.version });
      const f = applyAdInput(pickFields(cur), i);
      await this.assertMedia(f, trx);
      if (cur.status === 'published' && !f.mediaId) throw new DisplayAdError('VALIDATION_FAILED', 'A live advertisement needs its image.', { field: 'mediaId' });
      const changed = changedFields(cur, f);
      if (changed.length) {
        await sql`update platform_display_ads set name = ${f.name}, media_id = ${f.mediaId}, headline = ${f.headline}, subheadline = ${f.subheadline}, description = ${f.description}, cta_text = ${f.ctaText},
            qr_kind = ${f.qrKind}, qr_url = ${f.qrUrl}, fit_mode = ${f.fitMode}, focal_x = ${f.focalX}, focal_y = ${f.focalY}, start_date = ${f.startDate}::date, end_date = ${f.endDate}::date,
            days_of_week = ${f.daysOfWeek}::smallint[], daily_start_time = ${f.dailyStartTime}, daily_end_time = ${f.dailyEndTime}, display_duration_seconds = ${f.displayDurationSeconds}, priority = ${f.priority},
            version = version + 1, updated_by = ${actor.userId}, updated_at = now() where id = ${id}`.execute(trx);
        await sql`insert into platform_ad_events (ad_id, action, actor_user_id, detail) values (${id}, 'updated', ${actor.userId}, ${JSON.stringify({ changed })}::jsonb)`.execute(trx);
      }
      const a = await this.adRow(trx, id);
      return { view: this.view(a, await this.media([a.mediaId], trx)), live: cur.status === 'published' && changed.length > 0 };
    });
    if (out.live) await this.notify('platform_ad_updated');
    return out.view;
  }
  /** §35: publishing never changes the master switch; the switch never publishes a draft */
  async act(actor: PlatformActor, id: string, action: 'publish' | 'pause' | 'archive' | 'restore', input: unknown) {
    const ev = (input && typeof input === 'object' ? (input as Record<string, unknown>).expectedVersion : undefined);
    const out = await this.db.transaction().execute(async (trx) => {
      const cur = await this.adRow(trx, id, true);
      if (ev !== cur.version) throw new DisplayAdError('VERSION_CONFLICT', 'Someone else changed this advertisement. Refresh and try again.', { currentVersion: cur.version });
      const to = transition(cur.status, action);
      if (!to) throw new DisplayAdError('CONFLICT', `A ${cur.status} advertisement cannot be ${action === 'publish' ? 'published' : action + 'd'}.`, { status: cur.status });
      if (to === 'published') {
        if (!cur.mediaId) throw new DisplayAdError('VALIDATION_FAILED', 'Add an image before publishing.', { field: 'mediaId' });
        await this.assertMedia(cur, trx);
        if (effectiveStatus({ ...cur, status: 'published' }, PLATFORM_TZ, this.clock()) === 'EXPIRED') throw new DisplayAdError('VALIDATION_FAILED', 'The end date has passed. Change the dates to publish this advertisement.', { field: 'endDate' });
      }
      await sql`update platform_display_ads set status = ${to}, published_at = ${to === 'published' ? sql`coalesce(published_at, now())` : sql`published_at`},
          paused_at = ${to === 'paused' ? sql`now()` : sql`paused_at`}, archived_at = ${to === 'archived' ? sql`now()` : to === 'draft' ? null : sql`archived_at`},
          version = version + 1, updated_by = ${actor.userId}, updated_at = now() where id = ${id} and status = ${cur.status} and ${canMoveToSql(PLATFORM_DISPLAY_AD_LIFECYCLE, to)}`.execute(trx);
      await sql`insert into platform_ad_events (ad_id, action, actor_user_id, detail) values (${id}, ${action}, ${actor.userId}, ${JSON.stringify({ from: cur.status, to })}::jsonb)`.execute(trx);
      const a = await this.adRow(trx, id);
      return { view: this.view(a, await this.media([a.mediaId], trx)), live: cur.status === 'published' || to === 'published' };
    });
    if (out.live) await this.notify(`platform_ad_${action}`);
    return out.view;
  }

  /** §23 / §29: the same validated image pipeline as salon ads (signature sniffing, size caps, EXIF stripped, scan hook),
   *  stored under global/display-ads/<id> */
  async uploadMedia(actor: PlatformActor, files: Partial<Record<'original' | Variant, UploadedPart[]>> | undefined, body: unknown) {
    if (!this.storage) throw new DisplayAdError('FEATURE_UNAVAILABLE', 'Image storage is not configured on this server.');
    const limits = await this.limits.get();
    const pick = (k: 'original' | Variant) => files?.[k]?.[0];
    const checked = checkAdImageUpload({ original: pick('original'), large: pick('large'), medium: pick('medium'), thumb: pick('thumb') }, limits);
    for (const part of [checked.original, ...VARIANTS.map((v) => checked[v])]) {
      const up = await acceptUpload({ ...UPLOAD_POLICIES.displayAdImage, maxBytes: Math.max(limits.maxFileBytes, part.bytes) }, { bytes: part.buffer, tenantId: 'platform', quotaReserved: true });
      part.buffer = up.bytes; part.bytes = up.size;
    }
    checked.totalBytes = checked.original.bytes + VARIANTS.reduce((n, v) => n + checked[v].bytes, 0);
    const id = randomUUID();
    // the server-side key helper: global/display-ads/<media id>/<random>.<ext> (platform content belongs to no salon)
    const key = (ext: string) => uploadObjectKey({ tenantId: null, area: 'display-ads', owner: [id], ext });
    const keys: Record<'original' | Variant, string> = { original: key(checked.original.ext), large: key(checked.large.ext), medium: key(checked.medium.ext), thumb: key(checked.thumb.ext) };
    const stored: string[] = []; const variants = {} as Record<Variant, VariantRef>;
    try {
      await this.storage.put(keys.original, Buffer.from(checked.original.buffer)); stored.push(keys.original);
      for (const v of VARIANTS) { const part = checked[v]; const { url } = await this.storage.put(keys[v], Buffer.from(part.buffer)); stored.push(keys[v]); variants[v] = { key: keys[v], url, width: part.width, height: part.height, bytes: part.bytes, mime: part.mime }; }
      const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      const name = typeof pick('original')?.originalname === 'string' ? String(pick('original')!.originalname).replace(/[^\w.\- ]+/g, '_').slice(0, 120) : null;
      await sql`insert into platform_ad_media (id, mime_type, width, height, byte_size, total_bytes, sha256, storage_key, variants, suggested_focal_x, suggested_focal_y, original_filename, created_by)
        values (${id}, ${checked.original.mime}, ${checked.original.width}, ${checked.original.height}, ${checked.original.bytes}, ${checked.totalBytes}, ${createHash('sha256').update(checked.original.buffer).digest('hex')},
          ${keys.original}, ${JSON.stringify(variants)}::jsonb, ${focalOr(b.focalX)}, ${focalOr(b.focalY)}, ${name}, ${actor.userId})`.execute(this.db);
      await sql`insert into platform_ad_events (ad_id, action, actor_user_id, detail) values (null, 'media_uploaded', ${actor.userId}, ${JSON.stringify({ mediaId: id, mime: checked.original.mime })}::jsonb)`.execute(this.db);
    } catch (e) {
      for (const k of stored) await this.storage.remove(k).catch((e2: unknown) => console.warn(`[advertising] could not remove ${k} after a failed upload: ${(e2 as Error)?.message ?? e2}`));
      throw e;
    }
    const m = (await this.media([id])).get(id)!;
    return { id, mimeType: m.mimeType, width: m.width, height: m.height, thumb: { url: m.variants.thumb.url }, medium: { url: m.variants.medium.url }, large: { url: m.variants.large.url } };
  }

  /** §57: the platform playlist a display plays in PLATFORM_ONLY — published platform campaigns showing now in the
   *  display's own branch time zone, one image per slide, in priority order. Empty → the neutral panel (§69). */
  async playlist(tz: string, now: Date = this.clock()): Promise<CustomerDisplayAdPlaylist> {
    const rows = (await sql<any>`select ${PLATFORM_COLS} from platform_display_ads where status = 'published'`.execute(this.db)).rows;
    const ads = rows.map((r: any) => toAd({ ...r, tenant_id: 'platform' }, []));
    const media = await this.media(ads.map((a: AdRecord) => a.mediaId));
    return resolvePlaylist(ads.map((a: AdRecord) => toPlaylistAd(a, media)), { available: true, tenant: { ...DEFAULT_TENANT_AD_SETTINGS }, branch: null, deviceAdsEnabled: null, fullScreenIdleAllowed: false, tz, now });
  }
}

export type { StoredStatus };
