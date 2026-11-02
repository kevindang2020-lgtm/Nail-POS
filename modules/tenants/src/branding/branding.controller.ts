// branding.controller.ts — public branding read (every frontend) + super-admin branding controls.
// Logo asset is locked (replaceLogo refuses by default). Permissions: branding.view/update/asset.upload/restore.
import { AnonRateLimit } from '@aipowersalon/security/nest';   // Security Deep Scan §28/§43/§44: per-IP limit on public routes
import { Controller, Get, Patch, Post, Body, Req, UseGuards, HttpException, Header } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { BrandingService, BrandingError } from './branding.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { BRANDING_BODY } from '../request-schemas';

function actorFrom(r: any) { return { userId: r?.ctx?.userId, role: r?.ctx?.role }; }
function run<T>(fn: () => Promise<T>) {
  return fn().catch((e: any) => { if (e instanceof BrandingError) throw new HttpException(e.message, e.status); throw e; });
}

// PUBLIC: GET /platform/branding — safe config for all apps (excluded from tenant middleware in app.module).
@Controller('platform')
export class PublicBrandingController {
  constructor(private readonly svc: BrandingService) {}
  // Every app + the login screens fetch this before auth, and it changes rarely — so let browsers and a CDN cache it
  // (Scaling Roadmap Phase 2.3). `public` (no per-user data), 5-min freshness, and SWR so a stale copy serves
  // instantly while the CDN revalidates in the background. This offloads a very high-volume read from the API.
  @Get('branding') @AnonRateLimit(600, 5 * 60_000) @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600') get() { return this.svc.get(); }
}

// SUPER ADMIN: view/update colours + tagline, restore defaults; logo replacement is locked.
@UseGuards(SuperAdminGuard)
@Controller('super-admin/settings/branding')
export class SuperAdminBrandingController {
  constructor(private readonly svc: BrandingService) {}

  @Get() view() { return this.svc.get(); }                                  // branding.view
  @Patch() update(@Req() r: any, @Body(ValidatedBody(BRANDING_BODY, { strict: true })) b: any) { return run(() => this.svc.update(actorFrom(r), b || {})); } // branding.update
  @Post('restore') restore(@Req() r: any) { return run(() => this.svc.restore(actorFrom(r))); }                 // branding.asset.restore
  @Post('logo') replace(@Req() r: any) {
    const perms: string[] = r?.ctx?.permissions || [];
    return run(() => this.svc.replaceLogo(actorFrom(r), perms.includes('super_admin.branding.asset.upload'))); // locked
  }
}
