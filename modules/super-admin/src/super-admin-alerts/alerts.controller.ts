// alerts.controller.ts — SUPER_ADMIN-guarded HTTP surface for Alerts. Static routes are declared before ':id'.
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminAlertsService, type Actor } from './alerts.service';
import { SuperAdminAlertsControllerListQueries } from './alerts.list-queries';
import { ALERT_NOTE_BODY, ALERT_STATUS_BODY } from '../request-schemas-audit';   // BUILD_PLAN Phase 12 (#17)

function actorFrom(r: any): Actor { return { userId: r?.ctx?.userId, ip: safeInet(r?.ip) ?? undefined }; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminAlertsControllerListQueries)
@Controller('super-admin/alerts')
export class SuperAdminAlertsController {
  constructor(private readonly svc: SuperAdminAlertsService) {}

  @Get('recent') recent(@Query() q: any) { return this.svc.recent(+q?.limit || 5); }
  @Get('summary') summary() { return this.svc.summary(); }
  @Get('unread-count') unread() { return this.svc.unreadCount(); }
  @Post('mark-all-read') markAll(@Req() r: any) { return this.svc.markAllRead(actorFrom(r)); }
  @Post('sync') sync(@Req() r: any) { return this.svc.sync(actorFrom(r)); }

  @Get() list(@Query() q: any) {
    return this.svc.list({
      search: q?.search, severity: q?.severity, type: q?.type, status: q?.status, tenantId: q?.tenantId,
      sortBy: q?.sortBy, sortDirection: q?.sortDirection, page: +q?.page || 1, limit: +q?.limit || 25,
    });
  }
  @Get(':id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Patch(':id/status') setStatus(@Param('id') id: string, @Body(ValidatedBody(ALERT_STATUS_BODY, { strict: true })) b: any, @Req() r: any) { return this.svc.setStatus(id, b?.status, actorFrom(r)); }
  @Post(':id/notes') note(@Param('id') id: string, @Body(ValidatedBody(ALERT_NOTE_BODY, { strict: true })) b: any, @Req() r: any) { return this.svc.addNote(id, b?.note, actorFrom(r)); }
}
