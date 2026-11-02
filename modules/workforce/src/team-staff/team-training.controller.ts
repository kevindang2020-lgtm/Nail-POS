// team-training.controller.ts — TM-09 training & certification (Four-Module Completion Guide §10.4, 30 Oct 2026).
//   GET  summary · GET courses · POST courses · POST courses/:id/archive · GET members/:memberId · POST assignments ·
//   POST assignments/:id/{start|complete|cancel} · POST certifications · POST certifications/:id/verify (staff certifications;
//   a technician's certification keeps the existing POST /pos/technician-certifications/:technicianId/:id/verify)
// The repository re-checks manage / verify permission (403 audited), transitions (422), expectedVersion (409), tenant (404).
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { teamCtx } from '../team-screens/technicians-screen.controller';
import { requestIdOf } from '../team-screens/audit-rows';
import { TeamTrainingRepository } from './team-training.repository';
import { TS_COURSE_BODY, TS_COURSE_ARCHIVE_BODY, TS_ASSIGN_BODY, TS_START_BODY, TS_COMPLETE_BODY, TS_CANCEL_BODY, TS_CERT_BODY, TS_CERT_VERIFY_BODY } from './team-staff.schemas';

export const TEAM_TRAINING = 'TeamTrainingRepository';
const COURSES = { filters: { status: { type: 'enum', values: ['active', 'archived', 'all'] } }, maxLimit: 100, defaultLimit: 10, params: ['page'] } as const;
const unavailable = () => new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Team management needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team-training')
export class TeamTrainingController {
  constructor(@Inject(TEAM_TRAINING) private readonly repo: TeamTrainingRepository | null) {}
  private r() { if (!this.repo) throw unavailable(); return this.repo; }
  @Get('summary') @RequirePermission('pos.technicians.view')
  summary(@Req() req: any) { return this.r().summary(teamCtx(req)); }
  @Get('courses') @RequirePermission('pos.technicians.view') @ListQuery(COURSES)
  courses(@Req() req: any, @Query() q: any) { return this.r().courses(teamCtx(req), { status: q?.status, page: q?.page, pageSize: q?.pageSize }); }
  @Post('courses') @RequirePermission('pos.technicians.view')
  createCourse(@Req() req: any, @Body(ValidatedBody(TS_COURSE_BODY, { strict: true })) b: any) { return this.r().createCourse(teamCtx(req), b ?? {}, requestIdOf(req)); }
  @Post('courses/:id/archive') @RequirePermission('pos.technicians.view')
  archiveCourse(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TS_COURSE_ARCHIVE_BODY, { strict: true })) b: any) { return this.r().archiveCourse(teamCtx(req), id, b ?? {}, requestIdOf(req)); }
  @Get('members/:memberId') @RequirePermission('pos.technicians.view')
  member(@Req() req: any, @Param('memberId') id: string) { return this.r().member(teamCtx(req), id); }
  @Post('assignments') @RequirePermission('pos.technicians.view')
  assign(@Req() req: any, @Body(ValidatedBody(TS_ASSIGN_BODY, { strict: true })) b: any) { return this.r().assign(teamCtx(req), b ?? {}, requestIdOf(req)); }
  @Post('assignments/:id/start') @RequirePermission('pos.technicians.view')
  start(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TS_START_BODY, { strict: true })) b: any) { return this.r().act(teamCtx(req), id, 'start', b ?? {}, requestIdOf(req)); }
  @Post('assignments/:id/complete') @RequirePermission('pos.technicians.view')
  complete(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TS_COMPLETE_BODY, { strict: true })) b: any) { return this.r().act(teamCtx(req), id, 'complete', b ?? {}, requestIdOf(req)); }
  @Post('assignments/:id/cancel') @RequirePermission('pos.technicians.view')
  cancel(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TS_CANCEL_BODY, { strict: true })) b: any) { return this.r().act(teamCtx(req), id, 'cancel', b ?? {}, requestIdOf(req)); }
  @Post('certifications') @RequirePermission('pos.technicians.view')
  addCert(@Req() req: any, @Body(ValidatedBody(TS_CERT_BODY, { strict: true })) b: any) { return this.r().addCertification(teamCtx(req), b ?? {}, requestIdOf(req)); }
  @Post('certifications/:id/verify') @RequirePermission('pos.technicians.view')
  verify(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(TS_CERT_VERIFY_BODY, { strict: true })) b: any) { return this.r().verifyStaffCertification(teamCtx(req), id, b ?? {}, requestIdOf(req)); }
}
