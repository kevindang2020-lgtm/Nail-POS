// payment-channels.controller.ts — Three Ways to Pay SUNMI guide (Nov 9 2026): `/pos/payment-channels/*`.
//   GET  /pos/payment-channels?ticketId=   the three channels of THIS location (+ the open ticket's payment status)
//   POST /pos/payment-channels/check       Check Three Payment Channels — read-only diagnostics, no test charge
// pos.checkout.view. Tenant / branch / user from the session, never the query. Nothing here takes or moves money: the pay
// actions stay the existing ones (Clover Compact pay/terminal, send-to-device, send-app-payment) with their own guards.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { PcCheckResponse, PcResponse } from '@aipowersalon/api-contracts/tenant';
import { PaymentChannelsCenter, PaymentChannelsError, type PcCtx } from './payment-channels-center';

export const PAYMENT_CHANNELS_CENTER = 'PaymentChannelsCenter';
export const PC_CHECK_BODY: BodySchema = S.object({});

function ctxFrom(req: any): PcCtx {
  const c = req?.ctx || {};
  return { tenantId: String(c.tenantId || ''), branchId: String(c.branchId || ''), userId: c.userId ?? null, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof PaymentChannelsError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/payment-channels')
export class PaymentChannelsController {
  constructor(@Inject(PAYMENT_CHANNELS_CENTER) private readonly pc: PaymentChannelsCenter | null) {}
  private r(): PaymentChannelsCenter { if (!this.pc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Payment channels need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.pc; }

  @Get() @RequirePermission('pos.checkout.view')
  channels(@Req() q: any, @Query('ticketId') ticketId?: string): Promise<PcResponse> { return run(() => this.r().channels(ctxFrom(q), typeof ticketId === 'string' ? ticketId : null)); }

  @Post('check') @RequirePermission('pos.checkout.view')
  check(@Req() q: any, @Body(ValidatedBody(PC_CHECK_BODY, { strict: true })) _b: unknown): Promise<PcCheckResponse> { return run(() => this.r().check(ctxFrom(q))); }
}
