// offlineActions.ts — BUILD_PLAN Phase 13 (Constitution 6 §21–22, §257): the technician actions that may be tapped
// offline. Each is journaled with ONE Idempotency-Key, replayed once on reconnect, server-validated on replay (state +
// ownership; the route is @Idempotent()), and expires: a start older than 30 min or a completion older than 2 h is not
// replayed automatically. Money is never here (cash confirmation, tips, checkout stay online-only).
import type { MutationSpec } from '@aipowersalon/mobile-sdk';
import { techApi } from '../api/techApi';

const id = (s: string) => encodeURIComponent(s);
export const START_SERVICE_TTL_MS = 30 * 60_000;
export const SERVICE_DONE_TTL_MS = 2 * 3600_000;

export interface OfflineAction { spec: MutationSpec; exec: (idempotencyKey: string) => Promise<unknown> }

export function startServiceAction(ticketId: string, label?: string, expectedVersion?: number | null): OfflineAction {
  return {
    spec: { resourceType: 'ticket', resourceId: ticketId, operation: 'tech.start_service', method: 'POST', path: `/tech/tickets/${id(ticketId)}/start-service`,
      body: {}, expectedVersion: expectedVersion ?? null, offline: 'queue', ttlMs: START_SERVICE_TTL_MS, priority: 'HIGH', label: label ?? 'Start service' },
    exec: (k) => techApi.startService(ticketId, { idempotencyKey: k }),
  };
}
export function serviceDoneAction(ticketId: string, notes?: string, label?: string, expectedVersion?: number | null): OfflineAction {
  return {
    spec: { resourceType: 'ticket', resourceId: ticketId, operation: 'tech.service_done', method: 'POST', path: `/tech/tickets/${id(ticketId)}/service-done`,
      body: notes !== undefined ? { notes } : {}, expectedVersion: expectedVersion ?? null, offline: 'queue', ttlMs: SERVICE_DONE_TTL_MS, priority: 'HIGH', label: label ?? 'Service done' },
    exec: (k) => techApi.serviceDone(ticketId, notes, { idempotencyKey: k }),
  };
}
