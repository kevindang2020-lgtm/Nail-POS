// posQueueApi.ts — tenant POS Queue API client (canonical). Same-origin; tenant/branch/role from session.
import type {   // the wire contract (Constitution 13 §15)
  QueueFilters, QueueAssignTechnicianRequest, LockQueueItemRequest, UnlockQueueItemRequest, ReorderQueueRequest, QueueHistoryRow,
  CreateQueueGroupRequest, QueueGroupView, TechnicianAvailabilityRow, AutoBalanceApplyRequest,
  AssignPlanRequest, AssignPlanResult, MoveGroupToTechQueueResult,
} from '@aipowersalon/api-contracts/tenant';
// Supersedes the earlier stub. move-to-tech-queue / move-to-serving are idempotent server-side; notify may return
// { configured:false, disabledReason } — surface that and never imply a delivered notification.
// BUILD_PLAN Phase 6: a 409 from an assign / reorder / lock carries `{ message, code, currentTechnicianId }` (the queue's
// QueueAssignmentConflict). Keep `code` and the body so the screens can say plainly who has the guest now.
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string, public body?: any) { super(message); this.name = 'ApiError'; } }
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
const BASE = apiUrl('/pos/queue');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => new ApiError(message, status, body && typeof body === 'object' ? body.code : undefined, body) });
function qs(f: QueueFilters): string { const p = new URLSearchParams(); (Object.keys(f) as (keyof QueueFilters)[]).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (qid: string, action: string, body?: unknown) => http<any>('/items/' + id(qid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const posQueueApi = {
  state: (f: QueueFilters = {}) => http<any>('/state' + qs(f)),
  kpis: () => http<any>('/kpis'),
  waitEstimate: () => http<any>('/wait-estimate'),
  items: (f: QueueFilters = {}) => http<any>('/items' + qs(f)),
  item: (qid: string) => http<any>('/items/' + id(qid)),
  create: (body: unknown) => http<any>('/items', { method: 'POST', body: JSON.stringify(body) }),
  update: (qid: string, body: unknown) => http<any>('/items/' + id(qid), { method: 'PATCH', body: JSON.stringify(body) }),
  callNext: (qid: string, body?: unknown) => post(qid, 'call-next', body),
  assignTechnician: (qid: string, body: QueueAssignTechnicianRequest) => post(qid, 'assign-technician', body),
  changeRequestedTechnician: (qid: string, body: unknown) => post(qid, 'change-requested-technician', body),
  autoBalancePreview: () => http<any>('/auto-balance/preview', { method: 'POST' }),
  autoBalanceApply: (proposals: AutoBalanceApplyRequest['proposals']) => http<any>('/auto-balance/apply', { method: 'POST', body: JSON.stringify({ proposals } satisfies AutoBalanceApplyRequest) }),
  unassignTechnician: (qid: string, body: unknown) => post(qid, 'unassign-technician', body),
  updatePriority: (qid: string, body: unknown) => post(qid, 'update-priority', body),
  /** Customer Queue mandate (Add Upsell): the visit's FULL service list (catalog-priced on the server, audited) */
  updateServices: (qid: string, body: { serviceIds: string[] }) => post(qid, 'update-services', body),
  notifyCustomer: (qid: string, body: unknown) => post(qid, 'notify-customer', body),
  moveToTechQueue: (qid: string) => post(qid, 'move-to-tech-queue'),
  startService: (qid: string) => post(qid, 'start-service'),
  moveToServing: (qid: string) => post(qid, 'move-to-serving'),
  cancel: (qid: string, body: unknown) => post(qid, 'cancel', body),
  remove: (qid: string, body: unknown) => post(qid, 'remove', body),
  // ── BUILD_PLAN Phase 6 (queue domain, modules/queue queue.controller): locks, reorder, history, parties, per-service
  // technicians, availability. lock / unlock / service-assignments answer the item detail; a 409 is
  // { code: 'VERSION_CONFLICT', currentTechnicianId, currentVersion } or { code: 'ASSIGNMENT_LOCKED', lock }.
  /** technicianId null = "keep this guest unassigned" (nobody may assign them until unlocked). */
  lock: (qid: string, body: LockQueueItemRequest) => post(qid, 'lock', body),
  unlock: (qid: string, body: UnlockQueueItemRequest) => post(qid, 'unlock', body),
  reorder: (order: ReorderQueueRequest['order']) => http<{ order: { queueItemId: string; position: number; version: number }[] }>('/reorder', { method: 'POST', body: JSON.stringify({ order } satisfies ReorderQueueRequest) }),
  history: (qid: string) => http<{ queueItemId: string; history: QueueHistoryRow[] }>('/items/' + id(qid) + '/history'),
  groups: () => http<QueueGroupView[]>('/groups'),
  createGroup: (body: CreateQueueGroupRequest) => http<QueueGroupView>('/groups', { method: 'POST', body: JSON.stringify(body) }),
  // Multi-technician routing (contract §5): the ONE writer of a per-service / party assignment — all lines or none, with the
  // technicians (and queue version) this screen showed; 409 VERSION_CONFLICT (+ serviceId) / ASSIGNMENT_LOCKED when stale.
  // Replaces PUT items/:id/service-assignments (the server keeps it for old clients; this app no longer calls it).
  assignPlan: (body: AssignPlanRequest) => http<AssignPlanResult>('/plans/assign', { method: 'POST', body: JSON.stringify(body) }),
  /** "Start party": each member's idempotent move to the technicians' queue */
  moveGroupToTechQueue: (groupId: string) => http<MoveGroupToTechQueueResult>('/groups/' + id(groupId) + '/move-to-tech-queue', { method: 'POST' }),
  availability: () => http<TechnicianAvailabilityRow[]>('/technicians/availability'),
};
export type { QueueFilters };
