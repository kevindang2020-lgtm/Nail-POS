// superAdminAnalyticsApi.ts — typed client for the consolidated platform Analytics endpoint
// (GET /super-admin/analytics) + audited export (GET /super-admin/analytics/export). Mirrors the
// useOverviewAggregate pattern: one request, scope/compare-aware, re-fetches on change.

import type { AnalyticsRange, CategoryRevenue, CompareMode, DemandCell, ExportFormat, Gap, StateRevenue } from '@aipowersalon/api-contracts/platform';
export type { AnalyticsRange, CategoryRevenue, CompareMode, DemandCell, ExportFormat, Gap, StateRevenue };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { useCallback, useEffect, useState } from 'react';
import { api } from './client';
import type { AnalyticsKpi as Kpi, AnalyticsTrendPoint as TrendPoint, MethodSlice, BranchRow, HourBucket, AnalyticsTopTenant as TopTenant, AnalyticsStateRow as StateRow, AnalyticsRecommendation as Recommendation, AnalyticsModules, AnalyticsPayload, AnalyticsExportResult as ExportResult } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export const isGap = (x: unknown): x is Gap => !!x && typeof x === 'object' && (x as any).available === false;






export const analyticsApi = {
  get: (range: AnalyticsRange = '30d', tenantId?: string | null, compareTo: CompareMode = 'previous_period') =>
    api.get<AnalyticsPayload>('/super-admin/analytics', { range, compareTo, ...(tenantId ? { tenantId } : {}) }),
  export: (format: ExportFormat, range: AnalyticsRange, tenantId?: string | null, compareTo: CompareMode = 'previous_period') =>
    api.exportAsync<ExportResult>('/super-admin/analytics/export', { format, range, compareTo, ...(tenantId ? { tenantId } : {}) }),
};

// Decode a base64 export payload to a Blob and trigger a browser download.
export function downloadExport(res: ExportResult) {
  const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }));
  const a = document.createElement('a');
  a.href = url; a.download = res.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useAnalytics(initialRange: AnalyticsRange = '30d', tenantId?: string | null, initialCompare: CompareMode = 'previous_period') {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [range, setRange] = useState<AnalyticsRange>(initialRange);
  const [compareTo, setCompareTo] = useState<CompareMode>(initialCompare);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: AnalyticsRange, tid: string | null | undefined, cmp: CompareMode) => {
    setLoading(true); setError(null);
    try { setData(await analyticsApi.get(r, tid, cmp)); }
    catch (e: any) { setError(e?.message || 'Failed to load analytics.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(range, tenantId, compareTo); }, [range, tenantId, compareTo, load]);

  return { data, loading, error, range, setRange, compareTo, setCompareTo, reload: () => load(range, tenantId, compareTo) };
}
export type { Kpi, TrendPoint, MethodSlice, BranchRow, HourBucket, TopTenant, StateRow, Recommendation, AnalyticsModules, AnalyticsPayload, ExportResult };
