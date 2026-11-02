// posPlatformAnnouncementsApi.ts — Platform Announcements on the POS top bar (Oct 22 2026). The server decides what this
// employee sees (salon + branch from the session); the POS only reads the snapshot and records dismiss / acknowledge /
// first delivery for the signed-in employee.
import type { PosPlatformAnnouncementSnapshot, PosPlatformAnnouncementReceiptResult } from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

export const platformAnnouncementsApi = {
  active: () => api.get<PosPlatformAnnouncementSnapshot>('/pos/platform-announcements/active'),
  dismiss: (id: string, contentVersion: number) => api.post<PosPlatformAnnouncementReceiptResult>(`/pos/platform-announcements/${encodeURIComponent(id)}/dismiss`, { contentVersion }),
  acknowledge: (id: string, contentVersion: number) => api.post<PosPlatformAnnouncementReceiptResult>(`/pos/platform-announcements/${encodeURIComponent(id)}/acknowledge`, { contentVersion }),
  delivered: (id: string, contentVersion: number) => api.post<PosPlatformAnnouncementReceiptResult>(`/pos/platform-announcements/${encodeURIComponent(id)}/delivered`, { contentVersion }),
};
