// billing.controller.ts — Super-Admin Billing & Subscriptions HTTP surface. Behind SuperAdminGuard: tenant POS users
// (and everyone else) cannot read or mutate platform billing here. GET returns { rows, overview } over the real
// subscription / payment-config / hardware-payoff tables; PATCH changes a tenant's plan and/or subscription status.
import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminBillingService, TenantNotFoundError } from './billing.service';
import type { AuditActor } from './billing.repository';
import { BILL_ADD_ON_BODY, BILL_APPLY_CREDIT_BODY, BILL_CANCEL_BODY, BILL_CHANGE_PLAN_BODY, BILL_CREATE_INVOICE_BODY, BILL_DISCOUNT_BODY, BILL_EXPORT_BODY, BILL_EXPORT_JOB_BODY, BILL_EXTEND_TRIAL_BODY, BILL_PAUSE_BODY, BILL_PROCESS_JOBS_BODY, BILL_RESUME_BODY, BILL_RETRY_PAYMENT_BODY, BILL_REVIEW_REQUEST_BODY, BILL_SUBSCRIPTION_BODY, BILL_WEBHOOK_INGEST_BODY } from '../request-schemas-billing';   // BUILD_PLAN Phase 12 (#17)

function actorFrom(req: any): AuditActor { return { userId: req?.ctx?.userId, role: req?.ctx?.role }; }

@UseGuards(SuperAdminGuard)
@Controller('super-admin/billing')
export class SuperAdminBillingController {
  constructor(private readonly svc: SuperAdminBillingService) {}

  @Get()
  all() { return this.svc.getBilling(); }

  @Get('subscriptions-overview')
  async subscriptionsOverview() { return { ok: true, ...(await this.svc.subscriptionsOverview()) }; }

  @Post('invoices')
  async createInvoice(@Body(ValidatedBody(BILL_CREATE_INVOICE_BODY)) body: any, @Req() req: any) {
    try { return { ok: true, ...(await this.svc.createInvoice(actorFrom(req), body ?? {})) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Invalid invoice', HttpStatus.BAD_REQUEST); }
  }

  @Post('invoices/:invoiceNumber/finalize')
  async finalizeInvoice(@Param('invoiceNumber') invoiceNumber: string, @Req() req: any) {
    try { return { ok: true, ...(await this.svc.finalizeInvoice(actorFrom(req), invoiceNumber)) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot finalize', HttpStatus.BAD_REQUEST); }
  }

  @Post('credits/apply')
  async applyCredit(@Body(ValidatedBody(BILL_APPLY_CREDIT_BODY)) body: any, @Req() req: any) {
    try { return { ok: true, ...(await this.svc.applyCredit(actorFrom(req), body ?? {})) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot apply credit', HttpStatus.BAD_REQUEST); }
  }

  @Post('payments/retry')
  async retryPayment(@Body(ValidatedBody(BILL_RETRY_PAYMENT_BODY)) body: any, @Req() req: any) {
    try { return { ok: true, ...(await this.svc.retryPayment(actorFrom(req), body ?? {})) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot retry payment', HttpStatus.BAD_REQUEST); }
  }

  @Post('subscriptions/change-plan')
  async changePlan(@Body(ValidatedBody(BILL_CHANGE_PLAN_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.changePlan(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot change plan', HttpStatus.BAD_REQUEST); }
  }

  @Post('subscriptions/add-ons')
  async changeAddOn(@Body(ValidatedBody(BILL_ADD_ON_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.changeAddOn(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot change add-on', HttpStatus.BAD_REQUEST); }
  }

  @Post('subscriptions/extend-trial')
  async extendTrial(@Body(ValidatedBody(BILL_EXTEND_TRIAL_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.extendTrial(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot extend trial', HttpStatus.BAD_REQUEST); }
  }

  @Post('discounts')
  async createDiscount(@Body(ValidatedBody(BILL_DISCOUNT_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.createDiscount(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot create discount', HttpStatus.BAD_REQUEST); }
  }

  @Post('subscriptions/pause')
  async pause(@Body(ValidatedBody(BILL_PAUSE_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.pauseSubscription(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot pause', HttpStatus.BAD_REQUEST); }
  }

  @Post('subscriptions/resume')
  async resume(@Body(ValidatedBody(BILL_RESUME_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.resumeSubscription(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot resume', HttpStatus.BAD_REQUEST); }
  }

  @Post('subscriptions/cancel')
  async cancel(@Body(ValidatedBody(BILL_CANCEL_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.cancelSubscription(actorFrom(req), body ?? {}); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot cancel', HttpStatus.BAD_REQUEST); }
  }

  @Get('tenants/:tenantId/profile')
  async tenantProfile(@Param('tenantId') tenantId: string, @Req() req: any) {
    try { return { ok: true, profile: await this.svc.tenantBillingProfile(actorFrom(req), tenantId) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot load billing profile', HttpStatus.BAD_REQUEST); }
  }

  @Post('exports/jobs')
  async createExportJob(@Body(ValidatedBody(BILL_EXPORT_JOB_BODY)) body: any, @Req() req: any) {
    // BUILD_PLAN Phase 12: the job is also an operation of the ONE async contract (GET /super-admin/operations/:id)
    try { const j = await this.svc.createExportJob(actorFrom(req), body ?? {}); return { ok: true, ...j, operationId: j.jobId, statusUrl: `/super-admin/operations/${j.jobId}` }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot queue export', HttpStatus.BAD_REQUEST); }
  }

  @Post('exports/jobs/process')
  async processExportJobs(@Body(ValidatedBody(BILL_PROCESS_JOBS_BODY)) body: any) { return { ok: true, ...(await this.svc.processPendingExportJobs(body?.limit)) }; }

  @Get('exports/jobs/:token')
  async getExportJob(@Param('token') token: string) { const job = await this.svc.getExportJob(token); if (!job) throw new HttpException('Export not found', HttpStatus.NOT_FOUND); return { ok: true, job }; }

  @Get('exports/jobs/:token/download')
  async downloadExportJob(@Param('token') token: string, @Req() req: any) {
    try { return { ok: true, ...(await this.svc.downloadExportJob(actorFrom(req), token)) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot download', HttpStatus.GONE); }
  }

  @Post('exports')
  async exportReport(@Body(ValidatedBody(BILL_EXPORT_BODY)) body: any, @Req() req: any) {
    try { return { ok: true, ...(await this.svc.exportReport(actorFrom(req), body ?? {})) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot export', HttpStatus.BAD_REQUEST); }
  }

  @Post('webhooks/ingest')
  async ingestWebhook(@Body(ValidatedBody(BILL_WEBHOOK_INGEST_BODY)) body: any) {
    try { return { ok: true, ...(await this.svc.ingestWebhook(body ?? {})) }; }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot ingest webhook', HttpStatus.BAD_REQUEST); }
  }

  @Post('change-requests/:changeId/review')
  async reviewRequest(@Param('changeId') changeId: string, @Body(ValidatedBody(BILL_REVIEW_REQUEST_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.reviewRequest(actorFrom(req), { changeId, decision: body?.decision, note: body?.note }); }
    catch (e: any) { throw new HttpException(e?.message || 'Cannot review request', HttpStatus.BAD_REQUEST); }
  }

  @Patch(':tenantId/subscription')
  async updateSubscription(@Param('tenantId') tenantId: string, @Body(ValidatedBody(BILL_SUBSCRIPTION_BODY)) body: any, @Req() req: any) {
    try {
      return await this.svc.updateSubscription(tenantId, body ?? {}, actorFrom(req));
    } catch (e: any) {
      if (e instanceof TenantNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
      throw new HttpException(e?.message || 'Invalid subscription update', HttpStatus.BAD_REQUEST);
    }
  }
}
