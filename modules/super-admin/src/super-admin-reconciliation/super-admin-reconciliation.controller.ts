// super-admin-reconciliation.controller.ts — SuperAdminGuard-gated platform oversight for AI Deposit
// Reconciliation. Read-only aggregates; no tenant financial detail.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminReconService } from './super-admin-reconciliation.service';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/reconciliation')
export class SuperAdminReconController {
  constructor(private readonly svc: SuperAdminReconService) {}
  @Get('overview')
  overview() { return this.svc.overview(); }
}
