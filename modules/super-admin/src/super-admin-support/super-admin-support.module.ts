import { safeInet, DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SupportOverviewService, type AdminCtx } from './support-overview.service';
import { SupportOverviewRepository } from './support-overview.repository';
import { SupportActionsService } from './support-actions.service';
import { SupportTicketsService } from '@aipowersalon/support';
import { SuperAdminSupportControllerListQueries } from './super-admin-support.module.list-queries';
import { SUP_BODY_BODY, SUP_STATUS_BODY, SUP_TICKET_BODY } from '../request-schemas-workforce';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
function scopeFrom(req: any): any { return req?.ctx?.tenantId ? { tenantId: req.ctx.tenantId } : undefined; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminSupportControllerListQueries)
@Controller('super-admin/support')
export class SuperAdminSupportController {
  constructor(private readonly overview: SupportOverviewService, private readonly actions: SupportActionsService) {}

  @Get('overview') async getOverview(@Req() r: any) {
    const q = r?.query ?? {};
    const filters = { category: q.category, priority: q.priority, agent: q.agent, slaStatus: q.slaStatus, dateFrom: q.dateFrom, dateTo: q.dateTo };
    return { ok: true, ...(await this.overview.getOverview(ctxFrom(r), { scope: scopeFrom(r), filters })) };
  }

  // Create a ticket for a validated tenant (delegates to the existing audited ticket creator).
  @Post('tickets') createTicket(@Req() r: any, @Body(ValidatedBody(SUP_TICKET_BODY)) b: any) { return this.actions.createTicket(ctxFrom(r), b ?? {}); }
  // Cross-tenant ticket detail (conversation + internal timeline) + super-admin reply / status transition.
  @Get('tickets/:id') ticketDetail(@Req() r: any, @Param('id') id: string) { return this.actions.ticketDetail(ctxFrom(r), id); }
  @Post('tickets/:id/reply') reply(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SUP_BODY_BODY)) b: any) { return this.actions.reply(ctxFrom(r), id, String(b?.body ?? '')); }
  @Post('tickets/:id/status') setTicketStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SUP_STATUS_BODY)) b: any) { return this.actions.setStatus(ctxFrom(r), id, String(b?.to ?? ''), b?.note); }
  @Post('tickets/:id/internal-note') addInternalNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SUP_BODY_BODY)) b: any) { return this.actions.addInternalNote(ctxFrom(r), id, String(b?.body ?? '')); }
}

@Module({
  controllers: [SuperAdminSupportController],
  providers: [
    { provide: SupportOverviewService, useFactory: (db: AppDatabase) => new SupportOverviewService(new SupportOverviewRepository(db as any)), inject: [DATABASE] },
    { provide: SupportTicketsService, useFactory: (db: AppDatabase) => new SupportTicketsService(db as any), inject: [DATABASE] },
    { provide: SupportActionsService, useFactory: (t: SupportTicketsService, db: AppDatabase) => new SupportActionsService(t, db as any), inject: [SupportTicketsService, DATABASE] },
  ],
  exports: [SupportOverviewService, SupportActionsService],
})
export class SuperAdminSupportModule {}
