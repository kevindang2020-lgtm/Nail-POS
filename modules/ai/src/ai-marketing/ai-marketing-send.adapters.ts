// ai-marketing-send.adapters.ts — LIVE adapters that back the send ports with real infrastructure.
// ⚠️ These are DB/service glue: they follow the exact Kysely + service patterns used elsewhere in the repo,
// but I could not run tsc/live-PG here — they MUST be smoke-tested against seeded Postgres before trusting
// them in production. The pure send-decision logic (slice 5a) and the mapping helpers are unit-tested; this
// file is the wiring around them.
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_MARKETING_CAMPAIGN_SEND } from '../ai-lifecycles';
import type {
  SendLedgerPort,
  LimitEvaluatorPort,
  LedgerClaim,
  CampaignLifecyclePort,
  RecipientSourcePort,
  RecipientRow,
} from './ai-marketing-send.service';
import type { SendChannel, SkipReason } from './ai-marketing-send-core';
import type { CampaignRow } from '@aipowersalon/communications';
import type { AiMarketingContext } from './ai-marketing.dto';
import { toLimitDecision, isWithinQuietWindow, hhmmToMinutes } from './ai-marketing-send-adapters-core';

// The key format from idempotencyKey(): tenant|campaign|customer|channel|version. We parse it back into the
// ledger's unique-index columns so mark* can locate the row without extra state.
function parseKey(key: string): { tenant_id: string; campaign_id: string; customer_id: string; channel: string; message_version: number } {
  const [tenant_id, campaign_id, customer_id, channel, v] = key.split('|');
  return { tenant_id, campaign_id, customer_id, channel, message_version: Number(v) || 1 };
}

// --- SendLedger over ai_marketing_campaign_sends (migration 320) ---------------
export class KyselySendLedger implements SendLedgerPort {
  constructor(private readonly db: Kysely<DB>) {}

  async claim(_key: string, parts: { tenantId: string; branchId: string | null; campaignId: string; customerId: string; channel: SendChannel; messageVersion: number }): Promise<LedgerClaim> {
    // Insert-if-absent. The UNIQUE (tenant,campaign,customer,channel,message_version) index makes this the
    // idempotency gate: a duplicate insert is a no-op and we then read the existing status.
    const ins = await this.db
      .insertInto('ai_marketing_campaign_sends')
      .values({
        tenant_id: parts.tenantId, branch_id: parts.branchId, campaign_id: parts.campaignId,
        customer_id: parts.customerId, channel: parts.channel, message_version: parts.messageVersion,
        status: 'queued',
      } as any)
      .onConflict((oc) => oc.columns(['tenant_id', 'campaign_id', 'customer_id', 'channel', 'message_version']).doNothing())
      .returning('id')
      .executeTakeFirst();

    // A returned row means we inserted; ON CONFLICT DO NOTHING returns nothing when the row already existed.
    // (Driver-agnostic — does not rely on numInsertedOrUpdatedRows.)
    const created = !!ins;
    if (created) return { created: true, status: 'queued' };

    const existing = await this.db
      .selectFrom('ai_marketing_campaign_sends')
      .select('status')
      .where('tenant_id', '=', parts.tenantId)
      .where('campaign_id', '=', parts.campaignId)
      .where('customer_id', '=', parts.customerId)
      .where('channel', '=', parts.channel)
      .where('message_version', '=', parts.messageVersion)
      .executeTakeFirst();
    return { created: false, status: String(existing?.status ?? 'queued') };
  }

  private async setStatus(key: string, status: string, patch: Record<string, unknown>): Promise<void> {
    const p = parseKey(key);
    await this.db
      .updateTable('ai_marketing_campaign_sends')
      .set({ status, updated_at: sql`now()`, ...patch } as any)
      .where('tenant_id', '=', p.tenant_id)
      .where('campaign_id', '=', p.campaign_id)
      .where('customer_id', '=', p.customer_id)
      .where('channel', '=', p.channel)
      .where('message_version', '=', p.message_version)
      .where(canMoveToSql(AI_MARKETING_CAMPAIGN_SEND, status) as any)   // Phase 12 (#27): a recorded send / skip / failure is final
      .execute();
  }
  async markSent(key: string, providerId: string | null): Promise<void> { await this.setStatus(key, 'sent', { provider_id: providerId, skip_reason: null }); }
  async markSkipped(key: string, reason: SkipReason | string): Promise<void> { await this.setStatus(key, 'skipped', { skip_reason: String(reason) }); }
  async markFailed(key: string, reason: string): Promise<void> { await this.setStatus(key, 'failed', { skip_reason: String(reason).slice(0, 200) }); }
}

// --- Campaign plan store over ai_marketing_campaign_plans (migration 321) ------
export interface CampaignPlan {
  campaignId: string;
  tenantId: string;
  branchId: string | null;
  channel: SendChannel;
  messageVersion: number;
  body: string;
  offerName: string | null;
  audienceDefinition: Record<string, unknown>;
}
export interface PlanStorePort {
  save(plan: CampaignPlan, createdByUserId: string | null): Promise<void>;
  get(tenantId: string, campaignId: string): Promise<CampaignPlan | null>;
}

export class KyselyPlanStore implements PlanStorePort {
  constructor(private readonly db: Kysely<DB>) {}

  async save(plan: CampaignPlan, createdByUserId: string | null): Promise<void> {
    await this.db
      .insertInto('ai_marketing_campaign_plans')
      .values({
        campaign_id: plan.campaignId, tenant_id: plan.tenantId, branch_id: plan.branchId, channel: plan.channel,
        message_version: plan.messageVersion, body: plan.body, offer_name: plan.offerName,
        audience_definition: JSON.stringify(plan.audienceDefinition), created_by_user_id: createdByUserId,
      } as any)
      .onConflict((oc) => oc.column('campaign_id').doUpdateSet({
        channel: plan.channel, message_version: plan.messageVersion, body: plan.body, offer_name: plan.offerName,
        audience_definition: JSON.stringify(plan.audienceDefinition), updated_at: sql`now()`,
      } as any))
      .execute();
  }

  async get(tenantId: string, campaignId: string): Promise<CampaignPlan | null> {
    const r = await this.db
      .selectFrom('ai_marketing_campaign_plans')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();
    if (!r) return null;
    let audienceDefinition: Record<string, unknown> = {};
    try { audienceDefinition = typeof (r as any).audience_definition === 'string' ? JSON.parse((r as any).audience_definition) : ((r as any).audience_definition ?? {}); } catch { audienceDefinition = {}; }
    return {
      campaignId: (r as any).campaign_id, tenantId: (r as any).tenant_id, branchId: (r as any).branch_id ?? null,
      channel: (r as any).channel, messageVersion: Number((r as any).message_version) || 1, body: (r as any).body,
      offerName: (r as any).offer_name ?? null, audienceDefinition,
    };
  }
}

// In-memory PlanStore (dev/offline/tests) — keyed by tenant+campaign so it is tenant-isolated.
export class InMemoryPlanStore implements PlanStorePort {
  private store = new Map<string, CampaignPlan>();
  private k(t: string, c: string) { return t + '|' + c; }
  async save(plan: CampaignPlan): Promise<void> { this.store.set(this.k(plan.tenantId, plan.campaignId), plan); }
  async get(tenantId: string, campaignId: string): Promise<CampaignPlan | null> { return this.store.get(this.k(tenantId, campaignId)) ?? null; }
}

// --- LimitEvaluator over CommunicationsLimitsService ---------------------------
export interface LimitsEvaluatorLike { evaluate(tenantId: string, channel: 'sms' | 'email' | 'push'): Promise<{ action: string }>; }
export class CommunicationsLimitAdapter implements LimitEvaluatorPort {
  constructor(private readonly limits: LimitsEvaluatorLike) {}
  async evaluate(tenantId: string, channel: SendChannel): Promise<{ action: 'allow' | 'block' }> {
    const r = await this.limits.evaluate(tenantId, channel);
    return toLimitDecision(r);
  }
}

// --- Dispatcher over notifications.service.send --------------------------------
// notifications.service.send already re-checks opt-out + meters credits + logs every attempt, so this adapter
// is a thin bridge. ⚠️ live-smoke required (real provider + credits).
export interface NotificationsSenderLike {
  send(
    ctx: { tenantId: string; userId: string; role: string; branchId?: string; salonName?: string },
    req: { channel: 'sms' | 'email' | 'push'; to: string; body: string; customerId?: string; subject?: string },
  ): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string | null }>;
}
export class NotificationsDispatcher {
  constructor(private readonly sender: NotificationsSenderLike, private readonly salonName = '') {}
  async send(
    ctx: { tenantId: string; branchId: string; userId: string; role: string },
    msg: { channel: SendChannel; to: string; body: string; customerId: string },
  ): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string | null }> {
    return this.sender.send(
      { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, branchId: ctx.branchId || undefined, salonName: this.salonName },
      { channel: msg.channel, to: msg.to, body: msg.body, customerId: msg.customerId },
    );
  }
}

// --- QuietHours -----------------------------------------------------------------
// StaticQuietHours: never active (safe default until per-tenant quiet-hours config is wired).
export class StaticQuietHours {
  async isActive(): Promise<boolean> { return false; }
}
// WindowQuietHours: a fixed daily window in a fixed offset. Uses the pure isWithinQuietWindow helper.
// ⚠️ Real per-tenant/per-recipient timezone quiet-hours (from tenant config) is the remaining wiring step.
export class WindowQuietHours {
  constructor(private readonly startHHMM: string | null, private readonly endHHMM: string | null, private readonly utcOffsetMinutes = 0) {}
  async isActive(): Promise<boolean> {
    const now = new Date(Date.now() + this.utcOffsetMinutes * 60000);
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    return isWithinQuietWindow(mins, hhmmToMinutes(this.startHHMM), hhmmToMinutes(this.endHHMM));
  }
}

// --- SystemCampaignLifecycle over CampaignsService system methods ---------------
// Bridges the send executor's CampaignLifecyclePort to the TRUSTED system-actor methods (no user permission
// check; guarded user methods untouched). Used only by the worker/sweep.
export interface CampaignsSystemLike {
  systemDetail(tenantId: string, id: string): Promise<CampaignRow>;
  systemTransition(tenantId: string, id: string, to: string): Promise<CampaignRow>;
}
export class SystemCampaignLifecycle implements CampaignLifecyclePort {
  constructor(private readonly svc: CampaignsSystemLike) {}
  detail(ctx: { tenantId: string }, id: string): Promise<CampaignRow> {
    return this.svc.systemDetail(ctx.tenantId, id);
  }
  transition(ctx: { tenantId: string }, id: string, to: string): Promise<CampaignRow> {
    return this.svc.systemTransition(ctx.tenantId, id, to as any);
  }
}

// --- RecipientSource over the live audience definition --------------------------
// Reads the campaign's plan (audience definition) and enumerates recipients LIVE at send time, so eligibility
// is fresh. Returns only consented, contactable customers (send-time suppression re-check still happens per
// recipient in the executor). Bounded by MAX_RECIPIENTS. ⚠️ live-smoke required.
interface PlanReader { get(tenantId: string, campaignId: string): Promise<{ channel: SendChannel; audienceDefinition: Record<string, unknown> } | null>; }
const MAX_RECIPIENTS = 50000;

export class KyselyRecipientSource implements RecipientSourcePort {
  constructor(private readonly db: Kysely<DB>, private readonly plans: PlanReader) {}

  async enumerate(ctx: AiMarketingContext, campaign: CampaignRow): Promise<RecipientRow[]> {
    const upcomingFrom = businessDate(await branchTimeZone(this.db, ctx.tenantId, (ctx as any).branchId ?? null));   // the salon's day
    try {
      const plan = await this.plans.get(ctx.tenantId, campaign.id);
      if (!plan) return [];
      const def: any = plan.audienceDefinition || {};
      const channel: SendChannel = plan.channel;
      const consentCol = channel === 'email' ? 'c.marketing_email_opt_in' : 'c.marketing_sms_opt_in';
      const contactCol = channel === 'email' ? 'c.email' : 'c.normalized_phone';

      let q = this.db.selectFrom('customers as c')
        .where('c.tenant_id', '=', ctx.tenantId)
        .where('c.archived_at', 'is', null)
        .where(consentCol as any, '=', true)
        .where((eb: any) => eb.and([eb(contactCol, 'is not', null), eb(contactCol, '<>', '')]));
      if (ctx.branchId) q = q.where('c.branch_id', '=', ctx.branchId);
      if (def.requireActiveStatus !== false) q = q.where('c.status', '=', 'active');

      if (def.minDaysSinceLastCompletedVisit != null) {
        const days = Math.max(1, Math.min(1000, Math.trunc(Number(def.minDaysSinceLastCompletedVisit) || 0)));
        const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        q = q.where((eb: any) => eb.exists(
          eb.selectFrom('pos_tech_appointments as a').select('a.id')
            .whereRef('a.customer_id', '=', 'c.id').where('a.tenant_id', '=', ctx.tenantId)
            .where('a.status', '=', 'completed').where(sql<boolean>`a.appt_date < ${cutoff}::date`),
        ));
      }
      if (def.excludeWithFutureAppointment !== false) {
        q = q.where((eb: any) => eb.not(eb.exists(
          eb.selectFrom('pos_tech_appointments as a2').select('a2.id')
            .whereRef('a2.customer_id', '=', 'c.id').where('a2.tenant_id', '=', ctx.tenantId)
            .where('a2.status', 'in', [...CHAIR_HOLDING_STATUSES])   // Decision 38: shared list (incl. arrived)
            .where('a2.appt_date', '>=', upcomingFrom)   /* the salon's day (Oct 3 2026 — was the database's UTC date) */,
        )));
      }
      if (def.birthdayMonth != null) {
        const m = Math.max(1, Math.min(12, Math.trunc(Number(def.birthdayMonth) || 0)));
        q = q.where('c.birthday', 'is not', null).where(sql<boolean>`extract(month from c.birthday) = ${m}`);
      }

      const rows = await q
        .select((eb: any) => ['c.id as customerId', 'c.branch_id as branchId', eb.ref(contactCol).as('address')])
        .limit(MAX_RECIPIENTS)
        .execute();

      return (rows as any[]).map((r) => ({
        customerId: String(r.customerId),
        branchId: r.branchId ?? null,
        channel,
        address: String(r.address ?? ''),
        hasConsent: true, // consent filtered in-query; per-recipient suppression re-checked in the executor
      }));
    } catch {
      return []; // honest empty enumeration on failure — never a fabricated recipient list
    }
  }
}
