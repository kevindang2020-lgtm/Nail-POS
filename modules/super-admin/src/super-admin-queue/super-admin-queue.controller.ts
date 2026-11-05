// super-admin-queue.controller.ts — SuperAdminGuard-only, READ-ONLY cross-tenant live Queue Management (Phase 9). One
// route: the platform queue aggregation. No write routes (tenants run their own queues via the POS). Mirrors
// super-admin-staff / super-admin-checkin.
import { maskQueuePii } from './queue-pii-mask';
import { Controller, Get, Post, Body, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import type { Response } from 'express';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminQueueService, type AdminCtx } from './super-admin-queue.service';
import { LiveQueueService } from './live-queue.service';
import { LiveQueueActionsService } from './live-queue-actions.service';
import { SuperAdminQueueControllerListQueries } from './super-admin-queue.list-queries';
import { LQ_INCIDENT_BODY, LQ_NOTIFY_BODY, LQ_SUPPORT_SESSION_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminQueueControllerListQueries)
@Controller('super-admin/queue')
export class SuperAdminQueueController {
  constructor(
    private readonly svc: SuperAdminQueueService,
    private readonly live: LiveQueueService,
    private readonly actions: LiveQueueActionsService,
  ) {}

  // Reads are MASKED by default and AUDITED (queue-pii-mask.ts, Oct 12 2026 merge). ?supportTenantId=<uuid> unmasks that
  // ONE tenant's rows only while this admin holds a live support session / open controlled-support request for it.
  private async unmaskFor(r: any, q: any): Promise<string | null> { return q?.supportTenantId ? this.actions.supportModeTenant(ctxFrom(r), q.supportTenantId) : null; }

  @Get('overview') async overview(@Req() r: any, @Query() q: any) {
    const unmask = await this.unmaskFor(r, q);
    const o = await this.svc.getOverview(ctxFrom(r), { search: q?.search, status: q?.status, limit: q?.limit });
    await this.actions.auditView(ctxFrom(r), 'overview', q ?? {}, unmask);
    return { ok: true, ...maskQueuePii(o, unmask), supportMode: unmask ? { tenantId: unmask } : null };
  }

  // Full Live Queue Monitor payload (11 KPIs + every reference module). Read-only; SuperAdminGuard-gated.
  @Get('live-overview') async liveOverview(@Req() r: any, @Query() q: any) {
    const unmask = await this.unmaskFor(r, q);
    const o = await this.live.getOverview(ctxFrom(r), this.live.parseFilters(q ?? {}));
    await this.actions.auditView(ctxFrom(r), 'live-overview', q ?? {}, unmask);
    return { ok: true, ...maskQueuePii(o, unmask), supportMode: unmask ? { tenantId: unmask } : null };
  }

  // --- oversight write-actions (monitoring-only; no queue mutation). All audited + tenant/branch-scoped. ---
  @Post('incidents') openIncident(@Req() r: any, @Body(ValidatedBody(LQ_INCIDENT_BODY)) b: any) { return this.actions.openIncident(ctxFrom(r), b ?? {}); }
  @Post('notify-branch') notifyBranch(@Req() r: any, @Body(ValidatedBody(LQ_NOTIFY_BODY)) b: any) { return this.actions.notifyBranch(ctxFrom(r), b ?? {}); }
  @Post('support-session') supportSession(@Req() r: any, @Body(ValidatedBody(LQ_SUPPORT_SESSION_BODY)) b: any) { return this.actions.openSupportSession(ctxFrom(r), b ?? {}); }
  @Post(':queueId/retry-sync') retrySync(@Req() r: any, @Param('queueId') id: string) { return this.actions.retrySync(ctxFrom(r), id); }

  // Capture a KPI snapshot (scheduled by cron in production; also manually invokable) so trends have a real baseline.
  @Post('snapshot') snapshot(@Req() r: any, @Query() q: any) { return this.live.captureSnapshot(ctxFrom(r), this.live.parseFilters(q ?? {})); }

  @AsyncExport({ kind: 'super-admin.queue.export' }) @Get('export') async export(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportCsv(ctxFrom(r), { ...(q ?? {}), unmaskTenantId: await this.unmaskFor(r, q) });
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"` });
    return out.body;
  }

  @AsyncExport({ kind: 'super-admin.queue.export-xlsx' }) @Get('export-xlsx') async exportXlsx(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportXlsx(ctxFrom(r), { ...(q ?? {}), unmaskTenantId: await this.unmaskFor(r, q) });
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Content-Length': String(out.buffer.length) });
    return out.buffer;
  }

  @AsyncExport({ kind: 'super-admin.queue.export-pdf' }) @Get('export-pdf') async exportPdf(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportPdf(ctxFrom(r), { ...(q ?? {}), unmaskTenantId: await this.unmaskFor(r, q) });
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Content-Length': String(out.buffer.length) });
    return out.buffer;
  }
}
