// workforce-status.controller.ts — read surface for the ONE authoritative technician operational state.
//   GET /pos/workforce-status                   → every technician at the session branch (six statuses each)
//   GET /pos/workforce-status/:technicianId     → one technician
//   POST /pos/workforce-status/:technicianId/unavailable { on: boolean } → manager "not taking customers" flag
// Tenant/branch are server-derived from the session. Writes for clock/break live in /pos/time-clock.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import type { TechnicianWorkforceStateView, WorkforceUnavailableBody } from '@aipowersalon/api-contracts/tenant';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { WorkforceStatusService, WorkforceStateError } from './workforce-status.service';
import { WORKFORCE_UNAVAILABLE_BODY } from '../request-schemas';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof WorkforceStateError) {
      const status = e.code === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
      throw new HttpException({ message: e.message, code: e.code }, status);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/workforce-status')
export class WorkforceStatusController {
  constructor(private readonly svc: WorkforceStatusService) {}

  @Get() @RequirePermission('pos.technicians.view')
  list(@Req() r: any): Promise<TechnicianWorkforceStateView[]> { const c = r?.ctx || {}; return run(() => this.svc.listBranchStates(c.tenantId, c.branchId ?? null)); }

  @Get(':technicianId') @RequirePermission('pos.technicians.view')
  one(@Req() r: any, @Param('technicianId') id: string): Promise<TechnicianWorkforceStateView> {
    const c = r?.ctx || {};
    return run(async () => { const s = await this.svc.getTechnicianState(c.tenantId, id); if (!s) throw new WorkforceStateError('NOT_FOUND', 'Technician not found'); return s; });
  }

  @Post(':technicianId/unavailable') @RequirePermission('pos.technicians.manage_status')
  unavailable(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(WORKFORCE_UNAVAILABLE_BODY)) b: WorkforceUnavailableBody): Promise<TechnicianWorkforceStateView> {
    const c = r?.ctx || {};
    return run(() => (b?.on === false ? this.svc.setAvailable(c.tenantId, id) : this.svc.setUnavailable(c.tenantId, id)));
  }
}
