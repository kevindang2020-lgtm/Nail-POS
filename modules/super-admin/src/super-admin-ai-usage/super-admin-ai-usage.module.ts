import { SECRET_SEALERS, type SecretSealers } from '@aipowersalon/security';
import { Body, Controller, Get, Post, Query, Req, UseGuards, Module } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { AiUsageConfigService } from './ai-usage-config.service';
import { InMemoryUsageConfigRepo, type UsageConfigRepo } from './ai-usage-config.repository';
import { KyselyUsageConfigRepo } from './ai-usage-config.kysely.repository';
import { AiUsageConfigControllerListQueries } from './super-admin-ai-usage.module.list-queries';
import { AI_PROMPT_BODY, AI_PROVIDER_BODY, AI_PROVIDER_STATUS_BODY } from '../request-schemas-ai';   // BUILD_PLAN Phase 12 (#17)

const actor = (req: any): string | null => req?.ctx?.userId || req?.user?.id || null;

@UseGuards(SuperAdminGuard)
@ListQueries(AiUsageConfigControllerListQueries)
@Controller('super-admin/ai-usage')
export class AiUsageConfigController {
  constructor(private readonly svc: AiUsageConfigService) {}

  @Get('overview') overview(@Query() q: any) { return this.svc.getOverview({ tenantId: q?.tenantId || undefined }); }
  // Save a provider. The API key (if provided) is encrypted immediately; the response contains only a mask + fingerprint.
  @Post('providers') saveProvider(@Body(ValidatedBody(AI_PROVIDER_BODY, { strict: true })) b: any, @Req() r: any) { return this.svc.saveProvider({ providerKey: b?.providerKey, displayName: b?.displayName, apiKey: b?.apiKey, defaultModel: b?.defaultModel, status: b?.status, createdByUserId: actor(r) }); }
  @Post('providers/status') setStatus(@Body(ValidatedBody(AI_PROVIDER_STATUS_BODY, { strict: true })) b: any) { return this.svc.setProviderStatus(b?.providerKey, b?.status); }
  @Get('prompts') listPrompts() { return this.svc.listPrompts(); }
  @Post('prompts') savePrompt(@Body(ValidatedBody(AI_PROMPT_BODY, { strict: true })) b: any, @Req() r: any) { return this.svc.savePrompt({ promptKey: b?.promptKey, name: b?.name, body: b?.body, status: b?.status, updatedByUserId: actor(r) }); }
}

const USAGE_CONFIG_REPO = Symbol('USAGE_CONFIG_REPO');

@Module({
  controllers: [AiUsageConfigController],
  providers: [
    { provide: USAGE_CONFIG_REPO, useFactory: (db: AppDatabase): UsageConfigRepo => (db ? new KyselyUsageConfigRepo(db) : new InMemoryUsageConfigRepo()), inject: [DATABASE] },
    { provide: AiUsageConfigService, useFactory: (repo: UsageConfigRepo, sealers: SecretSealers) => new AiUsageConfigService(repo, sealers.forPurpose('ai_provider')), inject: [USAGE_CONFIG_REPO, SECRET_SEALERS] },
  ],
  exports: [AiUsageConfigService],
})
export class SuperAdminAiUsageModule {}
