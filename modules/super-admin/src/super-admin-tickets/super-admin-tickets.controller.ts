// super-admin-tickets.controller.ts — SuperAdminGuard-only, READ-ONLY platform ticket oversight (epic Req §10).
// GET list (filterable by tenant/status/search) + GET full history for any ticket. No write routes by design.
import { Controller, Get, HttpException, HttpStatus, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminTicketsService, SuperAdminTicketsError, type AdminCtx } from './super-admin-tickets.service';
import { SuperAdminTicketsControllerListQueries } from './super-admin-tickets.list-queries';

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof SuperAdminTicketsError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminTicketsControllerListQueries)
@Controller('super-admin/tickets')
export class SuperAdminTicketsController {
  constructor(private readonly svc: SuperAdminTicketsService) {}

  @Get('') list(@Req() r: any, @Query() q: any) {
    return run(async () => ({ ok: true, ...(await this.svc.listTickets(ctxFrom(r), { tenantId: q?.tenantId, status: q?.status, search: q?.search, dateFrom: q?.dateFrom, dateTo: q?.dateTo, page: q?.page ? Number(q.page) : undefined, pageSize: q?.pageSize ? Number(q.pageSize) : undefined })) }));
  }

  @Get(':ticketId/history') history(@Req() r: any, @Param('ticketId') id: string) {
    return run(async () => ({ ok: true, ...(await this.svc.ticketHistory(ctxFrom(r), id)) }));
  }
}
