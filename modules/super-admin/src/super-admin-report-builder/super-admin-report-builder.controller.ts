// super-admin-report-builder.controller.ts — SuperAdminGuard-only. Exposes the builder catalog (drives the UI),
// an ad-hoc run, and saved-definition CRUD. Validation errors surface as 400 (BadRequest), not 500.

import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminReportBuilderService } from './super-admin-report-builder.service';
import { DIMENSIONS, MEASURES, VISUALIZATIONS, SUPPORTED } from './report-builder-catalog';
import { RB_DEFINITION_BODY, RB_RUN_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

const ctxFrom = (r: any) => ({ userId: r?.user?.id ?? r?.user?.userId, email: r?.user?.email });

@Controller('super-admin/report-builder')
@UseGuards(SuperAdminGuard)
export class SuperAdminReportBuilderController {
  constructor(private readonly svc: SuperAdminReportBuilderService) {}

  @Get('catalog')
  catalog() {
    return { dimensions: DIMENSIONS, measures: MEASURES, visualizations: VISUALIZATIONS, supported: SUPPORTED };
  }

  @Post('run')
  async run(@Req() r: any, @Body(ValidatedBody(RB_RUN_BODY)) body: any) {
    try { return await this.svc.run(ctxFrom(r), body || {}); }
    catch (e: any) { throw new BadRequestException(e?.message || 'Invalid report specification.'); }
  }

  @Get('definitions')
  definitions() { return this.svc.list(); }

  @Post('definitions')
  async create(@Req() r: any, @Body(ValidatedBody(RB_DEFINITION_BODY)) body: any) {
    try { return await this.svc.create(ctxFrom(r), body || {}); }
    catch (e: any) { throw new BadRequestException(e?.message || 'Invalid report definition.'); }
  }

  @Patch('definitions/:id')
  async update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RB_DEFINITION_BODY)) body: any) {
    let row;
    try { row = await this.svc.update(ctxFrom(r), id, body || {}); }
    catch (e: any) { throw new BadRequestException(e?.message || 'Invalid report definition.'); }
    if (!row) throw new NotFoundException('Report definition not found.');
    return row;
  }

  @Delete('definitions/:id')
  async remove(@Req() r: any, @Param('id') id: string) {
    const ok = await this.svc.remove(ctxFrom(r), id);
    if (!ok) throw new NotFoundException('Report definition not found.');
    return { ok: true };
  }
}
