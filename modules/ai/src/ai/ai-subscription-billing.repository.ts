// ai-subscription-billing.repository.ts — idempotent persistence for billing-driven status changes. The event_id is
// claimed first (UNIQUE in ai_billing_events) so a re-delivered webhook is a no-op; only if the claim is new do we read
// the current status, apply the pure transition, and update tenant_ai_subscriptions. Guarded raw sql.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_AI_SUBSCRIPTION } from '../ai-lifecycles';
import { applyAiBillingEvent, type AiSubStatus } from './ai-subscription-billing-core';

export interface NormalizedBillingEvent {
  eventId: string; tenantId: string; packageCode: string; eventType: string;
  provider?: string | null; paymentSubscriptionId?: string | null; paymentCustomerId?: string | null; paymentStatus?: string | null;
  raw?: unknown;
}
export interface BillingApplyResult {
  applied: boolean; duplicate?: boolean; fromStatus?: AiSubStatus | null; toStatus?: AiSubStatus | null; reason: string;
}

export interface ExpiredTrialRow { tenantId: string; packageCode: string; trialEndsAt: string }
export interface AiSubscriptionBillingRepo {
  apply(ev: NormalizedBillingEvent): Promise<BillingApplyResult>;
  /** Trialing subscriptions whose trial_ends_at has passed — the sweep flips these to 'expired'. */
  listExpiredTrials(nowIso: string, limit: number): Promise<ExpiredTrialRow[]>;
}

export class InMemoryAiSubscriptionBillingRepo implements AiSubscriptionBillingRepo {
  public subs = new Map<string, AiSubStatus>();   // `${tenantId}:${packageCode}` -> status
  public trials: ExpiredTrialRow[] = [];           // seed for listExpiredTrials (tenantId, packageCode, trialEndsAt)
  public events = new Set<string>();               // processed event ids
  public log: { eventId: string; from: AiSubStatus | null; to: AiSubStatus | null; reason: string }[] = [];
  async listExpiredTrials(nowIso: string, limit: number): Promise<ExpiredTrialRow[]> {
    return this.trials
      .filter((t) => this.subs.get(`${t.tenantId}:${t.packageCode}`) === 'trialing' && t.trialEndsAt <= nowIso)
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }
  async apply(ev: NormalizedBillingEvent): Promise<BillingApplyResult> {
    if (this.events.has(ev.eventId)) return { applied: false, duplicate: true, reason: 'duplicate_event' };
    this.events.add(ev.eventId);
    const key = `${ev.tenantId}:${ev.packageCode}`;
    const current = this.subs.get(key);
    if (!current) { this.log.push({ eventId: ev.eventId, from: null, to: null, reason: 'no_subscription' }); return { applied: false, fromStatus: null, toStatus: null, reason: 'no_subscription' }; }
    const t = applyAiBillingEvent(current, ev.eventType);
    if (!t.ok) { this.log.push({ eventId: ev.eventId, from: current, to: current, reason: t.reason }); return { applied: false, fromStatus: current, toStatus: current, reason: t.reason }; }
    if (t.changed && t.status !== current) this.subs.set(key, t.status);
    this.log.push({ eventId: ev.eventId, from: current, to: t.status, reason: t.reason });
    return { applied: t.changed && t.status !== current, fromStatus: current, toStatus: t.status, reason: t.reason };
  }
}

export class KyselyAiSubscriptionBillingRepo implements AiSubscriptionBillingRepo {
  constructor(private readonly db: Kysely<any>) {}
  async listExpiredTrials(nowIso: string, limit: number): Promise<ExpiredTrialRow[]> {
    const r: any = await sql`
      select tenant_id, package_code, trial_ends_at from tenant_ai_subscriptions
      where status = 'trialing' and trial_ends_at is not null and trial_ends_at <= ${nowIso}
      order by trial_ends_at asc limit ${limit}
    `.execute(this.db).catch(() => ({ rows: [] }));
    return (r?.rows ?? []).map((x: any) => ({ tenantId: String(x.tenant_id), packageCode: String(x.package_code), trialEndsAt: new Date(x.trial_ends_at).toISOString() }));
  }
  async apply(ev: NormalizedBillingEvent): Promise<BillingApplyResult> {
    // 1) Claim the event id (idempotency). ON CONFLICT DO NOTHING → 0 rows means we've already processed it.
    const claim: any = await sql`
      insert into ai_billing_events (event_id, tenant_id, package_code, event_type, provider, payment_status, raw_json)
      values (${ev.eventId}, ${ev.tenantId}, ${ev.packageCode}, ${ev.eventType}, ${ev.provider ?? null}, ${ev.paymentStatus ?? null}, ${ev.raw ? JSON.stringify(ev.raw) : null}::jsonb)
      on conflict (event_id) do nothing
      returning id
    `.execute(this.db).catch(() => ({ rows: [] }));
    if (!claim?.rows?.length) return { applied: false, duplicate: true, reason: 'duplicate_event' };

    // 2) Read current status.
    const cur: any = await sql`select status from tenant_ai_subscriptions where tenant_id = ${ev.tenantId} and package_code = ${ev.packageCode}`
      .execute(this.db).catch(() => ({ rows: [] }));
    const current = cur?.rows?.[0]?.status as AiSubStatus | undefined;
    if (!current) { await this.stamp(ev.eventId, null, null, 'no_subscription', false); return { applied: false, fromStatus: null, toStatus: null, reason: 'no_subscription' }; }

    // 3) Apply the pure transition.
    const t = applyAiBillingEvent(current, ev.eventType);
    if (!t.ok) { await this.stamp(ev.eventId, current, current, t.reason, false); return { applied: false, fromStatus: current, toStatus: current, reason: t.reason }; }
    const willChange = t.changed && t.status !== current;

    if (willChange || t.setPeriod || t.lastPaymentStatus) {
      // Phase 12 (#27): conditional on the status this event was evaluated against — a concurrent event that moved the
      // subscription first wins; this one is recorded as not applied instead of overwriting it
      const moved: any = await sql`
        update tenant_ai_subscriptions set
          status = ${t.status},
          last_payment_status = coalesce(${t.lastPaymentStatus ?? null}, last_payment_status),
          payment_provider = coalesce(${ev.provider ?? null}, payment_provider),
          payment_subscription_id = coalesce(${ev.paymentSubscriptionId ?? null}, payment_subscription_id),
          payment_customer_id = coalesce(${ev.paymentCustomerId ?? null}, payment_customer_id),
          current_period_starts_at = ${t.setPeriod ? sql`now()` : sql`current_period_starts_at`},
          cancelled_at = ${t.setCancelled ? sql`now()` : sql`cancelled_at`},
          updated_at = now()
        where tenant_id = ${ev.tenantId} and package_code = ${ev.packageCode} and status = ${current} and ${canMoveToSql(TENANT_AI_SUBSCRIPTION, t.status)}
      `.execute(this.db).catch(() => undefined);
      if (moved && Number(moved.numAffectedRows ?? moved.numUpdatedRows ?? 1) === 0) {
        await this.stamp(ev.eventId, current, current, 'concurrent_change', false);
        return { applied: false, fromStatus: current, toStatus: current, reason: 'concurrent_change' };
      }
    }
    await this.stamp(ev.eventId, current, t.status, t.reason, willChange);
    return { applied: willChange, fromStatus: current, toStatus: t.status, reason: t.reason };
  }
  private async stamp(eventId: string, from: AiSubStatus | null, to: AiSubStatus | null, reason: string, applied: boolean) {
    await sql`update ai_billing_events set from_status=${from}, to_status=${to}, applied=${applied} where event_id=${eventId}`.execute(this.db).catch(() => undefined);
  }
}
