// devices.dto.ts — request context + the Devices & Integrations overview response contract.
// The overview body is the pure-core output plus a dataQuality block that names exactly which metrics have no
// canonical backend source yet, so the UI can render honest "—"/empty instead of inventing values.
import type { DevicesOverview, DevicesDataQuality } from '@aipowersalon/api-contracts/tenant';
export type { DevicesOverview, DevicesDataQuality };   // owned by packages/api-contracts (Constitution 13 §13)
import type { DevicesOverviewCore } from './devices-overview-core';

export interface DevicesContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
}


