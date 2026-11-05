// deals.tech.controller.ts — Technician App "My Deals". Route: tech/deals. Authenticated by the global tech middleware
// (req.ctx); no @RequirePermission (any authenticated technician), because the salon's technician-deal POLICY — not an
// RBAC permission — decides whether creation is allowed, and that's enforced in DealsService against deal_settings.
// A technician only ever sees/acts on their own deals (ownership enforced server-side).
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TECH_DEAL_BODY } from '../request-schemas';
import { Controller, Get, Post, Body, Param, Req, HttpException, HttpStatus } from '@nestjs/common';
import { RequirePermission } from '@aipowersalon/permissions/guards';
import { DealsService, DealForbiddenError, DealValidationError, DealConflictError } from './deals.service';
import type { DealContext } from './deals.dto';

function ctxFrom(req: any): DealContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], technicianId: c.technicianId ?? null };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DealForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof DealValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DealConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    throw e;
  }
}

@Controller('tech/deals')
export class DealsTechController {
  constructor(private readonly svc: DealsService) {}

  // The Tech App reads settings first to show an honest "deals are off" state when the salon disallows them.
  @RequirePermission('tech.dashboard.view') @Get('settings') settings(@Req() r: any) { return run(() => this.svc.techGetSettings(ctxFrom(r))); }

  // the technician's own services at the menu price — services.view, which every staff role (technicians included) holds
  @Get('services') @RequirePermission('services.view') services(@Req() r: any) { return run(() => this.svc.techServices(ctxFrom(r))); }

  @RequirePermission('tech.dashboard.view') @Get() myDeals(@Req() r: any) { return run(() => this.svc.techListMyDeals(ctxFrom(r))); }

  @RequirePermission('tech.deals.manage') @Post() create(@Req() r: any, @Body(ValidatedBody(TECH_DEAL_BODY)) b: any) { return run(() => this.svc.techCreateDeal(ctxFrom(r), b || {})); }

  @RequirePermission('tech.deals.manage') @Post(':id/submit') submit(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.techSubmit(ctxFrom(r), id)); }

  @RequirePermission('tech.deals.manage') @Post(':id/pause') pause(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.techPause(ctxFrom(r), id)); }
}
