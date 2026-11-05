// display-ads.service.ts — POS → Marketing & Growth → Customer Display Advertising (23-inch dual-screen spec §48–§78,
// §108–§111). Tenant and branch come from the signed-in session, never the request body. Rules live in the pure core;
// this file sequences them: availability → validation → branch authority → the write (version-checked, audited in the
// same transaction) → tell the affected displays.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DisplayAdAction, DisplayAdMediaView, DisplayAdsAnalytics, DisplayAdsState, DisplayAdView } from '@aipowersalon/api-contracts/tenant';
import type { CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import { DEFAULT_SALON_TIME_ZONE, isValidTimeZone } from '@aipowersalon/database';
import type { MediaStorage } from '@aipowersalon/media';
import { acceptUpload, UPLOAD_POLICIES } from '@aipowersalon/media';
import { notifySettingsChanged } from '@aipowersalon/realtime-contracts';
import {
  BLANK_AD_FIELDS, DisplayAdError, SCHEDULE_FIELDS, TARGETING_FIELDS, applyAdInput, applySettingsInput, assertTargeting,
  authorizedBranchIds, canManageAd, canSeeAd, changedFields, countStatuses, effectiveStatus, isOwner, isShowingNow, isUuid,
  parseBranchOverride, parseTenantAdSettings, pickFields, transition,
  type AdActor, type AdFields, type AdRecord, type StoredStatus,
} from './display-ads-core';
import { adMediaKeys, checkAdImageUpload, focalOr, VARIANTS, type UploadedPart, type Variant } from './display-ads-media-core';
import { AD_SETTINGS_CATEGORY, type AuditEntry, type DisplayAdsRepository, type MediaRow, type VariantRef, type WriteActor } from './display-ads.repository';
import type { AvailabilityPort, DisplayAdsNotifier, PlatformLimitsSource } from './display-ads-sources';
import type { DisplayAdsPlaylistService } from './display-ads-playlist.service';
import { assertTenantAdvertisingAllowed, type AdvertisingPolicyPort } from './platform-advertising';
import { hasTenantWideScope } from '@aipowersalon/permissions';

export interface AdsCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: readonly string[] }
const actorOf = (c: AdsCtx): AdActor => ({ role: c.role, branchId: c.branchId || '', userId: c.userId || null, tenantWide: hasTenantWideScope(c as any) });
const writer = (c: AdsCtx): WriteActor => ({ tenantId: c.tenantId, branchId: c.branchId || null, userId: c.userId || null, role: c.role });
const UNUSED_MEDIA_GRACE_MS = 24 * 3_600_000;
/** A display that reported an ad within this window is "showing ads now" (displays report about once a minute). */
const SHOWING_NOW_MS = 5 * 60_000;
const has = (o: unknown, k: string) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

function mediaView(m: MediaRow | undefined | null): DisplayAdMediaView | null {
  if (!m || m.deletedAt) return null;
  const ref = (v: VariantRef) => ({ url: v.url, width: v.width, height: v.height });
  return {
    id: m.id, mimeType: m.mimeType, width: m.width, height: m.height, bytes: m.bytes, totalBytes: m.totalBytes,
    thumb: ref(m.variants.thumb), medium: ref(m.variants.medium), large: ref(m.variants.large),
    suggestedFocalX: m.suggestedFocalX, suggestedFocalY: m.suggestedFocalY, createdAt: m.createdAt,
  };
}
/** §76: who / tenant (the row) / branch targeting / action / time (the row) / advertisement — every audit row says where it plays. */
const targeting = (f: Pick<AdFields, 'allBranches' | 'branchIds'>) => ({ allBranches: f.allBranches, branchIds: [...f.branchIds] });
const schedule = (f: AdFields) => Object.fromEntries(SCHEDULE_FIELDS.map((k) => [k, f[k]]));
/** The branches whose displays an ad reaches. */
const reach = (f: Pick<AdFields, 'allBranches' | 'branchIds'>): string[] | 'all' => (f.allBranches ? 'all' : [...f.branchIds]);
const union = (a: string[] | 'all', b: string[] | 'all'): string[] | 'all' => (a === 'all' || b === 'all' ? 'all' : [...new Set([...a, ...b])]);

export class DisplayAdsService {
  constructor(
    private readonly repo: DisplayAdsRepository,
    private readonly availability: AvailabilityPort,
    private readonly limits: Pick<PlatformLimitsSource, 'get'>,
    private readonly storage: MediaStorage,
    private readonly notifier: Pick<DisplayAdsNotifier, 'playlistChanged' | 'deviceChanged' | 'realtime'>,
    private readonly playlists: Pick<DisplayAdsPlaylistService, 'build'>,
    private readonly clock: () => Date = () => new Date(),
    /** G7: the Super Admin master switch — checked at execution time on every salon advertising write (§11, §42) */
    private readonly policy: AdvertisingPolicyPort | null = null,
  ) {}
  private tenantAllowed(): Promise<void> { return assertTenantAdvertisingAllowed(this.policy); }

  private async requireAvailable(tenantId: string): Promise<void> {
    const a = await this.availability.resolve(tenantId);
    if (!a.active) throw new DisplayAdError('FEATURE_UNAVAILABLE', 'Customer display advertising is not available for your salon.', { reason: a.reason });
  }

  private async tenantBranches(tenantId: string) {
    const rows = await this.repo.branches(tenantId);
    return rows.map((b) => ({ id: b.id, name: b.name, timeZone: isValidTimeZone(b.timezone) ? b.timezone! : DEFAULT_SALON_TIME_ZONE }));
  }
  private tzOf(ctx: AdsCtx, branches: { id: string; timeZone: string }[]): string {
    return branches.find((b) => b.id === ctx.branchId)?.timeZone ?? branches[0]?.timeZone ?? DEFAULT_SALON_TIME_ZONE;
  }

  private view(ad: AdRecord, media: Map<string, MediaRow>, defaultDuration: number, tz: string, now: Date, actor: AdActor): DisplayAdView {
    return {
      id: ad.id, version: ad.version, name: ad.name,
      status: effectiveStatus(ad, tz, now), storedStatus: ad.status, showingNow: isShowingNow(ad, tz, now),
      media: ad.mediaId ? mediaView(media.get(ad.mediaId)) : null,
      fullscreenMedia: ad.fullscreenMediaId ? mediaView(media.get(ad.fullscreenMediaId)) : null,
      headline: ad.headline, subheadline: ad.subheadline, description: ad.description, ctaText: ad.ctaText,
      qr: ad.qrKind && ad.qrUrl ? { kind: ad.qrKind, url: ad.qrUrl } : null,
      fitMode: ad.fitMode, focalX: ad.focalX, focalY: ad.focalY,
      startDate: ad.startDate, endDate: ad.endDate, daysOfWeek: ad.daysOfWeek, dailyStartTime: ad.dailyStartTime, dailyEndTime: ad.dailyEndTime,
      displayDurationSeconds: ad.displayDurationSeconds, effectiveDurationSeconds: ad.displayDurationSeconds ?? defaultDuration,
      priority: ad.priority, allBranches: ad.allBranches, branchIds: [...ad.branchIds],
      canManage: canManageAd(ad, actor),
      publishedAt: ad.publishedAt, pausedAt: ad.pausedAt, archivedAt: ad.archivedAt, createdAt: ad.createdAt, updatedAt: ad.updatedAt,
    };
  }

  private async viewOne(ctx: AdsCtx, ad: AdRecord): Promise<DisplayAdView> {
    const [media, branches, settings] = await Promise.all([this.repo.mediaByIds(ctx.tenantId, [ad.mediaId, ad.fullscreenMediaId]), this.tenantBranches(ctx.tenantId), this.repo.settingsRows(ctx.tenantId)]);
    return this.view(ad, media, parseTenantAdSettings(settings.tenant).defaultDurationSeconds, this.tzOf(ctx, branches), this.clock(), actorOf(ctx));
  }

  /** The one load of the screen: availability, limits and usage, branches, settings, the ads this user may see, displays. */
  async state(ctx: AdsCtx): Promise<DisplayAdsState> {
    const now = this.clock(); const actor = actorOf(ctx);
    const [availability, limits, branches, ads, settings, devices, usage, lastShown, salonName] = await Promise.all([
      this.availability.resolve(ctx.tenantId), this.limits.get(), this.tenantBranches(ctx.tenantId), this.repo.listAds(ctx.tenantId),
      this.repo.settingsRows(ctx.tenantId), this.repo.devices(ctx.tenantId), this.repo.usage(ctx.tenantId), this.repo.lastShownByDevice(ctx.tenantId),
      this.repo.salonName(ctx.tenantId),
    ]);
    const visible = ads.filter((a) => canSeeAd(a, actor));
    const media = await this.repo.mediaByIds(ctx.tenantId, visible.flatMap((a) => [a.mediaId, a.fullscreenMediaId]));
    const tenant = parseTenantAdSettings(settings.tenant);
    const tz = this.tzOf(ctx, branches);
    const authorized = authorizedBranchIds(actor, branches.map((b) => b.id));
    const overrides: DisplayAdsState['settings']['branches'] = {};
    for (const b of authorized) overrides[b] = parseBranchOverride(settings.branches.get(b));
    const pol = this.policy ? await this.policy.current() : null;
    return {
      salonName, availability, limits, usage,
      ...(pol ? { advertisingPolicy: { mode: pol.mode, version: pol.version, managedByPlatform: pol.mode === 'PLATFORM_ONLY' } } : {}),
      canManageAllBranches: isOwner(actor), authorizedBranchIds: authorized,
      branches,
      settings: { tenant, branches: overrides, canEditTenant: isOwner(actor) },
      ads: visible.map((a) => this.view(a, media, tenant.defaultDurationSeconds, tz, now, actor)),
      devices: devices.filter((d) => isOwner(actor) || (d.branchId !== null && authorized.includes(d.branchId)))
        .map((d) => ({ ...d, lastAdShownAt: lastShown.get(d.id) ?? null })),
      timeZone: tz, now: now.toISOString(),
    };
  }

  /** An ad this user may see — anything else is "not found", so ids from another salon or branch reveal nothing. */
  private async visibleAd(ctx: AdsCtx, id: string): Promise<AdRecord> {
    const ad = isUuid(id) ? await this.repo.getAd(ctx.tenantId, id) : null;
    if (!ad || !canSeeAd(ad, actorOf(ctx))) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'That advertisement could not be found.');
    return ad;
  }
  private async manageableAd(ctx: AdsCtx, id: string): Promise<AdRecord> {
    const ad = await this.visibleAd(ctx, id);
    if (!canManageAd(ad, actorOf(ctx))) throw new DisplayAdError('BRANCH_ACCESS_DENIED', 'This advertisement also plays at other branches — only the salon owner can change it.');
    return ad;
  }

  async get(ctx: AdsCtx, id: string): Promise<DisplayAdView> {
    return this.viewOne(ctx, await this.visibleAd(ctx, id));
  }

  /** Both images must be this salon's live uploads (the composite key would refuse another salon's anyway). */
  private async assertMedia(tenantId: string, f: AdFields): Promise<void> {
    const ids = [f.mediaId, f.fullscreenMediaId].filter((x): x is string => !!x);
    if (!ids.length) return;
    const found = await this.repo.mediaByIds(tenantId, ids);
    for (const id of ids) if (!found.get(id) || found.get(id)!.deletedAt) throw new DisplayAdError('VALIDATION_FAILED', 'That image is no longer available. Upload it again.', { field: id === f.mediaId ? 'mediaId' : 'fullscreenMediaId' });
  }

  private expectedVersion(input: unknown): number {
    const v = has(input, 'expectedVersion') ? (input as Record<string, unknown>).expectedVersion : undefined;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new DisplayAdError('VALIDATION_FAILED', 'expectedVersion is required.', { field: 'expectedVersion' });
    return v;
  }

  /** §49–§53: + ADD ADVERTISEMENT. Always a draft; a branch manager's ad targets their own branch unless they said so. */
  async create(ctx: AdsCtx, input: unknown): Promise<DisplayAdView> {
    await this.tenantAllowed();
    await this.requireAvailable(ctx.tenantId);
    const actor = actorOf(ctx);
    const fields = applyAdInput(BLANK_AD_FIELDS, input, { requireName: true });
    if (!isOwner(actor) && !has(input, 'allBranches') && !has(input, 'branchIds')) { fields.allBranches = false; fields.branchIds = actor.branchId ? [actor.branchId] : []; }
    const branches = await this.tenantBranches(ctx.tenantId);
    assertTargeting(fields, actor, new Set(branches.map((b) => b.id)));
    await this.assertMedia(ctx.tenantId, fields);
    const limits = await this.limits.get();
    const ad = await this.repo.createAd(writer(ctx), fields, limits.maxAds, (adId) => [
      { action: 'display_ad_created', adId, metadata: { name: fields.name, targeting: targeting(fields), schedule: schedule(fields) } },
    ]);
    return this.viewOne(ctx, ad);
  }

  /** §73: edit — version-checked. A live ad's change reaches its displays at once (old and new branches alike). */
  async update(ctx: AdsCtx, id: string, input: unknown): Promise<DisplayAdView> {
    await this.tenantAllowed();
    await this.requireAvailable(ctx.tenantId);
    const expected = this.expectedVersion(input);
    const cur = await this.manageableAd(ctx, id);
    const actor = actorOf(ctx);
    const next = applyAdInput(pickFields(cur), input);
    const branches = await this.tenantBranches(ctx.tenantId);
    assertTargeting(next, actor, new Set(branches.map((b) => b.id)));
    await this.assertMedia(ctx.tenantId, next);
    if (cur.status !== 'draft' && cur.status !== 'archived' && !next.mediaId) throw new DisplayAdError('VALIDATION_FAILED', 'A live advertisement needs its image.', { field: 'mediaId' });
    const changed = changedFields(cur, next);
    if (!changed.length) {
      if (cur.version !== expected) throw new DisplayAdError('VERSION_CONFLICT', 'Someone else changed this advertisement. Refresh and try again.', { currentVersion: cur.version });
      return this.viewOne(ctx, cur);
    }
    const audits: AuditEntry[] = [{ action: 'display_ad_updated', adId: id, metadata: { changed, targeting: targeting(next), ...(changed.some((k) => (TARGETING_FIELDS as readonly string[]).includes(k)) ? { previousTargeting: targeting(cur) } : {}) } }];
    if (changed.some((k) => (SCHEDULE_FIELDS as readonly string[]).includes(k))) {
      audits.push({ action: 'display_ad_schedule_changed', adId: id, metadata: { before: schedule(cur), after: schedule(next), targeting: targeting(next) } });
    }
    const ad = await this.repo.updateAd(writer(ctx), id, expected, next, audits);
    if (cur.status === 'published') await this.notifier.playlistChanged(ctx.tenantId, union(reach(cur), reach(next)), { reason: 'updated', adId: id });
    return this.viewOne(ctx, ad);
  }

  /** §64: publish / pause / archive / restore. Pause and archive stay possible when the feature is switched off (an
   *  owner must always be able to take an ad down); publish and restore need it. */
  async act(ctx: AdsCtx, id: string, action: DisplayAdAction, input: unknown): Promise<DisplayAdView> {
    // G7 §42: taking an ad down (pause / archive) stays possible; publishing or restoring one is refused while AI PowerSalon manages advertising
    if (action === 'publish' || action === 'restore') { await this.tenantAllowed(); await this.requireAvailable(ctx.tenantId); }
    const expected = this.expectedVersion(input);
    const cur = await this.manageableAd(ctx, id);
    const to = transition(cur.status, action);
    if (!to) throw new DisplayAdError('CONFLICT', `A ${cur.status} advertisement cannot be ${action === 'publish' ? 'published' : action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : 'restored'}.`, { status: cur.status });
    if (to === 'published') {
      if (!cur.mediaId) throw new DisplayAdError('VALIDATION_FAILED', 'Add an image before publishing.', { field: 'mediaId' });
      await this.assertMedia(ctx.tenantId, cur);
      const branches = await this.tenantBranches(ctx.tenantId);
      if (effectiveStatus({ ...cur, status: 'published' }, this.tzOf(ctx, branches), this.clock()) === 'EXPIRED') throw new DisplayAdError('VALIDATION_FAILED', 'The end date has passed. Change the dates to publish this advertisement.', { field: 'endDate' });
    }
    const limits = await this.limits.get();
    const ad = await this.repo.setStatus(writer(ctx), id, expected, cur.status, to as StoredStatus, [
      { action: `display_ad_${action === 'publish' ? 'published' : action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : 'restored'}`, adId: id, metadata: { from: cur.status, to, name: cur.name, targeting: targeting(cur) } },
    ], limits.maxAds);
    if (cur.status === 'published' || to === 'published') await this.notifier.playlistChanged(ctx.tenantId, reach(cur), { reason: action, adId: id });
    return this.viewOne(ctx, ad);
  }

  /** §74: delete a draft or an archived ad for good; its images are removed with it (unless another ad uses them). */
  async remove(ctx: AdsCtx, id: string, version: unknown): Promise<{ deleted: true }> {
    const expected = this.expectedVersion({ expectedVersion: typeof version === 'string' && version.trim() !== '' ? Number(version) : version });
    const cur = await this.manageableAd(ctx, id);
    await this.repo.deleteAd(writer(ctx), id, expected, [{ action: 'display_ad_deleted', adId: id, metadata: { name: cur.name, status: cur.status, targeting: targeting(cur) } }]);
    await this.dropMedia(ctx.tenantId, [cur.mediaId, cur.fullscreenMediaId].filter((x): x is string => !!x));
    return { deleted: true };
  }

  private async dropMedia(tenantId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    try {
      const rows = await this.repo.mediaByIds(tenantId, ids);
      const gone = await this.repo.markMediaDeleted(tenantId, ids);
      for (const id of gone) {
        const m = rows.get(id); if (!m) continue;
        for (const key of [m.storageKey, ...VARIANTS.map((v) => m.variants[v]?.key)].filter(Boolean)) await this.storage.remove(key as string).catch(() => undefined);
      }
    } catch { /* clean-up is best effort; unused images are collected again on the next upload */ }
  }

  /** §68–§71: one image and its three derivatives → object storage + a media row (limit-checked under the salon lock). */
  async uploadMedia(ctx: AdsCtx, files: Partial<Record<'original' | Variant, UploadedPart[]>> | undefined, body: unknown): Promise<DisplayAdMediaView> {
    await this.tenantAllowed();
    await this.requireAvailable(ctx.tenantId);
    const limits = await this.limits.get();
    const pick = (k: 'original' | Variant) => files?.[k]?.[0];
    const checked = checkAdImageUpload({ original: pick('original'), large: pick('large'), medium: pick('medium'), thumb: pick('thumb') }, limits);
    // Phase 12 (#34): the one upload policy on every part — the public original loses its EXIF / GPS (the orientation
    // is kept), the scan hook runs; the multipart guard already charged the request to the salon's storage quota
    for (const part of [checked.original, ...VARIANTS.map((v) => checked[v])]) {
      const up = await acceptUpload({ ...UPLOAD_POLICIES.displayAdImage, maxBytes: Math.max(limits.maxFileBytes, part.bytes) }, { bytes: part.buffer, tenantId: ctx.tenantId, quotaReserved: true });
      part.buffer = up.bytes; part.bytes = up.size;
    }
    checked.totalBytes = checked.original.bytes + VARIANTS.reduce((n, v) => n + checked[v].bytes, 0);
    // free space held by images nobody uses before counting against the limit
    try {
      const stale = await this.repo.unattachedMedia(ctx.tenantId, new Date(this.clock().getTime() - UNUSED_MEDIA_GRACE_MS), 20);
      await this.dropMedia(ctx.tenantId, stale.map((m) => m.id));
    } catch { /* best effort */ }
    const id = randomUUID();
    const keys = adMediaKeys(id, randomBytes(12).toString('hex'), checked, ctx.tenantId);
    const stored: string[] = [];
    const variants = {} as Record<Variant, VariantRef>;
    try {
      await this.storage.put(keys.original, Buffer.from(checked.original.buffer)); stored.push(keys.original);
      for (const v of VARIANTS) {
        const part = checked[v];
        const { url } = await this.storage.put(keys[v], Buffer.from(part.buffer)); stored.push(keys[v]);
        variants[v] = { key: keys[v], url, width: part.width, height: part.height, bytes: part.bytes, mime: part.mime };
      }
      const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      const name = typeof pick('original')?.originalname === 'string' ? String(pick('original')!.originalname).replace(/[^\w.\- ]+/g, '_').slice(0, 120) : null;
      const media = await this.repo.insertMedia(writer(ctx), {
        id, mimeType: checked.original.mime, width: checked.original.width, height: checked.original.height, bytes: checked.original.bytes,
        totalBytes: checked.totalBytes, sha256: createHash('sha256').update(checked.original.buffer).digest('hex'), storageKey: keys.original, variants,
        focalX: focalOr(b.focalX), focalY: focalOr(b.focalY), filename: name,
      }, limits.storageLimitBytes, { action: 'display_ad_media_uploaded', adId: null, metadata: { mediaId: id, mime: checked.original.mime, width: checked.original.width, height: checked.original.height, totalBytes: checked.totalBytes } });
      return mediaView(media)!;
    } catch (e) {
      for (const k of stored) await this.storage.remove(k).catch(() => undefined);
      throw e;
    }
  }

  /** §57–§58: exactly what a display at this branch plays right now (the device layer aside). */
  async playlist(ctx: AdsCtx, branchId: string | undefined): Promise<CustomerDisplayAdPlaylist> {
    const b = await this.authorizedBranch(ctx, branchId);
    return this.playlists.build(ctx.tenantId, b, null);
  }

  private async authorizedBranch(ctx: AdsCtx, branchId: string | undefined): Promise<string> {
    const branches = await this.tenantBranches(ctx.tenantId);
    const want = branchId && branchId.trim() ? branchId.trim().toLowerCase() : ctx.branchId;
    if (!want || !isUuid(want) || !branches.some((b) => b.id === want)) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'Unknown branch.');
    if (!authorizedBranchIds(actorOf(ctx), branches.map((b) => b.id)).includes(want)) throw new DisplayAdError('BRANCH_ACCESS_DENIED', 'You can only see your own branch.');
    return want;
  }

  /** §109: active / scheduled / expired ads, how often they were displayed (never "viewed"), displays showing ads now, per branch. */
  async analytics(ctx: AdsCtx, daysRaw: unknown, branchId: string | undefined): Promise<DisplayAdsAnalytics> {
    const actor = actorOf(ctx); const now = this.clock();
    const days = Math.min(90, Math.max(1, Math.round(Number(daysRaw) || 30)));
    const since = new Date(now.getTime() - days * 86_400_000);
    const branches = await this.tenantBranches(ctx.tenantId);
    const scope = branchId ? [await this.authorizedBranch(ctx, branchId)] : isOwner(actor) ? null : authorizedBranchIds(actor, branches.map((b) => b.id));
    const [ads, totals, devices] = await Promise.all([this.repo.listAds(ctx.tenantId), this.repo.displayTotals(ctx.tenantId, since, scope, new Date(now.getTime() - SHOWING_NOW_MS)), this.repo.devices(ctx.tenantId)]);
    const visible = ads.filter((a) => canSeeAd(a, actor) && (!scope || a.allBranches || a.branchIds.some((b) => scope.includes(b))));
    const tz = this.tzOf(ctx, branches);
    const names = new Map(ads.map((a) => [a.id, a.name]));
    const inScope = (b: string | null) => !scope || (b !== null && scope.includes(b));
    const showingNow = new Set(totals.recentDevices.map((d) => d.deviceId));
    const branchRows = branches.filter((b) => inScope(b.id)).map((b) => {
      const t = totals.byBranch.find((x) => x.branchId === b.id);
      const displays = devices.filter((d) => d.branchId === b.id);
      return { branchId: b.id, name: b.name, displayCount: t?.count ?? 0, displaySeconds: Math.round((t?.ms ?? 0) / 1000), displays: displays.length, devicesShowingNow: displays.filter((d) => showingNow.has(d.id)).length };
    });
    return {
      days, since: since.toISOString(), branchId: branchId ? scope![0] : null,
      totals: {
        ...countStatuses(visible, tz, now),
        displayCount: totals.byAd.reduce((a, x) => a + x.count, 0),
        displaySeconds: Math.round(totals.byAd.reduce((a, x) => a + x.ms, 0) / 1000),
        devicesShowingNow: devices.filter((d) => inScope(d.branchId) && showingNow.has(d.id)).length,
        displaysRegistered: devices.filter((d) => inScope(d.branchId)).length,
      },
      byAd: totals.byAd.filter((x) => names.has(x.adId)).map((x) => ({ adId: x.adId, name: names.get(x.adId)!, displayCount: x.count, displaySeconds: Math.round(x.ms / 1000), lastShownAt: x.last }))
        .sort((a, b) => b.displayCount - a.displayCount),
      byBranch: branchRows,
    };
  }

  /** §7, §59, §111: salon-wide settings (owner) or one branch's switches (that branch's manager or the owner). */
  /** `branchParam` null = the salon-wide settings (owner only); a branch id = that branch's switches. */
  async saveSettings(ctx: AdsCtx, branchParam: string | null, input: unknown): Promise<DisplayAdsState['settings']> {
    const fields = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
    const actor = actorOf(ctx);
    const scope = branchParam === null ? 'tenant' : 'branch';
    if (scope === 'tenant' && !isOwner(actor)) throw new DisplayAdError('PERMISSION_DENIED', 'Only the salon owner can change salon-wide advertising settings.');
    const branchId = scope === 'branch' ? await this.authorizedBranch(ctx, branchParam ?? undefined) : null;
    const rows = await this.repo.settingsRows(ctx.tenantId);
    const before = (branchId ? rows.branches.get(branchId) : rows.tenant) ?? {};
    const current = typeof before === 'object' && before ? { ...(before as Record<string, unknown>) } : {};
    const next = applySettingsInput(scope, current, fields);
    await this.repo.saveSettings(writer(ctx), branchId, next, { action: 'display_ads_settings_updated', adId: null, metadata: { category: AD_SETTINGS_CATEGORY, scope, branchId, before: current, after: next } });
    notifySettingsChanged(this.notifier.realtime, ctx.tenantId, AD_SETTINGS_CATEGORY);   // a tenant_settings row changed (after the write succeeded)
    await this.notifier.playlistChanged(ctx.tenantId, branchId ? [branchId] : 'all', { reason: 'settings' });
    return (await this.state(ctx)).settings;
  }

  /** §111 device configuration: ads on or off for one display. */
  async setDevice(ctx: AdsCtx, deviceId: string, input: unknown): Promise<{ deviceId: string; adsEnabled: boolean }> {
    const enabled = has(input, 'adsEnabled') ? (input as Record<string, unknown>).adsEnabled : undefined;
    if (typeof enabled !== 'boolean') throw new DisplayAdError('VALIDATION_FAILED', 'adsEnabled must be true or false.', { field: 'adsEnabled' });
    const actor = actorOf(ctx);
    const device = isUuid(deviceId) ? (await this.repo.devices(ctx.tenantId)).find((d) => d.id === deviceId.toLowerCase()) : undefined;
    if (!device) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'That display could not be found.');
    if (!isOwner(actor) && device.branchId !== actor.branchId) throw new DisplayAdError('BRANCH_ACCESS_DENIED', 'You can only change displays at your own branch.');
    const ok = await this.repo.setDeviceAdsEnabled(writer(ctx), device.id, enabled, { action: 'display_ads_device_updated', adId: null, metadata: { deviceId: device.id, branchId: device.branchId, adsEnabled: enabled } });
    if (!ok) throw new DisplayAdError('RESOURCE_NOT_FOUND', 'That display could not be found.');
    this.notifier.deviceChanged(device.id, { reason: 'device' });
    return { deviceId: device.id, adsEnabled: enabled };
  }
}
