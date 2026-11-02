// provider-reliability.controller.ts — SuperAdmin reliability view + circuit-breaker reset.

import { Body, Controller, Get, HttpException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IntegrationPermissionGuard, RequireIntegrationPermission } from './integration-permission.guard';
import { P } from './integration-permissions';
import { ProviderReliabilityService } from './provider-reliability.service';
import { INT_REASON_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

const actorFrom = (r: any) => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });

@Controller('super-admin/integrations')
@UseGuards(SuperAdminGuard, IntegrationPermissionGuard)
export class ProviderReliabilityController {
  constructor(private readonly svc: ProviderReliabilityService) {}

  @RequireIntegrationPermission(P.apiHealthView)
  @Get('connections/:id/reliability')
  reliability(@Req() r: any, @Param('id') id: string) { return this.svc.getReliability(actorFrom(r), id); }

  @RequireIntegrationPermission(P.apiHealthView)
  @Post('connections/:id/circuit/reset')
  async reset(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_REASON_BODY, { strict: true })) b: any) {
    const res = await this.svc.resetCircuit(actorFrom(r), id, b?.reason);
    if (!res.ok && (res as any).error === 'reason_required') throw new HttpException({ code: 'reason_required', message: 'A reason is required.' }, 400);
    return res;
  }
}
