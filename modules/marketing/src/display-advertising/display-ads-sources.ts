// display-ads-sources.ts — the inputs the advertising services share: is the feature available to this salon (§111
// layers 1–2), what are the Super Admin platform limits (§110), and who has to be told that a playlist changed (§73–§74).
import { DISPLAY_ADS_FEATURE_KEY } from '@aipowersalon/api-contracts';
import type { DisplayAdsAvailability, DisplayAdsLimits } from '@aipowersalon/api-contracts/tenant';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { parsePlatformLimits } from './display-ads-core';
import type { DisplayAdsRepository } from './display-ads.repository';

type Resolution = { active: boolean; reason?: string; detail?: string };
export interface FeatureResolver { resolve(tenantId: string, featureKey: string): Promise<Resolution> }
export interface EntitlementsReader { getEntitlements(tenantId: string): Promise<{ plan?: { mapped?: boolean } | null; features?: { featureKey: string; enabled: boolean }[] } | any> }
export interface AvailabilityPort { resolve(tenantId: string): Promise<DisplayAdsAvailability> }

const ON: DisplayAdsAvailability = { active: true, reason: null, detail: null };

/**
 * §111 "Platform Availability → Tenant Plan": the platform feature registry (status, kill switch) and the salon's plan
 * entitlement, through the registry's resolver (Constitution 7 §32). A salon whose plan text is not in the plan catalog
 * (legacy plans such as the pilot's) is not restricted by the plan layer — the same rule the plan LIMITS follow
 * (an unmapped plan configures no limit) — unless Super Admin switched the feature off for that salon.
 * Cached per salon for a minute (the device playlist is a hot path); a failed check keeps the last known answer, and
 * with none it fails CLOSED (ads off — the display shows the salon's branded panel, nothing breaks).
 */
export class DisplayAdsAvailabilityResolver implements AvailabilityPort {
  private readonly cache = new Map<string, { at: number; v: DisplayAdsAvailability }>();
  constructor(private readonly registry: FeatureResolver | null, private readonly ent: EntitlementsReader | null, private readonly ttlMs = 60_000, private readonly clock: () => number = () => Date.now()) {}

  async resolve(tenantId: string): Promise<DisplayAdsAvailability> {
    const hit = this.cache.get(tenantId); const now = this.clock();
    if (hit && now - hit.at < this.ttlMs) return hit.v;
    try {
      const v = await this.compute(tenantId);
      this.cache.set(tenantId, { at: now, v });
      return v;
    } catch {
      return hit ? hit.v : { active: false, reason: 'UNAVAILABLE', detail: 'Feature availability could not be checked.' };
    }
  }

  private async compute(tenantId: string): Promise<DisplayAdsAvailability> {
    if (!this.registry) return ON;   // no database: nothing to consult (in-memory / unit wiring)
    const r = await this.registry.resolve(tenantId, DISPLAY_ADS_FEATURE_KEY);
    if (r.active) return ON;
    if (r.reason === 'NOT_ENTITLED' && this.ent) {
      const e = await this.ent.getEntitlements(tenantId);
      const f = (e?.features ?? []).find((x: { featureKey: string }) => x.featureKey === DISPLAY_ADS_FEATURE_KEY);
      if (e?.plan && e.plan.mapped === false && (!f || f.enabled)) return { active: true, reason: null, detail: 'Plan not in the catalog — not restricted by plan.' };
    }
    return { active: false, reason: r.reason ?? 'NOT_AVAILABLE', detail: r.detail ?? null };
  }
}

/** §110 platform limits: explicitly-set platform_settings over the code defaults, re-read at most once a minute. */
export class PlatformLimitsSource {
  private at = -Infinity; private v: DisplayAdsLimits | null = null;
  constructor(private readonly repo: Pick<DisplayAdsRepository, 'platformSettingValues'>, private readonly ttlMs = 60_000, private readonly clock: () => number = () => Date.now()) {}
  async get(): Promise<DisplayAdsLimits> {
    const now = this.clock();
    if (this.v && now - this.at < this.ttlMs) return this.v;
    try { this.v = parsePlatformLimits(await this.repo.platformSettingValues()); this.at = now; }
    catch { if (!this.v) return parsePlatformLimits({}); }
    return this.v!;
  }
}

/**
 * §73–§74 "Event → Realtime → Customer Display": ids only. Each registered display of the affected branches hears it on
 * its own channel and refetches its playlist; the POS advertising screens of those branches refresh. Sent AFTER the
 * change committed (a display that refetched earlier would read the old playlist). A lost nudge is not lost data: every
 * playlist carries refreshAfterSeconds, so a display re-asks on its own.
 */
export class DisplayAdsNotifier {
  constructor(private readonly repo: Pick<DisplayAdsRepository, 'deviceIdsForBranches' | 'branches'>, private readonly rt: RealtimeEmitter | null) {}
  /** For notifySettingsChanged (Constitution 9 §246): a tenant_settings write is also announced to the owner's screens. */
  get realtime(): RealtimeEmitter | null { return this.rt; }

  async playlistChanged(tenantId: string, branches: string[] | 'all', payload: { reason: string; adId?: string }): Promise<void> {
    if (!this.rt) return;
    try {
      for (const id of await this.repo.deviceIdsForBranches(tenantId, branches)) {
        this.rt.toCustomerDisplayDevice?.(id, EVENTS.customerDisplayAdsUpdated, payload);   // §343 exempt: playlist-invalidation signal (ids only); the durable record is the audit row
      }
      const ids = branches === 'all' ? (await this.repo.branches(tenantId)).map((b) => b.id) : branches;
      for (const branchId of ids) {
        this.rt.toTenant({ tenantId, branchId }, EVENTS.customerDisplayAdsUpdated, payload);   // §343 exempt: POS advertising screens refresh (ids only); the durable record is the audit row
      }
    } catch { /* never fail the owner's change over a nudge — displays re-ask on their own schedule */ }
  }

  deviceChanged(deviceId: string, payload: { reason: string }): void {
    try { this.rt?.toCustomerDisplayDevice?.(deviceId, EVENTS.customerDisplayAdsUpdated, payload); }   // §343 exempt: one display's ads switched on/off (ids only); the audit row is the record
    catch { /* see above */ }
  }
}
