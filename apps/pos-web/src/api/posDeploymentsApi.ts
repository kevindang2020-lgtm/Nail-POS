// posDeploymentsApi.ts — client for the tenant Deployment & Update Control surface (/pos/deployments).
import { api } from './client';
import type { DeploymentView, DeployStatus } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)


export const posDeploymentsApi = {
  state: () => api.get<DeploymentsState>('/pos/deployments'),
  advance: (id: string, action: string) => api.post<DeploymentView>(`/pos/deployments/${id}/advance`, { action }),
};
import type { DeploymentsState } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export type { DeploymentView, DeployStatus };
export type { DeploymentsState };
