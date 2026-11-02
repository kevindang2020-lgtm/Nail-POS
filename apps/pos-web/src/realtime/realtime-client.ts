// realtime-client.ts — the POS realm's instance of the shared client (Constitution 9 §174), plus the window
// CustomEvent bridge that existing POS code and tests listen on. Reconnect-reconcile, jittered backoff, wake,
// dedupe, version guard, sequence gaps and presence reports all live in the package now.
import { api } from '../api/client';
import { apiUrl } from '../api/apiBase';   // BUILD_PLAN Phase 12: the stream is /api/v1/realtime/stream
import { createRealtimeClient, type RealtimeDetail, type RealtimeStatus } from '@aipowersalon/realtime-client';
export type { RealtimeDetail };

export const REALTIME_EVENT = 'aps:realtime';
export const REALTIME_RECONCILE = 'aps:realtime-reconcile';
export const REALTIME_STATUS = 'aps:realtime-status';

export const realtime = createRealtimeClient({ streamPath: apiUrl('/realtime/stream'), post: (p, b) => api.post(p, b) });
realtime.onEvent((detail) => window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail })));
realtime.onReconcile((reason) => window.dispatchEvent(new CustomEvent(REALTIME_RECONCILE, { detail: { reason } })));
realtime.onStatus((status) => window.dispatchEvent(new CustomEvent(REALTIME_STATUS, { detail: { status } })));

export function realtimeStatus(): RealtimeStatus { return realtime.status(); }
export function ensureRealtimeConnected(): void { realtime.connect(); }
