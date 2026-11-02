// superAdminGiftCardProgramsApi.ts — typed client for Super-Admin gift-card program + membership management (§15).
// Defines which tenants participate in which cross-tenant program (tenant-only / owner-portfolio / network). No money
// moves through this surface — clearing/settlement are separate.
import { api } from './client';

export interface GiftCardProgramMember { programId: string; tenantId: string; status: string; joinedAt: string }
export interface GiftCardProgram {
  id: string; name: string; ownerTenantId: string; scope: string; status: string; sharedLiability: boolean;
  createdAt: string; members: GiftCardProgramMember[]; memberCount: number;
}
export interface GiftCardProgramsState { programs: GiftCardProgram[] }

export const giftCardProgramsApi = {
  state: () => api.get<GiftCardProgramsState>('/super-admin/gift-cards/programs'),
  create: (body: { name: string; ownerTenantId: string; scope: string; sharedLiability?: boolean }) => api.post('/super-admin/gift-cards/programs', body),
  update: (id: string, body: { name?: string; scope?: string; status?: string; sharedLiability?: boolean }) => api.patch(`/super-admin/gift-cards/programs/${encodeURIComponent(id)}`, body),
  addMember: (id: string, tenantId: string) => api.post(`/super-admin/gift-cards/programs/${encodeURIComponent(id)}/members`, { tenantId }),
  setMemberStatus: (id: string, tenantId: string, status: string) => api.patch(`/super-admin/gift-cards/programs/${encodeURIComponent(id)}/members/${encodeURIComponent(tenantId)}`, { status }),
};
