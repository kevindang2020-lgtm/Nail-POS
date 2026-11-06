// superAdminBackupsApi.ts — G9 Enterprise Backup & Disaster Recovery (Nov 5 2026): the recovery catalog, the Backup
// Center overview, restore plans (dry run), the second-person approval and the restore job. Approve / execute need a
// fresh step-up (the client asks for it and retries).
import { api } from './client';
const enc = encodeURIComponent;
export const superAdminBackupsApi = {
  overview: () => api.get<any>('/super-admin/backups/overview'),
  tenants: (q: string) => api.get<any>('/super-admin/backups/tenants', { q }),
  points: (tenantId?: string, branchId?: string) => api.get<any>('/super-admin/backups/recovery-points', { tenantId, branchId } as Record<string, unknown>),
  point: (id: string) => api.get<any>(`/super-admin/backups/recovery-points/${enc(id)}`),
  plans: (q: { status?: string; tenantId?: string; page?: number } = {}) => api.get<any>('/super-admin/backups/restore-plans', q as Record<string, unknown>),
  plan: (id: string) => api.get<any>(`/super-admin/backups/restore-plans/${enc(id)}`),
  createPlan: (b: { mode: string; tenantId?: string | null; branchId?: string | null; recoveryPointId: string; targetTimestamp?: string | null; reason: string; idempotencyKey: string }) =>
    api.post<any>('/super-admin/backups/restore-plans', b),
  approve: (id: string, planSha256: string, financeAcknowledged: boolean) => api.post<any>(`/super-admin/backups/restore-plans/${enc(id)}/approve`, { planSha256, financeAcknowledged }),
  execute: (id: string, planSha256: string) => api.post<any>(`/super-admin/backups/restore-plans/${enc(id)}/execute`, { planSha256 }),
  cancel: (id: string, reason: string) => api.post<any>(`/super-admin/backups/restore-plans/${enc(id)}/cancel`, { reason }),
};
