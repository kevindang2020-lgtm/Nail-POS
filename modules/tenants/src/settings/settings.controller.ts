// settings.controller.ts — tenant POS Settings HTTP surface (`/pos/settings/*`).
// Behind TenantAuthGuard (POS roles only; Super Admin & customers rejected) + RolePermissionGuard.
// Guard requires `settings.view`; per-category EDIT permission + read-only rules are enforced in the service.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp } from '@aipowersalon/permissions/guards';
import type { PosTerminalLocationAssigned } from '@aipowersalon/api-contracts/tenant';   // wire contract (typing ratchet)
import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { PosSettingsService, ForbiddenError, ValidationError } from './settings.service';
import type { SettingsCategory, SettingsContext } from './settings.dto';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { A2P_REGISTER_BODY, BOOKING_AI_BODY, CONNECT_GOOGLE_BODY, MESSAGE_TEMPLATE_BODY, RECEIPT_LOGO_BODY, RECEIPT_TEST_BODY, SETTINGS_BOOKING_BODY, SETTINGS_BUSINESS_BRANCH_BODY, SETTINGS_CUSTOMER_DISPLAY_BODY, SETTINGS_GIFT_CARD_BODY, SETTINGS_LOYALTY_BODY, SETTINGS_NOTIFICATIONS_BODY, SETTINGS_ONLINE_BOOKING_BODY, SETTINGS_PAYMENTS_CHECKOUT_BODY, SETTINGS_QUEUE_WORKFLOW_BODY, SETTINGS_RECEIPTS_BODY, SETTINGS_ROLES_BODY, SETTINGS_SECURITY_BODY, SETTINGS_SERVICES_PRICING_BODY, SETTINGS_STORE_HOURS_BODY, SETTINGS_TAX_BODY, SETTINGS_TECHNICIANS_STAFF_BODY, SETTINGS_TIPS_BODY, TERMINAL_PAIR_BODY, TERMINAL_REGISTER_BODY, TERMINAL_RENAME_BODY, TERMINAL_DISABLE_BODY } from '../request-schemas';
import type { PaymentTerminalView, PaymentTerminalEditRequest, PaymentTerminalDisableRequest } from '@aipowersalon/api-contracts';   // wave 3 PAYI: terminal registry wire types

function ctxFrom(req: any): SettingsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function metaFrom(req: any) { return { ip: safeInet(req?.ip) ?? undefined, ua: req?.headers?.['user-agent'] }; }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/settings')
export class PosSettingsController {
  constructor(private readonly svc: PosSettingsService) {}

  private async run<T>(fn: () => T | Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e: any) {
      if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
  private get(req: any, cat: SettingsCategory) { return this.run(() => this.svc.getCategory(ctxFrom(req), cat)); }
  private patch(req: any, cat: SettingsCategory, body: any) { return this.run(() => this.svc.patchCategory(ctxFrom(req), cat, body || {}, metaFrom(req))); }

  @Get('state') @RequirePermission('settings.view')
  state(@Req() req: any) { return this.run(() => this.svc.getState(ctxFrom(req))); }

  @Get('business-branch') @RequirePermission('settings.view') gBiz(@Req() r: any) { return this.get(r, 'business-branch'); }
  @Patch('business-branch') @RequirePermission('settings.view') pBiz(@Req() r: any, @Body(ValidatedBody(SETTINGS_BUSINESS_BRANCH_BODY, { strict: true })) b: any) { return this.patch(r, 'business-branch', b); }

  @Get('store-hours-auto-logout') @RequirePermission('settings.view') gHours(@Req() r: any) { return this.get(r, 'store-hours-auto-logout'); }
  @Patch('store-hours-auto-logout') @RequirePermission('settings.view') pHours(@Req() r: any, @Body(ValidatedBody(SETTINGS_STORE_HOURS_BODY, { strict: true })) b: any) { return this.patch(r, 'store-hours-auto-logout', b); }

  @Get('payments-checkout') @RequirePermission('settings.view') gPay(@Req() r: any) { return this.get(r, 'payments-checkout'); }
  // Security Deep Scan C7: server-enforced step-up
  @RequireStepUp() @Patch('payments-checkout') @RequirePermission('settings.view') pPay(@Req() r: any, @Body(ValidatedBody(SETTINGS_PAYMENTS_CHECKOUT_BODY, { strict: true })) b: any) { return this.patch(r, 'payments-checkout', b); }

  @Get('gift-card-settings') @RequirePermission('settings.view') gGift(@Req() r: any) { return this.get(r, 'gift-card-settings'); }
  @Patch('gift-card-settings') @RequirePermission('settings.view') pGift(@Req() r: any, @Body(ValidatedBody(SETTINGS_GIFT_CARD_BODY, { strict: true })) b: any) { return this.patch(r, 'gift-card-settings', b); }

  @Get('tips') @RequirePermission('settings.view') gTips(@Req() r: any) { return this.get(r, 'tips'); }
  @Patch('tips') @RequirePermission('settings.view') pTips(@Req() r: any, @Body(ValidatedBody(SETTINGS_TIPS_BODY, { strict: true })) b: any) { return this.patch(r, 'tips', b); }

  @Get('tax') @RequirePermission('settings.view') gTax(@Req() r: any) { return this.get(r, 'tax'); }
  @Patch('tax') @RequirePermission('settings.view') pTax(@Req() r: any, @Body(ValidatedBody(SETTINGS_TAX_BODY, { strict: true })) b: any) { return this.patch(r, 'tax', b); }

  @Get('booking-appointments') @RequirePermission('settings.view') gBook(@Req() r: any) { return this.get(r, 'booking-appointments'); }
  @Patch('booking-appointments') @RequirePermission('settings.view') pBook(@Req() r: any, @Body(ValidatedBody(SETTINGS_BOOKING_BODY, { strict: true })) b: any) { return this.patch(r, 'booking-appointments', b); }

  @Get('online-google-ai-booking') @RequirePermission('settings.view') gOnline(@Req() r: any) { return this.get(r, 'online-google-ai-booking'); }
  @Patch('online-google-ai-booking') @RequirePermission('settings.view') pOnline(@Req() r: any, @Body(ValidatedBody(SETTINGS_ONLINE_BOOKING_BODY, { strict: true })) b: any) { return this.patch(r, 'online-google-ai-booking', b); }

  @Get('notifications-reminders') @RequirePermission('settings.view') gNotif(@Req() r: any) { return this.get(r, 'notifications'); }
  @Patch('notifications-reminders') @RequirePermission('settings.view') pNotif(@Req() r: any, @Body(ValidatedBody(SETTINGS_NOTIFICATIONS_BODY, { strict: true })) b: any) { return this.patch(r, 'notifications', b); }

  @Get('queue-workflow') @RequirePermission('settings.view') gQueue(@Req() r: any) { return this.get(r, 'queue-workflow'); }
  @Patch('queue-workflow') @RequirePermission('settings.view') pQueue(@Req() r: any, @Body(ValidatedBody(SETTINGS_QUEUE_WORKFLOW_BODY, { strict: true })) b: any) { return this.patch(r, 'queue-workflow', b); }

  @Get('services-pricing') @RequirePermission('settings.view') gSvc(@Req() r: any) { return this.get(r, 'services-pricing'); }
  @Patch('services-pricing') @RequirePermission('settings.view') pSvc(@Req() r: any, @Body(ValidatedBody(SETTINGS_SERVICES_PRICING_BODY, { strict: true })) b: any) { return this.patch(r, 'services-pricing', b); }

  @Get('technicians-staff') @RequirePermission('settings.view') gStaff(@Req() r: any) { return this.get(r, 'technicians-staff'); }
  @Patch('technicians-staff') @RequirePermission('settings.view') pStaff(@Req() r: any, @Body(ValidatedBody(SETTINGS_TECHNICIANS_STAFF_BODY, { strict: true })) b: any) { return this.patch(r, 'technicians-staff', b); }

  // Constitution 3 Step 9: the salon's sign-in policy (two-factor for owners/managers, trusted devices, Face ID, PIN unlock) — enforced by sign-in
  @Get('security') @RequirePermission('settings.view') gSecurity(@Req() r: any) { return this.get(r, 'security'); }
  @RequireStepUp() @Patch('security') @RequirePermission('settings.view') pSecurity(@Req() r: any, @Body(ValidatedBody(SETTINGS_SECURITY_BODY, { strict: true })) b: any) { return this.patch(r, 'security', b); }
  @Get('roles-permissions-security') @RequirePermission('settings.view') gRoles(@Req() r: any) { return this.get(r, 'roles-permissions'); }
  @RequireStepUp() @Patch('roles-permissions-security') @RequirePermission('settings.view') pRoles(@Req() r: any, @Body(ValidatedBody(SETTINGS_ROLES_BODY, { strict: true })) b: any) { return this.patch(r, 'roles-permissions', b); }

  @Get('loyalty-memberships') @RequirePermission('settings.view') gLoy(@Req() r: any) { return this.get(r, 'loyalty-memberships'); }
  @Patch('loyalty-memberships') @RequirePermission('settings.view') pLoy(@Req() r: any, @Body(ValidatedBody(SETTINGS_LOYALTY_BODY, { strict: true })) b: any) { return this.patch(r, 'loyalty-memberships', b); }

  @Get('customer-display-devices') @RequirePermission('settings.view') gDev(@Req() r: any) { return this.get(r, 'customer-display-devices'); }
  @Patch('customer-display-devices') @RequirePermission('settings.view') pDev(@Req() r: any, @Body(ValidatedBody(SETTINGS_CUSTOMER_DISPLAY_BODY, { strict: true })) b: any) { return this.patch(r, 'customer-display-devices', b); }

  @Get('receipts-branding') @RequirePermission('settings.view') gRcpt(@Req() r: any) { return this.get(r, 'receipts-branding'); }
  @Patch('receipts-branding') @RequirePermission('settings.view') pRcpt(@Req() r: any, @Body(ValidatedBody(SETTINGS_RECEIPTS_BODY, { strict: true })) b: any) { return this.patch(r, 'receipts-branding', b); }

  // read-only in tenant POS (Super Admin controls the plan)
  @Get('subscription-plan') @RequirePermission('settings.view') gSub(@Req() r: any) { return this.get(r, 'subscription-plan'); }

  @Get('audit-logs') @RequirePermission('settings.view') gAudit(@Req() r: any) { return this.get(r, 'audit-logs'); }

  // action helper: Forbidden -> 403, other (input) errors -> 400. An ASYNC action's rejection used to slip past the
  // try/catch (it only saw synchronous throws) and reached the client as a 500; a rejected Forbidden/Validation error
  // now maps the same way, while any other async failure still surfaces as a server error (its text is not echoed).
  private act<T>(fn: () => T): T {
    try {
      const out: any = fn();
      if (out && typeof out.then === 'function') {
        return out.catch((e: any) => {
          if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
          if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
          throw e;
        }) as T;
      }
      return out;
    }
    catch (e: any) {
      if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      throw new HttpException(e?.message || 'bad request', HttpStatus.BAD_REQUEST);
    }
  }

  // ---- Payments & terminal pairing ----
  @Get('payments-checkout/test-connection') @RequirePermission('settings.view')
  payTest(@Req() r: any) { return this.act(() => this.svc.testPayments(ctxFrom(r))); }
  @Get('payments-checkout/terminals') @RequirePermission('settings.view')
  termList(@Req() r: any) { return this.act(() => this.svc.listTerminals(ctxFrom(r))); }
  @RequireStepUp() @Post('payments-checkout/terminals/pair') @RequirePermission('settings.view')
  termPair(@Req() r: any, @Body(ValidatedBody(TERMINAL_PAIR_BODY, { strict: true })) b: any) { return this.act(() => this.svc.pairTerminal(ctxFrom(r), b?.code, b?.label || 'Station', b?.stationId, b?.hsn, { merchantAccountId: b?.merchantAccountId || null, requestKey: b?.idempotencyKey || null })); }
  // Payment Terminals guide (Nov 4 2026) §07 step 1: the processor accounts of this location a terminal can be paired to
  @Get('payments-checkout/terminals/processors') @RequirePermission('settings.view')
  termProcessors(@Req() r: any) { return this.act(() => this.svc.terminalProcessors(ctxFrom(r))); }
  // Oct 6 2026: the register a terminal serves (body { stationId: one of this location's registers | null })
  @RequireStepUp() @Post('payments-checkout/terminals/:id/register') @RequirePermission('settings.view')
  termRegister(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(TERMINAL_REGISTER_BODY, { strict: true })) b: any) { return this.act(() => this.svc.setTerminalRegister(ctxFrom(r), id, b?.stationId ?? null)); }
  // Fiserv §5.2 (Nov 4 2026): an unassigned terminal (no location) is assigned to THIS location before it can charge
  @RequireStepUp() @Post('payments-checkout/terminals/:id/assign-location') @RequirePermission('settings.view')
  termAssignLocation(@Req() r: any, @Param('id') id: string): Promise<PosTerminalLocationAssigned> { return this.act(() => this.svc.assignTerminalLocation(ctxFrom(r), id)) as Promise<PosTerminalLocationAssigned>; }
  @RequireStepUp() @Post('payments-checkout/terminals/:id/unpair') @RequirePermission('settings.view')
  termUnpair(@Req() r: any, @Param('id') id: string) { return this.act(() => this.svc.unpairTerminal(ctxFrom(r), id)); }
  @Get('payments-checkout/terminals/:id/test') @RequirePermission('settings.view')
  termTest(@Req() r: any, @Param('id') id: string) { return this.act(() => this.svc.testTerminal(ctxFrom(r), id)); }
  // wave 3 PAYI §52: rename / registry fields, disable, enable — the service requires the payments edit permission and audits
  @Post('payments-checkout/terminals/:id/rename') @RequirePermission('settings.view')
  termRename(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(TERMINAL_RENAME_BODY, { strict: true })) b: PaymentTerminalEditRequest): Promise<PaymentTerminalView> { return this.act(() => this.svc.updateTerminal(ctxFrom(r), id, b ?? {})); }
  @RequireStepUp() @Post('payments-checkout/terminals/:id/disable') @RequirePermission('settings.view')
  termDisable(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(TERMINAL_DISABLE_BODY, { strict: true })) b: PaymentTerminalDisableRequest): Promise<PaymentTerminalView> { return this.act(() => this.svc.setTerminalDisabled(ctxFrom(r), id, true, b?.reason)); }
  @RequireStepUp() @Post('payments-checkout/terminals/:id/enable') @RequirePermission('settings.view')
  termEnable(@Req() r: any, @Param('id') id: string): Promise<PaymentTerminalView> { return this.act(() => this.svc.setTerminalDisabled(ctxFrom(r), id, false, null)); }

  // ---- Online / Google / AI booking ----
  @Get('online-google-ai-booking/status') @RequirePermission('settings.view')
  bkStatus(@Req() r: any) { return this.act(() => this.svc.bookingStatus(ctxFrom(r))); }
  @Post('online-google-ai-booking/connect-google') @RequirePermission('settings.view')
  bkConnect(@Req() r: any, @Body(ValidatedBody(CONNECT_GOOGLE_BODY, { strict: true })) b: any) { return this.act(() => this.svc.connectGoogle(ctxFrom(r), b?.link)); }
  @Post('online-google-ai-booking/disconnect-google') @RequirePermission('settings.view')
  bkDisconnect(@Req() r: any) { return this.act(() => this.svc.disconnectGoogle(ctxFrom(r))); }
  @Post('online-google-ai-booking/ai') @RequirePermission('settings.view')
  bkAi(@Req() r: any, @Body(ValidatedBody(BOOKING_AI_BODY, { strict: true })) b: any) { return this.act(() => this.svc.enableAi(ctxFrom(r), !!b?.enabled, b?.actions)); }

  // ---- Notifications / A2P sender ----
  @Get('notifications-reminders/a2p-status') @RequirePermission('settings.view')
  a2pStatus(@Req() r: any) { return this.act(() => this.svc.a2pStatus(ctxFrom(r))); }
  @Post('notifications-reminders/a2p-register') @RequirePermission('settings.view')
  a2pRegister(@Req() r: any, @Body(ValidatedBody(A2P_REGISTER_BODY, { strict: true })) b: any) { return this.act(() => this.svc.registerA2p(ctxFrom(r), b?.brand)); }
  // DEPRECATED (740, Message Templates & Automation Center): the POS screen now uses pos/message-templates/* on the SAME rows.
  // Kept for API compatibility (owner rule: deprecate, do not remove); hardened — writes are versioned, archived templates are
  // refused, and writing needs communications.manage. On the check:unreached debt ledger until a caller is retired or wired.
  @Get('notifications-reminders/templates') @RequirePermission('settings.view')
  tplList(@Req() r: any) { return this.act(() => this.svc.listTemplates(ctxFrom(r))); }
  @Post('notifications-reminders/templates') @RequirePermission('pos.communications.manage')   // 740: writing templates is communications.manage, not settings.view
  tplUpsert(@Req() r: any, @Body(ValidatedBody(MESSAGE_TEMPLATE_BODY, { strict: true })) b: any) { return this.act(() => this.svc.upsertTemplate(ctxFrom(r), b)); }

  // ---- Receipts & branding actions ----
  @Get('receipts-branding/preview') @RequirePermission('settings.view')
  rcptPreview(@Req() r: any) { return this.act(() => this.svc.previewReceipt(ctxFrom(r))); }
  @Post('receipts-branding/send-test') @RequirePermission('settings.view')
  rcptSend(@Req() r: any, @Body(ValidatedBody(RECEIPT_TEST_BODY, { strict: true })) b: any) { return this.act(() => this.svc.sendTestReceipt(ctxFrom(r), b?.to, b?.channel)); }
  // The salon logo (receipts + the 23-inch customer display header, spec §13): real storage, checked bytes (salon-logo.ts).
  @Get('receipts-branding/logo') @RequirePermission('settings.view')
  rcptLogoGet(@Req() r: any) { return this.act(() => this.svc.getSalonLogo(ctxFrom(r))); }
  @Post('receipts-branding/logo') @RequirePermission('settings.view')
  rcptLogo(@Req() r: any, @Body(ValidatedBody(RECEIPT_LOGO_BODY, { strict: true })) b: any) { return this.act(() => this.svc.uploadReceiptLogo(ctxFrom(r), b?.logo)); }
  @Post('receipts-branding/logo/remove') @RequirePermission('settings.view')
  rcptLogoRm(@Req() r: any) { return this.act(() => this.svc.removeReceiptLogo(ctxFrom(r))); }

  // Customer displays: pairing, refresh, rename, registers, maintenance and revoke are /pos/customer-displays (23-inch
  // spec §8–§12, §82, §86). The staff-only pairing code and the test/status actions that stamped last_seen_at from the
  // POS (making a switched-off display look online) were removed Oct 6 2026.

  // ---- Go-live readiness (what still needs a live credential/device) ----
  @Get('go-live-readiness') @RequirePermission('settings.view')
  goLive(@Req() r: any) { return this.act(() => this.svc.getGoLiveReadiness(ctxFrom(r))); }
}
