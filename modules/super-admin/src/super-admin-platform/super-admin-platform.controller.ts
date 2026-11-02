import { SuperAdminGuard, RequirePermission, RequireStepUp, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SecurityEvents } from '@aipowersalon/security-center';
// super-admin-platform.controller.ts — SuperAdminGuard-only routes for applications, leads, hardware, support access.
import { BadRequestException, Body, Controller, Delete, Get, HttpException, Inject, NotFoundException, OnModuleInit, Optional, Param, Post, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PLATFORM_ADMIN_INVITE, platformApprovalsFrom, registerOnce, pendingAnswer } from '../super-admin-platform-staff/platform-admin-approvals';   // Security Deep Scan §134
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminPlatformService, PlatformError, type AdminCtx } from './super-admin-platform.service';
import { CustomerSalonsService, SalonSearchError } from '@aipowersalon/customers';
import { SuperAdminPlatformControllerListQueries } from './super-admin-platform.list-queries';
import { PL_ACCESS_DECISION_BODY, PL_ACCESS_REQUEST_BODY, PL_AI_FEATURE_BODY, PL_AI_PACKAGE_BODY, PL_ALLOCATE_DEVICE_BODY, PL_APPLICATION_BODY, PL_APP_ASSIGN_BODY, PL_APP_CONTACT_BODY, PL_APP_CONVERTED_BODY, PL_APP_FLAG_BODY, PL_APP_FOLLOW_UP_BODY, PL_APP_PRIORITY_BODY, PL_APP_STATUS_BODY, PL_BRANCH_HOURS_BODY, PL_BRANCH_MANAGER_BODY, PL_BRANCH_STATUS_BODY, PL_BRANCH_TRANSFER_BODY, PL_BULK_BRANCH_STATUS_BODY, PL_CREATE_BRANCH_BODY, PL_CREATE_SUPER_ADMIN_BODY, PL_HARDWARE_CREATE_BODY, PL_HARDWARE_UPDATE_BODY, PL_INVITATION_BODY, PL_INVITE_USER_BODY, PL_LEAD_BODY, PL_MERGE_CATEGORIES_BODY, PL_MERGE_CUSTOMERS_BODY, PL_NOTE_BODY, PL_PRIVACY_ADVANCE_BODY, PL_PRIVACY_REQUEST_BODY, PL_REASON_BODY, PL_RESET_PASSWORD_BODY, PL_RESEND_INVITE_BODY, PL_SCHEDULED_REPORT_BODY, PL_STATUS_BODY, PL_SUPPORT_ACTION_BODY, PL_SUPPORT_CUSTOMER_ACTION_BODY, PL_SUPPORT_EXTEND_BODY, PL_SUPPORT_START_BODY, PL_TEXT_BODY, PL_TOGGLE_BODY, PL_USAGE_LIMIT_BODY, PL_USER_BRANCH_BODY, PL_USER_MFA_BODY, PL_USER_ROLE_BODY } from '../request-schemas-platform';   // BUILD_PLAN Phase 12 (#17)

// permissions come from the SIGNED session only (Constitution 7 §81: elevated support checks them)
function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined, permissions: Array.isArray(req?.ctx?.permissions) ? req.ctx.permissions : [] }; }
export async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof PlatformError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'rate_limited') throw new HttpException(e.message, 429);
      if (e.code === 'forbidden') throw new ForbiddenException(e.reason === 'STEP_UP_REQUIRED' || e.reason === 'PLATFORM_RANK_REQUIRED' ? { code: e.reason, message: e.message } : e.message);
      if (e.code === 'conflict') throw new HttpException({ code: e.reason ?? 'CONFLICT', message: e.message }, 409);   // BUILD_PLAN Phase 9: LAST_OWNER
      // Security Deep Scan C3: a retired route says so (410) instead of failing in a way a screen cannot explain
      if (e.code === 'gone') throw new HttpException({ code: 'ENDPOINT_RETIRED', message: e.message }, 410);
      // C2: the account holder could not be reached — nothing was changed, and no password is ever returned instead
      if (e.code === 'unavailable') throw new HttpException({ code: e.reason === 'DELIVERY_FAILED' ? 'DELIVERY_FAILED' : 'CANNOT_DELIVER', message: e.message }, e.reason === 'DELIVERY_FAILED' ? 502 : 422);
      if (e.reason === 'REASON_REQUIRED') throw new BadRequestException({ code: 'REASON_REQUIRED', message: e.message });
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminPlatformControllerListQueries)
@Controller('super-admin/platform')
export class SuperAdminPlatformController {
  constructor(private readonly svc: SuperAdminPlatformService, private readonly salons: CustomerSalonsService, @Optional() private readonly securityEvents?: SecurityEvents, @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef | null) {}

  /** §134: inviting a PLATFORM administrator is an approvable action (policy default off). On approval the invitation is
   *  created for the requester within the approver's permissions (grant ceiling applies). Salon-role invitations are never routed through it. */
  onModuleInit(): void {
    registerOnce(platformApprovalsFrom(this.moduleRef), PLATFORM_ADMIN_INVITE, 'Invite a platform administrator', async (p: any, actor) =>
      run(() => this.svc.createInvitation({ userId: actor.userId ?? undefined, permissions: [...actor.permissions] } as AdminCtx, p)));
  }

  @Get('state') state() { return run(() => this.svc.state()); }

  @Get('applications') applications(@Query() q: any) { return run(() => this.svc.applications({ status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 25 })); }
  @Post('applications') createApplication(@Req() r: any, @Body(ValidatedBody(PL_APPLICATION_BODY, { strict: true })) b: any) { return run(() => this.svc.createApplication(ctxFrom(r), b)); }
  @Get('applications/metrics') @RequirePermission('super_admin.applications.view') appMetrics(@Req() r: any) { return run(() => this.svc.applicationMetrics(ctxFrom(r))); }
  @Post('applications/:id/status') @RequirePermission('super_admin.applications.update_status') appStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_APP_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.setApplicationStatus(ctxFrom(r), id, b?.status, { note: b?.note, reason: b?.reason })); }
  @Post('applications/:id/assign') @RequirePermission('super_admin.applications.assign') appAssign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_APP_ASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.assignApplication(ctxFrom(r), id, b?.userId ?? null)); }
  @Post('applications/:id/priority') @RequirePermission('super_admin.applications.review') appPriority(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_APP_PRIORITY_BODY, { strict: true })) b: any) { return run(() => this.svc.setApplicationPriority(ctxFrom(r), id, String(b?.priority || ''))); }
  @Post('applications/:id/follow-up') @RequirePermission('super_admin.applications.review') appFollowUp(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_APP_FOLLOW_UP_BODY, { strict: true })) b: any) { return run(() => this.svc.scheduleApplicationFollowUp(ctxFrom(r), id, b?.at ?? null)); }
  @Post('applications/:id/contact-log') @RequirePermission('super_admin.applications.contact') appContact(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_APP_CONTACT_BODY, { strict: true })) b: any) { return run(() => this.svc.logApplicationContact(ctxFrom(r), id, { channel: b?.channel, note: b?.note })); }
  @Post('applications/:id/approve') @RequirePermission('super_admin.applications.approve') appApprove(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.approveApplication(ctxFrom(r), id, { note: b?.note })); }
  @Post('applications/:id/reject') @RequirePermission('super_admin.applications.reject') appReject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.rejectApplication(ctxFrom(r), id, { reason: b?.reason })); }
  @Post('applications/:id/duplicate') @RequirePermission('super_admin.applications.review') appDuplicate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.markApplicationDuplicate(ctxFrom(r), id, { reason: b?.reason })); }
  @Post('applications/:id/spam') @RequirePermission('super_admin.applications.review') appSpam(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.markApplicationSpam(ctxFrom(r), id, { reason: b?.reason })); }
  @Post('applications/:id/archive') @RequirePermission('super_admin.applications.archive') appArchive(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.archiveApplication(ctxFrom(r), id)); }
  @Post('applications/:id/convert-to-onboarding') @RequirePermission('super_admin.applications.convert') appConvertOnboarding(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.convertApplicationToOnboarding(ctxFrom(r), id)); }
  @Get('applications/:id/ein') @RequirePermission('super_admin.applications.view_sensitive') appEin(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.revealApplicationEin(ctxFrom(r), id)); }
  @Post('applications/:id/notes') appNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_TEXT_BODY, { strict: true })) b: any) { return run(() => this.svc.noteApplication(ctxFrom(r), id, { text: b?.text })); }
  @Post('applications/:id/converted') appConverted(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_APP_CONVERTED_BODY, { strict: true })) b: any) { return run(() => this.svc.markApplicationConverted(ctxFrom(r), id, b?.tenantId)); }

  @Get('leads') leads(@Query() q: any) { return run(() => this.svc.leads({ status: q?.status, kind: q?.kind, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 25 })); }
  @Post('leads') createLead(@Req() r: any, @Body(ValidatedBody(PL_LEAD_BODY, { strict: true })) b: any) { return run(() => this.svc.createLead(ctxFrom(r), b)); }
  @Post('leads/:id/status') leadStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.setLeadStatus(ctxFrom(r), id, b?.status)); }
  @Post('leads/:id/convert') leadConvert(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.convertLead(ctxFrom(r), id)); }

  @Get('hardware') hardware(@Query() q: any) { return run(() => this.svc.hardware({ status: q?.status, search: q?.search, tenantId: q?.tenantId, page: +q?.page || 1, pageSize: +q?.pageSize || 25 })); }
  @Post('hardware') createHardware(@Req() r: any, @Body(ValidatedBody(PL_HARDWARE_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createHardware(ctxFrom(r), b)); }
  @Post('hardware/:id') updateHardware(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_HARDWARE_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateHardware(ctxFrom(r), id, b)); }

  @Get('audit-logs') auditLogs(@Query() q: any) { return run(() => this.svc.auditLogs({ tenantId: q?.tenantId, userId: q?.userId, action: q?.action, entityType: q?.entityType, from: q?.from, to: q?.to, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('payment-gateways') paymentGateways() { return run(() => this.svc.paymentGateways()); }
  @Get('payment-gateways/state') paymentGatewaysState(@Query() q: any) { return run(() => this.svc.paymentGatewaysState(q || {})); }
  @AsyncExport({ kind: 'super-admin.platform.payment-gateways-export' }) @Get('payment-gateways/export') paymentGatewaysExport(@Query() q: any) { return run(() => this.svc.paymentGatewaysExport(q || {})); }
  @Get('payment-gateways/analytics/status-breakdown') pgStatusBreakdown(@Query() q: any) { return run(async () => (await this.svc.paymentGatewaysState(q || {})).analytics.statusBreakdown); }
  @Get('payment-gateways/analytics/top-processors') pgTopProcessors(@Query() q: any) { return run(async () => (await this.svc.paymentGatewaysState(q || {})).analytics.topProcessors); }
  @Get('payment-gateways/recent-events') pgRecentEvents(@Query() q: any) { return run(async () => (await this.svc.paymentGatewaysState(q || {})).analytics.recentEvents); }
  @Get('payment-gateways/recent-activity') pgRecentActivity(@Query() q: any) { return run(async () => (await this.svc.paymentGatewaysState(q || {})).analytics.recentActivity); }

  @Get('ai-packages') aiPackages() { return run(() => this.svc.aiPackages()); }
  @Post('ai-packages/:tenantId') setAiPackage(@Req() r: any, @Param('tenantId') tid: string, @Body(ValidatedBody(PL_AI_PACKAGE_BODY, { strict: true })) b: any) { return run(() => this.svc.setAiPackage(ctxFrom(r), tid, b?.package)); }
  @Post('ai-packages/:tenantId/features') setAiFeature(@Req() r: any, @Param('tenantId') tid: string, @Body(ValidatedBody(PL_AI_FEATURE_BODY, { strict: true })) b: any) { return run(() => this.svc.setAiFeature(ctxFrom(r), tid, String(b?.feature ?? ''), b?.enabled === undefined ? undefined : b.enabled)); }
  @Get('usage-limits') usageLimits() { return run(() => this.svc.usageLimits()); }
  @Post('usage-limits/:tenantId') setUsageLimit(@Req() r: any, @Param('tenantId') tid: string, @Body(ValidatedBody(PL_USAGE_LIMIT_BODY, { strict: true })) b: any) { return run(() => this.svc.setUsageLimit(ctxFrom(r), tid, b?.metric, b?.limitValue)); }

  @Get('reports') reports() { return run(() => this.svc.reports()); }
  @Get('tenant-performance') tenantPerformance(@Query() q: any) { return run(() => this.svc.tenantPerformanceReport(q || {})); }
  @Get('top-performing-tenants') topPerforming(@Query() q: any) { return run(() => this.svc.topPerformingTenants(+q?.limit || 5)); }
  @Get('users') users(@Query() q: any) { return run(() => this.svc.users({ role: q?.role, search: q?.search, tenantId: q?.tenantId, branchId: q?.branchId, status: q?.status, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('users-dashboard') usersDashboard(@Query() q: any) { return run(() => this.svc.usersDashboard({ role: q?.role, search: q?.search })); }
  @Get('branches-dashboard') branchesDashboard() { return run(() => this.svc.branchesDashboard()); }
  @Get('branches') branchesDirectory(@Query() q: any) { return run(() => this.svc.branchesDirectory(q || {})); }
  @AsyncExport({ kind: 'super-admin.platform.branches-export' }) @Get('branches/export') branchesExport(@Req() r: any, @Query() q: any) { return run(() => this.svc.branchesExport(ctxFrom(r), q || {})); }
  @Post('branches/bulk-status') bulkBranchStatus(@Req() r: any, @Body(ValidatedBody(PL_BULK_BRANCH_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.bulkBranchStatus(ctxFrom(r), b)); }
  @Post('branches') createBranch(@Req() r: any, @Body(ValidatedBody(PL_CREATE_BRANCH_BODY, { strict: true })) b: any) { return run(() => this.svc.createBranch(ctxFrom(r), b)); }
  @Post('branches/:id/status') changeBranchStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_BRANCH_STATUS_BODY, { strict: true })) b: any) { return run(() => this.svc.changeBranchStatus(ctxFrom(r), id, b)); }
  @Get('branches/:id/assignable-managers') assignableManagers(@Param('id') id: string) { return run(() => this.svc.assignableManagers(id)); }
  @Post('branches/:id/manager') assignBranchManager(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_BRANCH_MANAGER_BODY, { strict: true })) b: any) { return run(() => this.svc.assignBranchManager(ctxFrom(r), id, b)); }
  @Get('branches/:id/transfer-options') branchTransferOptions(@Param('id') id: string) { return run(() => this.svc.branchTransferOptions(id)); }
  @Get('branches/:id/transfer-preflight') branchTransferPreflight(@Param('id') id: string, @Query() q: any) { return run(() => this.svc.branchTransferPreflight(id, String(q?.destTenantId || ''))); }
  @Post('branches/:id/transfer') requestBranchTransfer(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_BRANCH_TRANSFER_BODY, { strict: true })) b: any) { return run(() => this.svc.requestBranchTransfer(ctxFrom(r), id, b)); }
  @Get('branches/:id/hours') branchHours(@Param('id') id: string) { return run(() => this.svc.branchHours(id)); }
  @Post('branches/:id/hours') setBranchHours(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_BRANCH_HOURS_BODY, { strict: true })) b: any) { return run(() => this.svc.setBranchHours(ctxFrom(r), id, b)); }
  @Get('branches/:id/devices') branchDevices(@Param('id') id: string) { return run(() => this.svc.branchDevices(id)); }
  @Post('branches/:id/devices/allocate') allocateDevice(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_ALLOCATE_DEVICE_BODY, { strict: true })) b: any) { return run(() => this.svc.allocateDevice(ctxFrom(r), id, b)); }
  @Get('services') platformServices(@Query() q: any) { return run(() => this.svc.platformServices({ category: q?.category, status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('products') platformProducts(@Query() q: any) { return run(() => this.svc.platformProducts({ category: q?.category, status: q?.status, search: q?.search, lowStock: q?.lowStock === 'true', page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('categories') platformCategories(@Query() q: any) { return run(() => this.svc.platformCategories({ search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('brands') platformBrands(@Query() q: any) { return run(() => this.svc.platformBrands({ search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('suppliers') platformSuppliers(@Query() q: any) { return run(() => this.svc.platformSuppliers({ search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('service-categories') platformServiceCategories(@Query() q: any) { return run(() => this.svc.platformServiceCategories({ search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('tenant-service-categories') tenantServiceCategories(@Query() q: any) { return run(() => this.svc.tenantServiceCategories(String(q?.tenantId || ''))); }
  @Get('appointments') platformAppointments(@Query() q: any) { return run(() => this.svc.platformAppointments({ status: q?.status, source: q?.source, search: q?.search, date: q?.date, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('payments') platformPayments(@Query() q: any) { return run(() => this.svc.platformPayments({ status: q?.status, method: q?.method, processor: q?.processor, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('payments-transactions') paymentsTransactions(@Query() q: any) { return run(() => this.svc.paymentsTransactions({ search: q?.search, tenantId: q?.tenantId, branchId: q?.branchId, method: q?.method, status: q?.status, refundStatus: q?.refundStatus, settlementStatus: q?.settlementStatus, customerId: q?.customerId, deviceId: q?.deviceId, merchantAccount: q?.merchantAccount, startDate: q?.startDate, endDate: q?.endDate, page: +q?.page || 1, pageSize: +q?.pageSize || 10, sort: q?.sort, direction: q?.direction })); }
  @Get('payments-transactions/:id') paymentTransactionDetail(@Param('id') id: string) { return run(async () => { const d = await this.svc.paymentTransactionDetail(id); if (!d) throw new NotFoundException('Transaction not found'); return d; }); }
  @Get('payments-transactions/:id/authorization-history') paymentAuthHistory(@Param('id') id: string) { return run(async () => { const h = await this.svc.paymentAuthorizationHistory(id); if (!h) throw new NotFoundException('Transaction not found'); return h; }); }
  @Get('customers') platformCustomers(@Query() q: any) { return run(() => this.svc.platformCustomers({ status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('customer-duplicates') customerDuplicates(@Query() q: any) { return run(() => this.svc.customerDuplicates({ search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Post('customers/merge') mergeCustomers(@Req() r: any, @Body(ValidatedBody(PL_MERGE_CUSTOMERS_BODY, { strict: true })) b: any) { return run(() => this.svc.mergeCustomers(ctxFrom(r), b)); }
  @Post('service-categories/merge') mergeServiceCategories(@Req() r: any, @Body(ValidatedBody(PL_MERGE_CATEGORIES_BODY, { strict: true })) b: any) { return run(() => this.svc.mergeServiceCategories(ctxFrom(r), b)); }
  @Get('tenant-product-categories') tenantProductCategories(@Query() q: any) { return run(() => this.svc.tenantProductCategories(String(q?.tenantId || ''))); }
  @Post('product-categories/merge') mergeProductCategories(@Req() r: any, @Body(ValidatedBody(PL_MERGE_CATEGORIES_BODY, { strict: true })) b: any) { return run(() => this.svc.mergeProductCategories(ctxFrom(r), b)); }
  @Get('privacy-requests') privacyRequests(@Query() q: any) { return run(() => this.svc.privacyRequests({ status: q?.status, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Post('privacy-requests') createPrivacyRequest(@Req() r: any, @Body(ValidatedBody(PL_PRIVACY_REQUEST_BODY, { strict: true })) b: any) { return run(() => this.svc.createPrivacyRequest(ctxFrom(r), b)); }
  @Post('privacy-requests/:id/status') advancePrivacyRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_PRIVACY_ADVANCE_BODY, { strict: true })) b: any) { return run(() => this.svc.advancePrivacyRequest(ctxFrom(r), { ...b, id })); }
  @Get('report-exports') platformReportExports(@Query() q: any) { return run(() => this.svc.platformReportExports({ reportKey: q?.reportKey, format: q?.format, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('reminders') platformReminders(@Query() q: any) { return run(() => this.svc.platformReminders({ channel: q?.channel, status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('automations') platformAutomations(@Query() q: any) { return run(() => this.svc.platformAutomations({ status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('integrations') platformIntegrations(@Query() q: any) { return run(() => this.svc.platformIntegrations({ processor: q?.processor, status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('devices') platformDevices(@Query() q: any) { return run(() => this.svc.platformDevices({ category: q?.category, status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('security') platformSecurity(@Query() q: any) { return run(() => this.svc.platformSecurity({ severity: q?.severity, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50 })); }
  @Get('roles') roles() { return this.svc.roles(); }
  // Security Deep Scan C3 (Oct 23 2026): retired — answers 410 ENDPOINT_RETIRED (admin-web UsersRolesScreen still calls it).
  // Platform accounts are created by invitation only (POST invitations: platform_roles.manage + role ceiling + step-up).
  @Post('users') createSuperAdmin(@Req() r: any, @Body(ValidatedBody(PL_CREATE_SUPER_ADMIN_BODY, { strict: true })) b: any) { return run(() => this.svc.createSuperAdmin(ctxFrom(r), b)); }
  // C3 / A3: creating any account (a platform one above all) is a critical action — step-up; the service routes it through
  // createInvitation (platform_roles.manage + grant ceiling for a platform role; a token to the invitee, never a password)
  @RequireStepUp()
  @Post('users/invite') inviteUser(@Req() r: any, @Body(ValidatedBody(PL_INVITE_USER_BODY, { strict: true })) b: any) { return run(() => this.svc.inviteUser(ctxFrom(r), b)); }
  @Get('invitations') invitations(@Query() q: any) { return run(() => this.svc.listInvitations(q || {})); }
  @RequireStepUp()   // C3: an invitation can mint a platform account (Constitution 7 §8 / §24–25)
  @Post('invitations') createInvitation(@Req() r: any, @Body(ValidatedBody(PL_INVITATION_BODY, { strict: true })) b: any) {
    return run(async () => {
      // the body's `role` is the role REQUESTED for the invitee (validated by the schema, ceilinged by the service against the
      // caller's SESSION permissions) — never the caller's own role, which only ever comes from the signed session
      const requestedInviteeRole: unknown = b?.role;
      const approvals = requestedInviteeRole === 'SUPER_ADMIN' ? platformApprovalsFrom(this.moduleRef) : null;
      if (approvals && await approvals.required(PLATFORM_ADMIN_INVITE)) {
        const ctx = ctxFrom(r);
        if (!ctx.permissions?.includes('super_admin.platform_roles.manage')) throw new PlatformError('forbidden', 'Inviting a platform user requires super_admin.platform_roles.manage.');
        const { approvalReason, ...invite } = b ?? {};
        const out = await approvals.runOrRequest(PLATFORM_ADMIN_INVITE, invite, String(approvalReason ?? ''), { userId: ctx.userId ?? null, permissions: ctx.permissions ?? [] }, String(invite.email ?? invite.phone ?? ''));
        return out.executed ? out.result : pendingAnswer(out.approvalId, out.expiresAt);
      }
      const { approvalReason: _r, ...invite } = b ?? {};
      return this.svc.createInvitation(ctxFrom(r), invite);
    });
  }
  @Post('invitations/:id/resend') resendInvitation(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.resendInvitation(ctxFrom(r), id)); }
  @Post('invitations/:id/cancel') cancelInvitation(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancelInvitation(ctxFrom(r), id)); }
  @Get('access-requests') accessRequests(@Query() q: any) { return run(() => this.svc.listAccessRequests(q || {})); }
  @AsyncExport({ kind: 'super-admin.platform.users-export', maxSyncRows: 50_000, estimate: { table: 'users', platform: true } }) @Get('users/export') usersExport(@Req() r: any, @Query() q: any) { return run(() => this.svc.usersExport(ctxFrom(r), q || {})); }
  @Get('scheduled-reports') scheduledReports() { return run(() => this.svc.listScheduledReports()); }
  @Post('scheduled-reports') createScheduledReport(@Req() r: any, @Body(ValidatedBody(PL_SCHEDULED_REPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.createScheduledReport(ctxFrom(r), b || {})); }
  @Post('scheduled-reports/:id/toggle') toggleScheduledReport(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_TOGGLE_BODY, { strict: true })) b: any) { return run(() => this.svc.toggleScheduledReport(ctxFrom(r), id, b?.enabled !== false)); }
  @Post('scheduled-reports/:id/run-now') runScheduledReportNow(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.runScheduledReportNow(ctxFrom(r), id)); }
  @Delete('scheduled-reports/:id') deleteScheduledReport(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.deleteScheduledReport(ctxFrom(r), id)); }
  @Post('access-requests') createAccessRequest(@Req() r: any, @Body(ValidatedBody(PL_ACCESS_REQUEST_BODY, { strict: true })) b: any) { return run(() => this.svc.createAccessRequest(ctxFrom(r), b)); }
  @Post('access-requests/:id/review') reviewAccessRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_ACCESS_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.reviewAccessRequest(ctxFrom(r), id, b || {})); }
  @RequireStepUp()   // C7: approving a request grants access
  @Post('access-requests/:id/approve') approveAccessRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_ACCESS_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.approveAccessRequest(ctxFrom(r), id, b || {})); }
  @Post('access-requests/:id/reject') rejectAccessRequest(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_ACCESS_DECISION_BODY, { strict: true })) b: any) { return run(() => this.svc.rejectAccessRequest(ctxFrom(r), id, b || {})); }
  @Post('access-requests/:id/cancel') cancelAccessRequest(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancelAccessRequest(ctxFrom(r), id)); }
  @RequireStepUp() @Post('users/branch-access') assignUserBranch(@Req() r: any, @Body(ValidatedBody(PL_USER_BRANCH_BODY, { strict: true })) b: any) { return run(() => this.svc.assignUserBranch(ctxFrom(r), b)); }
  @RequireStepUp() @Post('users/branch-access/revoke') revokeUserBranch(@Req() r: any, @Body(ValidatedBody(PL_USER_BRANCH_BODY, { strict: true })) b: any) { return run(() => this.svc.revokeUserBranch(ctxFrom(r), b)); }
  @Get('tenant-users-branches') tenantUsersAndBranches(@Query() q: any) { return run(() => this.svc.tenantUsersAndBranches(String(q?.tenantId || ''))); }
  // A3 / C7 (Oct 23 2026): step-up, and never a platform account of equal or higher rank (service: platformHierarchyDecision)
  @RequireStepUp()
  @Post('users/:id/disable') disableUser(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.disableUser(ctxFrom(r), id)); }
  @RequireStepUp()
  @Post('users/:id/enable') enableUser(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.enableUser(ctxFrom(r), id)); }
  // C2: a reason (audited); the temporary password is delivered to the account holder, never returned
  @RequireStepUp()
  @Post('users/:id/reset-password') resetUserPassword(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_RESET_PASSWORD_BODY, { strict: true })) b: any) { return run(() => this.svc.resetUserPassword(ctxFrom(r), id, { reason: b?.reason, deliveryMethod: b?.deliveryMethod })); }
  @RequireStepUp()   // BUILD_PLAN Phase 9 (audit bug 5): moving a person between salon roles changes what they may do
  @Post('users/:id/role') setUserRole(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_USER_ROLE_BODY, { strict: true })) b: any) { return run(() => this.svc.setUserRole(ctxFrom(r), id, b?.role)); }
  @RequireStepUp()   // Constitution 7 §8: changing a user's MFA requirement
  @Post('users/:id/mfa') setUserMfa(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_USER_MFA_BODY, { strict: true })) b: any) { return run(() => this.svc.setUserMfa(ctxFrom(r), id, !!b?.required)); }
  @RequireStepUp()   // C2 / A3: re-mints a sign-in credential — delivered to the invitee only
  @Post('users/:id/resend-invite') resendInvite(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_RESEND_INVITE_BODY, { strict: true })) b: any) { return run(() => this.svc.resendInvite(ctxFrom(r), id, { deliveryMethod: b?.deliveryMethod })); }
  @Post('users/:id/cancel-invite') cancelInvite(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancelInvite(ctxFrom(r), id)); }
  @Get('users/:id/sessions') userSessions(@Param('id') id: string) { return run(() => this.svc.userSessions(id)); }
  @Post('sessions/:id/revoke') revokeSession(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.revokeSession(ctxFrom(r), id)); }
  @RequireStepUp()   // C7 / A3
  @Post('users/:id/revoke-sessions') revokeAllUserSessions(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.revokeAllUserSessions(ctxFrom(r), id)); }

  @Get('support-sessions') sessions(@Query('active') active?: string) { return run(() => this.svc.supportSessions(active !== 'false')); }
  // Constitution 12 §154/§189: entering a salon's data as Support is a security event, recorded only once the
  // service has accepted it (reason, time limit, step-up) — a refused attempt is the service's own error path.
  // Constitution 7 §75: the SUPPORT MODE banner — this admin's live sessions (both stores)
  @Get('support-sessions/mine') mySupportSessions(@Req() r: any) { return run(() => this.svc.mySupportSessions(ctxFrom(r))); }
  @RequireStepUp()   // Constitution 7 §8: entering Support Mode
  @Post('support-sessions') startSupport(@Req() r: any, @Body(ValidatedBody(PL_SUPPORT_START_BODY, { strict: true })) b: any) {
    return run(async () => {
      const out: any = await this.svc.startSupport(ctxFrom(r), b);
      void this.securityEvents?.record({ type: 'SUPPORT_MODE_STARTED', tenantId: String(b?.tenantId ?? ''), actorType: 'super_admin', actorId: r?.ctx?.userId ?? null, resourceType: 'support_session', resourceId: String(out?.id ?? ''), reason: String(b?.reason ?? '').slice(0, 200) });
      return out;
    });
  }
  // Constitution 7 §78: extending Support Mode needs a reason, the manage permission (derived key), step-up and an audit row
  @RequireStepUp()
  @Post('support-sessions/:id/extend') extendSupport(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_SUPPORT_EXTEND_BODY, { strict: true })) b: any) { return run(() => this.svc.extendSupport(ctxFrom(r), id, b)); }
  @Post('support-sessions/:id/end') endSupport(@Req() r: any, @Param('id') id: string) {
    return run(async () => {
      const out = await this.svc.endSupport(ctxFrom(r), id);
      void this.securityEvents?.record({ type: 'SUPPORT_MODE_ENDED', actorType: 'super_admin', actorId: r?.ctx?.userId ?? null, resourceType: 'support_session', resourceId: id });
      return out;
    });
  }
  @Post('support-sessions/:id/action') supportAction(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_SUPPORT_ACTION_BODY, { strict: true })) b: any) { return run(() => this.svc.recordSupportAction(ctxFrom(r), { ...b, sessionId: id })); }
  @Post('support-sessions/:id/customer-action') customerSupportAction(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PL_SUPPORT_CUSTOMER_ACTION_BODY, { strict: true })) b: any) { return run(() => this.svc.recordCustomerSupportAction(ctxFrom(r), { ...b, sessionId: id })); }
  // ── Tenant App Controls (build doc §26) — public listing / map / booking / tech app / progress / live edit ──
  @Get('app-flags/:tenantId')
  appFlags(@Param('tenantId') tenantId: string) {
    return run(async () => ({ ok: true, flags: await this.salons.listAppFlags(tenantId) }));
  }

  @Post('app-flags/:tenantId')
  setAppFlag(@Param('tenantId') tenantId: string, @Body(ValidatedBody(PL_APP_FLAG_BODY, { strict: true })) b: any) {
    return run(async () => {
      try {
        const out = await this.salons.setAppFlag(tenantId, String(b?.flag ?? ''), b?.enabled === null ? null : !!b?.enabled);
        return { ok: true, ...out };
      } catch (e) {
        if (e instanceof SalonSearchError) throw new HttpException({ ok: false, message: e.message }, 400);
        throw e;
      }
    });
  }

}
