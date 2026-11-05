import { ValidatedBody } from '@aipowersalon/permissions/guards';
// public-website.controller.ts — UNAUTHENTICATED intake for the marketing website: leads (demo/contact/free-package/
// newsletter) and full free-package applications. Defense: strict field whitelist + length caps in the service (raw
// input is never spread into SQL), honeypot accept-and-drop, and a per-IP rate limit (5/min, 10-min lockout) reusing
// login's rateLimitDecision. No tenant context, no session — excluded from TenantContextMiddleware in app.module.
import { Body, Controller, Post, Req } from '@nestjs/common';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { run } from './super-admin-platform.controller';
import { clientIp } from '@aipowersalon/security';
import { PUBLIC_ACCEPT_INVITE_BODY, PUBLIC_APPLICATION_BODY, PUBLIC_LEAD_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

// Constitution 12 §50: this used to read X-Forwarded-For raw — a header the client writes — so publicGate's rate
// limit on these public forms reset for anyone sending a fresh value. clientIp() takes Express's proxy-aware value.
function ipOf(req: any): string { return clientIp(req) ?? 'unknown'; }

@Controller('public/website')
export class PublicWebsiteController {
  constructor(private readonly svc: SuperAdminPlatformService) {}

  @Post('leads') lead(@Req() r: any, @Body(ValidatedBody(PUBLIC_LEAD_BODY)) b: any) { return run(() => this.svc.publicCreateLead(b, ipOf(r))); }
  @Post('applications') application(@Req() r: any, @Body(ValidatedBody(PUBLIC_APPLICATION_BODY)) b: any) { return run(() => this.svc.publicCreateApplication(b, ipOf(r), String(r?.headers?.['user-agent'] || ''))); }
  // Invitee redeems a single-use token and sets their own password (no admin/session context).
  @Post('invitations/accept') acceptInvite(@Body(ValidatedBody(PUBLIC_ACCEPT_INVITE_BODY)) b: any) { return run(() => this.svc.acceptInvitation(b)); }
}
