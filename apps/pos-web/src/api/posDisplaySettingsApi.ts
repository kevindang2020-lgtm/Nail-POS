// posDisplaySettingsApi.ts — Dual-Screen mandate §118: the salon owner's customer-display options that live with the
// salon's check-in settings (GET / PATCH /pos/settings/go-check-in): appointment and walk-in check-in, new guests,
// services and technician choice, the estimated wait, and the display's languages. Reading needs settings.view, saving
// settings.edit — enforced server-side. The master on/off switch is the platform's (Super Admin), shown read-only.
import type { GoCheckInSettings, WalkInBranchPatch, WalkInBranchSettingsList } from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

export type { GoCheckInSettings, WalkInBranchPatch, WalkInBranchSettingsList };
export type DisplaySettingsPatch = Partial<Omit<GoCheckInSettings, 'enabled'>>;

export const posDisplaySettingsApi = {
  get: () => api.get<GoCheckInSettings>('/pos/settings/go-check-in'),
  save: (patch: DisplaySettingsPatch) => api.patch<GoCheckInSettings>('/pos/settings/go-check-in', patch as unknown as Record<string, unknown>),
  /** migration 993: every location's walk-in switches (null = same as the salon) */
  branches: () => api.get<WalkInBranchSettingsList>('/pos/settings/go-check-in/branches'),
  saveBranch: (branchId: string, patch: WalkInBranchPatch) => api.put<WalkInBranchSettingsList>(`/pos/settings/go-check-in/branches/${encodeURIComponent(branchId)}`, patch as unknown as Record<string, unknown>),
};
