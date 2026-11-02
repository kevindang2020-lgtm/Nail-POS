import { RequirePermission } from '@aipowersalon/permissions/guards';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { T_PAYROLL_INQUIRY_BODY, T_CASH_DISPUTE_BODY, T_CASH_ACK_BODY, T_ACCEPT_BODY, T_ADD_LINE_BODY, T_ADD_ON_BODY, T_CANCEL_REQUEST_BODY, T_CHANGE_REQUEST_BODY, T_DECLINE_BODY, T_DONE_BODY, T_MESSAGE_BODY, T_NOTE_BODY, T_PATCH_LINE_BODY, T_READ_BODY, T_REMOVE_LINE_BODY, T_SKILL_BODY, T_SKILL_DECISION_BODY } from '../request-schemas';
import { validateImageUpload, payStubHeaders } from '@aipowersalon/workforce';
/**
 * tech.controller.ts — Technician-mobile HTTP surface (/tech/*). Thin: derives ctx from the session, calls TechService,
 * and maps TechError → HTTP (forbidden/not_technician → 403, not_found → 404, invalid_state → 400). Authorization
 * (own-ticket only) and state guards live in TechService.
 *
 * DATA ADAPTER PENDING: TechModule currently binds the in-memory TechDataPort (returns no data), so these endpoints
 * report "no technician/data" honestly until the Kysely TechDataPort is implemented. The route contract, auth, and
 * error mapping are real and type-checked.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, Res, StreamableFile, Patch, Delete , ConflictException, InternalServerErrorException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { makeMediaStorage, acceptUpload, uploadObjectKey, UPLOAD_POLICIES } from '@aipowersalon/media';
import { TechService, TechError } from './tech.service';
import { MembershipEnrollService } from '@aipowersalon/memberships';
import type { TechContext } from './tech.repository';
import { ListQueries } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';   // BUILD_PLAN Phase 13: one Idempotency-Key per start / complete (the app's offline journal replays with it)
import { TechControllerListQueries } from './tech.list-queries';
import type { TechPayout, TechPayrollInquiry, TechPayrollInquiryRequest, TechPayStatements, TechPayStatementDetail, PaycheckPayout, PaycheckDisputeRequest, PaycheckAckRequest, PayStubQuery } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

function ctxFrom(req: any): TechContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
    } catch (e: any) {
    if (e instanceof TechError || e?.name === 'TechError') {
      if (e.code === 'forbidden' || e.code === 'not_technician') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    // an exposed client error (a registry code with a 4xx status, e.g. 401 HANDOFF_TOKEN_INVALID) goes to the platform filter as it is
    if (e?.expose === true && Number(e?.status) >= 400 && Number(e?.status) < 500 && typeof e?.code === 'string') throw e;
    throw new InternalServerErrorException(e?.message || String(e));
  }
}

@ListQueries(TechControllerListQueries)
@Controller('tech')
export class TechController {
  constructor(private readonly svc: TechService, private readonly enroll: MembershipEnrollService) {}

  // The ticket customer's membership (plan/status/benefits + remaining credits) so the tech sees what's covered before
  // marking Service Done. Tenant-scoped, and only for a ticket assigned to the caller.
  @RequirePermission('tech.ticket.view') @Get('tickets/:id/membership') ticketMembership(@Req() r: any, @Param('id') id: string) {
    // only the caller's own ticket (403 otherwise), resolved from the queue ticket id the app sends to its real ticket
    return run(async () => { const c = ctxFrom(r); const real = await this.svc.ownedRealTicketId(c, id); return real ? this.enroll.membershipForTicket(c, real) : { hasMembership: false, membership: null, benefits: [] }; });
  }

  @RequirePermission('tech.dashboard.view') @Get() dashboard(@Req() r: any) { return run(() => this.svc.getDashboard(ctxFrom(r))); }
  @RequirePermission('tech.earnings.view') @Get('earnings') earnings(@Req() r: any) { return run(() => this.svc.getEarnings(ctxFrom(r))); }
  @RequirePermission('tech.payroll.view') @Get('payroll') payroll(@Req() r: any) { return run(() => this.svc.getPayroll(ctxFrom(r))); }
  // Payroll wave 2 (§89 payout history, §152 questions about an earning) — the technician's OWN rows only
  @RequirePermission('tech.payroll.view') @Get('payroll/payouts') payrollPayouts(@Req() r: any): Promise<TechPayout[]> { return run(() => this.svc.getPayouts(ctxFrom(r)) as Promise<TechPayout[]>); }
  @RequirePermission('tech.payroll.view') @Get('payroll/inquiries') payrollInquiries(@Req() r: any): Promise<TechPayrollInquiry[]> { return run(() => this.svc.getPayrollInquiries(ctxFrom(r)) as Promise<TechPayrollInquiry[]>); }
  @RequirePermission('tech.payroll.view') @Post('payroll/inquiries') payrollInquiry(@Req() r: any, @Body(ValidatedBody(T_PAYROLL_INQUIRY_BODY, { strict: true })) b: TechPayrollInquiryRequest): Promise<TechPayrollInquiry> { return run(() => this.svc.createPayrollInquiry(ctxFrom(r), b) as Promise<TechPayrollInquiry>); }
  // Weekly Paycheck (Oct 21 2026, §15): the technician's OWN statements; confirming / disputing the cash handed to her
  @RequirePermission('tech.payroll.view') @Get('payroll/statements') myPayStatements(@Req() r: any): Promise<TechPayStatements> { return run(() => this.svc.getPayStatements(ctxFrom(r)) as Promise<TechPayStatements>); }
  @RequirePermission('tech.payroll.view') @Get('payroll/statements/:statementId') myPayStatement(@Req() r: any, @Param('statementId') sid: string): Promise<TechPayStatementDetail> { return run(() => this.svc.getPayStatement(ctxFrom(r), sid) as Promise<TechPayStatementDetail>); }
  // 17.5 (Oct 27 2026): my approved week's pay stub — a PDF download from the locked statement (never cached; audited)
  @RequirePermission('tech.payroll.view') @Get('payroll/statements/:statementId/pay-stub.pdf') async myPayStub(@Req() r: any, @Param('statementId') sid: string, @Query() q: PayStubQuery, @Res({ passthrough: true }) res: { set(h: Record<string, string>): unknown }): Promise<StreamableFile> {
    const f = await run(() => this.svc.getPayStub(ctxFrom(r), sid, typeof q?.lang === 'string' ? q.lang : null));
    res.set(payStubHeaders(f));
    return new StreamableFile(f.buffer);   // the bytes as they are (a Buffer returned bare is JSON-serialised by Nest)
  }
  @RequirePermission('tech.payroll.view') @Post('payroll/cash-payouts/:payoutId/acknowledge') @Idempotent() ackCash(@Req() r: any, @Param('payoutId') id: string, @Body(ValidatedBody(T_CASH_ACK_BODY, { strict: true })) b: PaycheckAckRequest): Promise<PaycheckPayout> { return run(() => this.svc.acknowledgeCash(ctxFrom(r), id, b?.handoffCode ?? null) as Promise<PaycheckPayout>); }
  @RequirePermission('tech.payroll.view') @Post('payroll/cash-payouts/:payoutId/dispute') disputeCash(@Req() r: any, @Param('payoutId') id: string, @Body(ValidatedBody(T_CASH_DISPUTE_BODY, { strict: true })) b: PaycheckDisputeRequest): Promise<PaycheckPayout> { return run(() => this.svc.disputeCash(ctxFrom(r), id, b.reason) as Promise<PaycheckPayout>); }
  @RequirePermission('tech.schedule.view') @Get('schedule') schedule(@Req() r: any, @Query() q: any) { return run(() => this.svc.getSchedule(ctxFrom(r), q?.date)); }
  @RequirePermission('tech.earnings.view') @Get('earnings/canonical') earningsCanonical(@Req() r: any, @Query() q: any) { return run(() => this.svc.getCanonicalEarnings(ctxFrom(r), q?.period, q?.date, q?.dateTo, q?.payPeriodId)); }
  @RequirePermission('tech.earnings.view') @Get('earnings/receipt/:ticketId') earningsReceipt(@Req() r: any, @Param('ticketId') ticketId: string) { return run(() => this.svc.getTicketEarningsReceipt(ctxFrom(r), ticketId)); }
  @RequirePermission('tech.ticket.view') @Get('service-history') serviceHistory(@Req() r: any, @Query('service') service?: string) { return run(() => this.svc.getServiceHistory(ctxFrom(r), service)); }
  @RequirePermission('tech.ticket.view') @Get('tickets/:id') ticket(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getTicketDetail(ctxFrom(r), id)); }
  @RequirePermission('tech.ticket.accept') @Post('tickets/:id/accept') accept(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_ACCEPT_BODY, { strict: true })) b: any) { return run(() => this.svc.accept(ctxFrom(r), id, typeof b?.expectedVersion === 'number' ? b.expectedVersion : undefined)); }
  @RequirePermission('tech.ticket.decline') @Post('tickets/:id/decline') decline(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_DECLINE_BODY, { strict: true })) b: any) { return run(() => this.svc.decline(ctxFrom(r), id, { reason: String(b?.reason ?? ''), reasonCode: b?.reasonCode ? String(b.reasonCode) : null })); }
  @RequirePermission('tech.service.start') @Post('tickets/:id/start-service') @Idempotent() start(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.startService(ctxFrom(r), id)); }
  @RequirePermission('tech.service.pause') @Post('tickets/:id/pause') pause(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.pauseService(ctxFrom(r), id)); }
  @RequirePermission('tech.service.pause') @Post('tickets/:id/resume') resume(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.resumeService(ctxFrom(r), id)); }
  @RequirePermission('tech.service.complete') @Post('tickets/:id/service-done') @Idempotent() done(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_DONE_BODY, { strict: true })) b: any) { return run(() => this.svc.serviceDone(ctxFrom(r), id, { notes: b?.notes })); }
  @RequirePermission('tech.ticket.view') @Get('tickets') tickets(@Req() r: any) { return run(() => this.svc.getTickets(ctxFrom(r))); }
  @RequirePermission('tech.notifications.manage') @Get('notifications') notifications(@Req() r: any) { return run(() => this.svc.notifications(ctxFrom(r))); }
  @RequirePermission('tech.notifications.manage') @Post('notifications/read') markRead(@Req() r: any, @Body(ValidatedBody(T_READ_BODY, { strict: true })) b: any) { return run(() => this.svc.markNotificationsRead(ctxFrom(r), Array.isArray(b?.ids) ? b.ids.map(String) : 'all')); }
  @RequirePermission('tech.dashboard.view') @Get('settings') techSettings(@Req() r: any) { return run(() => this.svc.settings(ctxFrom(r))); }
  @RequirePermission('tech.ticket.view') @Get('tickets/:id/edit-options') editOptions(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.editOptions(ctxFrom(r), id)); }
  @RequirePermission('tech.ticket.edit_lines') @Post('tickets/:id/service-lines') addServiceLine(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_ADD_LINE_BODY, { strict: true })) b: any) { return run(() => this.svc.addServiceLine(ctxFrom(r), id, b || {})); }
  @RequirePermission('tech.ticket.edit_lines') @Patch('tickets/:id/service-lines/:lineId') patchServiceLine(@Req() r: any, @Param('id') id: string, @Param('lineId') lineId: string, @Body(ValidatedBody(T_PATCH_LINE_BODY, { strict: true })) b: any) { return run(() => this.svc.patchServiceLine(ctxFrom(r), id, lineId, b || {})); }
  @RequirePermission('tech.ticket.edit_lines') @Delete('tickets/:id/service-lines/:lineId') removeServiceLine(@Req() r: any, @Param('id') id: string, @Param('lineId') lineId: string, @Body(ValidatedBody(T_REMOVE_LINE_BODY, { strict: true })) b: any) { return run(() => this.svc.removeServiceLine(ctxFrom(r), id, lineId, b?.reason)); }
  @RequirePermission('tech.ticket.edit_lines') @Post('tickets/:id/change-requests') createChangeRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_CHANGE_REQUEST_BODY, { strict: true })) b: any) {
    return run(() => b?.type === 'remove_line'
      ? this.svc.removeServiceLine(ctxFrom(r), id, String(b?.lineId ?? ''), b?.reason)
      : this.svc.changeServiceLine(ctxFrom(r), id, String(b?.lineId ?? ''), String(b?.newServiceId ?? ''), b?.reason));
  }
  @RequirePermission('tech.ticket.view') @Get('tickets/:id/change-requests') listChangeRequests(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.listChangeRequests(ctxFrom(r), id)); }
  @RequirePermission('tech.ticket.add_addon') @Post('tickets/:id/add-addon') addAddOn(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_ADD_ON_BODY, { strict: true })) b: any) { return run(() => this.svc.addAddOn(ctxFrom(r), id, String(b?.serviceId ?? ''))); }
  @RequirePermission('tech.service.note_add') @Post('tickets/:id/notes') addNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.addNote(ctxFrom(r), id, { note: b?.note, visibility: b?.visibility })); }
  @RequirePermission('tech.ticket.cancel_request') @Post('tickets/:id/request-cancel') reqCancel(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_CANCEL_REQUEST_BODY, { strict: true })) b: any) { return run(() => this.svc.requestCancel(ctxFrom(r), id, { reason: b?.reason })); }
  @RequirePermission('tech.dashboard.view') @Get('queue/state') queueState(@Req() r: any) { return run(() => this.svc.getQueue(ctxFrom(r))); }
  @RequirePermission('tech.dashboard.view') @Get('more/state') moreState(@Req() r: any) { return run(() => this.svc.getMore(ctxFrom(r))); }
  @RequirePermission('tech.dashboard.view') @Get('skills') skills(@Req() r: any) { return run(() => this.svc.getSkills(ctxFrom(r))); }
  @RequirePermission('tech.dashboard.view') @Get('working-hours') workingHours(@Req() r: any) { return run(() => this.svc.getWorkingHours(ctxFrom(r))); }
  @RequirePermission('tech.profile.edit') @Post('skills/change-request') requestSkillChange(@Req() r: any, @Body(ValidatedBody(T_SKILL_BODY, { strict: true })) b: any) { return run(() => this.svc.requestSkillChange(ctxFrom(r), b ?? {})); }
  @RequirePermission('tech.profile.edit') @Post('skills/change-request/:id') updateSkillChange(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_SKILL_BODY, { strict: true })) b: any) { return run(() => this.svc.updateSkillChange(ctxFrom(r), id, b ?? {})); }
  
  @RequirePermission('tech.profile.edit') @Post('skills/upload-document')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.skillDocument.maxBytes } }))
  async uploadSkillDocument(@Req() r: any, @UploadedFile() file: any) {
    return run(async () => {
      const ctx = ctxFrom(r);
      if (!ctx.userId) throw new ForbiddenException('Not logged in');
      if (!file?.buffer) throw withCode(new BadRequestException('No file provided'), 'FILE_REQUIRED');
      // Sep 2026 merge: the bytes decide the type — an image (sniffed) or a PDF (%PDF- header); anything else, including a
      // renamed .html/.svg, is refused, and the extension comes from the sniffed type, never the client's filename.
      const buf: Buffer = file.buffer;
      const img: any = validateImageUpload(buf, 'photo');
      const isPdf = buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
      if (!img.ok && !isPdf) throw withCode(new BadRequestException('Upload a photo (JPEG, PNG, WebP) or a PDF.'), 'UPLOAD_TYPE_INVALID');
      // Phase 12 (#34): the skill-document policy (photo or PDF; photos lose their EXIF) and a key under the salon — was
      // `skill-docs/<user>-…` with no tenant segment
      const up = await acceptUpload(UPLOAD_POLICIES.skillDocument, { bytes: buf, filename: file.originalname, declaredType: file.mimetype, tenantId: ctx.tenantId || null, quotaReserved: true });
      const key = uploadObjectKey({ tenantId: ctx.tenantId || null, area: 'skill-docs', owner: [ctx.userId], ext: up.ext });
      const storage = makeMediaStorage();
      const res = await storage.put(key, up.bytes);
      return { url: res.url, key };
    });
  }
  @RequirePermission('tech.dashboard.view') @Get('skills/change-requests') mySkillRequests(@Req() r: any) { return run(() => this.svc.mySkillChangeRequests(ctxFrom(r))); }
  @RequirePermission('technicians.edit') @Get('skills/change-requests/pending') pendingSkillRequests(@Req() r: any) { return run(() => this.svc.pendingSkillChangeRequests(ctxFrom(r))); }
  @RequirePermission('technicians.edit') @Post('skills/change-requests/:id/decision') decideSkillRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_SKILL_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.decideSkillChange(ctxFrom(r), id, b?.decision, typeof b?.reviewNotes === 'string' ? b.reviewNotes : null)); }
  @RequirePermission('tech.timeclock.punch') @Get('time-clock') myClock(@Req() r: any) { return run(() => this.svc.myClock(ctxFrom(r))); }
  @RequirePermission('tech.timeclock.punch') @Post('time-clock/clock-in') clockIn(@Req() r: any) { return run(() => this.svc.clockIn(ctxFrom(r))); }
  @RequirePermission('tech.timeclock.punch') @Post('time-clock/clock-out') clockOut(@Req() r: any) { return run(() => this.svc.clockOut(ctxFrom(r))); }
  // No `managerOverride` body flag is read here (Oct 12 2026 merge, workforce audit P0 #7): a technician cannot approve their own break.
  @RequirePermission('tech.break.start') @Post('status/start-break') startBreak(@Req() r: any) { return run(() => this.svc.setBreakState(ctxFrom(r), true)); }
  @RequirePermission('tech.break.end') @Post('status/end-break') endBreak(@Req() r: any) { return run(() => this.svc.setBreakState(ctxFrom(r), false)); }
  @RequirePermission('tech.break.end') @Post('status/available') available(@Req() r: any) { return run(() => this.svc.setBreakState(ctxFrom(r), false)); }
  @RequirePermission('tech.break.start') @Post('status/break') brk(@Req() r: any) { return run(() => this.svc.toggleBreak(ctxFrom(r))); }
  @RequirePermission('tech.dashboard.view') @Post('help/message') sendMessageToManager(@Req() r: any, @Body(ValidatedBody(T_MESSAGE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.sendMessageToManager(ctxFrom(r), { topic: String(b?.topic || 'General Question'), message: String(b?.message || '') }));
  }
  // Constitution 5 Step 8 audit (Oct 4 2026): this is the POS shell's inbox of technicians' messages to the manager (pos-web
  // POSLayout reads and resolves it; tech-web never calls it). Unkeyed, any technician could read every colleague's
  // message to management and resolve it. Keyed for the POS roles (owner, manager, front desk, reception).
  @RequirePermission('pos.technicians.view') @Get('manager-messages') getManagerMessages(@Req() r: any) {
    return run(() => this.svc.getManagerMessages(ctxFrom(r)));
  }
  @RequirePermission('pos.technicians.view') @Patch('manager-messages/:id/resolve') resolveManagerMessage(@Req() r: any, @Param('id') id: string) {
    return run(() => this.svc.resolveManagerMessage(ctxFrom(r), id));
  }
}
