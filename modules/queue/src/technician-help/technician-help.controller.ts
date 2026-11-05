import { RequirePermission } from '@aipowersalon/permissions/guards';
// technician-help.controller.ts — /tech/help-requests. Thin: resolves the acting technician from the session (reusing
// the tech module's resolveTechnicianId), calls TechnicianHelpService, maps HelpError → HTTP. Both the primary
// (create) and the helper (accept/decline/list) act as their own technician identity; a manager/POS create path is a
// later addition. Auth context (req.ctx) is set by the same middleware the other /tech routes rely on.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { HELP_CREATE_BODY, HELP_DECLINE_BODY } from '../request-schemas';
import { BadRequestException, Body, Controller, ConflictException, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { TechnicianHelpService, HelpError, type HelpActor } from './technician-help.service';
import type { TechContext, TechDataPort } from '../tech/tech.repository';
import { ListQueries } from '@aipowersalon/database';
import { TechnicianHelpControllerListQueries } from './technician-help.list-queries';

function ctxFrom(req: any): TechContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof HelpError) {
      if (e.status === 403) throw new ForbiddenException(e.message);
      if (e.status === 404) throw new NotFoundException(e.message);
      if (e.status === 409) throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@ListQueries(TechnicianHelpControllerListQueries)
@Controller('tech/help-requests')
export class TechnicianHelpController {
  constructor(
    private readonly svc: TechnicianHelpService,
    @Inject('TechDataPort') private readonly techRepo: TechDataPort,
  ) {}

  private async actor(req: any): Promise<HelpActor> {
    const ctx = ctxFrom(req);
    const technicianId = await this.techRepo.resolveTechnicianId(ctx).catch(() => null);
    if (!technicianId) throw new HelpError('You are not registered as a technician.', 403, 'not_technician');
    return { tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, userId: ctx.userId };
  }

  @RequirePermission('tech.ticket.transfer_request') @Post() create(@Req() r: any, @Body(ValidatedBody(HELP_CREATE_BODY)) b: any) {
    return run(async () => this.svc.createRequest(await this.actor(r), {
      ticketId: b?.ticketId, serviceLineId: b?.serviceLineId, helperTechnicianId: b?.helperTechnicianId, reason: b?.reason, note: b?.note ?? null,
    }));
  }
  @RequirePermission('tech.ticket.accept') @Get() list(@Req() r: any) { return run(async () => this.svc.listForHelper(await this.actor(r))); }
  // Helper picker for the primary: qualified technicians for a given line's service (service resolved server-side).
  @RequirePermission('tech.ticket.transfer_request') @Get('qualified') qualified(@Req() r: any, @Query() q: any) {
    return run(async () => this.svc.qualifiedForLine(await this.actor(r), String(q?.ticketId || ''), String(q?.serviceLineId || '')));
  }
  @RequirePermission('tech.ticket.accept') @Post(':id/accept') accept(@Req() r: any, @Param('id') id: string) { return run(async () => this.svc.accept(await this.actor(r), id)); }
  @RequirePermission('tech.ticket.decline') @Post(':id/decline') decline(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(HELP_DECLINE_BODY)) b: any) { return run(async () => this.svc.decline(await this.actor(r), id, b?.reason)); }
}
