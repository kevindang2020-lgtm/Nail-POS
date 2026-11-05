// super-admin-memberships.controller.ts — SuperAdminGuard-only, READ-ONLY platform Membership Overview. One route: the
// cross-tenant aggregation that powers the Super Admin Memberships screen. No write routes (tenants manage their own
// plans/members via the POS surface). Mirrors the super-admin-tickets controller shape.
import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminMembershipsService, SuperAdminMembershipsError, type AdminCtx } from './super-admin-memberships.service';
import { SuperAdminMembershipsControllerListQueries } from './super-admin-memberships.list-queries';

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof SuperAdminMembershipsError && e.code === 'not_found') throw new NotFoundException(e.message); throw e; }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminMembershipsControllerListQueries)
@Controller('super-admin/memberships')
export class SuperAdminMembershipsController {
  constructor(private readonly svc: SuperAdminMembershipsService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    return this.svc.getOverview(ctxFrom(r), { rangeDays: q?.rangeDays, expiringWindowDays: q?.expiringWindowDays, revenueRange: q?.revenueRange }).then((o) => ({ ok: true, ...o }));
  }

  @Get('plans/:planId') plan(@Req() r: any, @Param('planId') id: string) {
    return run(async () => ({ ok: true, plan: await this.svc.getPlanDetail(ctxFrom(r), id) }));
  }

  @Get('members/:membershipId') member(@Req() r: any, @Param('membershipId') id: string) {
    return run(async () => ({ ok: true, member: await this.svc.getMemberDetail(ctxFrom(r), id) }));
  }
}
