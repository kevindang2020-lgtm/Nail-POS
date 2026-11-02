// team-onboarding.controller.ts — TM-06 Add Team Member for every role (Four-Module Completion Guide §10.1, 30 Oct 2026).
//   GET  /pos/team-onboarding/options   the roles this actor may add (and why not) + the branches they may grant
//   POST /pos/team-onboarding/staff     roles.manage (re-checked, 403 audited) + step-up; idempotency key in the body
// Tenant / branch / actor from the session, never the body.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Post, Req, UseGuards } from '@nestjs/common';
import { teamCtx } from '../team-screens/technicians-screen.controller';
import { requestIdOf } from '../team-screens/audit-rows';
import { TeamOnboardingRepository } from './team-onboarding.repository';
import { TS_ONBOARD_BODY } from './team-staff.schemas';
import { REALTIME, EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { logException } from '@aipowersalon/observability';

export const TEAM_ONBOARDING = 'TeamOnboardingRepository';
const unavailable = () => new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Team management needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-onboarding')
export class TeamOnboardingController {
  constructor(@Inject(TEAM_ONBOARDING) private readonly repo: TeamOnboardingRepository | null,
              @Optional() @Inject(REALTIME) private readonly realtime?: RealtimeEmitter) {}
  private r() { if (!this.repo) throw unavailable(); return this.repo; }
  @Get('options') @RequirePermission('pos.technicians.view')
  options(@Req() req: any) { return this.r().options(teamCtx(req)); }
  // Security Deep Scan §59: minting an account into a role needs a fresh step-up, like every staff invitation
  @Post('staff') @RequirePermission('pos.technicians.view') @RequireStepUp()
  async create(@Req() req: any, @Body(ValidatedBody(TS_ONBOARD_BODY, { strict: true })) b: any) {
    const ctx = teamCtx(req);
    const out: any = await this.r().create(ctx, b ?? {}, requestIdOf(req));
    // TM-05 (gap sweep): other Team screens refetch at once instead of waiting for their 30 s poll — a new member only
    // (a replayed request changed nothing), to every branch the member was granted plus the creator's own
    if (out && out.replayed === false && out.memberId) {
      const rooms = new Set<string>([...(Array.isArray(out.branchIds) ? out.branchIds.map(String) : []), ...(ctx.branchId ? [String(ctx.branchId)] : [])]);
      for (const branchId of rooms) {
        // §343 exempt: a momentary screen signal (the team list changed; refetch, ids only) — the audited insert is the fact
        try { this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId }, EVENTS.teamMemberCreated, { memberId: String(out.memberId) }); }
        catch (e) { logException(e, { where: 'team-onboarding.realtime', tenantId: ctx.tenantId }); }
      }
    }
    return out;
  }
}
