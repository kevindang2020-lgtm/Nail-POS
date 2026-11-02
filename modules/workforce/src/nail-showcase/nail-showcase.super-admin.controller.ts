/**
 * nail-showcase.super-admin.controller.ts — platform-wide NailShowcase moderation for SUPER_ADMIN. Mirrors the POS
 * moderation surface but operates across every tenant (the service methods take a platformWide flag that lifts the
 * own-tenant restriction). Gated by SuperAdminGuard, exactly like the other /super-admin/* controllers.
 */
import { Body, Controller, Get, Param, Patch, Req, UseGuards, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { NailShowcaseService, NailShowcaseError } from './nail-showcase.service';
import { NailShowcaseSocialService } from './nail-showcase-social.service';
import { NailShowcaseSocialError } from './nail-showcase-social.dto';
import type { NailShowcaseContext } from './nail-showcase.repository';
import { NS_RESOLVE_REPORT_BODY } from '../request-schemas';

function ctxFrom(req: any): NailShowcaseContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof NailShowcaseError) {
      if (e.code === 'not_customer' || e.code === 'forbidden') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'not_eligible') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    if (e instanceof NailShowcaseSocialError) {
      if (e.code === 'not_customer' || e.code === 'forbidden' || e.code === 'private') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('super-admin/nail-showcase')
@UseGuards(SuperAdminGuard)
export class NailShowcaseSuperAdminController {
  constructor(private readonly svc: NailShowcaseService, private readonly social: NailShowcaseSocialService) {}

  // Reported content across the whole platform (every tenant + manual posts with no tenant).
  @Get('reports') reports(@Req() r: any) { return run(() => this.svc.listReports(ctxFrom(r), true)); }

  // Reported creators (social profiles) grouped by reported customer, with their current rank + suspended state.
  @Get('reported-profiles') reportedProfiles(@Req() r: any) { return run(() => this.social.listReportedProfiles(ctxFrom(r))); }

  // Suspend / unsuspend a creator's social profile — removes them from (or restores them to) every NailShowcase ranking.
  @Patch('profiles/:customerId/suspend') suspend(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.suspendProfile(ctxFrom(r), id, true)); }
  @Patch('profiles/:customerId/unsuspend') unsuspend(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.suspendProfile(ctxFrom(r), id, false)); }

  // Hard platform takedown — works regardless of which tenant (or none) owns the content.
  @Patch('posts/:postId/remove') removePost(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.removePostPlatform(ctxFrom(r), id)); }
  @Patch('comments/:commentId/remove') removeComment(@Req() r: any, @Param('commentId') id: string) { return run(() => this.svc.removeCommentPlatform(ctxFrom(r), id)); }

  @Patch('reports/:reportId') resolve(@Req() r: any, @Param('reportId') id: string, @Body(ValidatedBody(NS_RESOLVE_REPORT_BODY, { strict: true })) b: any) {
    return run(() => this.svc.resolveReport(ctxFrom(r), id, b?.status ?? 'action_taken', true));
  }
}
