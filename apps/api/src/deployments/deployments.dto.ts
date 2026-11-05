// deployments.dto.ts — context + deployment view/state and request contracts.

// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { DeploymentView } from '@aipowersalon/api-contracts/tenant';

// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { DeploymentsState } from '@aipowersalon/api-contracts/tenant';


export interface DeploymentsContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }


export interface CreateDeploymentRequest { component?: string; componentKind?: string; installedVersion?: string | null; latestVersion?: string | null; targetCount?: number; status?: string }
export interface AdvanceRequest { action?: string; idempotencyKey?: string }
