// team-members-lookup.controller.ts — Team Management round 2A (30 Oct 2026): `/pos/team-members-screen/customer-links`
// (TM-01 customer-linked staff search) and `/pos/team-members-screen/preferred-check` (TM-04 preferred technician).
// TenantAuthGuard + RolePermissionGuard; tenant / branch from the session, never the query. The repository re-checks
// customers.view for the customer search. Read only — nothing here books, holds or changes a record.
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, HttpStatus, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { TeamMembersLookupRepository } from './team-members-lookup.repository';
import { teamCtx } from './technicians-screen.controller';

export const TEAM_MEMBERS_LOOKUP = 'TeamMembersLookupRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const CUSTOMER_LINKS = { search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-members-screen')
export class TeamMembersLookupController {
  constructor(@Inject(TEAM_MEMBERS_LOOKUP) private readonly repo: TeamMembersLookupRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The team screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  /** TM-01: staff linked to a customer (name or phone) through appointments and completed services, with the reason */
  @Get('customer-links') @RequirePermission('pos.technicians.view') @ListQuery(CUSTOMER_LINKS)
  customerLinks(@Req() req: any, @Query() q: any) { return this.r().customerLinks(teamCtx(req), { q: s(q?.q), page: q?.page, pageSize: q?.pageSize }); }

  /** TM-04: is the preferred technician valid for this service / date / start — and the qualified alternatives */
  @Get('preferred-check') @RequirePermission('pos.technicians.view')
  preferredCheck(@Req() req: any, @Query() q: any) { return this.r().preferredCheck(teamCtx(req), { technicianId: s(q?.technicianId), date: s(q?.date), time: s(q?.time), serviceIds: s(q?.serviceIds) }); }
}
