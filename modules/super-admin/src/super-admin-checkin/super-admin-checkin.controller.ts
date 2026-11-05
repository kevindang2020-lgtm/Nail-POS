// super-admin-checkin.controller.ts — SuperAdminGuard-only, READ-ONLY cross-tenant kiosk Check-in activity (Booking &
// Check-in, Phase 9). One route: the platform check-in aggregation. No write routes (tenants manage kiosks via the
// Check-In Devices surface). Mirrors super-admin-staff.
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminCheckinService, type AdminCtx } from './super-admin-checkin.service';
import { SuperAdminCheckinControllerListQueries } from './super-admin-checkin.list-queries';

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminCheckinControllerListQueries)
@Controller('super-admin/checkin')
export class SuperAdminCheckinController {
  constructor(private readonly svc: SuperAdminCheckinService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    return this.svc.getOverview(ctxFrom(r), { search: q?.search, status: q?.status, limit: q?.limit }).then((o) => ({ ok: true, ...o }));
  }
}
