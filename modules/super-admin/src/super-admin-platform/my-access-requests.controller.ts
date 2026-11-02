import { ValidatedBody } from '@aipowersalon/permissions/guards';
// my-access-requests.controller.ts — tenant SELF-SERVICE for the access-request workflow (§26). A signed-in user
// files / tracks / cancels their OWN role-elevation request. NOT behind SuperAdminGuard: it is protected by the
// session middleware (TenantContextMiddleware fails closed → 401 without a session), and identity is taken from
// req.ctx server-side, never from the client. Approvals happen in the Super Admin console.
import { Body, Controller, Get, Param, Post, Req, HttpException } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminPlatformService, type AdminCtx } from './super-admin-platform.service';
import { run } from './super-admin-platform.controller';
import { MY_ACCESS_REQUEST_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }

@Controller('me/access-requests')
export class MyAccessRequestsController {
  constructor(private readonly svc: SuperAdminPlatformService) {}
  private uid(r: any): string { const u = r?.ctx?.userId; if (!u) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401); return u; }

  @Get() mine(@Req() r: any) { this.uid(r); return run(() => this.svc.listOwnAccessRequests(ctxFrom(r))); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(MY_ACCESS_REQUEST_BODY, { strict: true })) b: any) { this.uid(r); return run(() => this.svc.createOwnAccessRequest(ctxFrom(r), b || {})); }
  @Post(':id/cancel') cancel(@Req() r: any, @Param('id') id: string) { this.uid(r); return run(() => this.svc.cancelOwnAccessRequest(ctxFrom(r), id)); }
}
