// technician-certifications.controller.ts — HTTP surface for certifications (migration 584; merged Oct 12 2026).
//   Technician App (/tech/certifications/*): the technician's OWN rows — list / add / edit / delete (unverified only).
//   POS (/pos/technician-certifications/:technicianId/*): a manager lists and VERIFIES / REVOKES —
//   pos.technicians.skills.edit, the permission that gates the eligibility edits, because verification feeds eligibility.
// Theirs had no guard and no permission on the Technician App half; ours is default-deny like every other /tech route.
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { T_CERT_BODY, T_CERT_VERIFY_BODY } from '../request-schemas';
import { TechnicianCertificationsService } from './technician-certifications';
import { TechError } from './tech-errors';
import type { TechContext } from './tech.repository';
import type { TechCertificationBody, TechCertificationDeleted, TechCertificationView } from '@aipowersalon/api-contracts/tenant';

function ctxFrom(req: any): TechContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof TechError || e?.name === 'TechError') {
      if (e.code === 'forbidden' || e.code === 'not_technician') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tech/certifications')
export class TechCertificationsController {
  constructor(private readonly svc: TechnicianCertificationsService) {}
  @RequirePermission('tech.dashboard.view') @Get() list(@Req() r: any): Promise<TechCertificationView[]> { return run(() => this.svc.listMine(ctxFrom(r))); }
  @RequirePermission('tech.profile.edit') @Post() create(@Req() r: any, @Body(ValidatedBody(T_CERT_BODY, { strict: true })) b: TechCertificationBody): Promise<TechCertificationView> { return run(() => this.svc.createMine(ctxFrom(r), b ?? {})); }
  @RequirePermission('tech.profile.edit') @Patch(':id') update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(T_CERT_BODY, { strict: true })) b: TechCertificationBody): Promise<TechCertificationView> { return run(() => this.svc.updateMine(ctxFrom(r), id, b ?? {})); }
  @RequirePermission('tech.profile.edit') @Delete(':id') remove(@Req() r: any, @Param('id') id: string): Promise<TechCertificationDeleted> { return run(() => this.svc.deleteMine(ctxFrom(r), id)); }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/technician-certifications')
export class PosTechnicianCertificationsController {
  constructor(private readonly svc: TechnicianCertificationsService) {}
  @RequirePermission('pos.technicians.view') @Get(':technicianId') list(@Req() r: any, @Param('technicianId') technicianId: string): Promise<TechCertificationView[]> { return run(() => this.svc.listForTechnician(ctxFrom(r).tenantId, technicianId)); }
  @RequirePermission('pos.technicians.skills.edit') @Post(':technicianId/:certificationId/verify') verify(@Req() r: any, @Param('technicianId') technicianId: string, @Param('certificationId') certificationId: string, @Body(ValidatedBody(T_CERT_VERIFY_BODY, { strict: true })) b: any): Promise<TechCertificationView> {
    const c = ctxFrom(r);
    return run(() => this.svc.verify({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId }, technicianId, certificationId, b ?? {}));
  }
}
