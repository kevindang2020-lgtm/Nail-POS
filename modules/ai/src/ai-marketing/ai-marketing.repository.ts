// ai-marketing.repository.ts — repository PORT + in-memory adapter (dev/offline/tests default).
// The port exposes exactly one read: a tenant-scoped MarketingReadModel of REAL aggregate counts.
// No raw/model-generated SQL ever crosses this boundary.
import type { AiMarketingContext, MarketingReadModel } from './ai-marketing.dto';
import type { AudienceDefinition, AudiencePreview } from './ai-marketing-audience';

export interface AiMarketingRepositoryPort {
  getReadModel(ctx: AiMarketingContext): Promise<MarketingReadModel>;
  // Aggregate-only audience preview from an ALREADY-VALIDATED definition (registry-checked upstream).
  previewAudience(ctx: AiMarketingContext, def: AudienceDefinition): Promise<AudiencePreview>;
}

const EMPTY_READ_MODEL: MarketingReadModel = {
  campaignCounts: { active: 0, scheduled: 0, draft: 0, completed: 0 },
  campaignTotals: { sent: 0, bookings: 0, revenueCents: 0, costCents: 0 },
  consent: { optedInSms: 0, optedInEmail: 0, suppressed: 0 },
  audiences: {
    rebookingDue: { eligible: 0, suppressed: 0 },
    inactive90: { eligible: 0, suppressed: 0 },
    birthdayThisMonth: { eligible: 0, suppressed: 0 },
    lastMinuteInterest: { eligible: 0, suppressed: 0 },
  },
};

// Deterministic base a tenant can seed for audience-preview tests. Isolation: keyed by tenantId.
export interface InMemoryAudienceBase {
  total: number;
  missingContact: number;
  optedOut: number;
}

// In-memory adapter keyed by tenantId so isolation is provable in tests: tenant A's seed is never visible to B.
export class InMemoryAiMarketingRepository implements AiMarketingRepositoryPort {
  private byTenant = new Map<string, MarketingReadModel>();
  private audienceBase = new Map<string, InMemoryAudienceBase>();

  constructor(
    seed: Record<string, MarketingReadModel> = {},
    audienceSeed: Record<string, InMemoryAudienceBase> = {},
  ) {
    for (const [tenantId, model] of Object.entries(seed)) this.byTenant.set(tenantId, model);
    for (const [tenantId, base] of Object.entries(audienceSeed)) this.audienceBase.set(tenantId, base);
  }

  seedTenant(tenantId: string, model: MarketingReadModel): void {
    this.byTenant.set(tenantId, model);
  }

  seedAudience(tenantId: string, base: InMemoryAudienceBase): void {
    this.audienceBase.set(tenantId, base);
  }

  async getReadModel(ctx: AiMarketingContext): Promise<MarketingReadModel> {
    // Isolation: a tenant only ever sees its own seeded model; unknown tenant => honest empty model.
    return this.byTenant.get(ctx.tenantId) ?? EMPTY_READ_MODEL;
  }

  async previewAudience(ctx: AiMarketingContext, def: AudienceDefinition): Promise<AudiencePreview> {
    const base = this.audienceBase.get(ctx.tenantId) ?? { total: 0, missingContact: 0, optedOut: 0 };
    const suppressed = Math.min(base.total, base.missingContact + base.optedOut);
    const eligible = Math.max(0, base.total - suppressed);
    return {
      channel: def.channel,
      total: base.total,
      eligible,
      suppressed,
      breakdown: { missingContact: base.missingContact, optedOut: base.optedOut },
      definitionEcho: def,
      generatedAt: new Date().toISOString(),
    };
  }
}

export { EMPTY_READ_MODEL };
