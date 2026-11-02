// campaigns.repository.ts — port + in-memory adapter. The in-memory store starts EMPTY (no production mock data): real
// campaigns appear only once created through the API, so a fresh tenant correctly shows an empty Campaign Center.
import { randomUUID } from 'crypto';
import type { CampaignRow, CampaignFilters, CreateCampaignRequest, UpdateCampaignRequest, CampaignStatus } from './campaigns.dto';
import { normalizeChannel, applyCampaignFilters } from './campaigns.dto';
import { clampPage } from '@aipowersalon/api-contracts';

export interface CampaignsContext { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export interface CampaignPage { items: CampaignRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }

export interface CampaignsRepositoryPort {
  /** The salon's IANA timezone — quiet hours and "today" are judged on it. */
  salonTimezone(ctx: CampaignsContext, branchId: string | null): Promise<string>;
  /** Counts for the platform campaign limits, from the start of the salon-local day. */
  limitFacts(ctx: CampaignsContext, timeZone: string): Promise<{ campaignsStartedToday: number; sendsStartedToday: number; lastStartedAt: Date | null }>;
  create(ctx: CampaignsContext, req: CreateCampaignRequest): Promise<CampaignRow>;
  get(ctx: CampaignsContext, id: string): Promise<CampaignRow | null>;
  update(ctx: CampaignsContext, id: string, patch: UpdateCampaignRequest): Promise<CampaignRow | null>;
  setStatus(ctx: CampaignsContext, id: string, status: CampaignStatus): Promise<CampaignRow | null>;
  list(tenantId: string, filters: CampaignFilters): Promise<CampaignPage>;
  listPlatform(filters: CampaignFilters & { tenantId?: string }): Promise<CampaignPage>;
  /** wave 3 PAYI §81: facts for the cost preview — how many of this salon's numbers have opted out of texts, and the
   *  platform's marketing price per segment (null = not priced; the preview says so instead of inventing a cost). */
  costFacts?(ctx: CampaignsContext): Promise<{ optedOutSms: number; segmentPriceCents: number | null; salonName: string | null }>;
  /** Campaign Center guide (739): may this campaign move toward sending (approved, unchanged since approval, a real audience
   *  snapshot with ≥ 1 eligible customer)? The Postgres adapter answers from the database; schedule / activate refuse otherwise. */
  sendReadiness?(ctx: CampaignsContext, id: string): Promise<{ ok: true; eligible: number } | { ok: false; code: string; message: string }>;
}

function paginate(rows: CampaignRow[], f: CampaignFilters): CampaignPage {
  const sorted = rows.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const page = clampPage(f.page);
  const pageSize = Math.min(200, Math.max(1, Number(f.pageSize) || 50));
  const totalItems = sorted.length;
  return { items: sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
}

export class InMemoryCampaignsRepository implements CampaignsRepositoryPort {
  /** tests: the opted-out count + the platform segment price the preview reads */
  costFactsValue: { optedOutSms: number; segmentPriceCents: number | null; salonName: string | null } = { optedOutSms: 0, segmentPriceCents: null, salonName: null };
  async costFacts(): Promise<{ optedOutSms: number; segmentPriceCents: number | null; salonName: string | null }> { return { ...this.costFactsValue }; }
  async salonTimezone(): Promise<string> { return 'America/New_York'; }
  async limitFacts(): Promise<{ campaignsStartedToday: number; sendsStartedToday: number; lastStartedAt: Date | null }> {
    return { campaignsStartedToday: 0, sendsStartedToday: 0, lastStartedAt: null };
  }
  private rows: CampaignRow[] = [];

  async create(ctx: CampaignsContext, req: CreateCampaignRequest): Promise<CampaignRow> {
    const now = new Date().toISOString();
    const row: CampaignRow = {
      id: randomUUID(), tenantId: ctx.tenantId, branchId: ctx.branchId ?? null,
      name: req.name, offer: req.offer ?? null, channel: normalizeChannel(req.channel),
      audienceLabel: req.audienceLabel ?? null, audienceSize: Math.max(0, Math.trunc(req.audienceSize ?? 0)),
      status: 'draft', scheduledAt: req.scheduledAt ?? null,
      sentCount: 0, openCount: 0, clickCount: 0, replyCount: 0, bookingCount: 0,
      revenueCents: 0, costCents: Math.max(0, Math.trunc(req.costCents ?? 0)),
      createdAt: now, updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async get(ctx: CampaignsContext, id: string): Promise<CampaignRow | null> {
    return this.rows.find((r) => r.id === id && r.tenantId === ctx.tenantId) ?? null;
  }

  async update(ctx: CampaignsContext, id: string, patch: UpdateCampaignRequest): Promise<CampaignRow | null> {
    const row = await this.get(ctx, id);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.offer !== undefined) row.offer = patch.offer ?? null;
    if (patch.channel !== undefined) row.channel = normalizeChannel(patch.channel);
    if (patch.audienceLabel !== undefined) row.audienceLabel = patch.audienceLabel ?? null;
    if (patch.audienceSize !== undefined) row.audienceSize = Math.max(0, Math.trunc(patch.audienceSize));
    if (patch.scheduledAt !== undefined) row.scheduledAt = patch.scheduledAt ?? null;
    if (patch.costCents !== undefined) row.costCents = Math.max(0, Math.trunc(patch.costCents));
    row.updatedAt = new Date().toISOString();
    return row;
  }

  async setStatus(ctx: CampaignsContext, id: string, status: CampaignStatus): Promise<CampaignRow | null> {
    const row = await this.get(ctx, id);
    if (!row) return null;
    row.status = status;
    row.updatedAt = new Date().toISOString();
    return row;
  }

  async list(tenantId: string, filters: CampaignFilters): Promise<CampaignPage> {
    return paginate(applyCampaignFilters(this.rows.filter((r) => r.tenantId === tenantId), filters), filters);
  }

  async listPlatform(filters: CampaignFilters & { tenantId?: string }): Promise<CampaignPage> {
    const all = filters.tenantId ? this.rows.filter((r) => r.tenantId === filters.tenantId) : this.rows;
    return paginate(applyCampaignFilters(all, filters), filters);
  }
}
