// hardware-payment.owner.controller.ts — §15 tenant-owner surface. Tenant derived from the session; owners can view
// and add a tokenized method + autopay consent, but CANNOT change split percentages (that's Super-Admin only).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { HardwarePaymentService, ActorCtx } from './hardware-payment.service';
import { HardwarePaymentError } from './hardware-payment.dto';

import { AUTOPAY_CONSENT_BODY, HARDWARE_PAYMENT_METHOD_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctx(req: any) { const c = req?.ctx || {}; return { tenantId: c.tenantId as string, actor: { userId: c.userId, role: c.role, ipAddress: req?.ip, deviceInfo: req?.headers?.['user-agent'] } as ActorCtx }; }
async function run<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof HardwarePaymentError) throw new HttpException(e.message, e.status || HttpStatus.BAD_REQUEST); throw e; } }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('owner/hardware-payment')
export class HardwarePaymentOwnerController {
  constructor(private readonly svc: HardwarePaymentService) {}

  @Get('plan') @RequirePermission('settings.view') plan(@Req() r: any) { const { tenantId } = ctx(r); return run(() => this.svc.ownerPlan(tenantId)); }
  /** Where the owner types the plan's card: the platform gateway's CardSecure hosted iFrame (no card data reaches us). */
  @Get('tokenizer') @RequirePermission('settings.edit') tokenizer() { return this.svc.hardwareTokenizer(); }
  @Get('invoices') @RequirePermission('settings.view') invoices(@Req() r: any) { const { tenantId } = ctx(r); return run(() => this.svc.ownerInvoices(tenantId)); }
  @Get('ledger') @RequirePermission('settings.view') ledger(@Req() r: any) { const { tenantId } = ctx(r); return run(() => this.svc.ownerLedger(tenantId)); }
  @Post('payment-method') @RequirePermission('settings.edit') addMethod(@Req() r: any, @Body(ValidatedBody(HARDWARE_PAYMENT_METHOD_BODY, { strict: true })) b: any) { const { tenantId, actor } = ctx(r); return run(() => this.svc.addPaymentMethod(tenantId, b || {}, actor)); }
  @Post('autopay-consent') @RequirePermission('settings.edit') consent(@Req() r: any, @Body(ValidatedBody(AUTOPAY_CONSENT_BODY, { strict: true })) b: any) { const { tenantId, actor } = ctx(r); if (!b?.planId) throw new HttpException('planId is required', HttpStatus.BAD_REQUEST); return run(() => this.svc.recordAutopayConsent(tenantId, String(b.planId), actor)); }
}
