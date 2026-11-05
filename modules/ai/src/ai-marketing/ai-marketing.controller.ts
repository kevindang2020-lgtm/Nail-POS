// ai-marketing.controller.ts — AI Marketing Assistant read API. DISTINCT route: pos/ai-marketing.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch are server-derived from req.ctx (never client).
// Slice 1 exposes read-only state; no send/mutation endpoints exist yet by design.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AI_MARKETING_APPROVE_BODY, AI_MARKETING_AUDIENCE_BODY, AI_MARKETING_DRAFT_BODY, AI_MARKETING_SUBMIT_BODY } from '../request-schemas';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import {
  AiMarketingService,
  AiMarketingForbiddenError,
  AiMarketingValidationError,
} from './ai-marketing.service';
import {
  AiMarketingContentService,
  ContentForbiddenError,
} from './ai-marketing-content.service';
import { ContentValidationError } from './ai-marketing-content';
import {
  AiMarketingCampaignService,
  CampaignOrchestrationValidationError,
} from './ai-marketing-campaign.service';
import { ForbiddenError, ValidationError, NotFoundError } from '@aipowersalon/communications';
import type { AiMarketingContext } from './ai-marketing.dto';

function ctxFrom(req: any): AiMarketingContext {
  const c = req?.ctx || {};
  return {
    tenantId: c.tenantId,
    branchId: c.branchId ?? '',
    userId: c.userId,
    role: c.role,
    permissions: c.permissions || [],
  };
}

async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiMarketingForbiddenError || e instanceof ContentForbiddenError || e instanceof ForbiddenError) {
      throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    }
    if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (
      e instanceof AiMarketingValidationError ||
      e instanceof ContentValidationError ||
      e instanceof CampaignOrchestrationValidationError ||
      e instanceof ValidationError
    ) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/ai-marketing')
export class AiMarketingController {
  constructor(
    private readonly svc: AiMarketingService,
    private readonly content: AiMarketingContentService,
    private readonly campaigns: AiMarketingCampaignService,
  ) {}

  @Get('state')
  @RequirePermission('pos.marketing.view')
  state(@Req() r: any) {
    return run(() => this.svc.getState(ctxFrom(r)));
  }

  // Aggregate-only audience preview (no customer rows returned). Body = an approved AudienceDefinition.
  @Post('audience/preview')
  @RequirePermission('pos.marketing.view')
  previewAudience(@Req() r: any, @Body(ValidatedBody(AI_MARKETING_AUDIENCE_BODY)) b: any) {
    return run(() => this.svc.previewAudience(ctxFrom(r), b || {}));
  }

  // Generate an EDITABLE draft (SMS/email/push). Never sends; output is validated for invented offers,
  // unknown tokens, raw URLs, and length before it is returned.
  @Post('content/draft')
  @RequirePermission('pos.marketing.view')
  generateDraft(@Req() r: any, @Body(ValidatedBody(AI_MARKETING_DRAFT_BODY)) b: any) {
    return run(() => this.content.generateDraft(ctxFrom(r), b || {}));
  }

  // Approval spine — reuses the existing campaign lifecycle. Approval SCHEDULES; it never sends.
  @Post('campaigns')
  @RequirePermission('pos.marketing.manage')
  submitCampaign(@Req() r: any, @Body(ValidatedBody(AI_MARKETING_SUBMIT_BODY)) b: any) {
    return run(() => this.campaigns.submitForApproval(ctxFrom(r), b || {}));
  }

  @Post('campaigns/:id/approve')
  @RequirePermission('pos.marketing.manage')
  approveCampaign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(AI_MARKETING_APPROVE_BODY)) b: any) {
    return run(() => this.campaigns.approveAndSchedule(ctxFrom(r), id, b?.scheduledAt));
  }

  @Post('campaigns/:id/cancel')
  @RequirePermission('pos.marketing.manage')
  cancelCampaign(@Req() r: any, @Param('id') id: string) {
    return run(() => this.campaigns.cancel(ctxFrom(r), id));
  }

  // Per-campaign results funnel + associated (not causal) revenue.
  @Get('campaigns/:id/results')
  @RequirePermission('pos.marketing.view')
  campaignResults(@Req() r: any, @Param('id') id: string) {
    return run(() => this.campaigns.getResults(ctxFrom(r), id));
  }
}
