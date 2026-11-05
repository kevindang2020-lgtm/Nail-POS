// billing-cycle.controller.ts — manual trigger for the period-end invoice generator, behind SuperAdminGuard. The worker
// (billing-cycle.scheduler.ts) is off by default; this lets ops run a pass on demand and see the counts.
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminBillingCycleService } from './billing-cycle.service';
import { BILL_CYCLE_RUN_BODY } from '../request-schemas-billing';   // BUILD_PLAN Phase 12 (#17)

@UseGuards(SuperAdminGuard)
@Controller('super-admin/billing/cycle')
export class BillingCycleController {
  constructor(private readonly svc: SuperAdminBillingCycleService) {}

  // POST /super-admin/billing/cycle/run  — body { dryRun?: boolean }. dryRun=true previews (writes nothing).
  @Post('run')
  run(@Body(ValidatedBody(BILL_CYCLE_RUN_BODY)) body: any) { return this.svc.runBillingCycle(Date.now(), 200, !!body?.dryRun); }
}
