// ai-review-reputation-auto-reply.ts — G8 (Nov 6 2026): the automatic public reply, wired.
// ReviewDraftingService.autoRespond existed but nothing called it. Now each NEW review that ingestion stores is offered
// here. It replies only when ALL of these hold — and every one of them is the salon's choice or a hard clamp:
//   · the assistant is on and "Automatic replies" is on for that salon/branch (OFF by default);
//   · "Require approval before publishing" is OFF (approval wins — autoResponseDecision; the settings center refuses the pair);
//   · a clean 5-star review: positive, no complaint category, no serious signal, no spam / injection, confidence ≥ 0.8;
//   · the AI package, when the platform enforces AI entitlements;
//   · the generated reply passes the safety validator (else it is left as a draft for a person).
// A publish the integration cannot carry (no Google connection yet) leaves the reply as a draft for a person; it never
// throws into ingestion.
import { systemContext } from '@aipowersalon/tenant-context';
import type { AutoReplySink, IngestContext } from './ai-review-reputation-ingest';
import type { ReviewAnalysis } from './ai-review-reputation-core';
import type { ReviewDraftingService } from './ai-review-reputation-drafting.service';
import type { SettingsPort } from './ai-review-reputation.service';
import { buildTenantContext } from './ai-review-reputation-context';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS, type SettingsRow } from './ai-review-reputation-settings';
import type { ReviewSenderAccess } from './ai-review-reputation-sender.job';

export class ReviewAutoReplier implements AutoReplySink {
  constructor(private readonly settings: SettingsPort, private readonly drafting: ReviewDraftingService, private readonly access?: ReviewSenderAccess | null) {}

  async onNewReview(ctx: IngestContext, reviewId: string, review: { text: string | null; rating: number | null }, analysis: ReviewAnalysis): Promise<{ autoResponded: boolean; reason: string }> {
    try {
      const sys: any = systemContext({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actor: 'review-auto-reply' });
      const rows = await this.settings.load(sys);
      const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as SettingsRow[], { branchId: ctx.branchId ?? undefined }) });
      if (!eff.enabled) return { autoResponded: false, reason: 'assistant_disabled' };
      if (!eff.config.autoResponse.enabled) return { autoResponded: false, reason: 'auto_response_disabled' };
      if (this.access) { const d = await this.access(ctx.tenantId, ctx.branchId ?? null); if (!d.allowed && d.enforce) return { autoResponded: false, reason: 'not_entitled' }; }
      const tenantContext = buildTenantContext(await this.settings.tenantContextInput(sys, eff.config));
      return await this.drafting.autoRespond(sys, reviewId, { analysis, config: eff.config, tenantContext, reviewText: review.text, rating: review.rating });
    } catch (e) {
      // e.g. INTEGRATION_DISCONNECTED at publish: the reply stays a draft for a person (autoRespond saved it first)
      return { autoResponded: false, reason: String((e as Error)?.message || 'error') };
    }
  }
}
