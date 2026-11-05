// website-leads.controller.ts + module — the Super-Admin Website Leads HTTP surface under /super-admin/website-leads,
// guarded so only platform super-admins reach it. Thin: derive actor ctx, map WebsiteLeadsError → HTTP.
import { safeInet, DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Body, Controller, Get, Header, Module, NotFoundException, BadRequestException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { WebsiteLeadsService, WebsiteLeadsError, type AdminCtx, type LeadsQuery } from './website-leads.service';
import { InMemoryWebsiteLeadsRepo, KyselyWebsiteLeadsRepo, type WebsiteLeadsRepo } from './website-leads.repository';
import { WebsiteLeadsControllerListQueries } from './super-admin-website-leads.module.list-queries';
import { WL_ASSIGN_BODY, WL_CREATE_BODY, WL_FOLLOW_UP_BODY, WL_NOTE_BODY, WL_STATUS_BODY, WL_UPDATE_BODY } from '../request-schemas-leads';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId ?? req?.user?.id, ip: safeInet(req?.ip) ?? undefined }; }
function queryFrom(q: any): LeadsQuery {
  return { search: q?.search, source: q?.source, status: q?.status, scoreRange: q?.scoreRange, dateFrom: q?.dateFrom, dateTo: q?.dateTo, page: q?.page ? +q.page : 1, limit: q?.limit ? +q.limit : 10 };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof WebsiteLeadsError) { if (e.code === 'not_found') throw new NotFoundException(e.message); throw new BadRequestException(e.message); }
    throw e;
  }
}

@ListQueries(WebsiteLeadsControllerListQueries)
@Controller('super-admin/website-leads')
@UseGuards(SuperAdminGuard)
export class WebsiteLeadsController {
  constructor(private readonly svc: WebsiteLeadsService) {}

  @Get('state') state(@Query() q: any) { return run(() => this.svc.state(queryFrom(q))); }
  @Get('kpis') kpis() { return run(() => this.svc.kpis()); }
  @Get('analytics/by-source') bySource() { return run(() => this.svc.bySource()); }
  @Get('analytics/by-status') byStatus() { return run(() => this.svc.byStatus()); }
  @Get('analytics/top-sources') topSources() { return run(() => this.svc.topSources()); }
  @Get('recent-activity') recent(@Query() q: any) { return run(() => this.svc.recentActivity(q?.limit ? +q.limit : 12)); }

  @AsyncExport({ kind: 'super-admin.website-leads.export' }) @Get('export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="website-leads.csv"')
  export(@Query() q: any) { return this.svc.exportCsv(queryFrom(q)); }

  // List must come after the literal sub-routes above so 'state'/'kpis'/etc. aren't captured as :id.
  @Get() list(@Query() q: any) { return run(() => this.svc.list(queryFrom(q))); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(WL_CREATE_BODY)) b: any) { return run(() => this.svc.createLead(ctxFrom(r), b || {})); }

  @Get(':id') get(@Param('id') id: string) { return run(() => this.svc.getLead(id)); }
  @Patch(':id') update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WL_UPDATE_BODY)) b: any) { return run(() => this.svc.updateLead(ctxFrom(r), id, b || {})); }
  @Patch(':id/status') status(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WL_STATUS_BODY)) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, String(b?.status ?? ''))); }
  @Patch(':id/assign') assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WL_ASSIGN_BODY)) b: any) { return run(() => this.svc.assign(ctxFrom(r), id, b?.assignedToUserId ?? null)); }
  @Post(':id/notes') note(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WL_NOTE_BODY)) b: any) { return run(() => this.svc.addNote(ctxFrom(r), id, String(b?.text ?? ''))); }
  @Post(':id/follow-ups') followUp(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(WL_FOLLOW_UP_BODY)) b: any) { return run(() => this.svc.scheduleFollowUp(ctxFrom(r), id, b || {})); }
  @Post(':id/convert-to-application') convert(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.convertToApplication(ctxFrom(r), id)); }
  @Post(':id/recalculate-score') score(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.recalculateScore(ctxFrom(r), id)); }
}

@Module({
  controllers: [WebsiteLeadsController],
  providers: [
    { provide: 'WebsiteLeadsRepo', useFactory: (db: AppDatabase): WebsiteLeadsRepo => (db ? new KyselyWebsiteLeadsRepo(db as any) : new InMemoryWebsiteLeadsRepo()), inject: [DATABASE] },
    { provide: WebsiteLeadsService, useFactory: (repo: WebsiteLeadsRepo, db: AppDatabase) => new WebsiteLeadsService(repo, db), inject: ['WebsiteLeadsRepo', DATABASE] },
  ],
  exports: [WebsiteLeadsService],
})
export class SuperAdminWebsiteLeadsModule {}
