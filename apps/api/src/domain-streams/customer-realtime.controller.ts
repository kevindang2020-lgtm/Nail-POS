// customer-realtime.controller.ts — the Customer App stream. Rooms: the customer's OWN room plus the branch
// they are checked into — both resolved from the session (§13/§15). Frames carry event names only (§22): the
// customer app refetches its own appointment/queue state, and never receives another customer's data.
// Stream behaviour lives in RealtimeStreamFactory (§7).
import { Controller, Sse, Req, Inject, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CustomerAuthGuard } from '@aipowersalon/permissions/guards';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';
import { rooms } from '@aipowersalon/realtime-contracts';
import type { CustomerDataPort } from '../customer/customer.repository';

// the CUSTOMER realm's stream (wave 4: it carried the POS TenantAuthGuard, which refuses every customer — 403 on every
// live screen of the Customer App)
@UseGuards(CustomerAuthGuard)
@Controller('customer')
export class CustomerRealtimeController {
  constructor(private readonly streams: RealtimeStreamFactory, @Inject('CustomerDataPort') private readonly repo: CustomerDataPort) {}

  @Sse('stream')
  stream(@Req() req: any): Observable<MessageEvent> {
    const c = req?.ctx || {};
    const cctx = { tenantId: c.tenantId, branchId: '', userId: c.userId } as any;
    return this.streams.open(req, async () => {
      let customerId: string | null = null;
      try { customerId = await this.repo.resolveCustomerId(cctx); } catch { customerId = null; }
      let branchId: string | null = null;
      try { branchId = customerId ? await this.repo.customerBranchId(cctx, customerId) : null; } catch { branchId = null; }
      // Constitution 9 §14/§222: the customer's ACTIVE TICKET room. Constitution 8's projection consumer fans
      // ticket_service_line_added/updated/removed to rooms.ticket(id) for exactly this app — and until now nothing
      // subscribed to that room, so a service line added or removed while the customer watched their visit reached
      // no one. Resolved from the session like every other room (§13); absent when they have no visit in progress.
      let ticketId: string | null = null;
      try { ticketId = customerId ? (await this.repo.activeService(cctx, customerId))?.ticketId ?? null : null; } catch { ticketId = null; }
      return [
        branchId ? rooms.tenantBranch(c.tenantId, branchId) : null,
        customerId ? rooms.customer(customerId) : null,
        ticketId ? rooms.ticket(ticketId) : null,
      ].filter((x): x is string => !!x);
    }, { frame: 'event-only' });
  }
}
