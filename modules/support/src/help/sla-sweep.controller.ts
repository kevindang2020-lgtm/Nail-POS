// sla-sweep.controller.ts — ops/manual trigger for the SLA first-response breach sweep. Super-Admin only
// (binary SuperAdminGuard). Runs the same idempotent job the cron drives, so triggering it by hand is safe to
// repeat. Returns the {scanned, swept} counts.
import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SlaBreachSweepJob } from './sla-breach-sweep';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/help')
export class SlaSweepController {
  constructor(private readonly sweep: SlaBreachSweepJob) {}

  @Post('sla-sweep') run(@Query('limit') limit?: string) {
    const n = Number(limit);
    return this.sweep.sweep(new Date().toISOString(), Number.isFinite(n) && n > 0 ? Math.min(2000, n) : 500);
  }
}
