// posAuditApi.ts — POS access to the tenant audit feed. Backed by the existing GET /pos/audit/events
// (audit.controller, permission `audit.view`, tenant-scoped). Reused by the Account "Recent Account Activity"
// panel and the Activity Logs screen — no separate audit store.
import { api } from './client';
import type { AuditPage, AuditEventRow } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)



export const posAuditApi = {
  events: (params: { pageSize?: number; page?: number; actorUserId?: string; module?: string; resourceType?: string; severity?: string; status?: string; search?: string; from?: string; to?: string } = {}) =>
    api.get<AuditPage>('/pos/audit/events', params as Record<string, unknown>),
};
export type { AuditPage, AuditEventRow };
