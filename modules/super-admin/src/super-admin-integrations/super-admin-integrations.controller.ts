// super-admin-integrations.controller.ts — SuperAdminGuard-only Integrations reads + safe status writes + export.
// Read surface over the platform's real connection signals; write workflows beyond disable/enable (OAuth,
// credential rotation, sync engine, live webhook reprocessing) are separate audited units.

import { Body, Controller, Get, HttpException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { IntegrationPermissionGuard, RequireIntegrationPermission } from './integration-permission.guard';
import { P } from './integration-permissions';
import { SuperAdminIntegrationsService } from './super-admin-integrations.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminIntegrationsControllerListQueries } from './super-admin-integrations.list-queries';
import { INT_REASON_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

const str = (v: unknown): string | undefined => { const x = Array.isArray(v) ? v[0] : v; const s = x == null ? '' : String(x); return s.trim() ? s.trim() : undefined; };
const actorFrom = (r: any): { id?: string; role?: string } => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });
const ERR_MSG: Record<string, string> = {
  unavailable: 'Integrations store is not available.', connection_required: 'A connection is required.',
  reason_required: 'A reason is required.', not_found: 'Connection not found.', write_failed: 'Could not update the connection.',
};
const fail = (res: { error?: string; status?: number }): never => { const c = res.error ?? 'write_failed'; throw new HttpException({ code: c, message: ERR_MSG[c] ?? 'Request failed.' }, res.status ?? 400); };

@ListQueries(SuperAdminIntegrationsControllerListQueries)
@Controller('super-admin/integrations')
@UseGuards(SuperAdminGuard, IntegrationPermissionGuard)
export class SuperAdminIntegrationsController {
  constructor(private readonly svc: SuperAdminIntegrationsService) {}

  private f(q: any) {
    return { integrationType: str(q.integrationType), tenantId: str(q.tenantId), status: str(q.status), authStatus: str(q.authStatus), syncState: str(q.syncState), dateFrom: str(q.dateFrom), dateTo: str(q.dateTo), q: str(q.q) };
  }

  @Get('overview') overview(@Query() q: any) { return this.svc.overview(this.f(q)); }
  @Get('connected') connected(@Query() q: any) { return this.svc.connectedIntegrations(this.f(q)); }
  @Get('webhooks/events') webhookEvents(@Query() q: any) { return this.svc.recentWebhookEvents(this.f(q)); }
  @Get('alerts') alerts(@Query() q: any) { return this.svc.authAlerts(this.f(q)); }
  @Get('errors') errors(@Query() q: any) { return this.svc.errorLogs(this.f(q)); }
  @Get('tenant-usage') tenantUsage(@Query() q: any) { return this.svc.tenantUsage(this.f(q)); }
  @Get('marketplace') marketplace() { return this.svc.marketplace(); }

  @RequireIntegrationPermission(P.export)
  @AsyncExport({ kind: 'super-admin.integrations.export' }) @Get('export')
  async export(@Req() r: any, @Query() q: any) {
    const res = await this.svc.exportReport(actorFrom(r), { ...this.f(q), format: str(q.format) });
    if (!res.ok) fail(res as any);
    return res;
  }

  @RequireIntegrationPermission(P.disable)
  @Post('connections/:id/disable')
  async disable(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_REASON_BODY, { strict: true })) body: any) {
    const res = await this.svc.disableConnection(actorFrom(r), String(id), str(body?.reason));
    if (!res.ok) fail(res as any);
    return res;
  }

  @RequireIntegrationPermission(P.enable)
  @Post('connections/:id/enable')
  async enable(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INT_REASON_BODY, { strict: true })) body: any) {
    const res = await this.svc.enableConnection(actorFrom(r), String(id), str(body?.reason));
    if (!res.ok) fail(res as any);
    return res;
  }
}
