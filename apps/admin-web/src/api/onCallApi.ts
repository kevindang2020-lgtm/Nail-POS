// onCallApi.ts — BUILD_PLAN Phase 14 C (Constitution 11 §262–265, §80, §92–95, §114–117): Super Admin → On-call & monitoring.
// Reads need super_admin.system_operations.view. Editing the chain and designating the synthetic test salon need
// super_admin.system.manage + step-up (the client re-prompts on 403 STEP_UP_REQUIRED and retries once) + a reason (audited).
// Acknowledging an alert needs super_admin.system.manage, no step-up (incident friction).
import type {
  BackupMonitoring, OnCallBoard, OnCallContactInput, OnCallContacts, SloValidation, SyntheticMonitoring,
} from '@aipowersalon/api-contracts/platform';
import { api } from './client';

const P = '/super-admin/oncall';
export const onCallApi = {
  contacts: () => api.get<OnCallContacts>(`${P}/contacts`),
  addContact: (b: OnCallContactInput) => api.post<OnCallContacts>(`${P}/contacts`, b as unknown as Record<string, unknown>),
  updateContact: (id: string, b: OnCallContactInput) => api.put<OnCallContacts>(`${P}/contacts/${encodeURIComponent(id)}`, b as unknown as Record<string, unknown>),
  removeContact: (id: string, reason: string) => api.post<OnCallContacts>(`${P}/contacts/${encodeURIComponent(id)}/remove`, { reason }),
  alerts: () => api.get<OnCallBoard>(`${P}/alerts`),
  acknowledge: (id: string) => api.post<{ acknowledged: boolean }>(`${P}/alerts/${encodeURIComponent(id)}/acknowledge`, {}),
  synthetic: () => api.get<SyntheticMonitoring>(`${P}/synthetic`),
  setSynthetic: (testTenantId: string | null, reason: string) => api.put<SyntheticMonitoring>(`${P}/synthetic`, { testTenantId, reason }),
  backups: () => api.get<BackupMonitoring>(`${P}/backups`),
  slos: () => api.get<SloValidation[]>(`${P}/slos`),
};
