// ai-readiness.service.ts — reads AI provider env (presence only, never the key values) → readiness report telling the
// operator whether Copilot drafts will be LLM-polished. Same safe pattern as messaging readiness.
import { Injectable, Controller, Get, UseGuards, Module } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { evaluateAiReadiness, type AiReadinessReport } from './ai-readiness-core';

@Injectable()
export class AiReadinessService {
  report(): AiReadinessReport {
    const env = process.env;
    return evaluateAiReadiness({ hasOpenAI: !!env.OPENAI_API_KEY, hasAnthropic: !!env.ANTHROPIC_API_KEY, hasGemini: !!env.GEMINI_API_KEY });
  }
}

@Controller('super-admin/ai')
@UseGuards(SuperAdminGuard)
export class AiReadinessController {
  constructor(private readonly svc: AiReadinessService) {}
  @Get('readiness') readiness() { return this.svc.report(); }
}

@Module({ controllers: [AiReadinessController], providers: [AiReadinessService], exports: [AiReadinessService] })
export class AiReadinessModule {}
