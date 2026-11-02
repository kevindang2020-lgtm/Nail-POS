// ai-business-admin.controller.ts — Super Admin surface for ai_business adoption (§40). SUPER_ADMIN only (its own
// guard, distinct from the tenant controller). Returns platform aggregates; no tenant private data.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import type { AiBusinessAdminRepositoryPort, AiBusinessAdminOverview } from './ai-business-admin.repository';

export class AiBusinessAdminService {
  constructor(private readonly repo: AiBusinessAdminRepositoryPort) {}
  overview(): Promise<AiBusinessAdminOverview> { return this.repo.overview(); }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/ai-business')
export class AiBusinessAdminController {
  constructor(private readonly svc: AiBusinessAdminService) {}

  // Adoption overview: saved-question and alert counts across all tenants. Model usage/cost is on the existing
  // Super Admin AI Usage panel (ai_usage_logs GROUP BY package_code) — not duplicated here.
  @Get('overview')
  overview() { return this.svc.overview(); }
}
