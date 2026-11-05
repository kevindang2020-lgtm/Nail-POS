import { Controller, Get, Post, Patch, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { safeInet } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IncidentService, IncidentError } from './incident.service';
import { SEC_INCIDENT_BODY, SEC_INCIDENT_TRANSITION_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof IncidentError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const actorOf = (r: any) => ({ userId: r?.ctx?.userId || null, role: r?.ctx?.role || null, name: r?.ctx?.name || null, ip: (safeInet(r?.ip) ?? undefined) || null });

@UseGuards(SuperAdminGuard)
@Controller('super-admin/security/incidents')
export class IncidentController {
  constructor(private readonly svc: IncidentService) {}
  @Get() list() { return run(() => this.svc.list(20)); }
  @Get('workflow') workflow() { return run(() => this.svc.workflow()); }
  @Get(':id') get(@Param('id') id: string) { return run(() => this.svc.get(id)); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(SEC_INCIDENT_BODY)) b: any) { return run(() => this.svc.create({ title: b?.title, description: b?.description, category: b?.category, severity: b?.severity, detectionSource: b?.detectionSource, tenantId: b?.tenantId, branchId: b?.branchId, assignedTo: b?.assignedTo, correlationId: b?.correlationId }, actorOf(r))); }
  @Patch(':id/transition') transition(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SEC_INCIDENT_TRANSITION_BODY)) b: any) { return run(() => this.svc.transition(id, b?.toStatus, b?.reason ?? null, actorOf(r))); }
}
