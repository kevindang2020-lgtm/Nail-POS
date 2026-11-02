// mobile-versions.service.ts — BUILD_PLAN Phase 13 B (Constitution 6 §55–57, §150): the store apps' version policies
// (mobile_app_versions, migration 558) and the installed-version distribution (mobile_app_installs_seen).
//
// Reads are on the hot path (the UPDATE_REQUIRED gate runs on every request), so the policies — at most eight rows — are
// held in memory and refreshed every 30 s; a read error keeps the last good snapshot (or none), so a database problem can
// never START refusing apps. Install sightings are written at most once an hour per install, fire-and-forget.
import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import {
  normaliseVersionPolicy, VersionPolicyError, appVersionState, isAppVersion, MOBILE_APP_IDS, CLIENT_PLATFORMS,
  type AppVersionPolicy, type MobileAppId, type NativePlatform, type ClientPlatform, type MobileVersionRow,
  type MobileVersionsOverview, type VersionDistributionRow,
} from '@aipowersalon/api-contracts';

export const POLICY_TTL_MS = 30_000;
export const SEEN_THROTTLE_MS = 60 * 60_000;
export const DISTRIBUTION_WINDOW_DAYS = 7;
export const MIN_VERSION_REASON = 10;
const SEEN_MAP_CAP = 50_000;

const iso = (d: unknown): string | null => (d ? new Date(d as any).toISOString() : null);
function rowToView(r: any): MobileVersionRow {
  return { app: r.app, platform: r.platform, minSupported: r.min_supported ?? null, recommended: r.recommended ?? null, latest: r.latest ?? null,
    storeUrl: r.store_url ?? null, message: r.message ?? null, version: Number(r.version), updatedAt: iso(r.updated_at), updatedBy: r.updated_by ?? null };
}

@Injectable()
export class MobileVersionsService {
  private snapshot: { rows: MobileVersionRow[]; exp: number } = { rows: [], exp: 0 };
  private refreshing: Promise<void> | null = null;
  private readonly seen = new Map<string, { at: number; version: string }>();
  private writes = 0;

  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null, @Optional() private readonly audit?: AuditService,
              private readonly now: () => number = Date.now) {}

  /** The cached policies (refreshing them when stale). Never throws. */
  async policies(): Promise<MobileVersionRow[]> {
    if (this.snapshot.exp > this.now()) return this.snapshot.rows;
    if (!this.db) return [];
    this.refreshing ??= (async () => {
      try {
        const rows = (await sql<any>`SELECT app, platform, min_supported, recommended, latest, store_url, message, version, updated_at, updated_by FROM mobile_app_versions ORDER BY app, platform`.execute(this.db as any)).rows.map(rowToView);
        this.snapshot = { rows, exp: this.now() + POLICY_TTL_MS };
      } catch {
        this.snapshot = { rows: this.snapshot.rows, exp: this.now() + 5_000 };   // keep the last good rows; retry soon
      } finally { this.refreshing = null; }
    })();
    await this.refreshing;
    return this.snapshot.rows;
  }

  /** Synchronous read of the current snapshot (the gate calls policies() first). */
  lookup(app: MobileAppId, platform: NativePlatform): AppVersionPolicy | null {
    return this.snapshot.rows.find((r) => r.app === app && r.platform === platform) ?? null;
  }

  clear(): void { this.snapshot = { rows: [], exp: 0 }; }

  /** Super Admin: create or change one (app, platform) policy. Reason ≥ 10 chars, optimistic version, audited. */
  async set(app: string, platform: string, input: Record<string, unknown>, actor: { userId: string | null }): Promise<MobileVersionRow> {
    if (!this.db) throw new ConflictException('Mobile app versions need the database.');
    const reason = String(input?.reason ?? '').trim();
    if (reason.length < MIN_VERSION_REASON) throw new BadRequestException({ code: 'reason_required', message: `A reason of at least ${MIN_VERSION_REASON} characters is required.` });
    let p: AppVersionPolicy;
    try { p = normaliseVersionPolicy({ ...input, app, platform }); }
    catch (e) { if (e instanceof VersionPolicyError) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: e.message }); throw e; }
    const expected = input?.expectedVersion == null ? null : Number(input.expectedVersion);
    const before = (await sql<any>`SELECT app, platform, min_supported, recommended, latest, store_url, message, version, updated_at, updated_by FROM mobile_app_versions WHERE app = ${p.app} AND platform = ${p.platform}`.execute(this.db)).rows[0];
    if (expected !== null && Number(before?.version ?? 0) !== expected) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Someone else changed this version policy — reload and try again.' });
    const r: any = (await sql`
      INSERT INTO mobile_app_versions (app, platform, min_supported, recommended, latest, store_url, message, reason, version, updated_by)
      VALUES (${p.app}, ${p.platform}, ${p.minSupported}, ${p.recommended}, ${p.latest}, ${p.storeUrl}, ${p.message}, ${reason}, 1, ${actor.userId})
      ON CONFLICT (app, platform) DO UPDATE SET min_supported = EXCLUDED.min_supported, recommended = EXCLUDED.recommended,
        latest = EXCLUDED.latest, store_url = EXCLUDED.store_url, message = EXCLUDED.message, reason = EXCLUDED.reason,
        version = mobile_app_versions.version + 1, updated_at = now(), updated_by = EXCLUDED.updated_by
      WHERE ${expected === null} OR mobile_app_versions.version = ${expected ?? 0}
      RETURNING app, platform, min_supported, recommended, latest, store_url, message, version, updated_at, updated_by`.execute(this.db)).rows[0];
    if (!r) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Someone else changed this version policy — reload and try again.' });
    const after = rowToView(r);
    const raisedMinimum = !!p.minSupported && (!before?.min_supported || before.min_supported !== p.minSupported);
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'mobile_versions',
      action: raisedMinimum ? 'minimum_version_changed' : 'version_policy_changed', resourceType: 'mobile_app_version', resourceId: `${p.app}/${p.platform}`,
      summary: `${p.app} ${p.platform}: min ${p.minSupported ?? '—'}, recommended ${p.recommended ?? '—'}, latest ${p.latest ?? '—'}`,
      metadata: { reason, before: before ? { minSupported: before.min_supported, recommended: before.recommended, latest: before.latest } : null,
        after: { minSupported: p.minSupported, recommended: p.recommended, latest: p.latest } }, reason });
    this.clear();   // this process now; the others within the 30 s TTL
    return after;
  }

  /**
   * Note an install's app version (from the client headers). At most one write per install per hour (or on a version
   * change); the raw device id is hashed and never stored. Fire-and-forget: never throws, never awaited by a request.
   */
  noteSeen(app: MobileAppId | null, platform: ClientPlatform | null, version: string | null, deviceId: unknown): void {
    if (!this.db || !app || !platform || !isAppVersion(version) || typeof deviceId !== 'string') return;
    const id = deviceId.trim();
    if (id.length < 8 || id.length > 200) return;
    const hash = createHash('sha256').update(id).digest('hex');
    const key = `${app}|${platform}|${hash}`;
    const prev = this.seen.get(key);
    const t = this.now();
    if (prev && prev.version === version && t - prev.at < SEEN_THROTTLE_MS) return;
    if (this.seen.size > SEEN_MAP_CAP) this.seen.clear();
    this.seen.set(key, { at: t, version });
    void sql`
      INSERT INTO mobile_app_installs_seen (app, platform, device_hash, app_version) VALUES (${app}, ${platform}, ${hash}, ${version})
      ON CONFLICT (app, platform, device_hash) DO UPDATE SET app_version = EXCLUDED.app_version, last_seen_at = now()`
      .execute(this.db).catch(() => { /* a sighting is best-effort */ });
    if (++this.writes % 5_000 === 0) void sql`DELETE FROM mobile_app_installs_seen WHERE last_seen_at < now() - interval '90 days'`.execute(this.db).catch(() => {});
  }

  /** §150: the policies plus the installed-version distribution of the last 7 days. */
  async overview(): Promise<MobileVersionsOverview> {
    if (!this.db) return { rows: [], distribution: [], windowDays: DISTRIBUTION_WINDOW_DAYS, totals: { installs: 0, unsupported: 0, recommendedUpdate: 0 } };
    const rows = (await sql<any>`SELECT app, platform, min_supported, recommended, latest, store_url, message, version, updated_at, updated_by FROM mobile_app_versions ORDER BY app, platform`.execute(this.db)).rows.map(rowToView);
    const dist = (await sql<any>`
      SELECT app, platform, app_version, count(*)::int AS installs FROM mobile_app_installs_seen
      WHERE last_seen_at >= now() - make_interval(days => ${DISTRIBUTION_WINDOW_DAYS})
      GROUP BY app, platform, app_version ORDER BY app, platform, installs DESC`.execute(this.db)).rows;
    const distribution: VersionDistributionRow[] = dist
      .filter((d: any) => (MOBILE_APP_IDS as readonly string[]).includes(d.app) && (CLIENT_PLATFORMS as readonly string[]).includes(d.platform))
      .map((d: any) => {
        const policy = d.platform === 'web' ? null : rows.find((r) => r.app === d.app && r.platform === d.platform) ?? null;
        return { app: d.app, platform: d.platform, version: d.app_version, installs: Number(d.installs), state: appVersionState(d.app_version, policy) };
      });
    const sum = (f: (d: VersionDistributionRow) => boolean) => distribution.filter(f).reduce((n, d) => n + d.installs, 0);
    return { rows, distribution, windowDays: DISTRIBUTION_WINDOW_DAYS,
      totals: { installs: sum(() => true), unsupported: sum((d) => d.state === 'UPDATE_REQUIRED'), recommendedUpdate: sum((d) => d.state === 'UPDATE_RECOMMENDED') } };
  }
}
