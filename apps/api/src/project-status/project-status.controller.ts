// project-status.controller.ts — Super Admin project-status HTTP surface.
// Behind SuperAdminGuard: tenant POS users (and everyone else) cannot read or edit project status here.
import { Controller, Get, Patch, Param, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ProjectStatusService, NotFoundError } from './project-status.service';
import { RECHECK_MODULE_BODY } from './request-schemas';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/project-status')
export class ProjectStatusController {
  constructor(private readonly svc: ProjectStatusService) {}

  @Get()
  all() { return this.svc.getAll(); }

  @Get('pos-settings')
  posSettings() { return this.svc.getPosSettings(); }

  @Get('pos-settings/:moduleKey')
  one(@Param('moduleKey') moduleKey: string) {
    try { return this.svc.getModule(moduleKey); }
    catch (e: any) { if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND); throw e; }
  }

  @Patch('pos-settings/:moduleKey/recheck')
  recheck(@Param('moduleKey') moduleKey: string) {
    try { return this.svc.recheck(moduleKey); }
    catch (e: any) { if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND); throw e; }
  }

  // spec §12 alias: PATCH /super-admin/project-status/module  { moduleKey }
  @Patch('module')
  recheckByBody(@Body(ValidatedBody(RECHECK_MODULE_BODY)) body: any) {
    const moduleKey = body?.moduleKey;
    if (!moduleKey) throw new HttpException('moduleKey is required', HttpStatus.BAD_REQUEST);
    try { return this.svc.recheck(moduleKey); }
    catch (e: any) { if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND); throw e; }
  }
}
