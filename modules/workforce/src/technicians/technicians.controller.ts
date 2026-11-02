// technicians.controller.ts — tenant POS Technicians HTTP surface (`/pos/technicians/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role from req.ctx (session).
// Literal + :id/sub routes are declared BEFORE the bare ':technicianId' so it never shadows them.
// Pay routes (commission, commission history, payroll summary) require technicians.view_pay — OWNER/MANAGER — never
// the roster read (mandate §72/§122). PATCH ':technicianId' never writes commission (§94; see the service).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { TechniciansService, ForbiddenError, ValidationError, ConflictError } from './technicians.service';
import { LimitExceededError } from '@aipowersalon/platform';
import type { TechniciansContext } from './technicians.repository';
import type { TechnicianFilters, CreateTechnicianRequest, UpdateTechnicianRequest, ChangeTechnicianStatusRequest } from './technicians.dto';
import { ScheduleVersionConflict } from './technicians.dto';
import type { EmploymentHistoryResponse } from '@aipowersalon/api-contracts/tenant';   // wire type (§128)
import { ListQueries } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';   // TM-03: a retried technician create replays, never creates a second one
import { TechniciansControllerListQueries } from './technicians.list-queries';
import { TECH_APP_ACCESS_BODY, TECH_COMMISSION_BODY, TECH_CREATE_BODY, TECH_IMPORT_BODY, TECH_LOOKUP_BODY, TECH_PERMISSIONS_BODY, TECH_SALON_COMMISSION_BODY, TECH_SCHEDULE_BODY, TECH_SERVICES_BODY, TECH_SHIFT_BODY, TECH_SKILLS_BODY, TECH_SUSPEND_BODY, TECH_UPDATE_BODY } from '../request-schemas';

function ctxFrom(req: any): TechniciansContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): TechnicianFilters {
  const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v));
  return { search: q.search, status: q.status, workingStatus: q.workingStatus, skillGroup: q.skillGroup, serviceCategory: q.serviceCategory, techAppEnabled: q.techAppEnabled, canProcessPayment: q.canProcessPayment, missingSchedule: q.missingSchedule, missingMapping: q.missingMapping, shiftStatus: q.shiftStatus, page: n(q.page), pageSize: n(q.pageSize), role: q.role || undefined, branchId: q.branchId || undefined };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof LimitExceededError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    if (e instanceof ScheduleVersionConflict) throw new HttpException({ code: e.code, message: e.message, details: { currentVersion: e.currentVersion } }, HttpStatus.CONFLICT);
    if (e instanceof ConflictError) throw new HttpException({ message: e.message, code: e.code, currentVersion: e.currentVersion }, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TechniciansControllerListQueries)
@Controller('pos/technicians')
export class TechniciansController {
  constructor(private readonly svc: TechniciansService) {}

  // literal GETs first
  @Get('state') @RequirePermission('pos.technicians.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.technicians.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('search') @RequirePermission('pos.technicians.view') search(@Req() r: any, @Query() q: any) { return run(() => this.svc.search(ctxFrom(r), filtersFrom(q))); }
  // Technicians qualified for a service (skill search + the Request-Help helper picker). Eligibility is server-derived.
  @Get('qualified') @RequirePermission('pos.technicians.view') qualified(@Req() r: any, @Query() q: any) { return run(() => this.svc.listQualified(ctxFrom(r), String(q?.serviceId || ''))); }
  @AsyncExport({ kind: 'pos.technicians.export' }) @Get('export') @RequirePermission('pos.technicians.export') export(@Req() r: any, @Query() q: any) { return run(() => this.svc.export(ctxFrom(r), filtersFrom(q))); }
  @Get('salon-commission') @RequirePermission('technicians.view_pay') getSalonComm(@Req() r: any) { return run(() => this.svc.getSalonCommission(ctxFrom(r))); }
  @Patch('salon-commission') @RequirePermission('pos.technicians.commission.edit') setSalonComm(@Req() r: any, @Body(ValidatedBody(TECH_SALON_COMMISSION_BODY, { strict: true })) b: any) { return run(() => this.svc.setSalonCommission(ctxFrom(r), b)); }

  // list + create + import
  @Get('') @RequirePermission('pos.technicians.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.list(ctxFrom(r), filtersFrom(q))); }
  @Post('lookup') @RequirePermission('pos.technicians.create') lookup(@Req() r: any, @Body(ValidatedBody(TECH_LOOKUP_BODY, { strict: true })) b: any) { return run(() => this.svc.lookup(ctxFrom(r), { phone: b?.phone, email: b?.email })); }
  // TM-03 (Oct 30 2026): an Idempotency-Key (one per create intent, sent by the POS) makes a retried create replay the first answer
  @Idempotent() @Post('') @RequirePermission('pos.technicians.create') create(@Req() r: any, @Body(ValidatedBody(TECH_CREATE_BODY, { strict: true })) b: CreateTechnicianRequest) { return run(() => this.svc.create(ctxFrom(r), b)); }
  @Post('import') @RequirePermission('pos.technicians.import') import(@Req() r: any, @Body(ValidatedBody(TECH_IMPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.import(ctxFrom(r), { csv: b?.csv ?? '', dryRun: b?.dryRun !== false })); }

  // :technicianId/sub-resources (before bare :technicianId)
  @Post(':technicianId/activate') @RequirePermission('pos.technicians.status_change') activate(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.activate(ctxFrom(r), id)); }
  @Post(':technicianId/suspend') @RequirePermission('pos.technicians.status_change') suspend(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_SUSPEND_BODY, { strict: true })) b: ChangeTechnicianStatusRequest) { return run(() => this.svc.suspend(ctxFrom(r), id, b)); }
  @Post(':technicianId/archive') @RequirePermission('pos.technicians.status_change') archive(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.archive(ctxFrom(r), id)); }
  @Post(':technicianId/reactivate') @RequirePermission('pos.technicians.status_change') reactivate(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.reactivate(ctxFrom(r), id)); }

  @Get(':technicianId/employment-history') @RequirePermission('pos.technicians.view') employmentHistory(@Req() r: any, @Param('technicianId') id: string): Promise<EmploymentHistoryResponse> { return run(() => this.svc.employmentHistory(ctxFrom(r), id)); }
  @Get(':technicianId/schedule') @RequirePermission('pos.technicians.view') gSchedule(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getSchedule(ctxFrom(r), id)); }
  @Patch(':technicianId/schedule') @RequirePermission('pos.technicians.schedule.edit') sSchedule(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_SCHEDULE_BODY, { strict: true })) b: any) { return run(() => this.svc.setSchedule(ctxFrom(r), id, b)); }
  @Get(':technicianId/shifts') @RequirePermission('pos.technicians.view') gShift(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getShift(ctxFrom(r), id)); }
  @Patch(':technicianId/shifts') @RequirePermission('pos.technicians.schedule.edit') sShift(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_SHIFT_BODY, { strict: true })) b: any) { return run(() => this.svc.setShift(ctxFrom(r), id, b)); }
  @Get(':technicianId/skills') @RequirePermission('pos.technicians.view') gSkills(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getSkills(ctxFrom(r), id)); }
  @Patch(':technicianId/skills') @RequirePermission('pos.technicians.skills.edit') sSkills(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_SKILLS_BODY, { strict: true })) b: any) { return run(() => this.svc.setSkills(ctxFrom(r), id, b)); }
  @Get(':technicianId/services') @RequirePermission('pos.technicians.view') gServices(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getServices(ctxFrom(r), id)); }
  @Patch(':technicianId/services') @RequirePermission('pos.technicians.skills.edit') sServices(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_SERVICES_BODY, { strict: true })) b: any) { return run(() => this.svc.setServices(ctxFrom(r), id, b)); }
  @Get(':technicianId/commission') @RequirePermission('technicians.view_pay') gComm(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getCommission(ctxFrom(r), id)); }
  @Get(':technicianId/commission-history') @RequirePermission('technicians.view_pay') gCommHist(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getCommissionHistory(ctxFrom(r), id)); }
  @Patch(':technicianId/commission') @RequirePermission('pos.technicians.commission.edit') sComm(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_COMMISSION_BODY, { strict: true })) b: any) { return run(() => this.svc.setCommission(ctxFrom(r), id, b)); }
  @Get(':technicianId/payroll-summary') @RequirePermission('technicians.view_pay') payroll(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.payrollSummary(ctxFrom(r), id)); }
  @Get(':technicianId/app-access') @RequirePermission('pos.technicians.view') gApp(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getAppAccess(ctxFrom(r), id)); }
  @Patch(':technicianId/app-access') @RequirePermission('pos.technicians.app_access.edit') @RequireStepUp() sApp(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_APP_ACCESS_BODY, { strict: true })) b: any) { return run(() => this.svc.setAppAccess(ctxFrom(r), id, b)); }
  @Get(':technicianId/permissions') @RequirePermission('pos.technicians.view') gPerms(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.getPermissions(ctxFrom(r), id)); }
  // Security Deep Scan C7: server-enforced step-up
  @RequireStepUp() @Patch(':technicianId/permissions') @RequirePermission('pos.technicians.permissions.edit') sPerms(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_PERMISSIONS_BODY, { strict: true })) b: any) { return run(() => this.svc.setPermissions(ctxFrom(r), id, b)); }

  // bare :technicianId LAST
  @Get(':technicianId') @RequirePermission('pos.technicians.view') detail(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Patch(':technicianId') @RequirePermission('pos.technicians.edit') update(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(TECH_UPDATE_BODY, { strict: true })) b: UpdateTechnicianRequest) { return run(() => this.svc.update(ctxFrom(r), id, b)); }
}
