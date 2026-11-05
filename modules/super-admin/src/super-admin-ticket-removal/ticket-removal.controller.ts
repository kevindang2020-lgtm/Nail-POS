// ticket-removal.controller.ts — SuperAdminGuard-only deletion-authorization + logical-removal routes (epic Req §10).
// Shares the /super-admin/tickets prefix with the read-only oversight controller (distinct methods/paths, no collision).
import { Body, Controller, ForbiddenException, HttpException, HttpStatus, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TicketRemovalService, TicketRemovalError, type AdminCtx } from './ticket-removal.service';
import { TICKET_REMOVE_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof TicketRemovalError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/tickets')
export class TicketRemovalController {
  constructor(private readonly svc: TicketRemovalService) {}

  @Post(':ticketId/deletion-code') generate(@Req() r: any, @Param('ticketId') id: string) {
    return run(async () => ({ ok: true, ...(await this.svc.generateCode(ctxFrom(r), id)) }));
  }
  @Post(':ticketId/deletion-code/reveal') reveal(@Req() r: any, @Param('ticketId') id: string) {
    return run(async () => ({ ok: true, ...(await this.svc.revealCode(ctxFrom(r), id)) }));
  }
  @Post(':ticketId/remove') remove(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TICKET_REMOVE_BODY)) b: any) {
    return run(async () => ({ ok: true, ...(await this.svc.removeTicket(ctxFrom(r), id, { code: b?.code, reason: b?.reason })) }));
  }
}
