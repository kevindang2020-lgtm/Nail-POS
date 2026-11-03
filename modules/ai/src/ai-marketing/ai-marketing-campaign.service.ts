// ai-marketing-campaign.service.ts — the AI Marketing approval SPINE. It does NOT own campaigns; it drives the
// existing CampaignsService (create + state-machine transition + audit + tenant scope + pos.marketing.manage).
// The AI-specific value here is pre-flight validation and a hard guardrail: approval only SCHEDULES a campaign,
// it never activates/sends. Sending is a separate, gated pipeline (later slice). The AI model is never on this
// path — a human with pos.marketing.manage submits and then explicitly approves.
import { type CampaignRow, type CreateCampaignRequest, type UpdateCampaignRequest, type CampaignStatus, type CampaignsContext } from '@aipowersalon/communications';
import { validateDraft, type DraftChannel } from './ai-marketing-content';
import { validateAudienceDefinition } from './ai-marketing-audience';
import { buildResults, type CampaignResults } from './ai-marketing-results';
import type { PlanStorePort } from './ai-marketing-send.adapters';
import type { CampaignConversionsPort } from './ai-marketing-conversions';
import type { AiMarketingContext } from './ai-marketing.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

// The subset of CampaignsService we depend on. The real CampaignsService satisfies this structurally, so the
// existing permission checks, state machine, audit, and tenant scoping are reused — not reimplemented.
export interface CampaignOrchestrationPort {
  create(ctx: CampaignsContext, req: CreateCampaignRequest): Promise<CampaignRow>;
  detail(ctx: CampaignsContext, id: string): Promise<CampaignRow>;
  update(ctx: CampaignsContext, id: string, patch: UpdateCampaignRequest): Promise<CampaignRow>;
  transition(ctx: CampaignsContext, id: string, to: CampaignStatus): Promise<CampaignRow>;
  /** draft → scheduled through Campaign Center's send-readiness rule (approved, unchanged since approval, a real audience snapshot
   *  with ≥ 1 eligible customer). Optional only for the in-memory unit tests of the legacy lifecycle. */
  schedule?(ctx: CampaignsContext, id: string): Promise<CampaignRow>;
}

export class CampaignOrchestrationValidationError extends Error {}

export interface SubmitCampaignInput {
  name: string;
  channel: DraftChannel;
  draftText: string; // the approved/edited draft; re-validated here
  audienceLabel: string; // human-readable, from the audience preview
  audienceSize: number; // eligible count from the preview (re-validated live at SEND time, later slice)
  offer?: { name: string } | null; // an approved, human-entered offer name, or null
  estimatedCostCents?: number;
  audienceDefinition?: Record<string, unknown> | null; // approved-registry def; persisted as the send plan
  messageVersion?: number;
}

export interface SubmitResult {
  campaign: CampaignRow; // status 'draft' == REVIEW_REQUIRED
  draftText: string; // echoed for the approver to see (campaign header carries no body)
  planStored: boolean; // whether a send plan (body + audience) was persisted for later execution
  approvalChecklist: { item: string; ok: boolean }[];
}

export class AiMarketingCampaignService {
  // planStore is optional so the approval spine works even before the send layer is wired; when present, a
  // send plan (message body + approved audience definition) is persisted so the campaign can actually be sent.
  constructor(
    private readonly campaigns: CampaignOrchestrationPort,
    private readonly planStore?: PlanStorePort,
    private readonly conversions?: CampaignConversionsPort,
  ) {}

  // Create a REAL campaign in 'draft' (review-required). Does not schedule or send.
  async submitForApproval(ctx: AiMarketingContext, raw: unknown): Promise<SubmitResult> {
    if (!ctx || !ctx.tenantId) throw new CampaignOrchestrationValidationError('Missing tenant context');
    const input = this.validateSubmit(raw);

    // Re-validate the draft against the same safety rules used at generation time. A draft that invents an
    // offer, uses an unknown token, embeds a raw URL, or is over length cannot be submitted.
    const dv = validateDraft(input.channel, input.draftText, !!input.offer);
    if (dv.requiresRevision) {
      throw withCode(new CampaignOrchestrationValidationError(
        'Draft needs revision before it can be submitted: ' + dv.warnings.join(' '),
      ), 'CAMPAIGN_DRAFT_NEEDS_REVISION');
    }
    if (input.audienceSize <= 0) {
      throw withCode(new CampaignOrchestrationValidationError('No eligible recipients — audience is empty'), 'AUDIENCE_EMPTY');
    }

    // CampaignsService.create enforces pos.marketing.manage, trims the name, and audits.
    const campaign = await this.campaigns.create(ctx as CampaignsContext, {
      name: input.name,
      channel: input.channel,
      offer: input.offer ? input.offer.name : undefined,
      audienceLabel: input.audienceLabel,
      audienceSize: input.audienceSize,
      costCents: input.estimatedCostCents,
    });

    // Persist the send plan (body + approved audience definition) so the campaign can actually be executed.
    // The audience definition is re-validated against the approved registry (no text-to-SQL) before storage.
    let planStored = false;
    if (this.planStore && input.audienceDefinition) {
      const def = validateAudienceDefinition({ ...input.audienceDefinition, channel: input.channel === 'push' ? 'sms' : input.channel });
      await this.planStore.save(
        {
          campaignId: campaign.id,
          tenantId: ctx.tenantId,
          branchId: ctx.branchId || null,
          channel: input.channel,
          messageVersion: Math.max(1, Math.trunc(input.messageVersion || 1)),
          body: input.draftText,
          offerName: input.offer ? input.offer.name : null,
          audienceDefinition: def as unknown as Record<string, unknown>,
        },
        ctx.userId || null,
      );
      planStored = true;
    }

    return {
      campaign, // 'draft'
      draftText: input.draftText,
      planStored,
      approvalChecklist: [
        { item: 'Draft passed content safety checks', ok: true },
        { item: 'Audience has eligible recipients', ok: input.audienceSize > 0 },
        { item: 'Send plan persisted', ok: planStored },
        { item: 'Offer is human-approved (or none)', ok: true },
        { item: 'Awaiting explicit human approval + schedule', ok: false },
      ],
    };
  }

  // Explicit human approval. Requires a future schedule time; moves draft → scheduled via the existing state
  // machine (which re-checks pos.marketing.manage and audits). NEVER activates/sends.
  async approveAndSchedule(ctx: AiMarketingContext, id: string, rawScheduledAt: unknown): Promise<CampaignRow> {
    if (!ctx || !ctx.tenantId) throw new CampaignOrchestrationValidationError('Missing tenant context');
    const scheduledAt = this.validateFutureIso(rawScheduledAt);

    const current = await this.campaigns.detail(ctx as CampaignsContext, id); // tenant-scoped; throws NotFound
    if (current.status !== 'draft') {
      throw withCode(new CampaignOrchestrationValidationError(
        `Only a draft campaign can be approved (this one is ${current.status})`,
      ), 'ONLY_DRAFT_APPROVE');
    }
    if ((current.audienceSize || 0) <= 0) {
      throw withCode(new CampaignOrchestrationValidationError('No eligible recipients — audience is empty'), 'AUDIENCE_EMPTY');
    }

    // Persist the approved schedule time, then schedule. AI Marketing guides (Nov 3 2026): this used to call transition()
    // directly — a draft moved to Scheduled with no Campaign Center approval (content hash) and no audience snapshot, and the
    // send sweep then sent it from the plan saved at submit time. It now goes through CampaignsService.schedule(), which
    // refuses anything Campaign Center would refuse (CAMPAIGN_APPROVAL_REQUIRED, CAMPAIGN_AUDIENCE_NOT_SELECTED, …).
    await this.campaigns.update(ctx as CampaignsContext, id, { scheduledAt });
    if (this.campaigns.schedule) return this.campaigns.schedule(ctx as CampaignsContext, id);
    return this.campaigns.transition(ctx as CampaignsContext, id, 'scheduled');
  }

  // Cancel a scheduled or draft campaign (delegates to the state machine).
  async cancel(ctx: AiMarketingContext, id: string): Promise<CampaignRow> {
    if (!ctx || !ctx.tenantId) throw new CampaignOrchestrationValidationError('Missing tenant context');
    return this.campaigns.transition(ctx as CampaignsContext, id, 'cancelled');
  }

  // Per-campaign results — composed from the campaign row counters (reused via detail(), which enforces
  // pos.marketing.view + tenant scoping). Revenue is labeled ASSOCIATED, not causal; rates are null when their
  // denominator is zero. The per-recipient ledger tally (migration 320) is layered in once its adapter is wired.
  async getResults(ctx: AiMarketingContext, id: string): Promise<CampaignResults> {
    if (!ctx || !ctx.tenantId) throw new CampaignOrchestrationValidationError('Missing tenant context');
    const campaign = await this.campaigns.detail(ctx as CampaignsContext, id);
    // Real per-campaign booking attribution from conversion events (migration 322), when wired.
    const attributedBooked = this.conversions ? await this.conversions.bookedByCampaign(ctx.tenantId, id) : null;
    return buildResults(campaign, null, new Date().toISOString(), attributedBooked);
  }

  private validateSubmit(raw: unknown): SubmitCampaignInput {
    if (!raw || typeof raw !== 'object') throw new CampaignOrchestrationValidationError('Campaign submission required');
    const o = raw as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) throw withCode(new CampaignOrchestrationValidationError('Campaign name is required'), 'CAMPAIGN_NAME_REQUIRED');
    const channel = o.channel;
    if (channel !== 'sms' && channel !== 'email' && channel !== 'push') {
      throw new CampaignOrchestrationValidationError('channel must be sms|email|push');
    }
    const draftText = String(o.draftText ?? '').trim();
    if (!draftText) throw withCode(new CampaignOrchestrationValidationError('draftText is required'), 'CAMPAIGN_TEXT_REQUIRED');
    let offer: { name: string } | null = null;
    if (o.offer != null) {
      const oname = String((o.offer as any).name ?? '').trim();
      if (!oname) throw withCode(new CampaignOrchestrationValidationError('offer.name is required when an offer is provided'), 'OFFER_NAME_REQUIRED');
      offer = { name: oname };
    }
    return {
      name,
      channel,
      draftText,
      audienceLabel: String(o.audienceLabel ?? '').trim() || '—',
      audienceSize: Math.max(0, Math.round(Number(o.audienceSize) || 0)),
      offer,
      estimatedCostCents:
        o.estimatedCostCents == null ? undefined : Math.max(0, Math.round(Number(o.estimatedCostCents) || 0)),
      audienceDefinition:
        o.audienceDefinition && typeof o.audienceDefinition === 'object' ? (o.audienceDefinition as Record<string, unknown>) : null,
      messageVersion: o.messageVersion == null ? 1 : Math.max(1, Math.trunc(Number(o.messageVersion) || 1)),
    };
  }

  private validateFutureIso(raw: unknown): string {
    const s = String(raw ?? '').trim();
    const t = Date.parse(s);
    if (!s || Number.isNaN(t)) throw withCode(new CampaignOrchestrationValidationError('scheduledAt must be a valid date/time'), 'SCHEDULE_TIME_INVALID');
    if (t <= Date.now()) throw new CampaignOrchestrationValidationError('scheduledAt must be in the future');
    return new Date(t).toISOString();
  }
}
