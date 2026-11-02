// super-admin-realtime.controller.ts — Constitution 9 Phase 20: GET /super-admin/stream. The Super Admin browser
// subscribes to the PLATFORM room only (§146: never a branch's raw stream) and receives `platform_ops_snapshot`
// aggregates (§60). Stream behaviour comes from RealtimeStreamFactory (§7); presence and authorization
// revalidation are tenant-scoped and do not apply to a platform principal — SuperAdminGuard, origin validation,
// the connect limiter, sequence numbers and session revocation still do.
import { Controller, Sse, Req, UseGuards, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { RealtimeStreamFactory } from '../realtime/realtime-stream';
import { rooms } from '@aipowersalon/realtime-contracts';

@UseGuards(SuperAdminGuard)
@Controller('super-admin')
export class SuperAdminRealtimeController {
  constructor(private readonly streams: RealtimeStreamFactory) {}

  @Sse('stream')
  stream(@Req() req: any): Observable<MessageEvent> {
    return this.streams.open(req, () => [rooms.platform()], { frame: 'full' });
  }
}
