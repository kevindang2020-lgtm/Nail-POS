// superAdminReportBuilderApi.ts — typed client for the Super Admin report builder
// (catalog + ad-hoc run + saved-definition CRUD).

import type { DimensionKey, MeasureKey, RunResult, VisualizationKey } from '@aipowersalon/api-contracts/platform';
export type { DimensionKey, MeasureKey, RunResult, VisualizationKey };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { useCallback, useEffect, useState } from 'react';
import { api } from './client';

export type ReportRange = '7d' | '30d' | '90d' | '6m' | '12m';

export type Catalog = {
  dimensions: { key: DimensionKey; label: string }[];
  measures: { key: MeasureKey; label: string; format: 'money' | 'count' }[];
  visualizations: { key: VisualizationKey; label: string }[];
  supported: Record<DimensionKey, { measures: MeasureKey[]; source: string }>;
};

export type RunSpec = { dimension: DimensionKey; measure: MeasureKey; visualization: VisualizationKey; range: ReportRange; tenantId?: string | null; limit?: number };

export type ReportDefinition = {
  id: string; name: string; dimension: DimensionKey; measure: MeasureKey; visualization: VisualizationKey;
  rangeKey: ReportRange; scopeTenantId: string | null; filters: Record<string, unknown>; rowLimit: number;
  createdByUserId: string | null; createdAt: string; updatedAt: string;
};

export const reportBuilderApi = {
  catalog: () => api.get<Catalog>('/super-admin/report-builder/catalog'),
  run: (spec: RunSpec) => api.post<RunResult>('/super-admin/report-builder/run', spec),
  list: () => api.get<ReportDefinition[]>('/super-admin/report-builder/definitions'),
  create: (body: RunSpec & { name: string }) => api.post<ReportDefinition>('/super-admin/report-builder/definitions', body),
  update: (id: string, body: Partial<RunSpec & { name: string }>) => api.patch<ReportDefinition>(`/super-admin/report-builder/definitions/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.del<{ ok: true }>(`/super-admin/report-builder/definitions/${encodeURIComponent(id)}`),
};

export function useReportCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDefinitions = useCallback(async () => { try { setDefinitions(await reportBuilderApi.list()); } catch { /* leave prior list */ } }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const c = await reportBuilderApi.catalog(); if (alive) setCatalog(c); await loadDefinitions(); }
      catch (e: any) { if (alive) setError(e?.message || 'Failed to load the report catalog.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [loadDefinitions]);

  return { catalog, definitions, loading, error, reloadDefinitions: loadDefinitions };
}
