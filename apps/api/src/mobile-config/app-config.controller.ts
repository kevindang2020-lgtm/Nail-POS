// app-config.controller.ts — BUILD_PLAN Phase 13 B: GET /app-config (public) and the Super Admin version policies.
//
// /app-config is PUBLIC BY NECESSITY: an app must learn it is too old (and where to update) BEFORE anyone can sign in, and
// the update screen must work for a build the API already refuses. It returns only platform-wide configuration (version
// thresholds, flag booleans, module notices, maintenance text) — no tenant data. A session is used only if the request
// already carries one, to evaluate tenant rollouts; it is never required. Rate-limited per client address and per instance.
import { BadRequestException, Body, Controller, Get, HttpException, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { clientIp } from '@aipowersalon/security';
import { sessionFromRequest } from '@aipowersalon/identity';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { MOBILE_APP_IDS, CLIENT_PLATFORMS, isAppVersion, parseClientHeaders, type MobileAppId, type ClientPlatform, type AppConfigResponse, type MobileVersionsOverview, type MobileVersionRow, type MobileVersionPolicyInput } from '@aipowersalon/api-contracts';
import { WindowLimiter } from '../observability/client-errors.controller';
import { AppConfigService } from './app-config.service';
import { MobileVersionsService } from './mobile-versions.service';
import { MOBILE_VERSION_BODY } from './request-schemas';

export const APP_CONFIG_LIMITS = { perIpPerMinute: 60, perInstancePerMinute: 6000 } as const;

@Controller('app-config')
export class AppConfigController {
  readonly limiter = new WindowLimiter(APP_CONFIG_LIMITS.perIpPerMinute, APP_CONFIG_LIMITS.perInstancePerMinute);
  constructor(private readonly svc: AppConfigService) {}

  @Get()
  async get(@Req() req: any, @Query('app') qApp?: string, @Query('platform') qPlatform?: string, @Query('version') qVersion?: string): Promise<AppConfigResponse> {
    if (!this.limiter.allow(clientIp(req) ?? 'unknown')) throw new HttpException({ statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests — try again in a minute.' }, 429);
    const h = parseClientHeaders(req?.headers);
    const app = (qApp ?? h.app ?? '') as string;
    if (!(MOBILE_APP_IDS as readonly string[]).includes(app)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: `app must be one of ${MOBILE_APP_IDS.join(', ')}.` });
    const platform = String(qPlatform ?? h.platform ?? 'web').toLowerCase();
    if (!(CLIENT_PLATFORMS as readonly string[]).includes(platform)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'platform must be ios, android or web.' });
    const rawVersion = qVersion ?? h.version;
    const version = isAppVersion(rawVersion) ? rawVersion : null;
    let tenantId: string | null = null;
    try { tenantId = sessionFromRequest(req, process.env.AUTH_SESSION_SECRET || '')?.tenantId ?? null; } catch { tenantId = null; }
    return this.svc.build(app as MobileAppId, platform as ClientPlatform, version, tenantId);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/mobile-versions')
export class MobileVersionsController {
  constructor(private readonly svc: MobileVersionsService) {}

  /** §150: every policy + the installed-version distribution of the last 7 days. */
  @Get() @RequirePermission('super_admin.mobile_versions.view')
  overview(): Promise<MobileVersionsOverview> { return this.svc.overview(); }

  /** Set one store app's thresholds on one platform. Step-up, a reason, an optimistic version and an audit record. */
  @RequireStepUp()
  @Put(':app/:platform') @RequirePermission('super_admin.mobile_versions.manage')
  set(@Param('app') app: string, @Param('platform') platform: string, @Body(ValidatedBody(MOBILE_VERSION_BODY)) b: MobileVersionPolicyInput, @Req() req: any): Promise<MobileVersionRow> {
    return this.svc.set(String(app), String(platform), (b ?? {}) as Record<string, unknown>, { userId: req?.ctx?.userId ?? null });
  }
}
