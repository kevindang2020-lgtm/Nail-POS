// display-ads-playlist.service.ts — what ONE customer display plays (23-inch dual-screen spec §47, §58–§62, §72–§74,
// §108, §111, §113). The caller (apps/api's customer-display device routes) has already resolved the device from its
// own credential; tenant, branch and device come from that row — never from the request (§62 "trusted tenant, branch,
// device"). The POS preview uses the same builder for a branch, so the owner sees exactly what the display will play.
//
// §113: advertising never sits on the checkout path. These are separate routes; if they fail, the display shows the
// salon's branded fallback and check-in, checkout and payments are untouched.
import type { CustomerDisplayAdDisplayReport, CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import { branchTimeZone } from '@aipowersalon/database';
import {
  DisplayAdError, isUuid, parseBranchOverride, parseTenantAdSettings, resolvePlaylist,
  type AdRecord, type PlaylistAd, type PlaylistMedia,
} from './display-ads-core';
import type { DisplayAdsRepository, DisplayRollup, MediaRow } from './display-ads.repository';
import type { AvailabilityPort, PlatformLimitsSource } from './display-ads-sources';

export interface DisplayIdentity { deviceId: string; tenantId: string; branchId: string | null }
const HOUR = 3_600_000;
const MAX_REPORT = 200, MAX_DISPLAY_MS = 120_000, BACKDATE_MS = 24 * HOUR, FUTURE_MS = 5 * 60_000;
const BATCH_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function toPlaylistMedia(m: MediaRow | undefined | null): PlaylistMedia | null {
  if (!m || m.deletedAt || !m.variants?.large || !m.variants?.medium) return null;
  const ref = (v: { url: string; width: number; height: number }) => ({ url: v.url, width: v.width, height: v.height });
  return { large: ref(m.variants.large), medium: ref(m.variants.medium), suggestedFocalX: m.suggestedFocalX, suggestedFocalY: m.suggestedFocalY };
}
export function toPlaylistAd(a: AdRecord, media: Map<string, MediaRow>): PlaylistAd {
  return {
    ...a,
    media: a.mediaId ? toPlaylistMedia(media.get(a.mediaId)) : null,
    fullscreenMedia: a.fullscreenMediaId ? toPlaylistMedia(media.get(a.fullscreenMediaId)) : null,
  };
}

export class DisplayAdsPlaylistService {
  constructor(
    private readonly repo: DisplayAdsRepository,
    private readonly availability: AvailabilityPort,
    private readonly limits: Pick<PlatformLimitsSource, 'get'>,
    private readonly db: unknown,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The playlist for a branch of a salon; `deviceId` adds the device layer (null = the POS preview). */
  async build(tenantId: string, branchId: string | null, deviceId: string | null): Promise<CustomerDisplayAdPlaylist> {
    const now = this.clock();
    const [availability, limits, settings, ads, tz, deviceAdsEnabled] = await Promise.all([
      this.availability.resolve(tenantId),
      this.limits.get(),
      this.repo.settingsRows(tenantId),
      this.repo.publishedAdsForBranch(tenantId, branchId),
      branchTimeZone(this.db, tenantId, branchId),
      deviceId ? this.repo.deviceAdsEnabled(tenantId, deviceId) : Promise.resolve(null),
    ]);
    const media = await this.repo.mediaByIds(tenantId, ads.flatMap((a) => [a.mediaId, a.fullscreenMediaId]));
    return resolvePlaylist(ads.map((a) => toPlaylistAd(a, media)), {
      available: availability.active,
      tenant: parseTenantAdSettings(settings.tenant),
      branch: branchId ? parseBranchOverride(settings.branches.get(branchId)) : null,
      deviceAdsEnabled,
      fullScreenIdleAllowed: limits.fullScreenIdleAllowed,
      tz, now,
    });
  }

  playlistForDevice(d: DisplayIdentity): Promise<CustomerDisplayAdPlaylist> {
    return this.build(d.tenantId, d.branchId, d.deviceId);
  }

  /**
   * §108: the display reports which ads it put on screen and for how long. Only this salon's ads count (an id from
   * anywhere else is dropped); times are bounded (a day back, five minutes ahead); one display lasts at most two
   * minutes. Rolled up per ad per hour. The batch id makes a resend harmless.
   */
  async recordDisplays(d: DisplayIdentity, body: unknown): Promise<{ accepted: number; duplicate: boolean }> {
    const b = (body && typeof body === 'object' ? body : {}) as Partial<CustomerDisplayAdDisplayReport>;
    if (typeof b.batchId !== 'string' || !BATCH_ID.test(b.batchId)) throw new DisplayAdError('VALIDATION_FAILED', 'batchId must be 8–64 letters, digits, - or _.', { field: 'batchId' });
    if (!Array.isArray(b.displays) || b.displays.length > MAX_REPORT) throw new DisplayAdError('VALIDATION_FAILED', `displays must be a list of at most ${MAX_REPORT}.`, { field: 'displays' });
    if (!d.branchId) return { accepted: 0, duplicate: false };
    const nowMs = this.clock().getTime();
    const items = b.displays.map((x: any) => {
      const t = typeof x?.shownAt === 'string' ? Date.parse(x.shownAt) : NaN;
      const ms = typeof x?.durationMs === 'number' && Number.isFinite(x.durationMs) ? Math.round(Math.min(MAX_DISPLAY_MS, Math.max(0, x.durationMs))) : NaN;
      return isUuid(x?.adId) && Number.isFinite(t) && t >= nowMs - BACKDATE_MS && t <= nowMs + FUTURE_MS && Number.isFinite(ms) ? { adId: String(x.adId).toLowerCase(), t, ms } : null;
    }).filter((x): x is { adId: string; t: number; ms: number } => !!x);
    const known = await this.repo.knownAdIds(d.tenantId, items.map((i) => i.adId));
    const roll = new Map<string, DisplayRollup>();
    for (const i of items) {
      if (!known.has(i.adId)) continue;
      const hour = new Date(Math.floor(i.t / HOUR) * HOUR).toISOString();
      const k = i.adId + '|' + hour; const at = new Date(i.t).toISOString();
      const r = roll.get(k);
      if (r) { r.count++; r.ms += i.ms; if (at < r.first) r.first = at; if (at > r.last) r.last = at; }
      else roll.set(k, { adId: i.adId, hourStart: hour, count: 1, ms: i.ms, first: at, last: at });
    }
    return this.repo.recordDisplays(d.tenantId, d.branchId, d.deviceId, b.batchId, [...roll.values()]);
  }
}
