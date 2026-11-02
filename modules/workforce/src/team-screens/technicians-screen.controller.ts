// technicians-screen.controller.ts — `/pos/technicians-screen/*`, the read model behind the Technicians Management Center
// (Oct 30 2026). TenantAuthGuard + RolePermissionGuard; tenant / branch / user from the session. Every write stays on
// TechniciansController (create · edit · lifecycle · PATCH :id/services for the mapping assistant · commission).
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, HttpException, HttpStatus, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { TechniciansScreenRepository, TECH_STATUSES, TECH_SHIFTS, TECH_SORTS, TECH_BANDS } from './technicians-screen.repository';
import type { TeamCtx } from './screen-kit';

export const TECHNICIANS_SCREEN = 'TechniciansScreenRepository';
export function teamCtx(req: any): TeamCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
export const per = (q: any) => ({ preset: s(q?.preset), from: s(q?.from), to: s(q?.to) });
export const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const DIRECTORY = { filters: { preset: PRESET, status: { type: 'enum', values: TECH_STATUSES }, shift: { type: 'enum', values: TECH_SHIFTS }, missingMapping: { type: 'enum', values: ['1', 'true', 'false'] },
  role: { type: 'text', maxLength: 60 }, band: { type: 'enum', values: TECH_BANDS }, serviceId: { type: 'uuid' }, sort: { type: 'enum', values: TECH_SORTS }, dateField: { type: 'enum', values: ['created', 'updated'] } },
  search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const SUB = { filters: { preset: PRESET, scope: { type: 'enum', values: ['upcoming', 'past'] } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 8, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const HISTORY = { filters: { preset: PRESET, technicianId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const CERTS = { filters: { state: { type: 'enum', values: ['valid', 'expiring', 'expired', 'all'] } }, maxLimit: 50, defaultLimit: 6, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/technicians-screen')
export class TechniciansScreenController {
  constructor(@Inject(TECHNICIANS_SCREEN) private readonly repo: TechniciansScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The team screen needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }

  @Get('dashboard') @RequirePermission('pos.technicians.view')
  dashboard(@Req() req: any, @Query() q: any) { return this.r().dashboard(teamCtx(req), per(q)); }

  @Get('directory') @RequirePermission('pos.technicians.view') @ListQuery(DIRECTORY)
  directory(@Req() req: any, @Query() q: any) {
    return this.r().directory(teamCtx(req), { q: s(q?.q), status: s(q?.status), shift: s(q?.shift), missingMapping: s(q?.missingMapping), role: s(q?.role), band: s(q?.band), serviceId: s(q?.serviceId),
      sort: s(q?.sort), dateField: s(q?.dateField), ...per(q), page: q?.page, pageSize: q?.pageSize });
  }

  @Get('history') @RequirePermission('pos.technicians.view') @ListQuery(HISTORY)
  history(@Req() req: any, @Query() q: any) { return this.r().history(teamCtx(req), { technicianId: s(q?.technicianId), q: s(q?.q), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('certifications') @RequirePermission('pos.technicians.view') @ListQuery(CERTS)
  certifications(@Req() req: any, @Query() q: any) { return this.r().certifications(teamCtx(req), { state: s(q?.state), page: q?.page, pageSize: q?.pageSize }); }

  @Get(':technicianId/appointments') @RequirePermission('pos.booking.view') @ListQuery(SUB)
  appointments(@Req() req: any, @Param('technicianId') id: string, @Query() q: any) { return this.r().appointments(teamCtx(req), id, { scope: s(q?.scope), page: q?.page, pageSize: q?.pageSize }); }

  @Get(':technicianId/service-history') @RequirePermission('pos.technicians.view') @ListQuery(SUB)
  serviceHistory(@Req() req: any, @Param('technicianId') id: string, @Query() q: any) { return this.r().serviceHistory(teamCtx(req), id, { q: s(q?.q), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get(':technicianId/mapping') @RequirePermission('pos.technicians.view')
  mapping(@Req() req: any, @Param('technicianId') id: string) { return this.r().mappingReview(teamCtx(req), id); }
}
