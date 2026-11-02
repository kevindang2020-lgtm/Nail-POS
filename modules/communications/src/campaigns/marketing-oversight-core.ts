// Marketing & Campaigns oversight — pure, DB-free engine. Computes the reference's 13 KPIs, the platform-vs-tenant
// campaign directory split, channel mix, revenue-by-campaign, and top campaigns from the existing campaigns table
// shape. BOUNDARY: platform announcements and tenant customer campaigns are kept distinct (ownerType). HONEST
// RENDERING: metrics with no backing column (delivery rate, opt-out rate, compliance status, delivery failures,
// compliance alerts) are surfaced as available:false, never fabricated.

export type Channel = 'sms' | 'email' | 'push' | 'in_app' | 'multi' | 'other';
export type OwnerType = 'platform' | 'tenant';

export interface CampaignLike {
  id: string;
  ownerType?: OwnerType;              // defaults to 'tenant' (existing campaigns are tenant-owned)
  tenantId: string | null;
  tenantName?: string | null;
  branchId: string | null;
  branchName?: string | null;
  name: string;
  channel: string;
  audienceSize: number;
  status: string;                     // draft | scheduled | in_progress | completed | cancelled
  scheduledAt: string | null;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bookingCount: number;
  revenueCents: number;
}

const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
const ownerOf = (c: CampaignLike): OwnerType => c.ownerType ?? 'tenant';
export const isActive = (c: CampaignLike): boolean => c.status === 'in_progress' || c.status === 'active' || c.status === 'sending';
export const isScheduled = (c: CampaignLike): boolean => c.status === 'scheduled';
export const isCompleted = (c: CampaignLike): boolean => c.status === 'completed';

/** Display reference like CAMP-PLT-0001 / CAMP-TNT-10231 derived from owner type + a stable short id. */
export function campaignReference(c: CampaignLike): string {
  const short = String(c.id).replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase().padStart(4, '0');
  return `CAMP-${ownerOf(c) === 'platform' ? 'PLT' : 'TNT'}-${short}`;
}

export interface MarketingKpi { key: string; label: string; value: string | null; supporting?: string; available: boolean; unfavorableIfUp?: boolean }

export function buildMarketingOverview(campaigns: CampaignLike[], deliveryMetrics?: { deliveryRate: number | null; optOutRate: number | null }) {
  const all = campaigns;
  const sum = (f: (c: CampaignLike) => number) => all.reduce((a, c) => a + (Number(f(c)) || 0), 0);
  const count = (f: (c: CampaignLike) => boolean) => all.filter(f).length;

  const sent = sum((c) => c.sentCount);
  const opens = sum((c) => c.openCount);
  const clicks = sum((c) => c.clickCount);
  const bookings = sum((c) => c.bookingCount);
  const revenue = sum((c) => c.revenueCents);
  const audience = sum((c) => c.audienceSize);

  const kpi = (key: string, label: string, value: string | null, extra: Partial<MarketingKpi> = {}): MarketingKpi =>
    ({ key, label, value, available: value !== null, ...extra });

  const kpis: MarketingKpi[] = [
    kpi('active', 'Active Campaigns', count(isActive).toLocaleString()),
    kpi('scheduled', 'Scheduled Campaigns', count(isScheduled).toLocaleString()),
    kpi('completed', 'Completed Campaigns', count(isCompleted).toLocaleString()),
    kpi('sms', 'SMS Campaigns', count((c) => c.channel === 'sms').toLocaleString()),
    kpi('email', 'Email Campaigns', count((c) => c.channel === 'email').toLocaleString()),
    kpi('push', 'Push Campaigns', count((c) => c.channel === 'push').toLocaleString()),
    kpi('audience', 'Audience Size', audience.toLocaleString()),
    kpi('delivery_rate', 'Delivery Rate', deliveryMetrics && deliveryMetrics.deliveryRate !== null ? `${deliveryMetrics.deliveryRate}%` : null),
    kpi('open_rate', 'Open Rate', `${pct(opens, sent)}%`, { supporting: 'opens ÷ sent' }),
    kpi('click_rate', 'Click Rate', `${pct(clicks, sent)}%`, { supporting: 'clicks ÷ sent' }),
    kpi('bookings', 'Booking Conversions', bookings.toLocaleString()),
    kpi('revenue', 'Revenue Attributed', `$${(revenue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`),
    kpi('opt_out_rate', 'Opt-out Rate', deliveryMetrics && deliveryMetrics.optOutRate !== null ? `${deliveryMetrics.optOutRate}%` : null, { unfavorableIfUp: true }),
  ];

  // Channel mix (donut) — counts + percentages that reconcile to the total.
  const chMap = new Map<string, number>();
  for (const c of all) chMap.set(c.channel || 'other', (chMap.get(c.channel || 'other') || 0) + 1);
  const channelMix = [...chMap.entries()].map(([channel, n]) => ({ channel, count: n, pct: pct(n, all.length) })).sort((a, b) => b.count - a.count);

  // Revenue by campaign + top campaigns (ranking metric = attributed revenue, stated explicitly).
  const ranked = [...all].sort((a, b) => b.revenueCents - a.revenueCents);
  const revenueByCampaign = ranked.slice(0, 5).map((c) => ({ id: c.id, name: c.name, revenueCents: c.revenueCents }));
  const topCampaigns = ranked.slice(0, 5).map((c) => ({
    id: c.id, name: c.name, deliveryRate: null as number | null, openRate: pct(c.openCount, c.sentCount),
    clickRate: pct(c.clickCount, c.sentCount), bookings: c.bookingCount, revenueCents: c.revenueCents,
  }));

  return {
    kpis,
    channelMix,
    revenueByCampaign,
    topCampaigns,
    rankingMetric: 'attributed_revenue',
    counts: {
      total: all.length,
      platform: all.filter((c) => ownerOf(c) === 'platform').length,
      tenant: all.filter((c) => ownerOf(c) === 'tenant').length,
      active: count(isActive), scheduled: count(isScheduled), completed: count(isCompleted),
    },
  };
}

export interface DirectoryRow {
  id: string; reference: string; name: string; ownerType: OwnerType; tenantId: string | null; tenant: string; branch: string; channel: string;
  audienceSize: number; deliveryRate: number | null; deliveryRateAvailable: boolean; openRate: number; clickRate: number;
  bookingConversions: number; revenueCents: number; scheduledAt: string | null; status: string;
  complianceStatus: string | null; complianceAvailable: boolean;
}

export function toDirectoryRow(c: CampaignLike): DirectoryRow {
  const owner = ownerOf(c);
  return {
    id: c.id, reference: campaignReference(c), name: c.name, ownerType: owner, tenantId: c.tenantId,
    tenant: owner === 'platform' ? 'All Tenants' : (c.tenantName || c.tenantId || '—'),
    branch: owner === 'platform' ? 'All Branches' : (c.branchName || c.branchId || '—'),
    channel: c.channel, audienceSize: c.audienceSize,
    deliveryRate: null, deliveryRateAvailable: false,   // no delivered column
    openRate: pct(c.openCount, c.sentCount), clickRate: pct(c.clickCount, c.sentCount),
    bookingConversions: c.bookingCount, revenueCents: c.revenueCents, scheduledAt: c.scheduledAt, status: c.status,
    complianceStatus: null, complianceAvailable: false, // no compliance column
  };
}

/** Split the directory into the platform group then the tenant group (reference ordering). */
export function splitByOwner(campaigns: CampaignLike[]): { platform: DirectoryRow[]; tenant: DirectoryRow[] } {
  const rows = campaigns.map(toDirectoryRow);
  return { platform: rows.filter((r) => r.ownerType === 'platform'), tenant: rows.filter((r) => r.ownerType === 'tenant') };
}
