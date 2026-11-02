/**
 * nail-showcase.pos.controller.ts — salon-side moderation (`/pos/nail-showcase/*`). Guards: TenantAuthGuard +
 * RolePermissionGuard; gated on a manager-level permission (customers.edit) — a dedicated `nail_showcase.moderate`
 * permission can replace it. The service enforces that a manager may only act on posts/comments in their own tenant.
 */
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { NailShowcaseService, NailShowcaseError } from './nail-showcase.service';
import type { NailShowcaseContext } from './nail-showcase.repository';
import { ListQueries } from '@aipowersalon/database';
import { NailShowcasePosControllerListQueries } from './nail-showcase.pos.list-queries';
import { NS_RESOLVE_REPORT_BODY } from '../request-schemas';

function ctxFrom(req: any): NailShowcaseContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof NailShowcaseError) {
      if (e.code === 'not_customer' || e.code === 'forbidden') throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e.code === 'not_found') throw new HttpException(e.message, HttpStatus.NOT_FOUND);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(NailShowcasePosControllerListQueries)
@Controller('pos/nail-showcase')
export class NailShowcasePosController {
  constructor(private readonly svc: NailShowcaseService) {}

  @Get('posts') @RequirePermission('customers.edit') posts(@Req() r: any, @Query() q: any) {
    return run(() => this.svc.listModeration(ctxFrom(r), { status: q.status, reportedOnly: q.reportedOnly === 'true' || q.reportedOnly === '1' }));
  }
  @Patch('posts/:postId/hide') @RequirePermission('customers.edit') hide(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.hidePost(ctxFrom(r), id)); }
  @Patch('posts/:postId/approve') @RequirePermission('customers.edit') approve(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.approvePost(ctxFrom(r), id)); }
  @Patch('comments/:commentId/hide') @RequirePermission('customers.edit') hideComment(@Req() r: any, @Param('commentId') id: string) { return run(() => this.svc.hideComment(ctxFrom(r), id)); }
  @Get('reports') @RequirePermission('customers.edit') reports(@Req() r: any) { return run(() => this.svc.listReports(ctxFrom(r), false)); }
  @Patch('reports/:reportId') @RequirePermission('customers.edit') resolve(@Req() r: any, @Param('reportId') id: string, @Body(ValidatedBody(NS_RESOLVE_REPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.resolveReport(ctxFrom(r), id, b?.status ?? 'reviewed', false)); }
}
