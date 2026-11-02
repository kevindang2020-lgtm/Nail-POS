// app-config.service.ts — BUILD_PLAN Phase 13 B (Constitution 6 §52–54, §219–220): what GET /app-config tells a mobile app.
//
//   update      §55: SUPPORTED / UPDATE_RECOMMENDED / UPDATE_REQUIRED for this app + platform + version (mobile_app_versions)
//   flags       §52 / §219: the app's remote flags — a CODE catalogue (CLIENT_FLAGS: no free-form keys, values only, never
//               scripting), each evaluated through the Phase 11 rollout service (platform_settings boolean + rollout policy,
//               tenant-aware when the request carries a session). A Super Admin rolls one out or kills it on the feature
//               rollout screen (/super-admin/features/<key>/rollout) — no store release needed.
//   modules     §54 / §220: modules switched off by a kill switch, so the app says "AI is temporarily unavailable" while
//               booking keeps working — never the whole app offline because one provider failed.
//   maintenance Super Admin maintenance (mode + message + announcement banner) and the host break-glass switch.
// Every read fails soft: a broken read returns the safe default (nothing refused, flags at their defaults, no notices).
import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MaintenanceService } from '@aipowersalon/super-admin';
import {
  appVersionState, type AppConfigResponse, type ClientPlatform, type MobileAppId, type ModuleNotice, type RemoteFlags,
} from '@aipowersalon/api-contracts';
import { PlatformFlagService } from '../common/platform-flags';
import { breakGlassStatus } from '../common/maintenance-break-glass';
import { MobileVersionsService } from './mobile-versions.service';

/** One remote flag. `key` is the platform_settings / rollout key; the app reads it by `name` (useRemoteFlag(name)). */
export interface ClientFlagDef { key: string; name: string; apps: readonly MobileAppId[]; default: boolean; description: string }
const ALL: readonly MobileAppId[] = ['customer', 'tech', 'owner', 'manager-pay'];
/** The catalogue. Adding a flag = a line here + the app reading useRemoteFlag(name, fallback). */
export const CLIENT_FLAGS: readonly ClientFlagDef[] = [
  { key: 'mobile.update_prompts', name: 'update_prompts', apps: ALL, default: true,
    description: 'Show the dismissible "update available" banner for builds below the recommended version (the hard update screen is not a flag).' },
  { key: 'mobile.maintenance_banner', name: 'maintenance_banner', apps: ALL, default: true,
    description: 'Show the maintenance / module-unavailable banner from /app-config.' },
  { key: 'mobile.customer.deals', name: 'deals', apps: ['customer'], default: true,
    description: 'The customer app\'s Deals tab and deal links (the deals engine kill switch also hides it).' },
];

/** Kill switches (Constitution 7 §34, platform_settings) → the module notice an app shows. Any card processor's
 *  'payments.<processor>_disabled' switch → the payments notice (matched by pattern, so a new processor needs no line here). */
const MODULE_SWITCHES: ReadonlyArray<{ setting: string; module: ModuleNotice['module']; message: string }> = [
  { setting: 'ai.auto_actions_disabled', module: 'ai', message: 'AI automation is temporarily unavailable. Everything else keeps working.' },
  { setting: 'deals.engine_disabled', module: 'deals', message: 'Deals are temporarily unavailable.' },
  { setting: 'sms.emergency_send_disabled', module: 'sms', message: 'Text messages are temporarily paused.' },
];
const NOTICE_TTL_MS = 15_000;
export const APP_CONFIG_REFRESH_SECONDS = 300;

@Injectable()
export class AppConfigService {
  private notices: { v: ModuleNotice[]; banner: string | null; exp: number } = { v: [], banner: null, exp: 0 };
  constructor(
    private readonly versions: MobileVersionsService,
    @Optional() private readonly flags?: PlatformFlagService,
    @Optional() private readonly maintenance?: MaintenanceService,
    @Optional() @Inject(DATABASE) private readonly db?: AppDatabase | null,
  ) {}

  async flagsFor(app: MobileAppId, tenantId: string | null): Promise<RemoteFlags> {
    const out: RemoteFlags = {};
    for (const f of CLIENT_FLAGS) {
      if (!f.apps.includes(app)) continue;
      try { out[f.name] = this.flags ? await this.flags.isEnabledFor(f.key, tenantId, f.default) : f.default; }
      catch { out[f.name] = f.default; }
    }
    return out;
  }

  private async moduleNotices(): Promise<{ notices: ModuleNotice[]; banner: string | null }> {
    if (this.notices.exp > Date.now()) return { notices: this.notices.v, banner: this.notices.banner };
    const notices: ModuleNotice[] = [];
    let banner: string | null = null;
    if (this.db) {
      try {
        const keys = MODULE_SWITCHES.map((s) => s.setting);
        const rows = (await sql<any>`SELECT setting_key, value FROM platform_settings WHERE setting_key IN (${sql.join(keys)}) OR setting_key LIKE 'payments.%_disabled'`.execute(this.db as any)).rows;
        const payDown = rows.some((x: any) => String(x.setting_key).startsWith('payments.') && (x.value === true || x.value === 'true'));
        if (payDown) notices.push({ module: 'payments', available: false, message: 'Card payments may be temporarily unavailable.' });
        for (const s of MODULE_SWITCHES) {
          const r = rows.find((x: any) => x.setting_key === s.setting);
          const on = r ? r.value === true || r.value === 'true' : false;
          if (on && !notices.some((n) => n.module === s.module)) notices.push({ module: s.module, available: false, message: s.message });
        }
      } catch { /* no notices rather than an error */ }
    }
    try { banner = ((await this.maintenance?.getState()) as any)?.announcementBanner || null; } catch { banner = null; }
    this.notices = { v: notices, banner, exp: Date.now() + NOTICE_TTL_MS };
    return { notices, banner };
  }

  async build(app: MobileAppId, platform: ClientPlatform, version: string | null, tenantId: string | null): Promise<AppConfigResponse> {
    const policies = await this.versions.policies();
    const policy = platform === 'web' ? null : policies.find((p) => p.app === app && p.platform === platform) ?? null;
    const state = appVersionState(version, policy);
    let maint: { active: boolean; mode: 'read_only' | 'full' | null; message: string | null } = { active: false, mode: null, message: null };
    try {
      const s = await this.maintenance?.cachedState();
      if (s?.active) maint = { active: true, mode: s.mode, message: s.message || null };
    } catch { /* fail open */ }
    const { notices, banner } = await this.moduleNotices();
    const bg = breakGlassStatus();
    return {
      app, platform, version,
      update: { state, minimumVersion: policy?.minSupported ?? null, recommendedVersion: policy?.recommended ?? null, latestVersion: policy?.latest ?? null,
        storeUrl: policy?.storeUrl ?? null, message: policy?.message ?? null },
      flags: await this.flagsFor(app, tenantId),
      modules: notices,
      maintenance: { ...maint, banner },
      breakGlass: { mode: bg.mode, message: bg.message },
      refreshAfterSeconds: APP_CONFIG_REFRESH_SECONDS,
      serverTime: new Date().toISOString(),
    };
  }
}
