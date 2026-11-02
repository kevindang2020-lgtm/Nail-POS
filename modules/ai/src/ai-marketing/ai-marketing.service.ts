// ai-marketing.service.ts — orchestration for the read layer. It reads a tenant-scoped MarketingReadModel
// and composes it into the Command Center summary + recommendation cards using PURE builders. It invents
// nothing: no offer, discount, price, expiration, service, or policy is generated here.
import {
  buildRecommendations,
  buildSummary,
  type AiMarketingContext,
  type AiMarketingState,
} from './ai-marketing.dto';
import type { AiMarketingRepositoryPort } from './ai-marketing.repository';
import {
  validateAudienceDefinition,
  AudienceValidationError,
  type AudiencePreview,
} from './ai-marketing-audience';

export class AiMarketingForbiddenError extends Error {}
export class AiMarketingValidationError extends Error {}

// Permission the controller enforces at the edge; re-asserted here as defense-in-depth so the service is
// safe even if invoked directly (e.g. from a future worker) without the HTTP guard.
const VIEW_PERMISSION = 'pos.marketing.view';

export class AiMarketingService {
  constructor(private readonly repo: AiMarketingRepositoryPort) {}

  async getState(ctx: AiMarketingContext): Promise<AiMarketingState> {
    this.assertContext(ctx);
    this.assertCanView(ctx);

    const model = await this.repo.getReadModel(ctx);
    const generatedAt = new Date().toISOString();
    const branchScope: 'branch' | 'tenant' = ctx.branchId ? 'branch' : 'tenant';

    return {
      summary: buildSummary(model, generatedAt),
      recommendations: buildRecommendations(model, branchScope),
      freshness: { generatedAt, source: 'live_read_model' },
    };
  }

  // Aggregate-only audience preview. Validates the definition against the approved registry (no text-to-SQL),
  // resolves a "current" birthday month, then delegates the safe, parameterized count to the repository.
  async previewAudience(ctx: AiMarketingContext, raw: unknown): Promise<AudiencePreview> {
    this.assertContext(ctx);
    this.assertCanView(ctx);

    // Convenience: allow birthdayMonth: 'current' from the UI, resolved server-side before validation.
    let input: any = raw;
    if (input && typeof input === 'object' && (input as any).birthdayMonth === 'current') {
      input = { ...(input as any), birthdayMonth: new Date().getUTCMonth() + 1 };
    }

    let def;
    try {
      def = validateAudienceDefinition(input);
    } catch (e) {
      if (e instanceof AudienceValidationError) throw new AiMarketingValidationError(e.message);
      throw e;
    }
    return this.repo.previewAudience(ctx, def);
  }

  private assertContext(ctx: AiMarketingContext): void {
    // Tenant identity must be present and server-derived. An empty tenantId means the guard/session failed
    // to populate req.ctx — fail closed rather than reading an unscoped model.
    if (!ctx || !ctx.tenantId) throw new AiMarketingValidationError('Missing tenant context');
  }

  private assertCanView(ctx: AiMarketingContext): void {
    const perms = ctx.permissions || [];
    // Accept the granular key, the coarse capability it maps to, or the tenant-wide marketing manage cap.
    const ok =
      perms.indexOf(VIEW_PERMISSION) >= 0 ||
      perms.indexOf('marketing.view') >= 0 ||
      perms.indexOf('marketing.manage') >= 0;
    if (!ok) throw new AiMarketingForbiddenError('Insufficient permission for AI Marketing');
  }
}
