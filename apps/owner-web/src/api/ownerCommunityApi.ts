// ownerCommunityApi.ts — BUILD_PLAN Phase 8 (tenant_safety_community): the Owner App's slice of the Safety Community
// (contract scratchpad/p8/CONTRACT.md §2 + §4 — the same tenant /community routes the POS calls, with the owner's session):
// the active high / critical alerts, the advisories waiting for approval (approve / return with a note), and the salon's
// community settings. Shapes are the API's own (`Community*` in @aipowersalon/api-contracts/tenant) — never re-declared.
import { api } from './client';
import type {
  CommunityActiveAlert, CommunityMyPostView, CommunityPage, CommunitySettingsUpdate, CommunitySettingsView,
} from '@aipowersalon/api-contracts/tenant';

export type { CommunityActiveAlert, CommunityMyPostView, CommunitySettingsView, CommunitySettingsUpdate };
const enc = encodeURIComponent;
const list = <T>(r: T[] | { items?: T[] } | null | undefined): T[] => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r!.items! : []);

export const ownerCommunityApi = {
  activeAlerts: () => api.get<CommunityActiveAlert[] | { items: CommunityActiveAlert[] }>('/community/alerts/active').then((r) => list<CommunityActiveAlert>(r)),
  awaitingApproval: () => api.get<CommunityPage<CommunityMyPostView>>('/community/mine', { kind: 'awaiting_approval', page: 1, pageSize: 50 }).then((r) => list<CommunityMyPostView>(r)),
  approve: (id: string, expectedVersion: number) => api.post<CommunityMyPostView>(`/community/advisories/${enc(id)}/approve`, { expectedVersion }),
  returnAdvisory: (id: string, expectedVersion: number, note: string) => api.post<CommunityMyPostView>(`/community/advisories/${enc(id)}/return`, { expectedVersion, note }),
  settings: () => api.get<CommunitySettingsView>('/community/settings'),
  saveSettings: (u: CommunitySettingsUpdate) => api.put<CommunitySettingsView>('/community/settings', u as unknown as Record<string, unknown>),
};
