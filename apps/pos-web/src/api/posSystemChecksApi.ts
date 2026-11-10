// posSystemChecksApi.ts — the shared read-only Check … System (extras arc, Nov 9 2026): GET pos/system-checks/<page>.
import { api } from './client';
import type { SystemCheckDomain, SystemCheckResult } from '@aipowersalon/api-contracts/tenant';
export type { SystemCheckDomain, SystemCheckResult };

export const posSystemChecksApi = {
  run: (domain: SystemCheckDomain) => api.get<SystemCheckResult>(`/pos/system-checks/${domain}`),
};
