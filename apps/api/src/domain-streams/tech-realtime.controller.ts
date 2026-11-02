// tech-realtime.controller.ts — the Technician App stream. Rooms: the branch room plus the technician's OWN room
// (assignments, help requests, follow-up tasks, earnings) — the technician id is resolved from the session, so a
// technician can only ever receive their own events (§13/§16). Frames carry event names only (§22 payload
// minimization: the app refetches what it needs). Stream behaviour lives in RealtimeStreamFactory (§7).
import { Controller, Sse, Req, Inject, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequirePermission, TenantAuthGuard } from '@aipowersalon/permissions/guards';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';
import { rooms } from '@aipowersalon/realtime-contracts';
import type { TechContext, TechDataPort } from '@aipowersalon/queue';

@UseGuards(TenantAuthGuard)
@Controller('tech')
export class TechRealtimeController {
  constructor(private readonly streams: RealtimeStreamFactory, @Inject('TechDataPort') private readonly repo: TechDataPort) {}

  @RequirePermission('tech.dashboard.view') @Sse('stream')
  stream(@Req() req: any): Observable<MessageEvent> {
    const c = req?.ctx || {};
    const ctx: TechContext = { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions || [] };
    return this.streams.open(req, async () => {
      let technicianId: string | null = null;
      try { technicianId = await this.repo.resolveTechnicianId(ctx); } catch { technicianId = null; }
      return [
        c.tenantId && c.branchId ? rooms.tenantBranch(c.tenantId, c.branchId) : null,
        technicianId ? rooms.technician(technicianId) : null,
      ].filter((x): x is string => !!x);
    }, { frame: 'event-only' });
  }
}
