// owner-realtime.controller.ts — the Owner App stream. Rooms: the owner's tenant-wide room (alerts, payroll,
// reports) plus their home branch room. Everything about how the stream behaves — sequence numbers, resync on
// reconnect, slow-client cap, origin check, connect limit, presence, session revocation, authorization
// revalidation — lives in RealtimeStreamFactory (Constitution 9 §7: one gateway). Rooms are derived from the
// server context, never the client (§13).
import { Controller, Sse, Req, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantAuthGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';
import { rooms } from '@aipowersalon/realtime-contracts';

@UseGuards(TenantAuthGuard)
@Controller('owner')
export class OwnerRealtimeController {
  constructor(private readonly streams: RealtimeStreamFactory) {}

  // Constitution 5 Step 8 audit (Oct 4 2026): the owner room carries alerts, payroll and report events in FULL frames,
  // and the route had no key — any staff session (front desk, technician) could subscribe. Same key as every owner-app
  // read (OwnerService requires owner.dashboard.view): OWNER and MANAGER keep it, nobody else gains it.
  @RequirePermission('owner.dashboard.view')
  @Sse('stream')
  stream(@Req() req: any): Observable<MessageEvent> {
    const c = req?.ctx || {};
    return this.streams.open(req, () => [
      c.tenantId ? rooms.ownerTenant(c.tenantId) : null,
      c.tenantId && c.branchId ? rooms.tenantBranch(c.tenantId, c.branchId) : null,
    ].filter((x): x is string => !!x), { frame: 'full' });
  }
}
