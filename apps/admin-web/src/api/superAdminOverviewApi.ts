// superAdminOverviewApi.ts — typed client + hook for the Super-Admin Overview (GET /super-admin/overview/state).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import type { SAStaffOverview } from './superAdminStaffApi';
import type { SAQueueOverview } from './superAdminQueueApi';
import type { SACheckinOverview } from './superAdminCheckinApi';
import type { SAMembershipOverview } from './superAdminMembershipsApi';
import type { SALoyaltyOverview } from './superAdminLoyaltyApi';
import type { Range, Severity } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { OverviewState } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)



export const superAdminOverviewApi = {
  state: (range: Range = 'month') => api.get<OverviewState>('/super-admin/overview/state', { range }),
  monthlySalesVolume: (range: Range = 'month') => api.get<{ range: Range; series: { label: string; valueCents: number }[] }>('/super-admin/overview/monthly-sales-volume', { range }),
  aggregate: (range: Range = 'month', tenantId?: string | null) =>
    api.get<OverviewAggregate>('/super-admin/overview/aggregate', { range, ...(tenantId ? { tenantId } : {}) }),
};

// One-shot Overview payload: the overview state composed with the platform device/payment/branch/service/appointment
// summaries and the staff/queue/check-in/membership/loyalty module overviews. Each section is independently nullable
// (the server is fail-soft). Replaces eleven client requests with one.
export interface OverviewAggregate {
  ok: boolean; range: Range; generatedAt: string;
  state: OverviewState | null;
  devices: { kpis: { totalDevices: number; online: number; offline: number; paymentTerminals: number } } | null;
  payments: { kpis: { todayVolumeCents: number; todayCount: number; failedCount: number; refundCentsMonth: number; tipsCents: number } } | null;
  branches: { directory: { id: string; name: string; tenantName: string | null; status: string; staff: number; todaysAppts: number; revenueMtdCents: number }[] } | null;
  services: { topServices: { name: string; bookings: number; revenueCents: number }[]; kpis: { avgRating: number; reviewCount: number } } | null;
  appts: { rows: { id: string; startTime: string; customerName: string; services: (string | { serviceId?: string; serviceName?: string; name?: string; priceCents?: number; durationMinutes?: number })[]; technicianName: string | null; status: string; tenantName: string | null }[]; byStatus: { status: string; count: number }[] } | null;
  staff: SAStaffOverview | null;
  queue: SAQueueOverview | null;
  checkin: SACheckinOverview | null;
  memberships: SAMembershipOverview | null;
  loyalty: SALoyaltyOverview | null;
  tenantsLive?: { tenantId: string; ownerName: string | null; plan: string | null; branchCount: number; serviceDone: number; checkout: number; revenueTodayCents: number; deviceOnline: number; deviceTotal: number }[] | null;
  revenueHourly?: { today: number[]; yesterday: number[] } | null;
}

export function formatServiceName(service: any): string {
  if (!service) return '—';
  if (typeof service === 'string') return service || '—';
  if (typeof service === 'object' && service !== null) {
    return service.serviceName || service.name || service.title || service.label || '—';
  }
  return String(service);
}

export function formatServicesList(services: any): string {
  if (!services) return '—';
  if (Array.isArray(services)) {
    if (services.length === 0) return '—';
    const names = services.map(formatServiceName).filter((n) => n && n !== '—');
    return names.length > 0 ? names.join(', ') : '—';
  }
  return formatServiceName(services);
}

export interface OverviewMods {
  staff: SAStaffOverview | null; queue: SAQueueOverview | null; checkin: SACheckinOverview | null;
  memberships: SAMembershipOverview | null; loyalty: SALoyaltyOverview | null;
  devices: OverviewAggregate['devices']; payments: OverviewAggregate['payments'];
  branches: OverviewAggregate['branches']; services: OverviewAggregate['services']; appts: OverviewAggregate['appts'];
  tenantsLive: OverviewAggregate['tenantsLive'];
  revenueHourly: OverviewAggregate['revenueHourly'];
}

export function useSuperAdminOverviewState(initialRange: Range = 'month') {
  const [data, setData] = useState<OverviewState | null>(null);
  const [range, setRange] = useState<Range>(initialRange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((r: Range) => {
    setLoading(true); setError(null);
    superAdminOverviewApi.state(r)
      .then((s) => setData(s))
      .catch((e: any) => setError(e?.message || 'Failed to load the Overview.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(range); }, [range, load]);

  return { data, loading, error, range, setRange, reload: () => load(range) };
}

// Single-request Overview hook: fetches the aggregate and exposes the overview state plus the composed module sections
// in the same `{ data, mods }` shape the screen consumes.
export function useOverviewAggregate(initialRange: Range = 'month', tenantId?: string | null) {
  const [agg, setAgg] = useState<OverviewAggregate | null>(null);
  const [range, setRange] = useState<Range>(initialRange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((r: Range, t?: string | null) => {
    setLoading(true); setError(null);
    superAdminOverviewApi.aggregate(r, t)
      .then((a) => setAgg(a))
      .catch((e: any) => setError(e?.message || 'Failed to load the Overview.'))
      .finally(() => setLoading(false));
  }, []);

  // Refetch when the range OR the tenant scope changes (selecting a salon re-scopes the whole Overview).
  useEffect(() => { load(range, tenantId); }, [range, tenantId, load]);

  const data = agg?.state ?? null;
  const mods: OverviewMods = useMemo(() => ({
    staff: agg?.staff ?? null, queue: agg?.queue ?? null, checkin: agg?.checkin ?? null,
    memberships: agg?.memberships ?? null, loyalty: agg?.loyalty ?? null,
    devices: agg?.devices ?? null, payments: agg?.payments ?? null,
    branches: agg?.branches ?? null, services: agg?.services ?? null, appts: agg?.appts ?? null,
    tenantsLive: agg?.tenantsLive ?? null,
    revenueHourly: agg?.revenueHourly ?? null,
  }), [agg]);
  return { data, mods, loading, error, range, setRange, reload: () => load(range, tenantId) };
}
export type { Range, Severity };
export type { OverviewState };
