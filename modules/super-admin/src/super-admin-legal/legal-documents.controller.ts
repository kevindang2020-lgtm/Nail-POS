// legal-documents.controller.ts — Super Admin › General Settings › Legal Documents (versioned, immutable-on-publish).
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { LegalDocumentsService, LegalError, type AdminCtx } from './legal-documents.service';
import { LegalDocumentsControllerListQueries } from './legal-documents.list-queries';
import { LEGAL_DOC_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { const c = req?.ctx || {}; return { userId: c.userId, email: c.email, role: c.role, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof LegalError) { const s = e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : 400; throw new HttpException({ error: e.code, message: e.message }, s); }
    throw e;
  }
}

@ListQueries(LegalDocumentsControllerListQueries)
@Controller('super-admin/settings/general/legal-documents')
@UseGuards(SuperAdminGuard)
export class LegalDocumentsController {
  constructor(private readonly svc: LegalDocumentsService) {}

  @Get() @RequirePermission('super_admin.general_settings.legal_documents.view')
  list() { return this.svc.listDocuments(); }

  @Get('history') @RequirePermission('super_admin.general_settings.legal_documents.view')
  history(@Query() q: any) { const n = Number(q?.limit); return this.svc.versionHistory(Number.isFinite(n) ? n : 50); }

  @Get('acceptance-status') @RequirePermission('super_admin.general_settings.legal_documents.view')
  acceptance(@Query() q: any) { return run(() => this.svc.acceptanceStatus(String(q?.docType || ''))); }

  @Get('overview-version') @RequirePermission('super_admin.general_settings.legal_documents.view')
  overviewVersion() { return this.svc.overviewVersion(); }

  @Get(':id') @RequirePermission('super_admin.general_settings.legal_documents.view')
  getOne(@Param('id') id: string) { return run(() => this.svc.getVersion(id)); }

  @Post() @RequirePermission('super_admin.general_settings.legal_documents.manage')
  create(@Req() req: any, @Body(ValidatedBody(LEGAL_DOC_BODY, { strict: true })) b: any) { return run(() => this.svc.createDraft(ctxFrom(req), b || {})); }

  @Post(':id/publish') @RequirePermission('super_admin.general_settings.legal_documents.publish')
  publish(@Req() req: any, @Param('id') id: string) { return run(() => this.svc.publish(ctxFrom(req), id)); }

  @Post(':id/retire') @RequirePermission('super_admin.general_settings.legal_documents.manage')
  retire(@Req() req: any, @Param('id') id: string) { return run(() => this.svc.retire(ctxFrom(req), id)); }
}
