// deals.kysely.repository.ts — Postgres adapter for the deals domain. Tenant/branch/technician scoping is server-
// derived from ctx and pinned in every WHERE. Uses raw sql templates (the deals tables are additive and not in the
// generated Kysely schema types). Status transitions are written with a guarded WHERE (status IN fromStates) so a
// lost race is a no-op, never a silent overwrite. Money is integer cents.
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL } from '../engine/deal-lifecycles';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { DealContext, CreateDealInput, DealView } from './deals.dto';
import type { DealSettings, DealStatus } from './deals.core';
import { computeFinalPriceCents, savingsCents } from './deals.core';
import { KyselyDealsLedger } from '../engine/deals-ledger.kysely';
import { KyselyDealsMarketplace } from './deals-marketplace.kysely';
import type { DealsRepositoryPort, RecordApprovalInput, ReserveResult, HoldRow, ConsumedHold, RedemptionInput, RedemptionResult, DealEventType, DealAnalyticsRow, MarketplaceOverview, AdminDealRow, SavedDealCard, CatalogCheck, NearbyQuery } from './deals.repository';

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);

const ACTIVE_TECH_STATES = ['active', 'pending_approval', 'approved', 'scheduled', 'paused'];
// which lifecycle fact a status change is (from>to, or *>to for any origin)
const TRANSITION_EVENT: Record<string, string> = {
  '*>pending_approval': DOMAIN_EVENTS.DEAL_SUBMITTED, '*>approved': DOMAIN_EVENTS.DEAL_APPROVED, '*>rejected': DOMAIN_EVENTS.DEAL_REJECTED,
  'approved>active': DOMAIN_EVENTS.DEAL_PUBLISHED, 'approved>scheduled': DOMAIN_EVENTS.DEAL_PUBLISHED, 'scheduled>active': DOMAIN_EVENTS.DEAL_PUBLISHED,
  'paused>scheduled': DOMAIN_EVENTS.DEAL_RESUMED, 'paused>active': DOMAIN_EVENTS.DEAL_RESUMED, '*>paused': DOMAIN_EVENTS.DEAL_PAUSED,
  '*>expired': DOMAIN_EVENTS.DEAL_EXPIRED, '*>sold_out': DOMAIN_EVENTS.DEAL_SOLD_OUT, '*>canceled': DOMAIN_EVENTS.DEAL_SUSPENDED,
  '*>active': DOMAIN_EVENTS.DEAL_PUBLISHED, '*>scheduled': DOMAIN_EVENTS.DEAL_PUBLISHED, '*>archived': DOMAIN_EVENTS.DEAL_UPDATED, '*>draft': DOMAIN_EVENTS.DEAL_UPDATED,
};

function toSettings(r: any): DealSettings {
  return {
    allowTechnicianDeals: (r?.allow_technician_deals ?? 'off') as any,
    maxDiscountPercent: r?.max_discount_percent == null ? null : Number(r.max_discount_percent),
    maxFixedDiscountCents: r?.max_fixed_discount_cents == null ? null : Number(r.max_fixed_discount_cents),
    minServicePriceCents: r?.min_service_price_cents == null ? null : Number(r.min_service_price_cents),
    maxActiveDealsPerTech: r?.max_active_deals_per_tech == null ? null : Number(r.max_active_deals_per_tech),
    maxRedemptionsCap: r?.max_redemptions_cap == null ? null : Number(r.max_redemptions_cap),
    maxCampaignDurationDays: r?.max_campaign_duration_days == null ? null : Number(r.max_campaign_duration_days),
    allowedNewCustomer: r?.allowed_new_customer ?? true,
    allowedExistingCustomer: r?.allowed_existing_customer ?? true,
    // BUILD_PLAN Phase 5, bug 19: these were written by migration 387 and read by nothing
    allowStackLoyalty: r?.allow_stack_loyalty ?? false,
    allowStackMembership: r?.allow_stack_membership ?? false,
    editableAfterRedemption: r?.editable_after_redemption ?? false,
    stackingPolicy: (r?.stacking_policy ?? 'best_single') as any,
    priceFloorPercent: Number(r?.price_floor_percent ?? 0),
    maxTotalDiscountPercent: r?.max_total_discount_percent == null ? null : Number(r.max_total_discount_percent),
    dealsEnabled: r?.deals_enabled ?? true,
    platformDisabled: r?.platform_disabled ?? false,
    platformDisabledReason: r?.platform_disabled_reason ?? null,
    platformMaxActiveDeals: r?.platform_max_active_deals == null ? null : Number(r.platform_max_active_deals),
  };
}
const DEFAULTS: DealSettings = toSettings({});

function toView(r: any, serviceIds: string[]): DealView {
  const original = r.original_price_cents == null ? null : Number(r.original_price_cents);
  const final = r.final_price_cents == null ? null : Number(r.final_price_cents);
  return {
    id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null,
    ownerType: String(r.owner_type) as any, technicianId: r.technician_id ? String(r.technician_id) : null,
    title: String(r.title), shortDescription: r.short_description ?? null, terms: r.terms ?? null, imageUrl: r.image_url ?? null,
    discountType: String(r.discount_type) as any, discountPercent: r.discount_percent == null ? null : Number(r.discount_percent),
    discountCents: r.discount_cents == null ? null : Number(r.discount_cents), originalPriceCents: original, finalPriceCents: final,
    savingsCents: original == null || final == null ? null : Math.max(0, original - final), serviceIds,
    startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), newCustomersOnly: !!r.new_customers_only, memberOnly: !!r.member_only,
    maxRedemptions: r.max_redemptions == null ? null : Number(r.max_redemptions), maxPerCustomer: r.max_per_customer == null ? null : Number(r.max_per_customer),
    stackable: !!r.stackable, allowTechSubstitution: !!r.allow_tech_substitution, status: String(r.status) as any,
    redemptionCount: Number(r.redemption_count || 0), version: Number(r.version || 1), createdAt: iso(r.created_at) || '',
    kind: (r.kind ?? 'deal') as any, rules: r.rules ?? null, priority: Number(r.priority ?? 100), stackGroup: r.stack_group ?? null,
    maxDiscountCents: r.max_discount_cents == null ? null : Number(r.max_discount_cents), budgetCents: r.budget_cents == null ? null : Number(r.budget_cents),
    budgetReservedCents: Number(r.budget_reserved_cents ?? 0), channels: Array.isArray(r.channels) ? r.channels : null, requiresCode: !!r.requires_code,
    daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week.map(Number) : null, validFromMinute: r.valid_from_minute == null ? null : Number(r.valid_from_minute),
    validToMinute: r.valid_to_minute == null ? null : Number(r.valid_to_minute), minSpendCents: r.min_spend_cents == null ? null : Number(r.min_spend_cents),
    bookingLeadMinutes: r.booking_lead_minutes == null ? null : Number(r.booking_lead_minutes),
    suspendedReason: r.suspended_reason ?? null, suspendedAt: iso(r.suspended_at), publishedAt: iso(r.published_at),
  };
}

/** The terms a customer sees, as they stood at a version (deal_versions.terms). */
function versionTerms(v: DealView): Record<string, unknown> {
  const { id, tenantId, redemptionCount, createdAt, status, version, budgetReservedCents, suspendedAt, suspendedReason, publishedAt, ...terms } = v as any;
  return terms;
}

export class KyselyDealsRepository implements DealsRepositoryPort {
  /** BUILD_PLAN Phase 5: the capacity + application ledger (holds, applications, coupons) — one place for every deal use. */
  readonly ledger: KyselyDealsLedger;
  /** The cross-salon reads and Super Admin writes (declared CROSS-TENANT in its own file). */
  readonly marketplace: KyselyDealsMarketplace;
  constructor(private readonly db: AppDatabase, private readonly outbox?: OutboxWriter) { this.ledger = new KyselyDealsLedger(db, outbox ?? null); this.marketplace = new KyselyDealsMarketplace(db, outbox ?? null); }

  nearbyActiveDealRows(q?: NearbyQuery) { return this.marketplace.nearbyActiveDealRows(q); }
  getPublicDealRow(id: string) { return this.marketplace.getPublicDealRow(id); }
  marketplaceOverview() { return this.marketplace.marketplaceOverview(); }
  listAllDeals(f: { status?: string | null; tenantId?: string | null; kind?: string | null; search?: string | null; suspended?: boolean | null }) { return this.marketplace.listAllDeals(f); }
  superSuspendDeal(dealId: string, reason: string, actor: { userId: string | null; role?: string | null }) { return this.marketplace.superSuspendDeal(dealId, reason, actor); }
  setTenantPlatform(tenantId: string, patch: { disabled?: boolean; reason?: string | null; maxActiveDeals?: number | null }, actor: { userId: string | null }) { return this.marketplace.setTenantPlatform(tenantId, patch, actor); }
  tenantsOverview() { return this.marketplace.tenantsOverview(); }
  /**
   * BUILD_PLAN Phase 5 — plan gating: the salon's plan (tenant_subscriptions → subscription_plans) may leave deals out
   * (plan_features 'deals.engine' = unavailable) or cap live deals (plan_limits 'active_deals'); the per-salon overrides
   * win (tenant_feature_overrides / tenant_plan_limit_overrides). No rule = allowed, unlimited.
   */
  async planGate(ctx: DealContext): Promise<{ featureState: string | null; maxActiveDeals: number | null }> {
    const plan = rowsOf(await sql`SELECT sp.id FROM tenant_subscriptions ts JOIN subscription_plans sp ON lower(sp.code) = lower(ts.plan) OR lower(sp.name) = lower(ts.plan)
                                   WHERE ts.tenant_id = ${ctx.tenantId} AND lower(ts.status) = 'active' ORDER BY ts.current_period_end DESC NULLS LAST LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })))[0];
    const feat = plan ? rowsOf(await sql`SELECT state FROM plan_features WHERE plan_id = ${plan.id} AND feature_key = 'deals.engine' LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })))[0] : null;
    const lim = plan ? rowsOf(await sql`SELECT limit_value FROM plan_limits WHERE plan_id = ${plan.id} AND metric = 'active_deals' LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })))[0] : null;
    const fo = rowsOf(await sql`SELECT state FROM tenant_feature_overrides WHERE tenant_id = ${ctx.tenantId} AND feature_key = 'deals.engine' AND (expires_at IS NULL OR expires_at > now()) LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })))[0];
    const lo = rowsOf(await sql`SELECT limit_value FROM tenant_plan_limit_overrides WHERE tenant_id = ${ctx.tenantId} AND metric = 'active_deals' AND (expires_at IS NULL OR expires_at > now()) ORDER BY effective_from DESC LIMIT 1`.execute(this.d).catch(() => ({ rows: [] })))[0];
    const limit = lo ? lo.limit_value : lim ? lim.limit_value : null;
    return { featureState: fo?.state ?? feat?.state ?? null, maxActiveDeals: limit == null ? null : Number(limit) };
  }

  async countLiveDeals(ctx: DealContext): Promise<number> {
    const r = rowsOf(await sql`SELECT count(*)::int AS n FROM deals WHERE tenant_id = ${ctx.tenantId} AND status IN ('active','scheduled')`.execute(this.d))[0];
    return Number(r?.n ?? 0);
  }

  /** Bugs 7 + 8: the branch and the services must be THIS salon's; the prices come from the catalog. */
  async catalogFor(ctx: DealContext, branchId: string | null, serviceIds: string[]): Promise<CatalogCheck> {
    const branchOk = !branchId || rowsOf(await sql`SELECT 1 FROM branches WHERE tenant_id = ${ctx.tenantId} AND id = ${branchId} LIMIT 1`.execute(this.d)).length > 0;
    const services = serviceIds.length
      ? rowsOf(await sql`SELECT id, price_cents, branch_id FROM services WHERE tenant_id = ${ctx.tenantId} AND id IN (${sql.join(serviceIds)}) AND status <> 'archived'`.execute(this.d))
          .map((r) => ({ id: String(r.id), priceCents: Number(r.price_cents), branchId: String(r.branch_id) }))
      : [];
    return { branchOk, services };
  }

  async dealsEngineDisabled(): Promise<boolean> {
    const r: any = await sql`select value from platform_settings where setting_key = 'deals.engine_disabled' limit 1`.execute(this.db as any);
    const v = r.rows[0]?.value;
    return v === true || v === 'true';
  }

  private get d(): any { return this.db; }

  private async servicesFor(tenantId: string, id: string, q?: any): Promise<string[]> {
    return rowsOf(await sql`SELECT service_id FROM deal_services WHERE tenant_id = ${tenantId} AND deal_id = ${id}`.execute(q ?? this.d)).map((x) => String(x.service_id));
  }

  async resolveTechnicianId(ctx: DealContext): Promise<string | null> {
    if (ctx.technicianId) return ctx.technicianId;
    const r = rowsOf(await sql`SELECT id FROM technicians WHERE tenant_id=${ctx.tenantId} AND user_id=${ctx.userId} LIMIT 1`.execute(this.d))[0];
    return r ? String(r.id) : null;
  }

  async getSettings(ctx: DealContext): Promise<DealSettings> {
    const r = rowsOf(await sql`SELECT * FROM deal_settings WHERE tenant_id=${ctx.tenantId} LIMIT 1`.execute(this.d))[0];
    return r ? toSettings(r) : { ...DEFAULTS };
  }

  async upsertSettings(ctx: DealContext, s: Partial<DealSettings>): Promise<DealSettings> {
    const cur = await this.getSettings(ctx);
    const m = { ...cur, ...s };
    await sql`
      INSERT INTO deal_settings (tenant_id, allow_technician_deals, max_discount_percent, max_fixed_discount_cents,
        min_service_price_cents, max_active_deals_per_tech, max_redemptions_cap, max_campaign_duration_days,
        allowed_new_customer, allowed_existing_customer, allow_stack_loyalty, allow_stack_membership, editable_after_redemption,
        stacking_policy, price_floor_percent, max_total_discount_percent, deals_enabled, updated_by_user_id, updated_at)
      VALUES (${ctx.tenantId}, ${m.allowTechnicianDeals}, ${m.maxDiscountPercent}, ${m.maxFixedDiscountCents},
        ${m.minServicePriceCents}, ${m.maxActiveDealsPerTech}, ${m.maxRedemptionsCap}, ${m.maxCampaignDurationDays},
        ${m.allowedNewCustomer}, ${m.allowedExistingCustomer}, ${!!m.allowStackLoyalty}, ${!!m.allowStackMembership}, ${!!m.editableAfterRedemption},
        ${m.stackingPolicy ?? 'best_single'}, ${m.priceFloorPercent ?? 0}, ${m.maxTotalDiscountPercent ?? null}, ${m.dealsEnabled ?? true}, ${ctx.userId}, now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        allow_technician_deals=EXCLUDED.allow_technician_deals, max_discount_percent=EXCLUDED.max_discount_percent,
        max_fixed_discount_cents=EXCLUDED.max_fixed_discount_cents, min_service_price_cents=EXCLUDED.min_service_price_cents,
        max_active_deals_per_tech=EXCLUDED.max_active_deals_per_tech, max_redemptions_cap=EXCLUDED.max_redemptions_cap,
        max_campaign_duration_days=EXCLUDED.max_campaign_duration_days, allowed_new_customer=EXCLUDED.allowed_new_customer,
        allowed_existing_customer=EXCLUDED.allowed_existing_customer, allow_stack_loyalty=EXCLUDED.allow_stack_loyalty,
        allow_stack_membership=EXCLUDED.allow_stack_membership, editable_after_redemption=EXCLUDED.editable_after_redemption,
        stacking_policy=EXCLUDED.stacking_policy, price_floor_percent=EXCLUDED.price_floor_percent,
        max_total_discount_percent=EXCLUDED.max_total_discount_percent, deals_enabled=EXCLUDED.deals_enabled,
        updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()
    `.execute(this.d);
    await this.audit(this.d, ctx, 'deals_settings_updated', 'deal_settings', ctx.tenantId, cur, m);
    return this.getSettings(ctx);
  }

  async countActiveDealsForTech(ctx: DealContext, technicianId: string): Promise<number> {
    const r = rowsOf(await sql`SELECT count(*)::int AS c FROM deals WHERE tenant_id=${ctx.tenantId} AND technician_id=${technicianId} AND status IN (${sql.join(ACTIVE_TECH_STATES)})`.execute(this.d))[0];
    return Number(r?.c ?? 0);
  }

  async insertDeal(ctx: DealContext, input: CreateDealInput, initialStatus: DealStatus, finalPriceCents: number): Promise<DealView> {
    return this.d.transaction().execute(async (trx: any) => {
      const row = rowsOf(await sql`
        INSERT INTO deals (tenant_id, branch_id, owner_type, technician_id, title, short_description, terms, image_url,
          discount_type, discount_percent, discount_cents, original_price_cents, final_price_cents, starts_at, ends_at,
          new_customers_only, member_only, min_spend_cents, deposit_cents, max_redemptions, max_per_customer, stackable,
          allow_tech_substitution, status, created_by_user_id, created_by_technician_id,
          kind, rules, priority, stack_group, max_discount_cents, budget_cents, channels, requires_code, days_of_week,
          valid_from_minute, valid_to_minute, booking_lead_minutes, published_at)
        VALUES (${ctx.tenantId}, ${input.branchId || null}, ${input.ownerType}, ${input.technicianId ?? null}, ${input.title.trim()},
          ${input.shortDescription ?? null}, ${input.terms ?? null}, ${input.imageUrl ?? null}, ${input.discountType},
          ${input.discountType === 'percent' ? input.discountPercent ?? null : null}, ${input.discountType !== 'percent' ? input.discountCents ?? null : null},
          ${input.originalPriceCents ?? null}, ${input.originalPriceCents == null ? null : finalPriceCents},
          ${input.startsAt || null}, ${input.endsAt || null}, ${!!input.newCustomersOnly}, ${!!input.memberOnly},
          ${input.minSpendCents ?? null}, ${input.depositCents ?? null}, ${input.maxRedemptions ?? null}, ${input.maxPerCustomer ?? null},
          ${!!input.stackable}, ${!!input.allowTechSubstitution}, ${initialStatus}, ${ctx.userId},
          ${input.ownerType === 'technician' ? (input.technicianId ?? ctx.technicianId ?? null) : null},
          ${input.kind ?? 'deal'}, ${JSON.stringify(input.rules ?? {})}::jsonb, ${input.priority ?? 100}, ${input.stackGroup ?? null},
          ${input.maxDiscountCents ?? null}, ${input.budgetCents ?? null}, ${input.channels && input.channels.length ? sql`${input.channels}::text[]` : null},
          ${!!input.requiresCode}, ${input.daysOfWeek && input.daysOfWeek.length ? sql`${input.daysOfWeek}::smallint[]` : null},
          ${input.validFromMinute ?? null}, ${input.validToMinute ?? null}, ${input.bookingLeadMinutes ?? null},
          ${initialStatus === 'active' || initialStatus === 'scheduled' ? sql`now()` : null})
        RETURNING *
      `.execute(trx))[0];
      const serviceIds = (input.serviceIds ?? []).filter(Boolean);
      for (const sid of serviceIds) {
        await sql`INSERT INTO deal_services (deal_id, service_id, tenant_id) VALUES (${row.id}, ${sid}, ${ctx.tenantId}) ON CONFLICT DO NOTHING`.execute(trx);
      }
      const view = toView(row, serviceIds);
      await sql`INSERT INTO deal_versions (deal_id, tenant_id, version, terms, changed_by_user_id) VALUES (${row.id}, ${ctx.tenantId}, ${view.version}, ${JSON.stringify(versionTerms(view))}::jsonb, ${ctx.userId})`.execute(trx);
      await this.lifecycle(trx, ctx, DOMAIN_EVENTS.DEAL_CREATED, view, null, { kind: view.kind, ownerType: view.ownerType, status: view.status });
      if (initialStatus === 'active' || initialStatus === 'scheduled') await this.lifecycle(trx, ctx, DOMAIN_EVENTS.DEAL_PUBLISHED, view, null, { status: view.status, auto: true });
      return view;
    });
  }

  /** Edit the terms: a new version (deal_versions); applications already on tickets keep the version they were applied at. */
  async updateDealTerms(ctx: DealContext, id: string, patch: Record<string, unknown>, finalPriceCents: number | null, serviceIds: string[] | null): Promise<DealView | null> {
    return this.d.transaction().execute(async (trx: any) => {
      const before = rowsOf(await sql`SELECT * FROM deals WHERE tenant_id = ${ctx.tenantId} AND id = ${id} FOR UPDATE`.execute(trx))[0];
      if (!before) return null;
      const col: Record<string, string> = { title: 'title', shortDescription: 'short_description', terms: 'terms', imageUrl: 'image_url', discountType: 'discount_type', discountPercent: 'discount_percent',
        discountCents: 'discount_cents', originalPriceCents: 'original_price_cents', startsAt: 'starts_at', endsAt: 'ends_at', newCustomersOnly: 'new_customers_only', memberOnly: 'member_only',
        minSpendCents: 'min_spend_cents', depositCents: 'deposit_cents', maxRedemptions: 'max_redemptions', maxPerCustomer: 'max_per_customer', stackable: 'stackable',
        allowTechSubstitution: 'allow_tech_substitution', priority: 'priority', stackGroup: 'stack_group', maxDiscountCents: 'max_discount_cents', budgetCents: 'budget_cents',
        requiresCode: 'requires_code', validFromMinute: 'valid_from_minute', validToMinute: 'valid_to_minute', bookingLeadMinutes: 'booking_lead_minutes' };
      const sets = Object.entries(patch).filter(([k]) => col[k]).map(([k, v]) => sql`${sql.ref(col[k])} = ${v === '' ? null : (v as any)}`);
      if ('rules' in patch) sets.push(sql`rules = ${JSON.stringify(patch.rules ?? {})}::jsonb`);
      if ('channels' in patch) sets.push(Array.isArray(patch.channels) && patch.channels.length ? sql`channels = ${patch.channels as string[]}::text[]` : sql`channels = NULL`);
      if ('daysOfWeek' in patch) sets.push(Array.isArray(patch.daysOfWeek) && patch.daysOfWeek.length ? sql`days_of_week = ${patch.daysOfWeek as number[]}::smallint[]` : sql`days_of_week = NULL`);
      if (finalPriceCents != null) sets.push(sql`final_price_cents = ${finalPriceCents}`);
      const row = rowsOf(await sql`UPDATE deals SET ${sql.join([...sets, sql`version = version + 1`, sql`updated_at = now()`])} WHERE tenant_id = ${ctx.tenantId} AND id = ${id} RETURNING *`.execute(trx))[0];
      if (serviceIds) {
        await sql`DELETE FROM deal_services WHERE tenant_id = ${ctx.tenantId} AND deal_id = ${id}`.execute(trx);
        for (const sid of serviceIds) await sql`INSERT INTO deal_services (deal_id, service_id, tenant_id) VALUES (${id}, ${sid}, ${ctx.tenantId}) ON CONFLICT DO NOTHING`.execute(trx);
      }
      const services = serviceIds ?? rowsOf(await sql`SELECT service_id FROM deal_services WHERE tenant_id = ${ctx.tenantId} AND deal_id = ${id}`.execute(trx)).map((x) => String(x.service_id));
      const view = toView(row, services);
      await sql`INSERT INTO deal_versions (deal_id, tenant_id, version, terms, changed_by_user_id) VALUES (${id}, ${ctx.tenantId}, ${view.version}, ${JSON.stringify(versionTerms(view))}::jsonb, ${ctx.userId})`.execute(trx);
      await this.lifecycle(trx, ctx, DOMAIN_EVENTS.DEAL_UPDATED, view, toView(before, []), { version: view.version, fields: Object.keys(patch) });
      return view;
    });
  }

  async versions(ctx: DealContext, id: string): Promise<{ version: number; terms: any; changedByUserId: string | null; createdAt: string | null }[]> {
    return rowsOf(await sql`SELECT version, terms, changed_by_user_id, created_at FROM deal_versions WHERE tenant_id = ${ctx.tenantId} AND deal_id = ${id} ORDER BY version DESC LIMIT 50`.execute(this.d))
      .map((r) => ({ version: Number(r.version), terms: r.terms, changedByUserId: r.changed_by_user_id ? String(r.changed_by_user_id) : null, createdAt: iso(r.created_at) }));
  }

  /** The deal lifecycle fact (outbox) + the persisted audit row (audit_logs), in the caller's transaction. */
  private async lifecycle(trx: any, ctx: DealContext, type: any, view: DealView, before: DealView | null, payload: Record<string, unknown>): Promise<void> {
    if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: type, tenantId: ctx.tenantId, branchId: view.branchId ?? undefined, aggregateType: 'deal', aggregateId: view.id,
      actorId: ctx.userId || undefined, actorType: ctx.userId ? 'user' : 'system', payload: { dealId: view.id, ...payload } }));
    await this.audit(trx, ctx, String(type).replace('.', '_'), 'deal', view.id, before ? { status: before.status, version: before.version } : null, { status: view.status, version: view.version, ...payload });
  }

  /** Persisted, append-only audit (audit_logs) — the tenant Audit Log shows it. Never a coupon code. */
  async audit(q: any, ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, action: string, entityType: string, entityId: string, before: unknown, after: unknown): Promise<void> {
    const uid = ctx.userId && /^[0-9a-f-]{36}$/i.test(ctx.userId) ? ctx.userId : null;
    const bid = ctx.branchId && /^[0-9a-f-]{36}$/i.test(ctx.branchId) ? ctx.branchId : null;
    await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${ctx.tenantId}, ${bid}, ${uid}, ${ctx.role ?? null}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify({ before, after })}::jsonb)`.execute(q);
  }

  async getDeal(ctx: DealContext, id: string): Promise<DealView | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const row = rowsOf(await sql`SELECT * FROM deals WHERE tenant_id=${ctx.tenantId} AND id=${id} LIMIT 1`.execute(this.d))[0];
    return row ? toView(row, await this.servicesFor(ctx.tenantId, id)) : null;
  }

  async listDeals(ctx: DealContext, filter?: { status?: DealStatus; ownerType?: string; technicianId?: string; kind?: string }): Promise<DealView[]> {
    const rows = rowsOf(await sql`
      SELECT * FROM deals WHERE tenant_id=${ctx.tenantId}
        ${filter?.status ? sql`AND status=${filter.status}` : sql``}
        ${filter?.kind ? sql`AND kind=${filter.kind}` : sql``}
        ${filter?.ownerType ? sql`AND owner_type=${filter.ownerType}` : sql``}
        ${filter?.technicianId ? sql`AND technician_id=${filter.technicianId}` : sql``}
      ORDER BY created_at DESC LIMIT 200
    `.execute(this.d));
    const out: DealView[] = [];
    for (const r of rows) out.push(toView(r, await this.servicesFor(ctx.tenantId, String(r.id))));
    return out;
  }

  async transitionStatus(ctx: DealContext, id: string, toStatus: DealStatus, fromStates: DealStatus[], approverUserId?: string | null): Promise<DealView | null> {
    return this.d.transaction().execute(async (trx: any) => {
      const before = rowsOf(await sql`SELECT * FROM deals WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`.execute(trx))[0];
      const row = rowsOf(await sql`
        UPDATE deals SET status=${toStatus}, version=version+1, updated_at=now()
          ${approverUserId ? sql`, approved_by_user_id=${approverUserId}` : sql``}
          ${toStatus === 'active' || toStatus === 'scheduled' ? sql`, published_at = COALESCE(published_at, now())` : sql``}
          ${toStatus === 'expired' ? sql`, expired_at = now()` : sql``}
        WHERE tenant_id=${ctx.tenantId} AND id=${id} AND status IN (${sql.join(fromStates)}) AND ${canMoveToSql(DEAL, toStatus)}
        RETURNING *
      `.execute(trx))[0];
      if (!row) return null;
      const view = toView(row, await this.servicesFor(ctx.tenantId, id, trx));
      const type = TRANSITION_EVENT[`${before?.status}>${toStatus}`] ?? TRANSITION_EVENT[`*>${toStatus}`];
      if (type) await this.lifecycle(trx, ctx, type, view, before ? toView(before, []) : null, { from: before?.status ?? null, to: toStatus });
      return view;
    });
  }

  async recordApproval(ctx: DealContext, dealId: string, input: RecordApprovalInput): Promise<void> {
    await sql`
      INSERT INTO deal_approvals (deal_id, tenant_id, approver_user_id, decision, reason, deal_version, terms_snapshot)
      VALUES (${dealId}, ${ctx.tenantId}, ${ctx.userId}, ${input.decision}, ${input.reason ?? null}, ${input.dealVersion}, NULL)
    `.execute(this.d);
  }

  // The public marketplace reads (nearby feed, public detail, Super Admin suspend) are cross-tenant by nature and live in
  // deals-marketplace.kysely.ts (declared there). The capacity + application ledger is engine/deals-ledger.kysely.ts.

  async getHold(ctx: DealContext, holdId: string): Promise<HoldRow | null> {
    const r = rowsOf(await sql`SELECT id, deal_id, status, appointment_id FROM deal_redemption_holds WHERE id=${holdId} AND tenant_id=${ctx.tenantId} LIMIT 1`.execute(this.d))[0];
    return r ? { id: String(r.id), dealId: String(r.deal_id), status: String(r.status), appointmentId: r.appointment_id ? String(r.appointment_id) : null } : null;
  }

  // Best-effort analytics event. Never throws into the caller — a logging failure must not break the user's action.
  async recordEvent(tenantId: string, dealId: string, customerId: string | null, eventType: DealEventType): Promise<void> {
    try {
      await sql`INSERT INTO deal_analytics_events (deal_id, tenant_id, customer_id, event_type) VALUES (${dealId}, ${tenantId}, ${customerId ?? null}, ${eventType})`.execute(this.d);
    } catch { /* swallow — analytics is fire-and-forget */ }
  }

  async dealAnalytics(ctx: DealContext): Promise<DealAnalyticsRow[]> {
    return rowsOf(await sql`
      SELECT d.id, d.title, d.status,
        count(e.*) FILTER (WHERE e.event_type='view') AS views,
        count(e.*) FILTER (WHERE e.event_type='save') AS saves,
        count(e.*) FILTER (WHERE e.event_type='booking_start') AS booking_starts,
        count(e.*) FILTER (WHERE e.event_type='booking') AS bookings,
        count(e.*) FILTER (WHERE e.event_type='redemption') AS redemptions,
        coalesce((SELECT sum(r.amount_discounted_cents - r.reversed_cents) FROM deal_redemptions r WHERE r.tenant_id=${ctx.tenantId} AND r.deal_id=d.id AND r.status IN ('redeemed','partially_reversed')), 0) AS discounted_cents
      FROM deals d LEFT JOIN deal_analytics_events e ON e.deal_id=d.id
      WHERE d.tenant_id=${ctx.tenantId}
      GROUP BY d.id, d.title, d.status, d.created_at
      ORDER BY d.created_at DESC
    `.execute(this.d)).map((r: any) => ({
      dealId: String(r.id), title: String(r.title), status: String(r.status),
      views: Number(r.views || 0), saves: Number(r.saves || 0), bookingStarts: Number(r.booking_starts || 0),
      bookings: Number(r.bookings || 0), redemptions: Number(r.redemptions || 0), discountedCents: Number(r.discounted_cents || 0),
    }));
  }

  // In-app technician notification (the Tech App reads technician_notifications). Best-effort — never breaks the action.
  async notifyTechnician(tenantId: string, technicianId: string, title: string, body: string | null): Promise<void> {
    try {
      await sql`INSERT INTO technician_notifications (tenant_id, technician_id, type, title, body) VALUES (${tenantId}, ${technicianId}, 'deal', ${title}, ${body ?? null})`.execute(this.d);
    } catch { /* swallow — notification failure must not break approve/reject */ }
  }

  /** Has a Super Admin frozen this technician's deals? (join the salon technician up to their global profile flag.) */
  async techServices(ctx: DealContext, technicianId: string): Promise<{ id: string; name: string; priceCents: number }[]> {
    return rowsOf(await sql`SELECT DISTINCT s.id, s.name, s.price_cents FROM technician_services ts
        JOIN services s ON s.id = ts.service_id AND s.tenant_id = ${ctx.tenantId} AND s.status <> 'archived'
       WHERE ts.tenant_id = ${ctx.tenantId} AND ts.technician_id = ${technicianId} ORDER BY s.name`.execute(this.d))
      .map((r) => ({ id: String(r.id), name: String(r.name), priceCents: Number(r.price_cents) }));
  }

  async techDealsFrozen(tenantId: string, technicianId: string): Promise<boolean> {
    const r = rowsOf(await sql`SELECT p.admin_deals_frozen AS frozen FROM technicians t
                                 JOIN global_tech_profiles p ON p.id = t.global_tech_profile_id
                                WHERE t.id = ${technicianId} AND t.tenant_id = ${tenantId} LIMIT 1`.execute(this.d))[0] as any;
    return !!(r && r.frozen);
  }

  // User-scoped saves — keyed by the global user_id, NOT a per-tenant customer. A save never creates a customers row.
  async saveDeal(userId: string, dealId: string): Promise<{ saved: boolean; tenantId: string | null }> {
    const deal = rowsOf(await sql`SELECT tenant_id FROM deals WHERE id=${dealId} LIMIT 1`.execute(this.d))[0];
    if (!deal) return { saved: false, tenantId: null };
    await sql`INSERT INTO deal_saves (deal_id, user_id, tenant_id) VALUES (${dealId}, ${userId}, ${deal.tenant_id}) ON CONFLICT (deal_id, user_id) DO NOTHING`.execute(this.d);
    return { saved: true, tenantId: String(deal.tenant_id) };
  }
  async unsaveDeal(userId: string, dealId: string): Promise<boolean> {
    const r = rowsOf(await sql`DELETE FROM deal_saves WHERE deal_id=${dealId} AND user_id=${userId} RETURNING deal_id`.execute(this.d));
    return r.length > 0;
  }
  async isSaved(userId: string, dealId: string): Promise<boolean> {
    return rowsOf(await sql`SELECT 1 FROM deal_saves WHERE deal_id=${dealId} AND user_id=${userId} LIMIT 1`.execute(this.d)).length > 0;
  }
  // A POS ticket reaches its appointment through the queue item it was made from (tickets.queue_item_id →
  // pos_queue_items.appointment_id). Lets checkout auto-find the deal without the client passing an appointment id.
  async appointmentIdForTicket(tenantId: string, ticketId: string): Promise<string | null> {
    const r = rowsOf(await sql`SELECT q.appointment_id FROM tickets t JOIN pos_queue_items q ON q.id = t.queue_item_id WHERE t.id=${ticketId} AND t.tenant_id=${tenantId} AND q.appointment_id IS NOT NULL LIMIT 1`.execute(this.d))[0];
    return r?.appointment_id ? String(r.appointment_id) : null;
  }
  async listUserSaves(userId: string): Promise<SavedDealCard[]> {
    return rowsOf(await sql`
      SELECT d.id, d.title, d.image_url, d.owner_type, d.technician_id, d.discount_type, d.discount_percent, d.discount_cents,
             d.original_price_cents, d.final_price_cents, d.status, t.display_name AS salon_name, tech.full_name AS technician_name
      FROM deal_saves s JOIN deals d ON d.id = s.deal_id JOIN tenants t ON t.id = d.tenant_id
      LEFT JOIN technicians tech ON tech.id = d.technician_id
      WHERE s.user_id = ${userId}
      ORDER BY s.created_at DESC LIMIT 200
    `.execute(this.d)).map((r: any) => {
      const o = r.original_price_cents == null ? null : Number(r.original_price_cents);
      const f = r.final_price_cents == null ? null : Number(r.final_price_cents);
      return { id: String(r.id), title: String(r.title), imageUrl: r.image_url ?? null, ownerType: String(r.owner_type),
        technicianName: r.technician_name ?? null, salonName: r.salon_name ?? null, discountType: String(r.discount_type),
        discountPercent: r.discount_percent == null ? null : Number(r.discount_percent), discountCents: r.discount_cents == null ? null : Number(r.discount_cents),
        originalPriceCents: o, finalPriceCents: f, savingsCents: o == null || f == null ? null : Math.max(0, o - f), status: String(r.status) };
    });
  }

}

export { computeFinalPriceCents, savingsCents };
