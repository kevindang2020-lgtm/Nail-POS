// ownerBranchHealthApi.ts — BUILD_PLAN Phase 14 B (Constitution 11 §345): the Owner App branch-health card. The salon is
// the session's (GET /owner/branch-health never takes a tenant) — an owner only ever sees their own branches.
import type { OwnerBranchHealth } from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

export const ownerBranchHealthApi = {
  get: () => api.get<OwnerBranchHealth>('/owner/branch-health'),
};
