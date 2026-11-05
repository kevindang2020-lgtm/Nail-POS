// weekly-off-skills.controller.ts — Technician Profile & Team Management guide (Nov 5 2026, G3, migration 816):
//   /pos/weekly-days-off/*   a manager's repeating weekly days off (versioned, previewed, conflicts acknowledged)
//   /pos/skills-catalog/*    the salon's reusable Skills Catalog and technician skill assignments
// Tenant / branch from the session; the repositories re-check permission, versions and conflicts and write the audit
// row in the same transaction. Bookings are never cancelled, moved or reassigned from here.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ListQuery } from '@aipowersalon/database';
import { WeeklyDaysOffRepository } from './weekly-days-off.repository';
import { SkillsCatalogRepository } from './skills-catalog.repository';
import { teamCtx } from './technicians-screen.controller';
import { requestIdOf } from './audit-rows';
import { WEEKLY_OFF_BODY, WEEKLY_OFF_END_BODY, SKILL_BODY, SKILL_ARCHIVE_BODY, SKILL_ASSIGN_BODY, SKILL_REVOKE_BODY } from '../request-schemas';

export const WEEKLY_DAYS_OFF = 'WeeklyDaysOffRepository';
export const SKILLS_CATALOG = 'SkillsCatalogRepository';
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const unavailable = () => new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'This needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/weekly-days-off')
export class WeeklyDaysOffController {
  constructor(@Inject(WEEKLY_DAYS_OFF) private readonly repo: WeeklyDaysOffRepository | null) {}
  private r() { if (!this.repo) throw unavailable(); return this.repo; }

  @Get('') @RequirePermission('pos.technicians.view')
  list(@Req() req: any, @Query('technicianId') technicianId?: string, @Query('month') month?: string) { return this.r().list(teamCtx(req), { technicianId, month }); }

  @Post('preview') @RequirePermission('pos.technicians.view')
  preview(@Req() req: any, @Body(ValidatedBody(WEEKLY_OFF_BODY, { strict: true })) b: any) { return this.r().preview(teamCtx(req), b ?? {}); }

  @Put('') @RequirePermission('pos.technicians.schedule.edit')
  save(@Req() req: any, @Body(ValidatedBody(WEEKLY_OFF_BODY, { strict: true })) b: any) { return this.r().save(teamCtx(req), b ?? {}, requestIdOf(req)); }

  @Post('end') @RequirePermission('pos.technicians.schedule.edit')
  end(@Req() req: any, @Body(ValidatedBody(WEEKLY_OFF_END_BODY, { strict: true })) b: any) { return this.r().end(teamCtx(req), b ?? {}, requestIdOf(req)); }
}

const CATALOG = { filters: { q: { type: 'text', maxLength: 100 }, status: { type: 'enum', values: ['active', 'archived', 'all'] }, category: { type: 'text', maxLength: 60 } } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/skills-catalog')
export class SkillsCatalogController {
  constructor(@Inject(SKILLS_CATALOG) private readonly repo: SkillsCatalogRepository | null) {}
  private r() { if (!this.repo) throw unavailable(); return this.repo; }

  @Get('') @RequirePermission('pos.technicians.view') @ListQuery(CATALOG)
  list(@Req() req: any, @Query() q: any) { return this.r().list(teamCtx(req), { q: s(q?.q), status: s(q?.status), category: s(q?.category), page: q?.page, pageSize: q?.pageSize }); }

  @Post('') @RequirePermission('pos.technicians.skills.edit')
  save(@Req() req: any, @Body(ValidatedBody(SKILL_BODY, { strict: true })) b: any) { return this.r().save(teamCtx(req), b ?? {}, requestIdOf(req)); }

  @Post(':id/archive') @RequirePermission('pos.technicians.skills.edit')
  archive(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(SKILL_ARCHIVE_BODY, { strict: true })) b: any) { return this.r().archive(teamCtx(req), id, b ?? {}, requestIdOf(req)); }

  @Get('technician/:technicianId') @RequirePermission('pos.technicians.view')
  technician(@Req() req: any, @Param('technicianId') technicianId: string) { return this.r().technicianSkills(teamCtx(req), technicianId); }

  @Post('assign') @RequirePermission('pos.technicians.skills.edit')
  assign(@Req() req: any, @Body(ValidatedBody(SKILL_ASSIGN_BODY, { strict: true })) b: any) { return this.r().assign(teamCtx(req), b ?? {}, requestIdOf(req)); }

  @Get('technician/:technicianId/removal-impact/:assignmentId') @RequirePermission('pos.technicians.view')
  removalImpact(@Req() req: any, @Param('technicianId') technicianId: string, @Param('assignmentId') assignmentId: string) { return this.r().revokePreview(teamCtx(req), technicianId, assignmentId); }

  @Post('revoke') @RequirePermission('pos.technicians.skills.edit')
  revoke(@Req() req: any, @Body(ValidatedBody(SKILL_REVOKE_BODY, { strict: true })) b: any) { return this.r().revoke(teamCtx(req), b ?? {}, requestIdOf(req)); }
}
