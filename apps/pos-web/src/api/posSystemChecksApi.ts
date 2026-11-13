// posSystemChecksApi.ts — the shared read-only Check … System (extras arc, Nov 9 2026): GET pos/system-checks/<page>.
import { api } from './client';
import type { SystemCheckDomain, SystemCheckResult, SystemCheckRows } from '@aipowersalon/api-contracts/tenant';
export type { SystemCheckDomain, SystemCheckResult, SystemCheckRows };

export const posSystemChecksApi = {
  run: (domain: SystemCheckDomain) => api.get<SystemCheckResult>(`/pos/system-checks/${domain}`),
  /** extras Membership Overview 16 · 15: the source rows behind one discrepant check (memberships only today) */
  rows: (domain: 'memberships', key: string) => api.get<SystemCheckRows>(`/pos/system-checks/${domain}/${encodeURIComponent(key)}/rows`),
};
