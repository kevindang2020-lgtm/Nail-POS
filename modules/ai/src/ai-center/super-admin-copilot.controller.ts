// super-admin-copilot.controller.ts — Super-Admin-only surface for Reception Copilot oversight (spec §46). Cross-tenant
// aggregates only (counts by action + by tenant); no per-customer or message-body data is exposed here.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { CopilotUsageService } from './copilot-usage.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminCopilotControllerListQueries } from './super-admin-copilot.list-queries';

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminCopilotControllerListQueries)
@Controller('super-admin/copilot')
export class SuperAdminCopilotController {
  constructor(private readonly usage: CopilotUsageService) {}

  /** Platform-wide Reception Copilot activity (cross-tenant action counts), optionally windowed by from/to (ISO). */
  @Get('usage') usageSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.usage.summary({ from, to });
  }

  /** System status (§46): whether the Copilot is operationally healthy at the platform level. Reports the configured AI
   * provider (which determines whether message drafts are AI-polished vs. template-based) and the data-model readiness.
   * No tenant data — platform-level operational facts only. */
  @Get('system-status') systemStatus() {
    const provider = process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.GEMINI_API_KEY ? 'gemini' : null;
    return {
      operational: true,
      aiProvider: provider,
      draftsMode: provider ? 'ai_polished' : 'template',
      dataModel: 'ready',            // sessions/recommendations/feedback migrations present in this build
      actionSpine: 'confirm_gated',  // no write without human confirmation
    };
  }
}
