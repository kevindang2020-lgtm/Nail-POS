// pos-terminal-pay.controller.ts — Fiserv master build §7 / §8B (Nov 4 2026): the front-desk "Pay on Clover Compact".
//
//   GET  /pos/checkout/terminals                         the paired terminals of THIS branch (pick list)
//   POST /pos/checkout/tickets/:ticketId/pay/terminal    { attemptKey, terminalId?, stationId? } → charge on the Compact
//   POST /pos/checkout/tickets/:ticketId/pay/terminal/cancel   stop the prompt on the terminal (best-effort)
//
// Tenant, branch and user come from the session (never the body). The charge itself is TerminalCaptureService
// .captureForPos — the same locks, lease, merchant routing, Bolt call and reconciliation as the customer display.
// The answer always says one of: approved / declined / unknown (verify) / unavailable / in progress — never a fake paid.
import { Body, Controller, ForbiddenException, Get, HttpException, Inject, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { PosTerminalOption, PosTerminalPayResult, PosTerminalCancelResult } from '@aipowersalon/api-contracts/tenant';   // wire contracts (typing ratchet)
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import type { TerminalCaptureService } from './terminal-capture.service';
import { CheckoutService } from '@aipowersalon/checkout';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';

const str = (max: number): BodySchema => ({ type: ['string', 'null'], maxLength: max });
export const PAY_TERMINAL_BODY: BodySchema = S.object({ attemptKey: str(80), terminalId: str(64), stationId: str(64),
  // G4 (merged Nov 7 2026): the cashier confirming the customer's per-technician tips on their behalf, with a reason
  staffTipConfirmation: S.nullable(S.object({ reason: str(500) })) });

export type { PosTerminalStatus, PosTerminalPayResult } from '@aipowersalon/api-contracts/tenant';

/** Map the capture outcome to the five front-desk states (§7.2): UNKNOWN is never shown as a decline. */
export function posTerminalResult(o: any): PosTerminalPayResult {
  switch (o?.outcome) {
    case 'approved': return { status: 'approved', paymentId: o.paymentId, retref: o.retref, amountCents: o.amountCents, next: 'done' };
    case 'declined': return { status: 'declined', paymentId: o.paymentId, message: o.respText || 'Declined', next: 'retry' };
    case 'unknown': return { status: 'unknown', paymentId: o.paymentId, message: o.reason, next: 'verify' };
    case 'cancelled': return { status: 'cancelled', message: 'Cancelled on the terminal — nothing was charged.', next: 'retry' };
    case 'terminal_busy': return { status: 'in_progress', message: 'The terminal is busy with another payment. Try again in a moment.', next: 'wait' };
    case 'ticket_busy': return { status: 'in_progress', message: `This ticket is already being paid (${o.heldBy}).`, next: 'wait' };
    case 'duplicate': return { status: 'unknown', paymentId: o.paymentId, message: 'This attempt was already sent — check its result with Verify before charging again.', next: 'verify' };
    case 'failed': return { status: 'unavailable', paymentId: o.paymentId, message: o.reason, next: 'retry' };
    case 'skipped': default: return { status: 'unavailable', message: o?.reason || 'Card payments on the terminal are not available.', next: 'retry' };
  }
}

function scopeFrom(req: any) { const c = req?.ctx || {}; return { tenantId: String(c.tenantId || ''), branchId: String(c.branchId || ''), userId: c.userId ?? null, permissions: (c.permissions || []) as string[] }; }

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/checkout')
export class PosTerminalPayController {
  constructor(@Optional() @Inject('TerminalCapturePort') private readonly capture?: TerminalCaptureService, @Optional() private readonly checkout?: CheckoutService) {}

  private svc(): TerminalCaptureService {
    if (!this.capture || typeof (this.capture).captureForPos !== 'function') throw new HttpException({ code: 'TERMINAL_NOT_CONFIGURED', message: 'Terminal payments need the database-backed server.' }, 503);
    return this.capture;
  }

  @Get('terminals') @RequirePermission('pos.checkout.take_payment')
  terminals(@Req() r: any): Promise<PosTerminalOption[]> { const s = scopeFrom(r); return this.svc().terminalsForPos(s); }

  @Post('tickets/:ticketId/pay/terminal') @RequirePermission('pos.checkout.take_payment')
  async pay(@Req() r: any, @Param('ticketId') ticketId: string, @Body(ValidatedBody(PAY_TERMINAL_BODY, { strict: true })) b: any): Promise<PosTerminalPayResult> {
    const s = scopeFrom(r);
    if (!s.permissions.includes('pos.checkout.card_payment')) throw new ForbiddenException('You do not have permission to take card payments.');
    // G4: the same per-technician tip rule as every other front-desk tender (TECH_TIPS_NOT_CONFIRMED before the terminal prompts)
    if (this.checkout) {
      try { await this.checkout.assertTipsConfirmed({ tenantId: s.tenantId, branchId: s.branchId, userId: String(s.userId ?? ''), role: String(r?.ctx?.role ?? ''), permissions: s.permissions }, ticketId, b?.staffTipConfirmation ?? null); }
      catch (e: any) {
        if (e?.name === 'ValidationError') { const code = e.code ?? 'VALIDATION_ERROR'; throw new HttpException({ code, message: e.message }, isRegisteredCode(code) ? ERROR_REGISTRY[code].status : 400); }
        if (e?.name === 'ForbiddenError') throw new ForbiddenException(e.message);
        throw e;
      }
    }
    const o = await this.svc().captureForPos(s, ticketId, { attemptKey: String(b?.attemptKey || ''), terminalId: b?.terminalId ?? null, stationId: b?.stationId ?? null });
    return posTerminalResult(o);
  }

  @Post('tickets/:ticketId/pay/terminal/cancel') @RequirePermission('pos.checkout.take_payment')
  cancel(@Req() r: any, @Param('ticketId') ticketId: string): Promise<PosTerminalCancelResult> { const s = scopeFrom(r); return this.svc().cancelForPos(s, ticketId); }
}
