// superAdminDashboardApi.ts — typed clients for the Super-Admin Platform Dashboard (S02). Pulls the subscription
// economics (GET /super-admin/dashboard → MRR, plan distribution, usage) and real system health (GET
// /super-admin/system-health → DB probe + process metrics). Tenant-wide; SUPER_ADMIN only. No fabricated data:
// plan prices are a server-side business setting and unconfigured services surface as honest gaps in the screen.
import { useCallback, useEffect, useState } from 'react';
import { api } from './client';
import type { PlanDistributionItem } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { SystemHealth } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import { useCan } from '../auth/useCan';

export interface DashboardOverview {
  estimatedMrrCents: number;
  averageUsagePercent: number;
  tenantsOverUsage: number;
  planDistribution: PlanDistributionItem[];
}

export function useSuperAdminDashboard() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // SCAN (Oct 12 2026): the health probe is a System Operations read — a finance / AI role on this analytics page was refused it on every load
  const mayHealth = useCan()('super_admin.system_operations.view');
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      (api.get('/super-admin/dashboard') as Promise<DashboardOverview>).then(setData).catch(() => setData(null)),
      mayHealth ? (api.get('/super-admin/system-health') as Promise<SystemHealth>).then(setHealth).catch(() => setHealth(null)) : Promise.resolve(setHealth(null)),
    ]).catch((e: any) => setError(e?.message || 'Failed to load dashboard.')).finally(() => setLoading(false));
  }, [mayHealth]);
  useEffect(() => { load(); }, [load]);
  return { data, health, loading, error, reload: load };
}
export type { PlanDistributionItem };
export type { SystemHealth };
