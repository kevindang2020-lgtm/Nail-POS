// terminal-cancel.controller.ts — Oct 21 2026 (Oct 19 audit item, rebuilt): the front desk calls off a Bolt terminal prompt
// that is waiting for a card (the guest walked away or chose cash). Front-desk work, like operating the display
// (pos.customer_display.operate). The answer says whether the terminal was told; the display session's own stream
// carries the 'cancelled' outcome when the terminal lets go.
import { Controller, Inject, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import type { TerminalCapturePort } from './terminal-capture.service';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-display')
export class POSTerminalCancelController {
  constructor(@Optional() @Inject('TerminalCapturePort') private readonly capture?: TerminalCapturePort) {}

  @Post('sessions/:sessionId/cancel-terminal') @RequirePermission('pos.customer_display.operate')
  async cancel(@Req() r: any, @Param('sessionId') sessionId: string): Promise<{ cancelled: boolean; reason?: string }> {
    const tenantId = String(r?.ctx?.tenantId ?? '');
    if (!this.capture || typeof this.capture.cancel !== 'function') return { cancelled: false, reason: 'NOT_SUPPORTED' };
    return this.capture.cancel(tenantId, sessionId);
  }
}
