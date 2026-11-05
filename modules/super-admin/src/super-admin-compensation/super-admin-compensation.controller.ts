// super-admin-compensation.controller.ts — §27 SuperAdminGuard-only cross-tenant compensation-config oversight.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminCompensationService } from './super-admin-compensation.service';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/compensation')
export class SuperAdminCompensationController {
  constructor(private readonly svc: SuperAdminCompensationService) {}

  @Get('overview') overview() { return this.svc.overview(); }
}
