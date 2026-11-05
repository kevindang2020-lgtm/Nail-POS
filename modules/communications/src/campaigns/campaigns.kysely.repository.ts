// campaigns.kysely.repository.ts — Postgres adapter mirroring the port. Tenant-scoped CRUD + status updates; platform
// read is cross-tenant (reachable only via the Super-Admin-guarded controller).
import { sql, type Kysely } from 'kysely';
import { applyListQuery, parseListQuery, type DB } from '@aipowersalon/database';
import { CAMPAIGNS_SPEC } from './campaigns.list-queries';
import type { CampaignsContext, CampaignsRepositoryPort, CampaignPage } from './campaigns.repository';
import type { CampaignRow, CampaignFilters, CreateCampaignRequest, UpdateCampaignRequest, CampaignStatus, CampaignChannel } from './campaigns.dto';
import { normalizeChannel } from './campaigns.dto';
import { clampPage } from '@aipowersalon/api-contracts';
import { canMoveToSql } from '@aipowersalon/database';
import { CAMPAIGN } from '../communications-lifecycles';

const toRow = (r: any): CampaignRow => ({
  id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, name: r.name, offer: r.offer ?? null,
  channel: (r.channel || 'sms') as CampaignChannel, audienceLabel: r.audience_label ?? null, audienceSize: Number(r.audience_size || 0),
  status: (r.status || 'draft') as CampaignStatus, scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
  sentCount: Number(r.sent_count || 0), openCount: Number(r.open_count || 0), clickCount: Number(r.click_count || 0),
  replyCount: Number(r.reply_count || 0), bookingCount: Number(r.booking_count || 0),
  revenueCents: Number(r.revenue_cents || 0), costCents: Number(r.cost_cents || 0),
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

export class KyselyCampaignsRepository implements CampaignsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async create(ctx: CampaignsContext, req: CreateCampaignRequest): Promise<CampaignRow> {
    const ins = await this.db.insertInto('campaigns').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, name: req.name, offer: req.offer ?? null,
      channel: normalizeChannel(req.channel), audience_label: req.audienceLabel ?? null,
      audience_size: Math.max(0, Math.trunc(req.audienceSize ?? 0)), status: 'draft',
      scheduled_at: (req.scheduledAt ?? null) as any, cost_cents: Math.max(0, Math.trunc(req.costCents ?? 0)),
      created_by: ctx.userId ?? null,
    } as any).returningAll().executeTakeFirstOrThrow();
    return toRow(ins);
  }

  async get(ctx: CampaignsContext, id: string): Promise<CampaignRow | null> {
    const r = await this.db.selectFrom('campaigns').selectAll().where('id', '=', id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return r ? toRow(r) : null;
  }

  async update(ctx: CampaignsContext, id: string, patch: UpdateCampaignRequest): Promise<CampaignRow | null> {
    const edit: any = { updated_at: sql`now()` };   // never the status (that is setStatus, through the campaign machine)
    if (patch.name !== undefined) edit.name = patch.name;
    if (patch.offer !== undefined) edit.offer = patch.offer ?? null;
    if (patch.channel !== undefined) edit.channel = normalizeChannel(patch.channel);
    if (patch.audienceLabel !== undefined) edit.audience_label = patch.audienceLabel ?? null;
    if (patch.audienceSize !== undefined) edit.audience_size = Math.max(0, Math.trunc(patch.audienceSize));
    if (patch.scheduledAt !== undefined) edit.scheduled_at = patch.scheduledAt ?? null;
    if (patch.costCents !== undefined) edit.cost_cents = Math.max(0, Math.trunc(patch.costCents));
    const r = await this.db.updateTable('campaigns').set(edit).where('id', '=', id).where('tenant_id', '=', ctx.tenantId).returningAll().executeTakeFirst();
    return r ? toRow(r) : null;
  }

  async setStatus(ctx: CampaignsContext, id: string, status: CampaignStatus): Promise<CampaignRow | null> {
    // started_at is stamped ONCE, on the first move into 'in_progress', and never moved again (migration 442).
    // The daily campaign limits count from it; updated_at moves on every edit and cannot be used.
    const set: Record<string, unknown> = { status, updated_at: sql`now()` };
    if (status === 'in_progress') set.started_at = sql`coalesce(started_at, now())`;
    const r = await this.db.updateTable('campaigns').set(set as any)
      .where('id', '=', id).where('tenant_id', '=', ctx.tenantId).where(canMoveToSql(CAMPAIGN, status) as any).returningAll().executeTakeFirst();
    return r ? toRow(r) : null;
  }

  /**
   * The salon's IANA timezone: the campaign's branch, else the tenant's earliest branch, else the platform
   * default. Quiet hours and "today" are both judged on this clock.
   */
  async salonTimezone(ctx: CampaignsContext, branchId: string | null): Promise<string> {
    const pick = async (q: any) => (await q.select('timezone').executeTakeFirst())?.timezone as string | null | undefined;
    const byBranch = branchId ? await pick(this.db.selectFrom('branches').where('id', '=', branchId).where('tenant_id', '=', ctx.tenantId)) : null;
    const first = byBranch ?? await pick(this.db.selectFrom('branches').where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'asc'));
    return first || 'America/New_York';
  }

  /** Facts the limit check needs, counted from the start of the salon-local day. Throws on error — see service. */
  /** wave 3 PAYI §81: opted-out SMS addresses for THIS salon + the platform's marketing segment price
   *  (platform_settings 'sms.marketing_segment_price_cents', group sms_packages; absent → null = unpriced). */
  async costFacts(ctx: CampaignsContext): Promise<{ optedOutSms: number; segmentPriceCents: number | null; salonName: string | null }> {
    const o: any = await sql`select count(*)::int as n from notification_opt_outs where tenant_id = ${ctx.tenantId} and channel = 'sms'`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] }));
    const p: any = await sql`select value from platform_settings where setting_key = 'sms.marketing_segment_price_cents' limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    const raw = p.rows?.[0]?.value; const price = raw == null ? NaN : Number(typeof raw === 'string' ? raw.replace(/"/g, '') : raw);
    const t: any = await sql`select display_name from tenants where id = ${ctx.tenantId}`.execute(this.db).catch(() => ({ rows: [] }));
    return { optedOutSms: Number(o.rows?.[0]?.n ?? 0), segmentPriceCents: Number.isFinite(price) && price >= 0 ? Math.round(price) : null, salonName: t.rows?.[0]?.display_name ? String(t.rows[0].display_name) : null };
  }

  async limitFacts(ctx: CampaignsContext, timeZone: string): Promise<{ campaignsStartedToday: number; sendsStartedToday: number; lastStartedAt: Date | null }> {
    const r: any = await sql`
      select count(*) filter (where started_at >= date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone})::int as started,
             coalesce(sum(audience_size) filter (where started_at >= date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone}), 0)::int as sends,
             max(started_at) as last_started
        from campaigns where tenant_id = ${ctx.tenantId} and started_at is not null`.execute(this.db);
    const row = r.rows[0] ?? {};
    return { campaignsStartedToday: Number(row.started ?? 0), sendsStartedToday: Number(row.sends ?? 0),
             lastStartedAt: row.last_started ? new Date(row.last_started) : null };
  }

  // BUILD_PLAN Phase 12 (DoD #21/#22): filters, search and order from CAMPAIGNS_SPEC — columns from the spec, values bound
  private async page(baseWhere: (qb: any) => any, f: CampaignFilters): Promise<CampaignPage> {
    const lq = parseListQuery(f as Record<string, unknown>, CAMPAIGNS_SPEC);
    const page = clampPage(f.page);
    const pageSize = lq.limit;
    const countRow: any = await applyListQuery(baseWhere(this.db.selectFrom('campaigns')), lq, { sort: false, limit: false }).select(sql<number>`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 }));
    const totalItems = Number(countRow?.n || 0);
    const rows = await applyListQuery(baseWhere(this.db.selectFrom('campaigns')), lq, { limit: false }).selectAll().limit(pageSize).offset((page - 1) * pageSize).execute().catch(() => []);
    return { items: (rows as any[]).map(toRow), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
  }

  list(tenantId: string, filters: CampaignFilters): Promise<CampaignPage> {
    return this.page((qb) => qb.where('tenant_id', '=', tenantId), filters);
  }
  listPlatform(filters: CampaignFilters & { tenantId?: string }): Promise<CampaignPage> {
    return this.page((qb) => (filters.tenantId ? qb.where('tenant_id', '=', filters.tenantId) : qb), filters);
  }
}
