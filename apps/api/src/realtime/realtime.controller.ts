// realtime.controller.ts — the POS stream. Server-Sent Events (see REALTIME_ARCHITECTURE_AUDIT.md Phase 3: SSE is
// preserved — push here is server→client only, it rides the existing HTTP/Vite proxy, and the browser's
// EventSource reconnects natively). Everything about HOW a stream behaves lives in RealtimeStreamFactory (§7 one
// gateway); this controller only says WHICH rooms a POS principal gets — derived from the server context (§13).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Sse, Req, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RealtimeStreamFactory } from './realtime-stream';
import { rooms } from '@aipowersalon/realtime-contracts';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly streams: RealtimeStreamFactory) {}

  @Sse('stream')
  @RequirePermission('pos.login')
  stream(@Req() req: any): Observable<MessageEvent> {
    const c = req?.ctx || {};
    return this.streams.open(req, () => [rooms.tenantBranch(c.tenantId, c.branchId)], { frame: 'full' });
  }
}
