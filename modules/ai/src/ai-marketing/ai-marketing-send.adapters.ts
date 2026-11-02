// ai-marketing-send.adapters.ts — LIVE adapters that back the send ports with real infrastructure.
// ⚠️ These are DB/service glue: they follow the exact Kysely + service patterns used elsewhere in the repo,
// but I could not run tsc/live-PG here — they MUST be smoke-tested against seeded Postgres before trusting
// them in production. The pure send-decision logic (slice 5a) and the mapping helpers are unit-tested; this
// file is the wiring around them.
import { branchTimeZone, tenantTimeZone } from '@aipowersalon/database';
import { monthDayOf, occasionYear, isFeb29Policy } from '@aipowersalon/customers';
import { businessDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_MARKETING_CAMPAIGN_SEND, BIRTHDAY_MESSAGE_CLAIM } from '../ai-lifecycles';
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
      })
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
      .set({ status, updated_at: sql`now()`, ...patch })
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
      })
      .onConflict((oc) => oc.column('campaign_id').doUpdateSet({
        channel: plan.channel, message_version: plan.messageVersion, body: plan.body, offer_name: plan.offerName,
        audience_definition: JSON.stringify(plan.audienceDefinition), updated_at: sql`now()`,
      }))
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
    try { audienceDefinition = typeof r.audience_definition === 'string' ? JSON.parse(r.audience_definition) : (r.audience_definition ?? {}); } catch { audienceDefinition = {}; }
    return {
      campaignId: r.campaign_id, tenantId: r.tenant_id, branchId: r.branch_id ?? null,
      channel: (r as any).channel, messageVersion: Number((r as any).message_version) || 1, body: (r as any).body,
      offerName: r.offer_name ?? null, audienceDefinition,
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
    req: { channel: 'sms' | 'email' | 'push'; to: string; body: string; customerId?: string; subject?: string; purpose?: 'marketing' },
  ): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string | null }>;
}
export class NotificationsDispatcher {
  constructor(private readonly sender: NotificationsSenderLike, private readonly salonName = '') {}
  async send(
    ctx: { tenantId: string; branchId: string; userId: string; role: string },
    msg: { channel: SendChannel; to: string; body: string; customerId: string; subject?: string | null },
  ): Promise<{ sent: boolean; status: string; reason?: string; providerId?: string | null }> {
    return this.sender.send(
      { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, branchId: ctx.branchId || undefined, salonName: this.salonName },
      // Email guide (Oct 31 2026): a campaign is MARKETING — the send path adds the salon's address + one-click unsubscribe and
      // honours marketing-only unsubscribes (it used to reach the ledger with no purpose, i.e. as a transactional message)
      { channel: msg.channel, to: msg.to, body: msg.body, customerId: msg.customerId, purpose: 'marketing', ...(msg.subject ? { subject: msg.subject } : {}) },
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
    return this.svc.systemTransition(ctx.tenantId, id, to);
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
    const upcomingFrom = businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null));   // the salon's day
    try {
      const plan = await this.plans.get(ctx.tenantId, campaign.id);
      if (!plan) return [];
      const def: any = plan.audienceDefinition || {};
      const channel: SendChannel = plan.channel;
      // Campaign Center (739): the APPROVED audience snapshot — exactly the customers chosen and approved, re-checked LIVE
      // here for consent, usable contact and an active, unarchived profile (per-recipient opt-out is re-checked by the
      // executor). Never widened: a customer outside the snapshot is never added.
      if (def.campaignSnapshot === true) return await snapshotRecipients(this.db, ctx.tenantId, campaign.id, Math.trunc(Number(def.snapshotVersion) || 0), channel);
      const consentCol = channel === 'email' ? 'c.marketing_email_opt_in' : 'c.marketing_sms_opt_in';
      const contactCol = channel === 'email' ? 'c.email' : 'c.normalized_phone';

      let q = this.db.selectFrom('customers as c')
        .where('c.tenant_id', '=', ctx.tenantId)
        .where('c.archived_at', 'is', null)
        .where(consentCol, '=', true)
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

      return rows.map((r) => ({
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

/** the approved snapshot's eligible customers, with consent + contact re-read now (raw SQL, tenant pinned) */
export async function snapshotRecipients(db: Kysely<any>, tenantId: string, campaignId: string, snapshotVersion: number, channel: SendChannel): Promise<RecipientRow[]> {
  if (snapshotVersion < 1 || channel === 'push') return [];
  const consent = channel === 'email' ? sql`c.marketing_email_opt_in` : sql`c.marketing_sms_opt_in`;
  const contact = channel === 'email' ? sql`c.email` : sql`c.normalized_phone`;
  const rows = (await sql<any>`select c.id as customer_id, c.branch_id, ${contact} as address, coalesce(${consent}, false) as consent
      from campaign_recipients r join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
      where r.tenant_id = ${tenantId} and r.campaign_id = ${campaignId} and r.snapshot_version = ${snapshotVersion} and r.eligibility = 'eligible'
        and c.archived_at is null and c.status = 'active'
      order by c.id limit ${MAX_RECIPIENTS}`.execute(db)).rows;
  return rows.map((r: any) => ({ customerId: String(r.customer_id), branchId: r.branch_id ?? null, channel, address: String(r.address ?? ''), hasConsent: !!r.consent }));
}

// ── Birthday Campaigns (750): one birthday message per customer per occasion year per channel ────────────────────────
// A campaign is a birthday campaign when its audience came from the Birthday Campaign Assistant (campaigns.occasion,
// set by Campaign Center when that audience is attached). The claim is a row in birthday_message_claims, unique per
// salon + customer + occasion year + channel, inserted BEFORE the provider call:
//   • free                      → claimed for this campaign → send
//   • claimed by THIS campaign  → skipped: birthday_send_in_progress (a second worker, or a run that died mid-send — the
//                                 customer is never risked a second birthday text; the skip is visible in the campaign)
//   • claimed/sent by another   → skipped: birthday_already_sent_this_year
//   • released (a failed send)  → re-claimed for this campaign
// The occasion year is the year of the birthday occurrence closest to the salon's "today" (birthday-core).
export class KyselyOccasionGuard {
  private occ = new Map<string, string | null>();
  constructor(private readonly db: Kysely<any>) {}
  private async occasionOf(tenantId: string, campaignId: string): Promise<string | null> {
    const k = `${tenantId}:${campaignId}`;
    if (!this.occ.has(k)) this.occ.set(k, (await sql<any>`select occasion from campaigns where tenant_id = ${tenantId} and id = ${campaignId}`.execute(this.db)).rows[0]?.occasion ?? null);
    return this.occ.get(k) ?? null;
  }
  async claim(ctx: AiMarketingContext, campaignId: string, customerId: string, channel: SendChannel): Promise<{ allowed: boolean; reason?: string; claimId?: string | null }> {
    if (channel !== 'sms' && channel !== 'email') return { allowed: true, claimId: null };
    if ((await this.occasionOf(ctx.tenantId, campaignId)) !== 'birthday') return { allowed: true, claimId: null };
    const c = (await sql<any>`select to_char(birthday, 'YYYY-MM-DD') as birthday from customers where tenant_id = ${ctx.tenantId} and id = ${customerId}`.execute(this.db)).rows[0];
    const md = monthDayOf(c?.birthday);
    if (!md) return { allowed: false, reason: 'birthday_not_recorded' };   // the birthday was cleared after approval
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => 'America/New_York');
    const today = businessDate(tz);
    const pol = (await sql<any>`select feb29_policy from tenant_birthday_settings where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.feb29_policy;
    const year = occasionYear(md, today, isFeb29Policy(pol) ? pol : 'feb28');
    const r = (await sql<any>`insert into birthday_message_claims (tenant_id, customer_id, occasion_year, channel, campaign_id, status)
        values (${ctx.tenantId}, ${customerId}, ${year}, ${channel}, ${campaignId}, 'claimed')
      on conflict (tenant_id, customer_id, occasion_year, channel) do update
        set campaign_id = excluded.campaign_id, status = 'claimed', updated_at = now()
        where ${canMoveToSql(BIRTHDAY_MESSAGE_CLAIM, 'claimed', 'birthday_message_claims')}
      returning id, campaign_id`.execute(this.db)).rows[0];
    if (!r) {
      const cur = (await sql<any>`select status, campaign_id from birthday_message_claims where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and occasion_year = ${year} and channel = ${channel}`.execute(this.db)).rows[0];
      // the same campaign mid-send (a second worker, or a run that died after claiming): never risk a second text
      return { allowed: false, reason: cur && cur.status === 'claimed' && String(cur.campaign_id) === campaignId ? 'birthday_send_in_progress' : 'birthday_already_sent_this_year' };
    }
    return { allowed: true, claimId: String(r.id) };
  }
  async settle(ctx: AiMarketingContext, claimId: string, outcome: 'sent' | 'released'): Promise<void> {
    await sql`update birthday_message_claims set status = ${outcome}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${claimId} and ${canMoveToSql(BIRTHDAY_MESSAGE_CLAIM, outcome)}`.execute(this.db);
  }
}
