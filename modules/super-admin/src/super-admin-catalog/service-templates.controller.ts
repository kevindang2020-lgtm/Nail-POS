// service-templates.controller.ts — Super Admin › Catalog Management › Service Templates (under SuperAdminGuard).
// Unit 1 exposes the read-only overview aggregate.
import { Controller, Get, Post, Patch, Param, Query, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ServiceTemplatesService, CatalogForbiddenError, CatalogNotFoundError } from './service-templates.service';
import type { AuditActor } from './service-templates.repository';
import { ListQueries } from '@aipowersalon/database';
import { ServiceTemplatesControllerListQueries } from './service-templates.list-queries';
import { CAT_CATEGORY_CREATE_BODY, CAT_CATEGORY_UPDATE_BODY, CAT_CUSTOMIZABLE_BODY, CAT_DEPLOY_BODY, CAT_TEMPLATE_CREATE_BODY, CAT_TEMPLATE_RETIRE_BODY, CAT_TEMPLATE_UPDATE_BODY } from '../request-schemas-catalog';   // BUILD_PLAN Phase 12 (#17)

@UseGuards(SuperAdminGuard)
@ListQueries(ServiceTemplatesControllerListQueries)
@Controller('super-admin/catalog')
export class ServiceTemplatesController {
  constructor(private readonly svc: ServiceTemplatesService) {}

  private actor(req: any): AuditActor { return { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] }; }
  private wrap(e: any): never {
    if (e instanceof CatalogForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof CatalogNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    throw new HttpException(e?.message || 'Catalog action failed', HttpStatus.BAD_REQUEST);
  }

  @Get('categories')
  async categories() {
    return this.svc.listCategories();
  }

  @Post('categories')
  async createCategory(@Body(ValidatedBody(CAT_CATEGORY_CREATE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.createCategory(this.actor(req), body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Patch('categories/:code')
  async updateCategory(@Param('code') code: string, @Body(ValidatedBody(CAT_CATEGORY_UPDATE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.updateCategory(this.actor(req), code, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get('service-templates/overview')
  async overview() {
    return this.svc.getOverview();
  }

  @Get('service-templates')
  async list(@Query() q: any) {
    return this.svc.listTemplates(q ?? {});
  }

  @AsyncExport({ kind: 'super-admin.catalog.service-templates-export' }) @Get('service-templates/export')
  async export(@Query() q: any, @Req() req: any) {
    try { return await this.svc.exportCsv(this.actor(req), q ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get('service-templates/:id')
  async detail(@Param('id') id: string) {
    try { return await this.svc.getTemplate(id); } catch (e) { this.wrap(e); }
  }

  @Post('service-templates')
  async create(@Body(ValidatedBody(CAT_TEMPLATE_CREATE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.createTemplate(this.actor(req), body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Patch('service-templates/:id')
  async update(@Param('id') id: string, @Body(ValidatedBody(CAT_TEMPLATE_UPDATE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.updateTemplate(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Post('service-templates/:id/publish')
  async publish(@Param('id') id: string, @Req() req: any) {
    try { return await this.svc.publishTemplate(this.actor(req), id); } catch (e) { this.wrap(e); }
  }

  @Post('service-templates/:id/retire')
  async retire(@Param('id') id: string, @Body(ValidatedBody(CAT_TEMPLATE_RETIRE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.retireTemplate(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get('service-templates/:id/deploy-preview')
  async deployPreview(@Param('id') id: string, @Query('allowOverwrite') allowOverwrite: string, @Req() req: any) {
    try { return await this.svc.previewDeploy(this.actor(req), id, allowOverwrite === 'true'); } catch (e) { this.wrap(e); }
  }

  @Post('service-templates/:id/deploy')
  async deploy(@Param('id') id: string, @Body(ValidatedBody(CAT_DEPLOY_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.deploy(this.actor(req), id, body ?? {}); } catch (e) { this.wrap(e); }
  }

  @Get('service-templates/:id/comparison')
  async comparison(@Param('id') id: string) {
    try { return await this.svc.getComparison(id); } catch (e) { this.wrap(e); }
  }

  @Patch('deployments/:deploymentId/customizable')
  async setCustomizable(@Param('deploymentId') deploymentId: string, @Body(ValidatedBody(CAT_CUSTOMIZABLE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.setCustomizable(this.actor(req), deploymentId, body ?? {}); } catch (e) { this.wrap(e); }
  }
}
