// stream-ticket.controller.ts — BUILD_PLAN Phase 13 (Constitution 6 §28–32, bug 1): POST /realtime/stream-ticket.
// A signed-in native app (bearer) asks for a single-use 60-second ticket and opens its realm's SSE stream with
// `?ticket=` — never a bearer token in a URL. Any signed-in salon / customer session may ask (the STREAM it opens still
// enforces its own permission); an integration key may not. The path is realm 'any' (session-from-request.ts) so a
// customer's token and a staff token are both read here; the ticket records which realm it belongs to.
import { Controller, Post, Req, UseGuards, HttpCode } from '@nestjs/common';
import { TenantAuthGuard, ResourceScope } from '@aipowersalon/permissions/guards';
import { sessionFromRequest } from '@aipowersalon/identity';
import type { StreamTicketResponse } from '@aipowersalon/api-contracts';
import { StreamTicketService } from './stream-tickets';

@UseGuards(TenantAuthGuard)
@ResourceScope('OWN')   // §38: a ticket for the caller's own session (the stream enforces its own permission)
@Controller('realtime')
export class StreamTicketController {
  constructor(private readonly tickets: StreamTicketService) {}

  @Post('stream-ticket')
  @HttpCode(200)
  async issue(@Req() req: any): Promise<StreamTicketResponse> {
    const claims = req.session || sessionFromRequest(req, process.env.AUTH_SESSION_SECRET || '');
    return this.tickets.issue({ claims, sessionId: req.sessionId ?? null, actorType: req.ctx?.actorType, deviceId: req.headers?.['x-device-id'] });
  }
}
