// system-health.controller.ts — GET /super-admin/system-health → real process + DB metrics. SUPER_ADMIN only.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SystemHealthService } from './system-health.service';

@Controller('super-admin/system-health')
@UseGuards(SuperAdminGuard)
export class SystemHealthController {
  constructor(private readonly svc: SystemHealthService) {}
  @Get() health() { return this.svc.getHealth(); }
}
