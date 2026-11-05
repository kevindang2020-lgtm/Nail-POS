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
  isOptedOut(tenantId: string, channel: SendChannel, address: string): Promise<boolean>;
}
export interface QuietHoursPort {
  isActive(tenantId: string, branchId: string | null): Promise<boolean>;
}
export interface DispatchResult {
  sent: boolean;
  status: string;
  reason?: string;
  providerId?: string | null;
}
export interface DispatcherPort {
  send(ctx: AiMarketingContext, msg: { channel: SendChannel; to: string; body: string; customerId: string }): Promise<DispatchResult>;
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
  ) {}

  // Execute a SCHEDULED campaign. Idempotent and safe to re-run. Body is the approved message version text.
  async executeCampaign(
    ctx: AiMarketingContext,
    args: { campaignId: string; messageVersion: number; body: string },
  ): Promise<SendSummary> {
    if (!ctx || !ctx.tenantId) throw new SendExecutionError('Missing tenant context');
    const { campaignId, messageVersion, body } = args;
    if (!body || !body.trim()) throw new SendExecutionError('Message body is required');

    const campaign = await this.campaigns.detail(ctx as CampaignsContext, campaignId); // tenant-scoped
    // Sendable states: 'scheduled' (approved, first run) or 'in_progress' (resume after a worker restart).
    // A completed/draft/cancelled campaign is never (re)sent from here.
    if (campaign.status !== 'scheduled' && campaign.status !== 'in_progress') {
      throw new SendExecutionError(`Only a scheduled campaign can be sent (this one is ${campaign.status})`);
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

    for (const rc of recipients) {
      const key = idempotencyKey({ tenantId: ctx.tenantId, campaignId, customerId: rc.customerId, channel: rc.channel, messageVersion });

      // Idempotency gate: claim the ledger row. If it already exists in a terminal state, this recipient was
      // already handled — never send again.
      const claim = await this.ledger.claim(key, {
        tenantId: ctx.tenantId, branchId: rc.branchId ?? null, campaignId, customerId: rc.customerId, channel: rc.channel, messageVersion,
      });
      const alreadyHandled = !claim.created && claim.status !== 'queued';
      if (alreadyHandled) { skipped++; bump('already_sent'); continue; }

      // AT-SEND-TIME re-validation — state may have changed since approval.
      const isSuppressed = await this.suppression.isOptedOut(ctx.tenantId, rc.channel, rc.address);
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

      // Dispatch through the existing send path (which independently re-checks opt-out + credits and logs).
      try {
        const res = await this.dispatcher.send(ctx, { channel: rc.channel, to: rc.address, body, customerId: rc.customerId });
        if (res.sent) {
          await this.ledger.markSent(key, res.providerId ?? null);
          sent++;
        } else {
          await this.ledger.markSkipped(key, res.reason || 'blocked');
          blocked++; bump(res.reason || 'blocked');
        }
      } catch (e: any) {
        await this.ledger.markFailed(key, String(e?.message || 'provider_error'));
        failed++; bump('provider_error');
      }
    }

    await this.campaigns.transition(ctx as CampaignsContext, campaignId, 'completed');

    return {
      campaignId,
      attempted: recipients.length,
      sent, skipped, blocked, failed,
      byReason,
      completedAt: new Date().toISOString(),
    };
  }
}
