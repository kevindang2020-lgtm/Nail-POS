// campaigns.dto.ts — types + pure logic for marketing campaigns. Helpers are side-effect free and unit-tested:
// lifecycle transition rules, engagement-rate + ROI derivation (the T15 table columns), and KPI roll-ups.
import { CAMPAIGN } from '../communications-lifecycles';
import { foldVi } from '@aipowersalon/api-contracts';
export type CampaignChannel = 'sms' | 'email' | 'push';
export type CampaignStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface CampaignRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  name: string;
  offer: string | null;
  channel: CampaignChannel;
  audienceLabel: string | null;
  audienceSize: number;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  bookingCount: number;
  revenueCents: number;
  costCents: number;
  createdAt: string;
  updatedAt: string;
  // derived (filled by deriveMetrics):
  openRate?: number;
  clickRate?: number;
  replyRate?: number;
  bookingRate?: number;
  roi?: number;
}

export interface CreateCampaignRequest {
  name: string;
  offer?: string;
  channel?: CampaignChannel;
  audienceLabel?: string;
  audienceSize?: number;
  scheduledAt?: string;
  costCents?: number;
}
export interface UpdateCampaignRequest {
  name?: string;
  offer?: string;
  channel?: CampaignChannel;
  audienceLabel?: string;
  audienceSize?: number;
  scheduledAt?: string | null;
  costCents?: number;
}

export interface CampaignFilters {
  status?: CampaignStatus;
  channel?: CampaignChannel;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CampaignKpis {
  totalCampaigns: number;
  activeCampaigns: number;
  totalSent: number;
  campaignRevenueCents: number;
  totalCostCents: number;
  avgRoi: number | null; // revenue ÷ cost (ROAS), 1 decimal — null when no cost is recorded (Marketing & Growth §07: unknown is N/A, never 0)
  avgOpenRate: number; // %
}

const CHANNELS: CampaignChannel[] = ['sms', 'email', 'push'];
const STATUSES: CampaignStatus[] = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];

export function normalizeChannel(v: unknown): CampaignChannel {
  return typeof v === 'string' && (CHANNELS as string[]).includes(v) ? (v as CampaignChannel) : 'sms';
}
export function isCampaignStatus(v: unknown): v is CampaignStatus {
  return typeof v === 'string' && (STATUSES as string[]).includes(v);
}

// Lifecycle state machine. A campaign starts in draft; it can be scheduled, then activated (in_progress), then
// completed; it can be cancelled from any non-terminal state. Terminal states (completed/cancelled) allow no exits.
// Phase 12 (#27): the table is the CAMPAIGN machine (communications-lifecycles.ts) — one table, read here and enforced by
// the repository's conditional update.
export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN.can(from, to);
}
export function allowedTransitions(from: CampaignStatus): CampaignStatus[] {
  return [...(CAMPAIGN.transitions[from] ?? [])] as CampaignStatus[];
}

const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

// Engagement rates + ROI for one campaign (guards divide-by-zero). Open/click/reply are relative to sent; ROI is the
// classic (revenue - cost) / cost expressed as a multiple, e.g. 5.1x.
export function deriveMetrics(r: CampaignRow): CampaignRow {
  const openRate = pct(r.openCount, r.sentCount);
  const clickRate = pct(r.clickCount, r.sentCount);
  const replyRate = pct(r.replyCount, r.sentCount);
  const bookingRate = pct(r.bookingCount, r.sentCount);
  const roi = r.costCents > 0 ? Math.round((r.revenueCents / r.costCents) * 10) / 10 : 0;
  return { ...r, openRate, clickRate, replyRate, bookingRate, roi };
}

// KPI strip roll-up across a set of campaigns (T15 header tiles).
export function deriveKpis(rows: CampaignRow[]): CampaignKpis {
  const totalSent = rows.reduce((a, r) => a + r.sentCount, 0);
  const campaignRevenueCents = rows.reduce((a, r) => a + r.revenueCents, 0);
  const totalCostCents = rows.reduce((a, r) => a + r.costCents, 0);
  const openSum = rows.reduce((a, r) => a + r.openCount, 0);
  return {
    totalCampaigns: rows.length,
    activeCampaigns: rows.filter((r) => r.status === 'in_progress' || r.status === 'scheduled').length,
    totalSent,
    campaignRevenueCents,
    totalCostCents,
    avgRoi: totalCostCents > 0 ? Math.round((campaignRevenueCents / totalCostCents) * 10) / 10 : null,
    avgOpenRate: pct(openSum, totalSent),
  };
}

export function applyCampaignFilters(rows: CampaignRow[], f: CampaignFilters): CampaignRow[] {
  let out = rows;
  if (f.status) out = out.filter((r) => r.status === f.status);
  if (f.channel) out = out.filter((r) => r.channel === f.channel);
  if (f.search) { const s = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ out = out.filter((r) =>
    [r.name, r.offer, r.audienceLabel].some((x) => foldVi(x).includes(s))); }
  return out;
}
