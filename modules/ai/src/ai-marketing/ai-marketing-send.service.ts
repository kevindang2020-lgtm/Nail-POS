// ai-marketing-send.service.ts — the send executor. It ACTIVATES a scheduled campaign and dispatches to each
// recipient through the EXISTING send path, re-validating consent/suppression/frequency/quiet-hours AT SEND
// TIME and using the durable ledger (migration 320) for idempotency. It reuses, and does not reimplement:
//   - campaign lifecycle .......... CampaignsService (detail + transition; permission + audit)
//   - suppression / opt-out ....... notifications OptOutPort.isOptedOut
//   - frequency / usage caps ...... CommunicationsLimitsService.evaluate
//   - actual dispatch ............. notifications.service.send (already enforces opt-out + credits + logging)
//
// Designed to run inside a worker/sweep (like ai-trial-sweep/reminders) — the codebase has no general job
// queue, so this executor is deliberately queue-agnostic and idempotent, safe to re-run. It is NOT exposed as
// a user-triggered "send now" endpoint here: the real port adapters + worker loop + live provider smoke are
// the next step. Every port below has an in-memory fake in the spec, so the orchestration is fully unit-tested.
import { type CampaignRow, type CampaignStatus, type CampaignsContext } from '@aipowersalon/communications';
import {
  idempotencyKey,
  decideSend,
  type SendChannel,
  type RecipientState,
  type SkipReason,
} from './ai-marketing-send-core';
import type { AiMarketingContext } from './ai-marketing.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class SendExecutionError extends Error {}

// --- ports (reused surfaces; faked in tests) ---------------------------------
export interface CampaignLifecyclePort {
  detail(ctx: CampaignsContext, id: string): Promise<CampaignRow>;
  transition(ctx: CampaignsContext, id: string, to: CampaignStatus): Promise<CampaignRow>;
}
export interface RecipientRow {
  customerId: string;
  branchId?: string | null;
  channel: SendChannel;
  address: string; // phone / email — resolved from the live audience at execution
  hasConsent: boolean;
}
export interface RecipientSourcePort {
  enumerate(ctx: AiMarketingContext, campaign: CampaignRow): Promise<RecipientRow[]>;
}
export interface LedgerClaim {
  created: boolean; // true when THIS run inserted the row (won the idempotency race)
  status: string; // existing status when created=false: sent|blocked|failed|skipped|queued
}
export interface SendLedgerPort {
  claim(key: string, parts: { tenantId: string; branchId: string | null; campaignId: string; customerId: string; channel: SendChannel; messageVersion: number }): Promise<LedgerClaim>;
  markSent(key: string, providerId: string | null): Promise<void>;
  markSkipped(key: string, reason: SkipReason | string): Promise<void>;
  markFailed(key: string, reason: string): Promise<void>;
}
export interface LimitEvaluatorPort {
  evaluate(tenantId: string, channel: SendChannel): Promise<{ action: 'allow' | 'block' }>;
}
export interface SuppressionPort {
  /** purpose 'marketing': a marketing-only email unsubscribe (748) blocks a campaign too */
  isOptedOut(tenantId: string, channel: SendChannel, address: string, purpose?: string | null): Promise<boolean>;
}
export interface QuietHoursPort {
  isActive(tenantId: string, branchId: string | null): Promise<boolean>;
}
/** Birthday Campaigns (750): for an occasion campaign (campaigns.occasion = 'birthday') ONE message per customer per occasion
 *  year per channel. `claim` runs in the database BEFORE the provider call; `settle` records sent / releases on a failed send. */
export interface OccasionGuardPort {
  claim(ctx: AiMarketingContext, campaignId: string, customerId: string, channel: SendChannel): Promise<{ allowed: boolean; reason?: string; claimId?: string | null }>;
  settle(ctx: AiMarketingContext, claimId: string, outcome: 'sent' | 'released'): Promise<void>;
}
export interface DispatchResult {
  sent: boolean;
  status: string;
  reason?: string;
  providerId?: string | null;
}
export interface DispatcherPort {
  send(ctx: AiMarketingContext, msg: { channel: SendChannel; to: string; body: string; customerId: string; subject?: string | null }): Promise<DispatchResult>;
}

export interface SendSummary {
  campaignId: string;
  attempted: number;
  sent: number;
  skipped: number;
  blocked: number;
  failed: number;
  byReason: Record<string, number>;
  completedAt: string;
  /** set when the run stopped early because the campaign left 'in_progress' (cancelled) */
  stoppedBy?: string | null;
}

export class AiMarketingSendService {
  constructor(
    private readonly campaigns: CampaignLifecyclePort,
    private readonly recipients: RecipientSourcePort,
    private readonly ledger: SendLedgerPort,
    private readonly limits: LimitEvaluatorPort,
    private readonly suppression: SuppressionPort,
    private readonly quietHours: QuietHoursPort,
    private readonly dispatcher: DispatcherPort,
    private readonly occasion: OccasionGuardPort | null = null,
  ) {}

  // Execute a SCHEDULED campaign. Idempotent and safe to re-run. Body is the approved message version text.
  async executeCampaign(
    ctx: AiMarketingContext,
    args: { campaignId: string; messageVersion: number; body: string; subject?: string | null },
  ): Promise<SendSummary> {
    if (!ctx || !ctx.tenantId) throw new SendExecutionError('Missing tenant context');
    const { campaignId, messageVersion, body } = args;
    if (!body || !body.trim()) throw withCode(new SendExecutionError('Message body is required'), 'MESSAGE_BODY_REQUIRED');

    const campaign = await this.campaigns.detail(ctx as CampaignsContext, campaignId); // tenant-scoped
    // Sendable states: 'scheduled' (approved, first run) or 'in_progress' (resume after a worker restart).
    // A completed/draft/cancelled campaign is never (re)sent from here.
    if (campaign.status !== 'scheduled' && campaign.status !== 'in_progress') {
      throw withCode(new SendExecutionError(`Only a scheduled campaign can be sent (this one is ${campaign.status})`), 'ONLY_SCHEDULED_SEND');
    }

    // Move to in_progress (audited by the campaign state machine) only on the first run.
    if (campaign.status === 'scheduled') {
      await this.campaigns.transition(ctx as CampaignsContext, campaignId, 'in_progress');
    }

    const quietActive = await this.quietHours.isActive(ctx.tenantId, ctx.branchId || null);
    const recipients = await this.recipients.enumerate(ctx, campaign);

    const byReason: Record<string, number> = {};
    let sent = 0, skipped = 0, blocked = 0, failed = 0;
    const bump = (r: string) => { byReason[r] = (byReason[r] || 0) + 1; };

    let stoppedBy: string | null = null;
    for (let i = 0; i < recipients.length; i++) {
      const rc = recipients[i];
      // Campaign Center guide §08: a cancel must stop FUTURE sends. Re-read the campaign every 10 recipients (cheap, and an
      // already-submitted message is never claimed to be recalled).
      if (i > 0 && i % 10 === 0) {
        // a read failure here propagates: the run stops, the campaign stays in progress, and the next sweep resumes it
        // idempotently (the ledger skips everyone already handled) — never a silent "keep sending"
        const now = await this.campaigns.detail(ctx as CampaignsContext, campaignId);
        if (now.status !== 'in_progress') { stoppedBy = now.status; break; }
      }
      const key = idempotencyKey({ tenantId: ctx.tenantId, campaignId, customerId: rc.customerId, channel: rc.channel, messageVersion });

      // Idempotency gate: claim the ledger row. If it already exists in a terminal state, this recipient was
      // already handled — never send again.
      const claim = await this.ledger.claim(key, {
        tenantId: ctx.tenantId, branchId: rc.branchId ?? null, campaignId, customerId: rc.customerId, channel: rc.channel, messageVersion,
      });
      const alreadyHandled = !claim.created && claim.status !== 'queued';
      if (alreadyHandled) { skipped++; bump('already_sent'); continue; }

      // AT-SEND-TIME re-validation — state may have changed since approval.
      const isSuppressed = await this.suppression.isOptedOut(ctx.tenantId, rc.channel, rc.address, 'marketing');
      const limit = await this.limits.evaluate(ctx.tenantId, rc.channel);
      const state: RecipientState = {
        hasConsent: !!rc.hasConsent,
        hasUsableContact: !!rc.address && rc.address.trim() !== '',
        isSuppressed,
      };
      const decision = decideSend(state, false, { action: limit.action }, quietActive);

      if (decision.action === 'skip') {
        await this.ledger.markSkipped(key, decision.reason || 'skipped');
        skipped++; bump(decision.reason || 'skipped');
        continue;
      }

      // Birthday Campaigns: one birthday message per customer per occasion year — claimed BEFORE the provider is called, so two
      // birthday campaigns (or two workers) cannot both text the same customer for the same birthday.
      let occasionClaim: string | null = null;
      if (this.occasion) {
        const g = await this.occasion.claim(ctx, campaignId, rc.customerId, rc.channel);
        if (!g.allowed) { await this.ledger.markSkipped(key, g.reason || 'birthday_already_sent_this_year'); skipped++; bump(g.reason || 'birthday_already_sent_this_year'); continue; }
        occasionClaim = g.claimId ?? null;
      }

      // Dispatch through the existing send path (which independently re-checks opt-out + credits and logs).
      try {
        const res = await this.dispatcher.send(ctx, { channel: rc.channel, to: rc.address, body, customerId: rc.customerId, subject: args.subject ?? null });
        if (res.sent) {
          await this.ledger.markSent(key, res.providerId ?? null);
          if (occasionClaim) await this.occasion!.settle(ctx, occasionClaim, 'sent');
          sent++;
        } else {
          await this.ledger.markSkipped(key, res.reason || 'blocked');
          if (occasionClaim) await this.occasion!.settle(ctx, occasionClaim, 'released');
          blocked++; bump(res.reason || 'blocked');
        }
      } catch (e: any) {
        await this.ledger.markFailed(key, String(e?.message || 'provider_error'));
        // a provider error may still have been accepted: the claim is kept (never risk a second birthday text) — see the doc
        failed++; bump('provider_error');
      }
    }

    // A cancelled campaign stays cancelled (cancelled → completed is not a legal move); otherwise every recipient was
    // handled — sent, skipped with a reason, or failed — so the campaign is complete, even when nobody was eligible.
    if (!stoppedBy) await this.campaigns.transition(ctx as CampaignsContext, campaignId, 'completed');

    return {
      campaignId,
      attempted: recipients.length,
      sent, skipped, blocked, failed,
      byReason,
      completedAt: new Date().toISOString(),
      stoppedBy,
    };
  }
}
