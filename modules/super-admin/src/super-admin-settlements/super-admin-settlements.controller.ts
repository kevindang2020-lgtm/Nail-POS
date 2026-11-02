// super-admin-settlements.controller.ts — SuperAdminGuard-gated platform Settlements & Deposits. Read overview +
// oversight write-actions (notes, etc. added in a later unit). Tenant identity is server-derived; no client tenant trust.
import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import type { Response } from 'express';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SettlementsService, type AdminCtx } from './settlements.service';
import { SettlementsActionsService } from './settlements-actions.service';
import { SuperAdminSettlementsControllerListQueries } from './super-admin-settlements.list-queries';
import { STL_MATCH_DEPOSIT_BODY, STL_NOTE_BODY, STL_PROCESSOR_CASE_BODY, STL_RESOLVE_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
function scopeFrom(req: any): unknown { return req?.ctx?.tenantId ? { tenantId: req.ctx.tenantId } : undefined; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminSettlementsControllerListQueries)
@Controller('super-admin/settlements')
export class SuperAdminSettlementsController {
  constructor(private readonly svc: SettlementsService, private readonly actions: SettlementsActionsService) {}

  @Get('overview') async overview(@Req() r: any, @Query() q: any) {
    const filters = this.svc.parseFilters(q ?? {}, scopeFrom(r));
    return { ok: true, ...(await this.svc.getOverview(ctxFrom(r), filters)) };
  }

  @Post(':id/notes') addNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(STL_NOTE_BODY, { strict: true })) b: any) { return this.actions.addNote(ctxFrom(r), id, b ?? {}); }
  @Post(':id/match-deposit') matchDeposit(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(STL_MATCH_DEPOSIT_BODY, { strict: true })) b: any) { return this.actions.matchDeposit(ctxFrom(r), id, b ?? {}); }
  @Post(':id/resolve') resolve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(STL_RESOLVE_BODY, { strict: true })) b: any) { return this.actions.resolveDiscrepancy(ctxFrom(r), id, b ?? {}); }
  @Post(':id/processor-case') processorCase(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(STL_PROCESSOR_CASE_BODY, { strict: true })) b: any) { return this.actions.openProcessorCase(ctxFrom(r), id, b ?? {}); }

  @AsyncExport({ kind: 'super-admin.settlements.export' }) @Get('export') async export(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportCsv(ctxFrom(r), q ?? {});
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"` });
    return out.body;
  }
  @AsyncExport({ kind: 'super-admin.settlements.export-xlsx' }) @Get('export-xlsx') async exportXlsx(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportXlsx(ctxFrom(r), q ?? {});
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Content-Length': String(out.buffer.length) });
    return out.buffer;
  }
  @AsyncExport({ kind: 'super-admin.settlements.export-pdf' }) @Get('export-pdf') async exportPdf(@Req() r: any, @Query() q: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.actions.exportPdf(ctxFrom(r), q ?? {});
    res.set({ 'Content-Type': out.contentType, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Content-Length': String(out.buffer.length) });
    return out.buffer;
  }
}
